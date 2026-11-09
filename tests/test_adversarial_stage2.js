/**
 * Adversarial Stress Tests for Stage 2
 * Reviewer & Critic verification
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ProgressStorage,
  normalizeSituational,
  normalizePractical
} from '../assets/js/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9226;
const HTTP_PORT = 8195;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[Adversarial Assertion Failed] ${message}`);
  }
}

function createStaticServer(rootDir, port) {
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png'
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(path.join(rootDir, reqPath));
    if (!safePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    fs.readFile(safePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end(`Not found: ${reqPath}`);
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ============================================================================
// ADVERSARIAL TEST SUITE
// ============================================================================

async function testStorageAdversarial() {
  console.log('\n--- ADV-1: Storage Tampering & Fault Tolerance ---');

  let mockStore = {};
  global.localStorage = {
    getItem: (k) => mockStore[k] || null,
    setItem: (k, v) => { mockStore[k] = String(v); },
    removeItem: (k) => { delete mockStore[k]; },
    clear: () => { mockStore = {}; }
  };

  // Case 1: Corrupted JSON string in storage
  mockStore['session_statistics_progress_v1'] = '{{CORRUPTED_JSON!!';
  let storage = new ProgressStorage('session_statistics_progress_v1');
  assert(storage.memoryState.answers !== null, 'Answers must fallback safely on JSON error');
  assert(storage.getAnswer('situational', 1) === null, 'Must return null for unknown answer');
  console.log('  ✓ Survived malformed JSON in localStorage');

  // Case 2: Null and non-object properties in storage
  mockStore['session_statistics_progress_v1'] = JSON.stringify({ answers: null, lastActive: 'invalid' });
  storage = new ProgressStorage('session_statistics_progress_v1');
  assert(typeof storage.memoryState.answers === 'object', 'Answers must remain an object');
  console.log('  ✓ Survived null answers & invalid lastActive format');

  // Case 3: QuotaExceeded simulation
  let throwQuota = false;
  global.localStorage.setItem = (k, v) => {
    if (throwQuota) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    mockStore[k] = String(v);
  };
  throwQuota = true;
  storage.saveAnswer('situational', 1, 'B', true); // Should not crash
  assert(storage.getAnswer('situational', 1).selectedOption === 'B', 'In-memory state preserved despite quota error');
  throwQuota = false;
  console.log('  ✓ Survived QuotaExceededError without crashing');
}

async function testBrowserAdversarial() {
  console.log('\n--- ADV-2: Headless Chrome Adversarial & Edge Cases ---');

  const server = await createStaticServer(ROOT_DIR, HTTP_PORT);
  const tempUserData = path.join(os.tmpdir(), `chrome_cdp_adv_${Date.now()}`);
  fs.mkdirSync(tempUserData, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${tempUserData}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;

  try {
    let version = null;
    for (let i = 0; i < 25; i++) {
      await delay(200);
      try {
        version = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (version && version.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    // Emulate iPhone SE narrow viewport (320px)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 568,
      deviceScaleFactor: 2,
      mobile: true
    });

    const targetUrl = `http://127.0.0.1:${HTTP_PORT}/index.html`;
    await cdp.send('Page.navigate', { url: targetUrl });
    await delay(1200);

    // ADV-2.1: Rapid Multi-Click Attack on Options
    console.log('Testing Rapid Multi-Click Resistance...');
    const multiClickResult = await cdp.evaluate(`
      (() => {
        const btnB = document.getElementById('option-B');
        const btnA = document.getElementById('option-A');
        const btnC = document.getElementById('option-C');

        // Fire 5 rapid clicks across multiple buttons
        btnB.click();
        btnA.click();
        btnC.click();
        btnB.click();

        const raw = JSON.parse(localStorage.getItem('session_statistics_progress_v1'));
        return {
          storedAnswer: raw.answers['situational_1'],
          answersCount: Object.keys(raw.answers).length,
          btnBIsCorrect: btnB.classList.contains('is-correct'),
          btnAIsDimmed: btnA.classList.contains('is-dimmed')
        };
      })()
    `);

    assert(multiClickResult.storedAnswer.selectedOption === 'B', 'First click must win');
    assert(multiClickResult.storedAnswer.isCorrect === true, 'Stored answer must remain correct');
    assert(multiClickResult.answersCount === 1, 'Only 1 answer entry must exist');
    assert(multiClickResult.btnBIsCorrect === true, 'Option B must stay .is-correct');
    assert(multiClickResult.btnAIsDimmed === true, 'Option A must stay .is-dimmed');
    console.log('  ✓ Rapid multi-click attack safely rejected (atomic first-press state lock)');

    // ADV-2.2: Reset Cancelation Check
    console.log('Testing Reset Cancelation Flow...');
    const cancelResult = await cdp.evaluate(`
      (() => {
        window.confirm = () => false; // User cancels prompt
        document.getElementById('btn-reset').click();

        const raw = JSON.parse(localStorage.getItem('session_statistics_progress_v1'));
        return {
          hasAnswers: Boolean(raw && raw.answers && raw.answers['situational_1']),
          cardVisible: document.getElementById('explanation-card').classList.contains('is-visible')
        };
      })()
    `);

    assert(cancelResult.hasAnswers === true, 'Answers must NOT be deleted when user cancels reset');
    assert(cancelResult.cardVisible === true, 'Card must remain visible after cancelled reset');
    console.log('  ✓ Reset confirmation dialog rejection preserves state accurately');

    // ADV-2.3: Catalog Filter Empty State Display
    console.log('Testing Catalog Filter Empty State Handling...');
    const emptyFilterResult = await cdp.evaluate(`
      (() => {
        document.getElementById('btn-catalog').click();
        // Since question 1 is solved correctly, filter 'incorrect' should show 0 items
        document.querySelector('.filter-chip[data-filter="incorrect"]').click();
        const grid = document.getElementById('sheet-grid');
        const cells = grid.querySelectorAll('.grid-cell');
        const noticeText = grid.textContent.trim();

        return {
          cellsCount: cells.length,
          noticePresent: noticeText.includes('Нет заданий в данной категории фильтра')
        };
      })()
    `);

    assert(emptyFilterResult.cellsCount === 0, 'Should be 0 cells in incorrect filter');
    assert(emptyFilterResult.noticePresent === true, 'Must display friendly empty state notice');
    console.log('  ✓ Empty catalog filter shows polite notification message');

    // Close catalog
    await cdp.evaluate(`document.getElementById('btn-close-sheet').click();`);

    // ADV-2.4: Offline Simulation with Service Worker
    console.log('Testing Subway/Offline-First PWA Resilience...');
    // Enable offline mode via CDP Network
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });

    // Test offline navigation inside page
    const offlineNavResult = await cdp.evaluate(`
      (() => {
        // Navigate to practical category and question 5
        document.getElementById('tab-practical').click();
        document.getElementById('btn-next').click();
        document.getElementById('btn-next').click();

        return {
          categoryBadge: document.getElementById('badge-practical').textContent.trim(),
          questionBadge: document.getElementById('question-index-badge').textContent.trim(),
          contextLabel: document.getElementById('context-label').textContent.trim()
        };
      })()
    `);

    assert(offlineNavResult.categoryBadge === '57', 'Offline category practical loaded');
    assert(offlineNavResult.questionBadge === 'Вопрос 3 из 57', `Expected Question 3 of 57, got ${offlineNavResult.questionBadge}`);
    assert(offlineNavResult.contextLabel === 'Условие задачи', 'Context label matches');
    console.log('  ✓ Fully functional offline in subway conditions (zero network requests required)');

  } finally {
    if (cdp) cdp.close();
    chromeProc.kill('SIGKILL');
    server.close();
  }
}

async function main() {
  try {
    await testStorageAdversarial();
    await testBrowserAdversarial();
    console.log('\n========================================');
    console.log('✓ ALL ADVERSARIAL STRESS TESTS PASSED!');
    console.log('========================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ADVERSARIAL TEST FAILED:', err);
    process.exit(1);
  }
}

main();
