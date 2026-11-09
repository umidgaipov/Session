/**
 * Automated Test Suite for Stage 2 (Engine, Checking, Storage, Catalog, SW)
 * Tests unit logic and runs real Headless Chrome CDP tests via local HTTP server.
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
const CDP_PORT = 9224;
const HTTP_PORT = 8193;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

// ----------------------------------------------------------------------------
// Local Static File Server for CDP Testing
// ----------------------------------------------------------------------------
function createStaticServer(rootDir, port) {
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
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

// ----------------------------------------------------------------------------
// CDP Client
// ----------------------------------------------------------------------------
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
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails);
      throw new Error(`CDP Evaluate Exception: ${desc}`);
    }
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

// ----------------------------------------------------------------------------
// UNIT TESTS (Data Normalization & ProgressStorage in Node)
// ----------------------------------------------------------------------------
async function runUnitTests() {
  console.log('\n========================================');
  console.log('PART 1: UNIT & INTEGRATION TESTS');
  console.log('========================================');

  // 1. Data files exist and have correct item counts
  const sitRaw = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'situational_tests.json'), 'utf8'));
  const pracRaw = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'practical_tests.json'), 'utf8'));

  assert(Array.isArray(sitRaw) && sitRaw.length === 95, `Expected 95 situational questions, got ${sitRaw.length}`);
  assert(Array.isArray(pracRaw) && pracRaw.length === 57, `Expected 57 practical questions, got ${pracRaw.length}`);
  console.log(`✓ Dataset counts verified: Situational = ${sitRaw.length}, Practical = ${pracRaw.length} (Total: 152)`);

  // 2. Normalization verification
  const normalizedSit = sitRaw.map(normalizeSituational);
  const normalizedPrac = pracRaw.map(normalizePractical);

  assert(normalizedSit[0].id === 1, 'Situational id should be 1');
  assert(normalizedSit[0].mode === 'situational', 'Mode must be situational');
  assert(normalizedSit[0].contextLabel === 'Ситуационный кейс', 'Context label mismatch');
  assert(normalizedSit[0].options.length === 4, 'Situational item must have 4 options');
  assert(normalizedSit[0].correctOptionId === 'B', 'Situational item 1 correct option should be B');
  assert(typeof normalizedSit[0].explanation === 'string' && normalizedSit[0].explanation.length > 10, 'Missing explanation');
  assert(Object.keys(normalizedSit[0].distractorExplanations).length === 3, 'Expected 3 distractor explanations for item 1');
  console.log('✓ Situational normalization verified');

  assert(normalizedPrac[0].id === 1, 'Practical id should be 1');
  assert(normalizedPrac[0].mode === 'practical', 'Mode must be practical');
  assert(normalizedPrac[0].contextLabel === 'Условие задачи', 'Context label mismatch');
  assert(normalizedPrac[0].options.length === 4, 'Practical item must have 4 options');
  assert(normalizedPrac[0].correctOptionId === 'C', 'Practical item 1 correct option should be C');
  assert(typeof normalizedPrac[0].explanation === 'string' && normalizedPrac[0].explanation.length > 10, 'Missing explanation');
  console.log('✓ Practical normalization verified');

  // 3. Storage Unit Tests (In-memory mock for Node)
  // Mock localStorage for Node environment testing
  const mockStorageStore = {};
  global.localStorage = {
    getItem: (key) => mockStorageStore[key] || null,
    setItem: (key, val) => { mockStorageStore[key] = String(val); },
    removeItem: (key) => { delete mockStorageStore[key]; },
    clear: () => { Object.keys(mockStorageStore).forEach((k) => delete mockStorageStore[k]); }
  };

  const storage = new ProgressStorage('test_session_progress');

  // Test saveAnswer & getAnswer with composite key isolation
  storage.saveAnswer('situational', 1, 'B', true);
  storage.saveAnswer('practical', 1, 'C', true);

  const sitAns1 = storage.getAnswer('situational', 1);
  const pracAns1 = storage.getAnswer('practical', 1);

  assert(sitAns1 && sitAns1.selectedOption === 'B' && sitAns1.isCorrect === true, 'Situational 1 answer corrupted');
  assert(pracAns1 && pracAns1.selectedOption === 'C' && pracAns1.isCorrect === true, 'Practical 1 answer corrupted');
  console.log('✓ Storage composite key isolation verified (${category}_${id})');

  // Test category stats computation
  storage.saveAnswer('situational', 2, 'A', false); // 1 correct, 1 incorrect out of 95
  const sitStats = storage.getCategoryStats('situational', 95);
  assert(sitStats.total === 95, `Expected 95 total, got ${sitStats.total}`);
  assert(sitStats.answered === 2, `Expected 2 answered, got ${sitStats.answered}`);
  assert(sitStats.correct === 1, `Expected 1 correct, got ${sitStats.correct}`);
  assert(sitStats.incorrect === 1, `Expected 1 incorrect, got ${sitStats.incorrect}`);
  assert(sitStats.percentage === Math.round((2 / 95) * 100), `Incorrect percentage: ${sitStats.percentage}`);
  console.log('✓ Category statistics calculation verified');

  // Test clearAll
  storage.clearAll();
  assert(storage.getAnswer('situational', 1) === null, 'Storage clearAll failed to clear situational answer');
  assert(storage.getAnswer('practical', 1) === null, 'Storage clearAll failed to clear practical answer');
  console.log('✓ Storage clearAll verified');

  // 4. Service Worker file syntax & content checks
  const swCode = fs.readFileSync(path.join(ROOT_DIR, 'sw.js'), 'utf8');
  assert(swCode.includes("const CACHE_NAME = 'session-stat-v2';") || swCode.includes("const CACHE_NAME = 'session-stat-v1';"), 'sw.js must contain CACHE_NAME');
  assert(swCode.includes("'situational_tests.json'"), 'sw.js must precache situational_tests.json');
  assert(swCode.includes("'practical_tests.json'"), 'sw.js must precache practical_tests.json');
  assert(swCode.includes('skipWaiting'), 'sw.js must call skipWaiting');
  assert(swCode.includes('clients.claim'), 'sw.js must call clients.claim');
  console.log('✓ Service Worker static integrity verified');
}

// ----------------------------------------------------------------------------
// E2E CDP TESTS (Headless Chrome & Local HTTP Server)
// ----------------------------------------------------------------------------
async function runBrowserTests() {
  console.log('\n========================================');
  console.log('PART 2: HEADLESS CHROME E2E CDP TESTS');
  console.log('========================================');

  console.log(`Starting static HTTP server on port ${HTTP_PORT}...`);
  const server = await createStaticServer(ROOT_DIR, HTTP_PORT);

  const tempUserData = path.join(os.tmpdir(), `chrome_cdp_stage2_${Date.now()}`);
  fs.mkdirSync(tempUserData, { recursive: true });

  console.log(`Launching headless Chrome on port ${CDP_PORT}...`);
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

    if (!version || !version.webSocketDebuggerUrl) {
      throw new Error('Failed to connect to Chrome remote debugging port');
    }

    const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Emulate iPhone 14 Pro mobile viewport (390x844)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });

    const targetUrl = `http://127.0.0.1:${HTTP_PORT}/index.html`;
    console.log(`Navigating to ${targetUrl}...`);
    await cdp.send('Page.navigate', { url: targetUrl });

    // Wait for data load and DOM initialization
    await delay(1000);

    // TEST 1: Initial Render
    console.log('\n--- Test 2.1: Initial DOM State & Data Loading ---');
    const initialState = await cdp.evaluate(`
      (() => {
        return {
          badgeSit: document.getElementById('badge-situational').textContent.trim(),
          badgePrac: document.getElementById('badge-practical').textContent.trim(),
          questionBadge: document.getElementById('question-index-badge').textContent.trim(),
          categoryText: document.getElementById('category-text').textContent.trim(),
          contextLabel: document.getElementById('context-label').textContent.trim(),
          optionsCount: document.querySelectorAll('#options-list .option-btn').length,
          prevDisabled: document.getElementById('btn-prev').disabled,
          nextDisabled: document.getElementById('btn-next').disabled,
          explanationVisible: document.getElementById('explanation-card').classList.contains('is-visible')
        };
      })()
    `);

    assert(initialState.badgeSit === '95', `Badge situational expected 95, got ${initialState.badgeSit}`);
    assert(initialState.badgePrac === '57', `Badge practical expected 57, got ${initialState.badgePrac}`);
    assert(initialState.questionBadge === 'Вопрос 1 из 95', `Question badge expected "Вопрос 1 из 95", got "${initialState.questionBadge}"`);
    assert(initialState.optionsCount === 4, `Expected 4 option buttons, got ${initialState.optionsCount}`);
    assert(initialState.prevDisabled === true, 'Previous button must be disabled on question 1');
    assert(initialState.nextDisabled === false, 'Next button must be enabled on question 1');
    assert(initialState.explanationVisible === false, 'Explanation card must be hidden initially');
    console.log('✓ Initial DOM render verified (95 situational tests loaded, 4 options rendered, explanation hidden)');

    // TEST 2: Answer Checking (Correct Option B)
    console.log('\n--- Test 2.2: Answer Evaluation (Correct Option B) ---');
    const answerResult = await cdp.evaluate(`
      (() => {
        const btnB = document.getElementById('option-B');
        btnB.click();
        const card = document.getElementById('explanation-card');
        const pill = document.getElementById('explanation-status-pill');
        const distractors = document.querySelectorAll('#distractors-list .distractor-item');
        const progressText = document.getElementById('progress-text').textContent.trim();

        return {
          btnBIsCorrect: btnB.classList.contains('is-correct'),
          btnAIsDimmed: document.getElementById('option-A').classList.contains('is-dimmed'),
          btnCIsDimmed: document.getElementById('option-C').classList.contains('is-dimmed'),
          btnDIsDimmed: document.getElementById('option-D').classList.contains('is-dimmed'),
          allDisabled: Array.from(document.querySelectorAll('#options-list .option-btn')).every(b => b.disabled && b.classList.contains('is-disabled')),
          cardVisible: card.classList.contains('is-visible'),
          pillText: pill.textContent.trim(),
          pillIsCorrect: pill.classList.contains('is-correct'),
          distractorCount: distractors.length,
          progressText
        };
      })()
    `);

    assert(answerResult.btnBIsCorrect === true, 'Option B should have .is-correct');
    assert(answerResult.btnAIsDimmed && answerResult.btnCIsDimmed && answerResult.btnDIsDimmed, 'Other options must be dimmed');
    assert(answerResult.allDisabled === true, 'All option buttons must be disabled after answer');
    assert(answerResult.cardVisible === true, 'Explanation card must be visible');
    assert(answerResult.pillText === 'Верно', `Status pill text expected "Верно", got "${answerResult.pillText}"`);
    assert(answerResult.pillIsCorrect === true, 'Status pill should have .is-correct');
    assert(answerResult.distractorCount === 3, `Expected 3 distractor items, got ${answerResult.distractorCount}`);
    assert(answerResult.progressText === '1 / 95', `Progress text expected "1 / 95", got "${answerResult.progressText}"`);
    console.log('✓ Correct answer evaluation verified (.is-correct, distractors anatomy, progress update)');

    // TEST 3: LocalStorage Persistence
    console.log('\n--- Test 2.3: LocalStorage State Persistence ---');
    const storedData = await cdp.evaluate(`
      (() => {
        const raw = localStorage.getItem('session_statistics_progress_v1');
        return raw ? JSON.parse(raw) : null;
      })()
    `);

    assert(storedData && storedData.answers, 'Stored data must have answers');
    assert(storedData.answers['situational_1'], 'Must have key situational_1');
    assert(storedData.answers['situational_1'].selectedOption === 'B', 'Stored option must be B');
    assert(storedData.answers['situational_1'].isCorrect === true, 'Stored isCorrect must be true');
    console.log('✓ LocalStorage persistence verified (key session_statistics_progress_v1, composite key situational_1)');

    // TEST 4: Navigation to Question 2 and Incorrect Answer Evaluation
    console.log('\n--- Test 2.4: Navigation & Incorrect Answer Evaluation ---');
    const q2Result = await cdp.evaluate(`
      (() => {
        // Click Next
        document.getElementById('btn-next').click();
        const badgeAfterNext = document.getElementById('question-index-badge').textContent.trim();
        const prevEnabled = !document.getElementById('btn-prev').disabled;

        // Click incorrect option A on question 2
        document.getElementById('option-A').click();

        const btnA = document.getElementById('option-A');
        const pill = document.getElementById('explanation-status-pill');
        const progressText = document.getElementById('progress-text').textContent.trim();

        return {
          badgeAfterNext,
          prevEnabled,
          btnAIsIncorrect: btnA.classList.contains('is-incorrect'),
          pillText: pill.textContent.trim(),
          pillIsIncorrect: pill.classList.contains('is-incorrect'),
          progressText
        };
      })()
    `);

    assert(q2Result.badgeAfterNext === 'Вопрос 2 из 95', `Expected "Вопрос 2 из 95", got "${q2Result.badgeAfterNext}"`);
    assert(q2Result.prevEnabled === true, 'Previous button should be enabled on question 2');
    assert(q2Result.btnAIsIncorrect === true, 'Option A should have .is-incorrect');
    assert(q2Result.pillText === 'Неверно', `Status pill should say "Неверно", got "${q2Result.pillText}"`);
    assert(q2Result.pillIsIncorrect === true, 'Status pill should have .is-incorrect');
    assert(q2Result.progressText === '2 / 95', `Progress text expected "2 / 95", got "${q2Result.progressText}"`);
    console.log('✓ Navigation to Question 2 & incorrect answer evaluation verified');

    // TEST 5: Category Switching (Situational -> Practical)
    console.log('\n--- Test 2.5: Category Switching (Situational -> Practical) ---');
    const switchResult = await cdp.evaluate(`
      (() => {
        document.getElementById('tab-practical').click();
        return {
          tabPracActive: document.getElementById('tab-practical').classList.contains('is-active'),
          tabSitActive: document.getElementById('tab-situational').classList.contains('is-active'),
          questionBadge: document.getElementById('question-index-badge').textContent.trim(),
          contextLabel: document.getElementById('context-label').textContent.trim(),
          progressText: document.getElementById('progress-text').textContent.trim()
        };
      })()
    `);

    assert(switchResult.tabPracActive === true && switchResult.tabSitActive === false, 'Tab practical must be active');
    assert(switchResult.questionBadge === 'Вопрос 1 из 57', `Expected "Вопрос 1 из 57", got "${switchResult.questionBadge}"`);
    assert(switchResult.contextLabel === 'Условие задачи', `Expected "Условие задачи", got "${switchResult.contextLabel}"`);
    assert(switchResult.progressText === '0 / 57', `Expected "0 / 57", got "${switchResult.progressText}"`);
    console.log('✓ Category switching verified (57 practical tasks, condition label, isolated progress)');

    // Switch back to Situational and verify question 2 state restored
    const restoreResult = await cdp.evaluate(`
      (() => {
        document.getElementById('tab-situational').click();
        return {
          questionBadge: document.getElementById('question-index-badge').textContent.trim(),
          progressText: document.getElementById('progress-text').textContent.trim(),
          optionAIsIncorrect: document.getElementById('option-A').classList.contains('is-incorrect'),
          cardVisible: document.getElementById('explanation-card').classList.contains('is-visible')
        };
      })()
    `);
    assert(restoreResult.questionBadge === 'Вопрос 2 из 95', 'Question 2 state must be restored on tab return');
    assert(restoreResult.optionAIsIncorrect === true, 'Option A must still be marked as incorrect');
    assert(restoreResult.cardVisible === true, 'Explanation card must remain visible for answered question');
    console.log('✓ State restoration on category return verified');

    // TEST 6: Catalog Bottom Sheet Drawer & Filter Chips
    console.log('\n--- Test 2.6: Catalog Bottom Sheet Drawer & Filter Chips ---');
    const sheetResult = await cdp.evaluate(`
      (() => {
        // Open catalog
        document.getElementById('btn-catalog').click();
        const backdropOpen = document.getElementById('sheet-backdrop').classList.contains('is-open');
        const gridCells = document.querySelectorAll('#sheet-grid .grid-cell');
        const cell1Correct = gridCells[0].classList.contains('is-correct');
        const cell2Incorrect = gridCells[1].classList.contains('is-incorrect');
        const cell2Current = gridCells[1].classList.contains('is-current');

        // Test filter: correct
        document.querySelector('.filter-chip[data-filter="correct"]').click();
        const correctCellsCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // Test filter: incorrect
        document.querySelector('.filter-chip[data-filter="incorrect"]').click();
        const incorrectCellsCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // Test filter: all
        document.querySelector('.filter-chip[data-filter="all"]').click();
        const allCellsCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        const filterCountAll = document.getElementById('filter-count-all')?.textContent.trim();
        const filterCountUnsolved = document.getElementById('filter-count-unsolved')?.textContent.trim();
        const filterCountIncorrect = document.getElementById('filter-count-incorrect')?.textContent.trim();
        const filterCountCorrect = document.getElementById('filter-count-correct')?.textContent.trim();

        // Click cell 10 to navigate
        const cell10 = document.querySelectorAll('#sheet-grid .grid-cell')[9];
        cell10.click();

        const backdropClosedAfterClick = !document.getElementById('sheet-backdrop').classList.contains('is-open');
        const badgeAfterJump = document.getElementById('question-index-badge').textContent.trim();

        return {
          backdropOpen,
          totalCells: gridCells.length,
          cell1Correct,
          cell2Incorrect,
          cell2Current,
          correctCellsCount,
          incorrectCellsCount,
          allCellsCount,
          filterCountAll,
          filterCountUnsolved,
          filterCountIncorrect,
          filterCountCorrect,
          backdropClosedAfterClick,
          badgeAfterJump
        };
      })()
    `);

    assert(sheetResult.backdropOpen === true, 'Sheet backdrop must have .is-open');
    assert(sheetResult.totalCells === 95, `Expected 95 cells in grid, got ${sheetResult.totalCells}`);
    assert(sheetResult.cell1Correct === true, 'Cell 1 must have .is-correct');
    assert(sheetResult.cell2Incorrect === true, 'Cell 2 must have .is-incorrect');
    assert(sheetResult.cell2Current === true, 'Cell 2 must have .is-current');
    assert(sheetResult.correctCellsCount === 1, `Expected 1 cell with filter "correct", got ${sheetResult.correctCellsCount}`);
    assert(sheetResult.incorrectCellsCount === 1, `Expected 1 cell with filter "incorrect", got ${sheetResult.incorrectCellsCount}`);
    assert(sheetResult.allCellsCount === 95, `Expected 95 cells with filter "all", got ${sheetResult.allCellsCount}`);
    assert(sheetResult.filterCountAll === '95', `Filter counter "all" expected 95, got ${sheetResult.filterCountAll}`);
    assert(sheetResult.filterCountUnsolved === '93', `Filter counter "unsolved" expected 93, got ${sheetResult.filterCountUnsolved}`);
    assert(sheetResult.filterCountIncorrect === '1', `Filter counter "incorrect" expected 1, got ${sheetResult.filterCountIncorrect}`);
    assert(sheetResult.filterCountCorrect === '1', `Filter counter "correct" expected 1, got ${sheetResult.filterCountCorrect}`);
    assert(sheetResult.backdropClosedAfterClick === true, 'Sheet should close after selecting a cell');
    assert(sheetResult.badgeAfterJump === 'Вопрос 10 из 95', `Expected "Вопрос 10 из 95", got "${sheetResult.badgeAfterJump}"`);
    console.log('✓ Catalog Bottom Sheet verified (95 cells, counters: 95/93/1/1, filters: correct/incorrect/all, jump to question)');

    // TEST 7: Reset Progress
    console.log('\n--- Test 2.7: Reset Progress Confirmation ---');
    const resetResult = await cdp.evaluate(`
      (() => {
        // Mock window.confirm to return true
        window.confirm = () => true;
        document.getElementById('btn-reset').click();

        const progressText = document.getElementById('progress-text').textContent.trim();
        const questionBadge = document.getElementById('question-index-badge').textContent.trim();
        const rawStorage = localStorage.getItem('session_statistics_progress_v1');
        const cardVisible = document.getElementById('explanation-card').classList.contains('is-visible');
        const filterCountAll = document.getElementById('filter-count-all')?.textContent.trim();
        const filterCountUnsolved = document.getElementById('filter-count-unsolved')?.textContent.trim();
        const filterCountIncorrect = document.getElementById('filter-count-incorrect')?.textContent.trim();
        const filterCountCorrect = document.getElementById('filter-count-correct')?.textContent.trim();

        return {
          progressText,
          questionBadge,
          rawStorage,
          cardVisible,
          filterCountAll,
          filterCountUnsolved,
          filterCountIncorrect,
          filterCountCorrect
        };
      })()
    `);

    assert(resetResult.progressText === '0 / 95', `Progress text expected "0 / 95", got "${resetResult.progressText}"`);
    assert(resetResult.rawStorage === null, 'LocalStorage must be cleared on reset');
    assert(resetResult.cardVisible === false, 'Explanation card must be hidden after reset');
    assert(resetResult.filterCountAll === '95', `Filter count all expected 95 after reset, got ${resetResult.filterCountAll}`);
    assert(resetResult.filterCountUnsolved === '95', `Filter count unsolved expected 95 after reset, got ${resetResult.filterCountUnsolved}`);
    assert(resetResult.filterCountIncorrect === '0', `Filter count incorrect expected 0 after reset, got ${resetResult.filterCountIncorrect}`);
    assert(resetResult.filterCountCorrect === '0', `Filter count correct expected 0 after reset, got ${resetResult.filterCountCorrect}`);
    console.log('✓ Progress reset flow verified (storage cleared, counters 0 / 95, filter chips reset to 95/95/0/0, fresh card state)');

    console.log('\n========================================');
    console.log('ALL E2E BROWSER TESTS PASSED 100%!');
    console.log('========================================\n');
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill('SIGKILL');
    server.close();
  }
}

async function main() {
  try {
    await runUnitTests();
    await runBrowserTests();
    console.log('✓ ALL STAGE 2 VERIFICATION SUITES COMPLETED SUCCESSFULLY.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST RUN FAILED:', err);
    process.exit(1);
  }
}

main();
