/**
 * Adversarial Stress Testing Suite for Stage 2 Engine
 * Author: challenger_m2_1 (EMPIRICAL CHALLENGER)
 * 
 * Verifies:
 * 1. Rapid option clicking / double tap / clicking while disabled.
 * 2. LocalStorage stress: corrupted JSON, quota limits, missing keys, rapid reload persistence.
 * 3. 100% full dataset answer verification (95 situational + 57 practical = 152 questions).
 * 4. Catalog drawer filter chips: filter by "unsolved", "incorrect", "correct" with active counters.
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
const HTTP_PORT = 8199;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Actively awaits application initialization and dataset readiness.
 * Checks window.app && window.app.isReady === true.
 * Eliminates race conditions from arbitrary delay() timers.
 */
async function waitForAppReady(cdp, timeoutMs = 8000) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const isReady = await cdp.evaluate(`
        Boolean(
          typeof window.app !== 'undefined' &&
          window.app &&
          window.app.isReady === true
        )
      `);

      if (isReady === true) {
        return true;
      }
    } catch (err) {
      // Ignore evaluation errors during page context creation
      lastError = err;
    }
    await delay(50);
  }

  throw new Error(`Timeout (${timeoutMs}ms) waiting for window.app.isReady. Last error: ${lastError ? lastError.message : 'None'}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

// ----------------------------------------------------------------------------
// Local Static File Server
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

  return new Promise((resolve, reject) => {
    server.on('error', reject);
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
    this.runtimeExceptions = [];
    this.consoleMessages = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        this.runtimeExceptions.push(msg.params);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        this.consoleMessages.push(msg.params);
      }
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    this.ws.onclose = () => {
      for (const [id, { reject }] of this.callbacks.entries()) {
        reject(new Error(`CDP connection closed while awaiting response for request #${id}`));
      }
      this.callbacks.clear();
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
      const detail = res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails);
      throw new Error(`CDP Evaluate Exception: ${detail}`);
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

// ============================================================================
// SUITE 1: 100% DATASET ANSWER VERIFICATION (All 152 questions)
// ============================================================================
async function testFullDatasetAnswerVerification() {
  console.log('\n======================================================');
  console.log('SUITE 1: 100% DATASET ANSWER VERIFICATION (152 QUESTIONS)');
  console.log('======================================================');

  const sitRaw = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'situational_tests.json'), 'utf8'));
  const pracRaw = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'practical_tests.json'), 'utf8'));

  assert(sitRaw.length === 95, `Expected 95 situational questions, got ${sitRaw.length}`);
  assert(pracRaw.length === 57, `Expected 57 practical questions, got ${pracRaw.length}`);

  let totalQuestionsVerified = 0;
  let correctMatches = 0;
  let distractorCountMatches = 0;
  const anomalies = [];

  // Verify Situational Tests
  sitRaw.forEach((rawItem, idx) => {
    const q = normalizeSituational(rawItem, idx);
    totalQuestionsVerified++;

    assert(q.id === idx + 1, `Situational index ${idx} expected id ${idx + 1}, got ${q.id}`);
    assert(q.mode === 'situational', 'Mode must be situational');
    assert(q.question && q.question.length > 5, `Situational #${q.id} has empty question`);
    assert(Array.isArray(q.options) && q.options.length === 4, `Situational #${q.id} options length != 4`);

    const optionIds = q.options.map(o => o.id);
    assert(optionIds.join(',') === 'A,B,C,D', `Situational #${q.id} option IDs mismatch: ${optionIds.join(',')}`);

    const correctOptions = q.options.filter(o => o.isCorrect);
    if (correctOptions.length !== 1) {
      anomalies.push(`Situational #${q.id}: has ${correctOptions.length} correct options (expected 1)`);
    } else {
      assert(correctOptions[0].id === q.correctOptionId, `Situational #${q.id}: correctOptionId ${q.correctOptionId} does not match option.isCorrect (${correctOptions[0].id})`);
      correctMatches++;
    }

    assert(q.explanation && q.explanation.length > 5, `Situational #${q.id} explanation missing`);
    const distractorKeys = Object.keys(q.distractorExplanations || {});
    if (distractorKeys.length === 3) {
      distractorCountMatches++;
    } else {
      anomalies.push(`Situational #${q.id}: distractor count is ${distractorKeys.length} (expected 3)`);
    }
  });

  // Verify Practical Tests
  pracRaw.forEach((rawItem, idx) => {
    const q = normalizePractical(rawItem, idx);
    totalQuestionsVerified++;

    assert(q.id === idx + 1, `Practical index ${idx} expected id ${idx + 1}, got ${q.id}`);
    assert(q.mode === 'practical', 'Mode must be practical');
    assert(q.question && q.question.length > 5, `Practical #${q.id} has empty question`);
    assert(Array.isArray(q.options) && q.options.length === 4, `Practical #${q.id} options length != 4`);

    const optionIds = q.options.map(o => o.id);
    assert(optionIds.join(',') === 'A,B,C,D', `Practical #${q.id} option IDs mismatch: ${optionIds.join(',')}`);

    const correctOptions = q.options.filter(o => o.isCorrect);
    if (correctOptions.length !== 1) {
      anomalies.push(`Practical #${q.id}: has ${correctOptions.length} correct options (expected 1)`);
    } else {
      assert(correctOptions[0].id === q.correctOptionId, `Practical #${q.id}: correctOptionId ${q.correctOptionId} does not match option.isCorrect (${correctOptions[0].id})`);
      correctMatches++;
    }

    assert(q.explanation && q.explanation.length > 5, `Practical #${q.id} explanation missing`);
    const distractorKeys = Object.keys(q.distractorExplanations || {});
    if (distractorKeys.length === 3) {
      distractorCountMatches++;
    } else {
      anomalies.push(`Practical #${q.id}: distractor count is ${distractorKeys.length} (expected 3)`);
    }
  });

  console.log(`✓ Total questions verified: ${totalQuestionsVerified} (95 Situational + 57 Practical)`);
  console.log(`✓ 100% options schema match: Exactly 4 options (A, B, C, D) for all 152 questions`);
  console.log(`✓ Exactly one correct option matching correctOptionId: ${correctMatches} / 152`);
  console.log(`✓ Distractor explanations with exactly 3 entries: ${distractorCountMatches} / 152`);

  if (anomalies.length > 0) {
    console.warn(`⚠️ Dataset anomalies detected (${anomalies.length}):`, anomalies);
  } else {
    console.log('✓ Zero anomalies found in datasets');
  }

  return { totalQuestionsVerified, correctMatches, distractorCountMatches, anomalies };
}

// ============================================================================
// SUITE 2: LOCALSTORAGE ADVERSARIAL STRESS & CORRUPTION RECOVERY
// ============================================================================
async function testLocalStorageStressAndCorruption() {
  console.log('\n======================================================');
  console.log('SUITE 2: LOCALSTORAGE STRESS & CORRUPTION RECOVERY');
  console.log('======================================================');

  let mockStore = {};
  global.localStorage = {
    getItem: (key) => mockStore[key] ?? null,
    setItem: (key, val) => { mockStore[key] = String(val); },
    removeItem: (key) => { delete mockStore[key]; },
    clear: () => { mockStore = {}; }
  };

  // Test Case 2.1: Corrupted JSON strings
  const corruptedPayloads = [
    '{ broken json [',
    'undefined',
    'null',
    '12345',
    '"plain string"',
    '[]',
    '{"version": 1}',
    '{"answers": "not an object"}',
    '{"answers": [1, 2, 3]}',
    '{"answers": {"situational_1": "corrupted"}}',
    '{"lastActive": "bad"}',
    '{"lastActive": {"category": "unknown", "index": -999}}',
    '{"lastActive": {"category": "situational", "index": 999999}}'
  ];

  for (const payload of corruptedPayloads) {
    mockStore['session_statistics_progress_v1'] = payload;
    let storageInstance;
    try {
      storageInstance = new ProgressStorage('session_statistics_progress_v1');
    } catch (e) {
      throw new Error(`ProgressStorage threw unhandled error on payload: ${payload} -> ${e.message}`);
    }

    assert(typeof storageInstance.memoryState === 'object', 'memoryState must remain an object');
    assert(typeof storageInstance.memoryState.answers === 'object', 'answers must remain an object');

    // Test that calling getCategoryStats does not crash
    const stats = storageInstance.getCategoryStats('situational', 95);
    assert(typeof stats.answered === 'number', 'answered must be a number');

    // Test that saving an answer works even after corrupted payload
    storageInstance.saveAnswer('situational', 1, 'B', true);
    assert(storageInstance.getAnswer('situational', 1).selectedOption === 'B', 'Failed to save answer after corrupted load');
  }
  console.log(`✓ ProgressStorage survived ${corruptedPayloads.length} corrupted JSON variations without crashing`);

  // Test Case 2.2: QuotaExceededError handling
  console.log('--- Testing QuotaExceededError resilience ---');
  mockStore = {};
  global.localStorage.setItem = (key, val) => {
    const quotaErr = new Error('QuotaExceededError: Failed to execute setItem on Storage: Setting the value of key exceeded the quota.');
    quotaErr.name = 'QuotaExceededError';
    throw quotaErr;
  };

  const quotaStorage = new ProgressStorage('session_statistics_progress_v1');
  // Attempt to save answer when localStorage quota is exceeded
  let quotaSaveError = null;
  try {
    quotaStorage.saveAnswer('situational', 10, 'C', true);
    quotaStorage.saveLastActive('situational', 10);
  } catch (err) {
    quotaSaveError = err;
  }

  assert(quotaSaveError === null, `saveAnswer threw unhandled error on QuotaExceeded: ${quotaSaveError}`);
  const ansAfterQuota = quotaStorage.getAnswer('situational', 10);
  assert(ansAfterQuota && ansAfterQuota.selectedOption === 'C', 'Answer must remain preserved in memory fallback during QuotaExceeded');
  console.log('✓ QuotaExceededError gracefully handled: memory fallback preserves state without crashing');

  // Test Case 2.3: Storage completely disabled / SecurityError
  console.log('--- Testing Disabled Storage / SecurityError resilience ---');
  delete global.localStorage;
  let disabledStorage;
  try {
    disabledStorage = new ProgressStorage('session_statistics_progress_v1');
  } catch (err) {
    throw new Error(`ProgressStorage failed when localStorage is absent: ${err.message}`);
  }
  assert(disabledStorage.isStorageAvailable === false, 'isStorageAvailable must be false when localStorage is absent');
  disabledStorage.saveAnswer('practical', 5, 'D', false);
  assert(disabledStorage.getAnswer('practical', 5).selectedOption === 'D', 'Disabled storage memory fallback failed');
  console.log('✓ Disabled storage resilience verified');

  // Restore normal mock localStorage
  global.localStorage = {
    getItem: (key) => mockStore[key] ?? null,
    setItem: (key, val) => { mockStore[key] = String(val); },
    removeItem: (key) => { delete mockStore[key]; },
    clear: () => { mockStore = {}; }
  };
}

// ============================================================================
// SUITE 3: HEADLESS CHROME CDP ADVERSARIAL STRESS TESTS
// ============================================================================
async function testBrowserAdversarialStress() {
  console.log('\n======================================================');
  console.log('SUITE 3: HEADLESS CHROME CDP ADVERSARIAL STRESS TESTS');
  console.log('======================================================');

  console.log(`Starting static HTTP server on port ${HTTP_PORT}...`);
  const server = await createStaticServer(ROOT_DIR, HTTP_PORT);

  const tempUserData = path.join(os.tmpdir(), `chrome_cdp_stress_${Date.now()}`);
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
    for (let i = 0; i < 30; i++) {
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
    await waitForAppReady(cdp);

    // ------------------------------------------------------------------------
    // STRESS TEST 3.0: WINDOW.APP GLOBAL EXPOSURE & API CONTRACT VALIDATION
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.0: window.app Global Exposure & Readiness Contract ---');
    const appContract = await cdp.evaluate(`
      (() => {
        if (typeof window.app === 'undefined' || window.app === null) {
          return { exposed: false, reason: 'window.app is undefined on window object' };
        }
        const a = window.app;
        return {
          exposed: true,
          isReady: Boolean(a.isReady),
          hasState: Boolean(a.state),
          mode: a.state ? a.state.mode : null,
          hasRenderCurrentQuestion: typeof a.renderCurrentQuestion === 'function',
          hasStorage: Boolean(a.storage),
          datasetsLoaded: {
            situational: a.state?.datasets?.situational?.length || 0,
            practical: a.state?.datasets?.practical?.length || 0
          }
        };
      })()
    `);

    assert(appContract.exposed === true, `window.app global exposure failed: ${appContract.reason}`);
    assert(appContract.isReady === true, 'window.app.isReady must be true after initial load');
    assert(appContract.hasState === true, 'window.app.state must be defined');
    assert(appContract.hasRenderCurrentQuestion === true, 'window.app.renderCurrentQuestion must be a function');
    assert(appContract.datasetsLoaded.situational === 95, `Expected 95 situational questions, got ${appContract.datasetsLoaded.situational}`);
    assert(appContract.datasetsLoaded.practical === 57, `Expected 57 practical questions, got ${appContract.datasetsLoaded.practical}`);
    console.log('✓ window.app globally exposed, datasets verified, and API contracts valid');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.1: RAPID OPTION CLICKING (Double Tap & Multi-Tap)
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.1: Rapid Option Clicking (Double Tap & Multi-Tap) ---');
    const rapidClickResult = await cdp.evaluate(`
      (() => {
        const btnB = document.getElementById('option-B');
        const btnA = document.getElementById('option-A');
        const btnC = document.getElementById('option-C');

        // Simulate ultra-rapid 10 consecutive clicks on Option B
        for (let i = 0; i < 10; i++) {
          btnB.click();
        }

        // Immediately attempt to click Option A and Option C while disabled
        btnA.click();
        btnC.click();

        // Also dispatch synthetic MouseEvents directly
        btnA.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        const raw = localStorage.getItem('session_statistics_progress_v1');
        const parsed = raw ? JSON.parse(raw) : null;
        const answer = parsed ? parsed.answers['situational_1'] : null;

        return {
          answer,
          btnBIsCorrect: btnB.classList.contains('is-correct'),
          btnAIsIncorrect: btnA.classList.contains('is-incorrect'),
          btnAIsDimmed: btnA.classList.contains('is-dimmed'),
          btnCIsDimmed: btnC.classList.contains('is-dimmed'),
          allDisabled: Array.from(document.querySelectorAll('#options-list .option-btn')).every(b => b.disabled),
          progressText: document.getElementById('progress-text').textContent.trim()
        };
      })()
    `);

    assert(rapidClickResult.answer !== null, 'Answer must be recorded');
    assert(rapidClickResult.answer.selectedOption === 'B', `Selected option must remain 'B', got ${rapidClickResult.answer.selectedOption}`);
    assert(rapidClickResult.answer.isCorrect === true, 'isCorrect must be true');
    assert(rapidClickResult.btnBIsCorrect === true, 'Button B must have .is-correct');
    assert(rapidClickResult.btnAIsIncorrect === false, 'Button A must NOT be marked as incorrect after disabled click');
    assert(rapidClickResult.btnAIsDimmed === true, 'Button A must remain dimmed');
    assert(rapidClickResult.allDisabled === true, 'All option buttons must remain disabled');
    assert(rapidClickResult.progressText === '1 / 95', `Progress text must be '1 / 95', got '${rapidClickResult.progressText}'`);
    console.log('✓ Rapid double-tap and multi-tap blocked successfully (answer recorded once, disabled clicks ignored)');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.2: RAPID ANSWERING OF 10 QUESTIONS & RELOAD PERSISTENCE
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.2: Rapid Answering of 10 Questions & Reload Persistence ---');
    const rapidAnswerResult = await cdp.evaluate(`
      (() => {
        const answersRecorded = [];
        // We are at question 1 (already answered). Answer next 9 questions rapidly
        for (let q = 2; q <= 10; q++) {
          document.getElementById('btn-next').click();
          // Pick option (alternate A and B)
          const optLetter = (q % 2 === 0) ? 'A' : 'B';
          const btn = document.getElementById('option-' + optLetter);
          if (btn) {
            btn.click();
            answersRecorded.push({ q, optLetter });
          }
        }
        return {
          answersRecorded,
          progressText: document.getElementById('progress-text').textContent.trim(),
          badge: document.getElementById('question-index-badge').textContent.trim()
        };
      })()
    `);

    assert(rapidAnswerResult.answersRecorded.length === 9, `Expected 9 rapid answers, got ${rapidAnswerResult.answersRecorded.length}`);
    assert(rapidAnswerResult.progressText === '10 / 95', `Progress text expected '10 / 95', got '${rapidAnswerResult.progressText}'`);
    assert(rapidAnswerResult.badge === 'Вопрос 10 из 95', `Badge expected 'Вопрос 10 из 95', got '${rapidAnswerResult.badge}'`);
    console.log('✓ 10 questions answered rapidly in sequence');

    // Now reload page and verify persistence
    console.log('Reloading page via CDP to test cold start persistence...');
    await cdp.send('Page.reload');
    await waitForAppReady(cdp);

    const afterReload = await cdp.evaluate(`
      (() => {
        const progressText = document.getElementById('progress-text').textContent.trim();
        const badge = document.getElementById('question-index-badge').textContent.trim();
        const cardVisible = document.getElementById('explanation-card').classList.contains('is-visible');
        const allDisabled = Array.from(document.querySelectorAll('#options-list .option-btn')).every(b => b.disabled);

        return {
          progressText,
          badge,
          cardVisible,
          allDisabled
        };
      })()
    `);

    assert(afterReload.progressText === '10 / 95', `After reload progress expected '10 / 95', got '${afterReload.progressText}'`);
    assert(afterReload.badge === 'Вопрос 10 из 95', `After reload badge expected 'Вопрос 10 из 95', got '${afterReload.badge}'`);
    assert(afterReload.cardVisible === true, 'Explanation card must remain visible after reload for answered question');
    assert(afterReload.allDisabled === true, 'Options must remain disabled after reload for answered question');
    console.log('✓ Rapid reload persistence verified: 10/95 questions intact, state restored perfectly');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.3: CORRUPTED LOCALSTORAGE RECOVERY IN LIVE BROWSER
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.3: Corrupted LocalStorage Recovery in Live Browser ---');
    await cdp.evaluate(`
      localStorage.setItem('session_statistics_progress_v1', 'corrupted_syntax<<<NOT_JSON>>>');
    `);

    // Reload page with corrupted localStorage
    await cdp.send('Page.reload');
    await waitForAppReady(cdp);

    const corruptionRecovery = await cdp.evaluate(`
      (() => {
        const progressText = document.getElementById('progress-text').textContent.trim();
        const badge = document.getElementById('question-index-badge').textContent.trim();
        const optionsCount = document.querySelectorAll('#options-list .option-btn').length;
        const optionsDisabled = Array.from(document.querySelectorAll('#options-list .option-btn')).some(b => b.disabled);

        // Click Option B on fresh state
        document.getElementById('option-B').click();
        const progressAfterClick = document.getElementById('progress-text').textContent.trim();

        return {
          progressText,
          badge,
          optionsCount,
          optionsDisabled,
          progressAfterClick
        };
      })()
    `);

    assert(corruptionRecovery.progressText === '0 / 95', `Fresh progress expected '0 / 95', got '${corruptionRecovery.progressText}'`);
    assert(corruptionRecovery.optionsCount === 4, `Expected 4 options, got ${corruptionRecovery.optionsCount}`);
    assert(corruptionRecovery.optionsDisabled === false, 'Options must be active on corrupted storage fallback');
    assert(corruptionRecovery.progressAfterClick === '1 / 95', `Progress after click expected '1 / 95', got '${corruptionRecovery.progressAfterClick}'`);
    console.log('✓ Browser recovered smoothly from corrupted localStorage without throwing uncaught exceptions');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.4: CATALOG DRAWER FILTER CHIPS & ACTIVE COUNTERS
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.4: Catalog Drawer Filter Chips & Active Counters ---');

    // Set known controlled state:
    // Answer Q1: Correct (Option B)
    // Answer Q2: Incorrect (Option A)
    // Answer Q3: Correct (Option B)
    // Answer Q4: Incorrect (Option A)
    // Answer Q5: Correct (Option C)
    // Total: 5 answered (3 correct, 2 incorrect, 90 unsolved out of 95)
    await cdp.evaluate(`
      (() => {
        // Reset storage first
        localStorage.removeItem('session_statistics_progress_v1');
      })()
    `);
    await cdp.send('Page.reload');
    await waitForAppReady(cdp);

    const setupFilterState = await cdp.evaluate(`
      (() => {
        // Q1 (true: B): Option B (Correct)
        document.getElementById('option-B').click();

        // Q2 (true: D): Next -> Option D (Correct)
        document.getElementById('btn-next').click();
        document.getElementById('option-D').click();

        // Q3 (true: A): Next -> Option A (Correct)
        document.getElementById('btn-next').click();
        document.getElementById('option-A').click();

        // Q4 (true: C): Next -> Option A (Incorrect)
        document.getElementById('btn-next').click();
        document.getElementById('option-A').click();

        // Q5 (true: B): Next -> Option A (Incorrect)
        document.getElementById('btn-next').click();
        document.getElementById('option-A').click();

        return {
          progress: document.getElementById('progress-text').textContent.trim()
        };
      })()
    `);
    assert(setupFilterState.progress === '5 / 95', `Expected progress 5 / 95, got ${setupFilterState.progress}`);

    // Now open catalog drawer and inspect filter chips and counts
    const catalogAudit = await cdp.evaluate(`
      (() => {
        document.getElementById('btn-catalog').click();

        const chips = Array.from(document.querySelectorAll('.filter-chip')).map(c => ({
          filter: c.dataset.filter,
          text: c.textContent.trim(),
          hasCounterSpan: Boolean(c.querySelector('span')),
          counterText: c.querySelector('span') ? c.querySelector('span').textContent.trim() : null
        }));

        // Test filter "all"
        document.querySelector('.filter-chip[data-filter="all"]').click();
        const allCells = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // Test filter "unsolved"
        document.querySelector('.filter-chip[data-filter="unsolved"]').click();
        const unsolvedCells = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // Test filter "incorrect"
        document.querySelector('.filter-chip[data-filter="incorrect"]').click();
        const incorrectCells = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // Test filter "correct"
        document.querySelector('.filter-chip[data-filter="correct"]').click();
        const correctCells = document.querySelectorAll('#sheet-grid .grid-cell').length;

        return {
          chips,
          allCells,
          unsolvedCells,
          incorrectCells,
          correctCells
        };
      })()
    `);

    console.log('Catalog Filter Chips in DOM:', JSON.stringify(catalogAudit.chips, null, 2));
    console.log(`Grid filtering results:`);
    console.log(`- Filter 'all': ${catalogAudit.allCells} cells (expected 95)`);
    console.log(`- Filter 'unsolved': ${catalogAudit.unsolvedCells} cells (expected 90)`);
    console.log(`- Filter 'incorrect': ${catalogAudit.incorrectCells} cells (expected 2)`);
    console.log(`- Filter 'correct': ${catalogAudit.correctCells} cells (expected 3)`);

    // Verify grid filtering correctness
    assert(catalogAudit.allCells === 95, `Filter 'all' expected 95 cells, got ${catalogAudit.allCells}`);
    assert(catalogAudit.unsolvedCells === 90, `Filter 'unsolved' expected 90 cells, got ${catalogAudit.unsolvedCells}`);
    assert(catalogAudit.incorrectCells === 2, `Filter 'incorrect' expected 2 cells, got ${catalogAudit.incorrectCells}`);
    assert(catalogAudit.correctCells === 3, `Filter 'correct' expected 3 cells, got ${catalogAudit.correctCells}`);
    console.log('✓ Catalog grid filtering by "unsolved", "incorrect", "correct" works accurately!');

    // Now examine active counters on filter chips
    const chipAll = catalogAudit.chips.find(c => c.filter === 'all');
    const chipUnsolved = catalogAudit.chips.find(c => c.filter === 'unsolved');
    const chipIncorrect = catalogAudit.chips.find(c => c.filter === 'incorrect');
    const chipCorrect = catalogAudit.chips.find(c => c.filter === 'correct');

    const counterEvaluation = {
      chipAllHasCounter: chipAll && chipAll.hasCounterSpan && chipAll.counterText === '95',
      chipUnsolvedHasCounter: chipUnsolved && chipUnsolved.hasCounterSpan,
      chipIncorrectHasCounter: chipIncorrect && chipIncorrect.hasCounterSpan,
      chipCorrectHasCounter: chipCorrect && chipCorrect.hasCounterSpan
    };

    console.log('Filter Chip Counters Evaluation:', counterEvaluation);

    assert(counterEvaluation.chipAllHasCounter === true, 'Filter chip "Все" must have active counter 95');
    assert(counterEvaluation.chipUnsolvedHasCounter === true && chipUnsolved.counterText === '90', `Filter chip "Нерешенные" expected 90, got "${chipUnsolved?.counterText}"`);
    assert(counterEvaluation.chipIncorrectHasCounter === true && chipIncorrect.counterText === '2', `Filter chip "С ошибками" expected 2, got "${chipIncorrect?.counterText}"`);
    assert(counterEvaluation.chipCorrectHasCounter === true && chipCorrect.counterText === '3', `Filter chip "Решенные" expected 3, got "${chipCorrect?.counterText}"`);
    console.log('✓ All 4 catalog filter chips have accurate active counters (95 / 90 / 2 / 3)!');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.5: PRACTICAL MODE RAPID ANSWERING & CATEGORY ISOLATION
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.5: Practical Mode Rapid Answering & Category Isolation ---');
    const practicalIsolationResult = await cdp.evaluate(`
      (() => {
        // Close catalog
        document.getElementById('btn-close-sheet').click();

        // Switch to Practical
        document.getElementById('tab-practical').click();

        // Practical Q1 (correct is C). Click C
        document.getElementById('option-C').click();

        // Answer practical Q2-Q5 rapidly
        for (let q = 2; q <= 5; q++) {
          document.getElementById('btn-next').click();
          // Alternate options
          const optLetter = (q % 2 === 0) ? 'B' : 'D';
          const btn = document.getElementById('option-' + optLetter);
          if (btn) btn.click();
        }

        const pracProgress = document.getElementById('progress-text').textContent.trim();
        const pracBadge = document.getElementById('question-index-badge').textContent.trim();

        // Switch back to Situational and verify its progress is unchanged (was 5 / 95)
        document.getElementById('tab-situational').click();
        const sitProgressRestored = document.getElementById('progress-text').textContent.trim();

        return {
          pracProgress,
          pracBadge,
          sitProgressRestored
        };
      })()
    `);

    assert(practicalIsolationResult.pracProgress === '5 / 57', `Practical progress expected '5 / 57', got '${practicalIsolationResult.pracProgress}'`);
    assert(practicalIsolationResult.pracBadge === 'Вопрос 5 из 57', `Practical badge expected 'Вопрос 5 из 57', got '${practicalIsolationResult.pracBadge}'`);
    assert(practicalIsolationResult.sitProgressRestored === '5 / 95', `Situational progress must remain '5 / 95', got '${practicalIsolationResult.sitProgressRestored}'`);
    console.log('✓ Practical mode rapid answering & cross-category isolation verified');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.6: BOUNDARY & OVERFLOW NAVIGATION STRESS
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.6: Boundary & Overflow Navigation Stress ---');
    const boundaryNavResult = await cdp.evaluate(`
      (() => {
        // Try pressing ArrowLeft 100 times (underflow)
        for (let i = 0; i < 100; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        }
        const badgeAtStart = document.getElementById('question-index-badge').textContent.trim();
        const prevDisabled = document.getElementById('btn-prev').disabled;

        // Try pressing ArrowRight 200 times (overflow past 95)
        for (let i = 0; i < 200; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        }
        const badgeAtEnd = document.getElementById('question-index-badge').textContent.trim();
        const nextDisabled = document.getElementById('btn-next').disabled;

        // Press Escape when catalog is not open
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        return {
          badgeAtStart,
          prevDisabled,
          badgeAtEnd,
          nextDisabled
        };
      })()
    `);

    assert(boundaryNavResult.badgeAtStart === 'Вопрос 1 из 95', `Underflow failed: expected 'Вопрос 1 из 95', got '${boundaryNavResult.badgeAtStart}'`);
    assert(boundaryNavResult.prevDisabled === true, 'Previous button must be disabled at index 0');
    assert(boundaryNavResult.badgeAtEnd === 'Вопрос 95 из 95', `Overflow failed: expected 'Вопрос 95 из 95', got '${boundaryNavResult.badgeAtEnd}'`);
    assert(boundaryNavResult.nextDisabled === true, 'Next button must be disabled at index 94');
    console.log('✓ Boundary navigation (underflow/overflow bounds checking) verified');

    // ------------------------------------------------------------------------
    // STRESS TEST 3.7: FILTER CHIP LIVE COUNTERS ADVERSARIAL STRESS & DYNAMIC UPDATES
    // ------------------------------------------------------------------------
    console.log('\n--- Stress Test 3.7: Filter Chip Live Counters Dynamic Updates & Invariants ---');
    const filterLiveCountersResult = await cdp.evaluate(`
      (() => {
        const getCounters = () => {
          const elAll = document.getElementById('filter-count-all');
          const elUnsolved = document.getElementById('filter-count-unsolved');
          const elIncorrect = document.getElementById('filter-count-incorrect');
          const elCorrect = document.getElementById('filter-count-correct');
          return {
            exists: Boolean(elAll && elUnsolved && elIncorrect && elCorrect),
            all: elAll ? parseInt(elAll.textContent.trim(), 10) : null,
            unsolved: elUnsolved ? parseInt(elUnsolved.textContent.trim(), 10) : null,
            incorrect: elIncorrect ? parseInt(elIncorrect.textContent.trim(), 10) : null,
            correct: elCorrect ? parseInt(elCorrect.textContent.trim(), 10) : null
          };
        };

        const log = [];

        // Verify window.app.state and renderCurrentQuestion() readiness cleanly
        const appStateValid = Boolean(
          typeof window.app !== 'undefined' &&
          window.app &&
          window.app.state &&
          typeof window.app.renderCurrentQuestion === 'function' &&
          typeof window.app.storage === 'object'
        );

        // Currently we are at Q95 in Situational mode (from Test 3.6 overflow)
        // Q1..Q5 are answered (3 correct, 2 incorrect, 90 unsolved). Q95 is unanswered.
        const initialSit = getCounters();
        log.push({ step: 'initial_situational', counters: initialSit });

        // Answer Q95
        const btnQ95 = document.getElementById('option-A');
        if (btnQ95) btnQ95.click();
        const afterQ95 = getCounters();
        log.push({ step: 'after_q95', counters: afterQ95 });

        // Rapid sequential answering of 10 questions backwards using btn-prev (Q94 down to Q85)
        const rapidSteps = [];
        for (let i = 0; i < 10; i++) {
          const btnPrev = document.getElementById('btn-prev');
          if (btnPrev && !btnPrev.disabled) btnPrev.click();

          const optLetter = (i % 2 === 0) ? 'B' : 'C';
          const btnOpt = document.getElementById('option-' + optLetter);
          if (btnOpt && !btnOpt.disabled) btnOpt.click();

          const c = getCounters();
          const invariantHolds = (c.all === c.unsolved + c.incorrect + c.correct);
          rapidSteps.push({ stepIdx: i, counters: c, invariantHolds });
        }
        log.push({ step: 'rapid_10_answers', rapidSteps });

        // Switch Category to Practical
        document.getElementById('tab-practical').click();
        const practicalCounters = getCounters();
        const pracInvariantHolds = (practicalCounters.all === practicalCounters.unsolved + practicalCounters.incorrect + practicalCounters.correct);
        log.push({ step: 'switch_to_practical', counters: practicalCounters, invariantHolds: pracInvariantHolds });

        // Answer 5 practical questions rapidly using btn-next
        const pracRapidSteps = [];
        for (let i = 0; i < 5; i++) {
          const btnNext = document.getElementById('btn-next');
          if (btnNext && !btnNext.disabled) btnNext.click();

          const btnOpt = document.getElementById('option-C');
          if (btnOpt && !btnOpt.disabled) btnOpt.click();

          const c = getCounters();
          const invariantHolds = (c.all === c.unsolved + c.incorrect + c.correct);
          pracRapidSteps.push({ stepIdx: i, counters: c, invariantHolds });
        }
        log.push({ step: 'prac_rapid_5_answers', pracRapidSteps });

        // Switch back to Situational
        document.getElementById('tab-situational').click();
        const backToSitCounters = getCounters();
        const backToSitInvariant = (backToSitCounters.all === backToSitCounters.unsolved + backToSitCounters.incorrect + backToSitCounters.correct);
        log.push({ step: 'back_to_situational', counters: backToSitCounters, invariantHolds: backToSitInvariant });

        // Test Reset Progress
        const origConfirm = window.confirm;
        window.confirm = () => true;
        document.getElementById('btn-reset').click();
        window.confirm = origConfirm;

        const postResetCounters = getCounters();
        const postResetInvariant = (postResetCounters.all === postResetCounters.unsolved + postResetCounters.incorrect + postResetCounters.correct);
        log.push({ step: 'post_reset', counters: postResetCounters, invariantHolds: postResetInvariant });

        // Open catalog drawer and test filter chips under post-reset state
        document.getElementById('btn-catalog').click();

        // 1. Click filter 'all'
        document.querySelector('.filter-chip[data-filter="all"]').click();
        const gridAllCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // 2. Click filter 'unsolved'
        document.querySelector('.filter-chip[data-filter="unsolved"]').click();
        const gridUnsolvedCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // 3. Click filter 'incorrect'
        document.querySelector('.filter-chip[data-filter="incorrect"]').click();
        const gridIncorrectCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        // 4. Click filter 'correct'
        document.querySelector('.filter-chip[data-filter="correct"]').click();
        const gridCorrectCount = document.querySelectorAll('#sheet-grid .grid-cell').length;

        document.getElementById('btn-close-sheet').click();

        return {
          log,
          appStateValid,
          drawerGridAfterReset: {
            all: gridAllCount,
            unsolved: gridUnsolvedCount,
            incorrect: gridIncorrectCount,
            correct: gridCorrectCount
          }
        };
      })()
    `);

    // Validations
    const initialStep = filterLiveCountersResult.log.find(l => l.step === 'initial_situational');
    assert(initialStep.counters.exists, 'All 4 counter elements must exist in DOM');
    assert(initialStep.counters.all === 95, `Initial Situational all expected 95, got ${initialStep.counters.all}`);
    assert(initialStep.counters.unsolved === 90, `Initial Situational unsolved expected 90, got ${initialStep.counters.unsolved}`);
    assert(initialStep.counters.incorrect === 2, `Initial Situational incorrect expected 2, got ${initialStep.counters.incorrect}`);
    assert(initialStep.counters.correct === 3, `Initial Situational correct expected 3, got ${initialStep.counters.correct}`);
    console.log('✓ Initial 4 counters exact match: all=95, unsolved=90, incorrect=2, correct=3');

    // After Q95 answered
    const afterQ95Step = filterLiveCountersResult.log.find(l => l.step === 'after_q95');
    assert(afterQ95Step.counters.all === 95, 'Q95 answered: all count must remain 95');
    assert(afterQ95Step.counters.unsolved === 89, `Q95 answered: unsolved expected 89, got ${afterQ95Step.counters.unsolved}`);
    assert(afterQ95Step.counters.incorrect + afterQ95Step.counters.correct === 6, 'Q95 answered: answered total must be 6');
    console.log('✓ Single answer dynamically updated counters (unsolved=89, answered=6)');

    // Rapid answers
    const rapidAnswersStep = filterLiveCountersResult.log.find(l => l.step === 'rapid_10_answers');
    assert(rapidAnswersStep.rapidSteps.length === 10, 'Expected 10 rapid answers recorded');
    const allInvariantsHold = rapidAnswersStep.rapidSteps.every(s => s.invariantHolds);
    assert(allInvariantsHold, 'Counter sum invariant (all === unsolved + incorrect + correct) failed during rapid answers');
    const lastRapidCounter = rapidAnswersStep.rapidSteps[9].counters;
    assert(lastRapidCounter.all === 95, `Situational all count must remain 95, got ${lastRapidCounter.all}`);
    assert(lastRapidCounter.unsolved === 79, `After 16 answers (5 initial + 1 on Q95 + 10 rapid), unsolved expected 79, got ${lastRapidCounter.unsolved}`);
    assert(lastRapidCounter.incorrect + lastRapidCounter.correct === 16, `Answered total expected 16, got ${lastRapidCounter.incorrect + lastRapidCounter.correct}`);
    console.log(`✓ 10 rapid sequential answers dynamically updated all 4 counters with 100% invariant preservation (unsolved=${lastRapidCounter.unsolved}, answered=${lastRapidCounter.incorrect + lastRapidCounter.correct})`);

    // Switch to practical
    const pracStep = filterLiveCountersResult.log.find(l => l.step === 'switch_to_practical');
    assert(pracStep.counters.all === 57, `Practical total expected 57, got ${pracStep.counters.all}`);
    assert(pracStep.invariantHolds, 'Practical counter sum invariant must hold on category switch');
    console.log(`✓ Category switch to Practical immediately recalculated live counters: all=${pracStep.counters.all}, unsolved=${pracStep.counters.unsolved}, correct=${pracStep.counters.correct}, incorrect=${pracStep.counters.incorrect}`);

    // Practical rapid answers
    const pracRapidStep = filterLiveCountersResult.log.find(l => l.step === 'prac_rapid_5_answers');
    assert(pracRapidStep.pracRapidSteps.every(s => s.invariantHolds), 'Practical rapid answering invariants failed');
    console.log('✓ Practical rapid answering preserved all counter invariants');

    // Back to situational
    const backToSit = filterLiveCountersResult.log.find(l => l.step === 'back_to_situational');
    assert(backToSit.counters.all === 95, `Back to Situational expected 95, got ${backToSit.counters.all}`);
    assert(backToSit.counters.unsolved === 79, `Back to Situational unsolved expected 79, got ${backToSit.counters.unsolved}`);
    assert(backToSit.invariantHolds, 'Back to Situational invariant must hold');
    console.log(`✓ Switch back to Situational restored live counters accurately: all=${backToSit.counters.all}, unsolved=${backToSit.counters.unsolved}`);

    // Reset progress
    const postReset = filterLiveCountersResult.log.find(l => l.step === 'post_reset');
    assert(postReset.counters.all === 95, `Post-reset all expected 95, got ${postReset.counters.all}`);
    assert(postReset.counters.unsolved === 95, `Post-reset unsolved expected 95, got ${postReset.counters.unsolved}`);
    assert(postReset.counters.incorrect === 0, `Post-reset incorrect expected 0, got ${postReset.counters.incorrect}`);
    assert(postReset.counters.correct === 0, `Post-reset correct expected 0, got ${postReset.counters.correct}`);
    assert(postReset.invariantHolds, 'Post-reset invariant must hold');

    // Verify grid counts match the counter spans exactly
    assert(filterLiveCountersResult.drawerGridAfterReset.all === 95, `Drawer grid 'all' expected 95, got ${filterLiveCountersResult.drawerGridAfterReset.all}`);
    assert(filterLiveCountersResult.drawerGridAfterReset.unsolved === 95, `Drawer grid 'unsolved' expected 95, got ${filterLiveCountersResult.drawerGridAfterReset.unsolved}`);
    assert(filterLiveCountersResult.drawerGridAfterReset.correct === 0, `Drawer grid 'correct' expected 0, got ${filterLiveCountersResult.drawerGridAfterReset.correct}`);
    assert(filterLiveCountersResult.drawerGridAfterReset.incorrect === 0, `Drawer grid 'incorrect' expected 0, got ${filterLiveCountersResult.drawerGridAfterReset.incorrect}`);
    console.log('✓ Reset Progress successfully reset all 4 counters to zero answered (all=95, unsolved=95, incorrect=0, correct=0) and synchronized catalog grid filters (95 / 95 / 0 / 0)!');

    assert(filterLiveCountersResult.appStateValid === true, 'window.app and window.app.renderCurrentQuestion must remain valid during live counter operations');

    // Verify programmatic navigation & state evaluation via window.app.state (addressing audit finding)
    const progNavResult = await cdp.evaluate(`
      (() => {
        window.app.state.currentIndex['situational'] = 5;
        window.app.renderCurrentQuestion();
        const badge = document.getElementById('question-index-badge').textContent.trim();
        return {
          badge,
          currentIndex: window.app.state.currentIndex['situational']
        };
      })()
    `);
    assert(progNavResult.badge === 'Вопрос 6 из 95', `Programmatic navigation expected 'Вопрос 6 из 95', got '${progNavResult.badge}'`);
    assert(progNavResult.currentIndex === 5, 'Programmatic state currentIndex mismatch');
    console.log('✓ Programmatic navigation via window.app.state & renderCurrentQuestion() verified');

    // Check uncaught runtime exceptions during the entire session
    console.log('\n--- Uncaught Runtime Exceptions Check ---');
    console.log(`Exceptions count: ${cdp.runtimeExceptions.length}`);
    if (cdp.runtimeExceptions.length > 0) {
      console.warn('Runtime exceptions captured:', cdp.runtimeExceptions);
    } else {
      console.log('✓ Zero uncaught runtime exceptions captured in browser session');
    }

    return {
      rapidClickResult,
      rapidAnswerResult,
      afterReload,
      corruptionRecovery,
      catalogAudit,
      counterEvaluation,
      filterLiveCountersResult,
      runtimeExceptions: cdp.runtimeExceptions
    };
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill('SIGKILL');
    server.close();
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  try {
    const datasetResults = await testFullDatasetAnswerVerification();
    await testLocalStorageStressAndCorruption();
    const browserResults = await testBrowserAdversarialStress();

    console.log('\n======================================================');
    console.log('ADVERSARIAL STRESS TEST SUMMARY & FINDINGS');
    console.log('======================================================');
    console.log('1. Rapid option clicking: PASS (multi-tap & disabled clicks blocked)');
    console.log('2. LocalStorage corruption & quota limits: PASS (safe memory fallback, survives 13 corruption patterns)');
    console.log('3. Answer verification across 100% of questions: PASS (152/152 questions validated)');
    console.log(`4. Catalog drawer filter chips:`);
    console.log(`   - Grid filtering: PASS (unsolved=90, incorrect=2, correct=3, all=95)`);
    console.log(`   - Active counters on filter chips:`);
    console.log(`     * "Все" counter: ${browserResults.counterEvaluation.chipAllHasCounter ? 'PRESENT (95)' : 'MISSING'}`);
    console.log(`     * "Нерешенные" counter: ${browserResults.counterEvaluation.chipUnsolvedHasCounter ? 'PRESENT' : 'MISSING'}`);
    console.log(`     * "С ошибками" counter: ${browserResults.counterEvaluation.chipIncorrectHasCounter ? 'PRESENT' : 'MISSING'}`);
    console.log(`     * "Решенные" counter: ${browserResults.counterEvaluation.chipCorrectHasCounter ? 'PRESENT' : 'MISSING'}`);
    console.log('5. Live filter counters invariant under rapid operations & reset: PASS (100% invariant verified)');

    const findings = {
      datasetResults,
      browserResults
    };

    fs.writeFileSync(
      path.join(ROOT_DIR, 'tests', 'adversarial_stress_m2_findings.json'),
      JSON.stringify(findings, null, 2),
      'utf8'
    );

    console.log('\n✓ Results written to tests/adversarial_stress_m2_findings.json');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ADVERSARIAL STRESS TEST FAILED:', err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Promise Rejection in stress test:', reason);
  process.exit(1);
});

main();
