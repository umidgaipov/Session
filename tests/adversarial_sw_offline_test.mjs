/**
 * Session — Statistics Mobile Test Platform
 * Empirical Adversarial Test Suite for Service Worker & Subway Offline Readiness
 * 
 * Verifies:
 * 1. Cache manifest completeness (all critical local assets)
 * 2. Real Headless Chrome CDP offline emulation (Network.emulateNetworkConditions: offline=true)
 * 3. Physical server shutdown offline test (zero socket connection)
 * 4. Offline page reload and complete rendering
 * 5. Offline dataset availability (95 situational + 57 practical = 152 questions)
 * 6. Offline question answering, checking, and explanation display
 * 7. Offline localStorage state persistence across hard reloads
 * 8. Offline category tab switching and catalog drawer navigation
 * 9. URL edge cases (root '/', index.html, query strings) while offline
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9228;
const HTTP_PORT = 8295;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

// ----------------------------------------------------------------------------
// Local Static HTTP Server
// ----------------------------------------------------------------------------
function createStaticServer(rootDir, port) {
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
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
      res.setHeader('Service-Worker-Allowed', '/');
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ----------------------------------------------------------------------------
// CDP Client via native WebSocket
// ----------------------------------------------------------------------------
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
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
      } else if (msg.method) {
        const listeners = this.eventListeners.get(msg.method) || [];
        for (const listener of listeners) {
          listener(msg.params);
        }
      }
    };
  }

  on(method, callback) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(callback);
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
      throw new Error(`JS Eval Exception: ${JSON.stringify(res.exceptionDetails)}`);
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
// MAIN TEST RUNNER
// ----------------------------------------------------------------------------
async function runAdversarialOfflineTests() {
  console.log('===============================================================');
  console.log(' SESSION — ADVERSARIAL SERVICE WORKER & OFFLINE TEST HARNESS   ');
  console.log('===============================================================\n');

  const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };

  function record(name, pass, info = '') {
    testResults.total++;
    if (pass) {
      testResults.passed++;
      console.log(`  ✓ PASS: ${name}${info ? ' (' + info + ')' : ''}`);
    } else {
      testResults.failed++;
      console.error(`  ✗ FAIL: ${name}${info ? ' (' + info + ')' : ''}`);
    }
    testResults.details.push({ name, pass, info });
  }

  // --------------------------------------------------------------------------
  // Phase 1: Static Code and Manifest Integrity Verification
  // --------------------------------------------------------------------------
  console.log('--- Phase 1: Static Manifest & File Integrity ---');

  const swPath = path.join(ROOT_DIR, 'sw.js');
  assert(fs.existsSync(swPath), 'sw.js file must exist at project root');
  const swCode = fs.readFileSync(swPath, 'utf8');

  // Verify critical assets in CORE_PRECACHE_ASSETS
  const requiredCoreAssets = [
    './',
    'index.html',
    'assets/css/styles.css',
    'assets/js/app.js',
    'situational_tests.json',
    'practical_tests.json'
  ];

  for (const asset of requiredCoreAssets) {
    const included = swCode.includes(`'${asset}'`) || swCode.includes(`"${asset}"`);
    record(`sw.js includes manifest asset: ${asset}`, included);
  }

  // Verify file existence on disk for all manifest assets
  const diskAssetsToCheck = [
    { name: 'index.html', path: path.join(ROOT_DIR, 'index.html') },
    { name: 'assets/css/styles.css', path: path.join(ROOT_DIR, 'assets/css/styles.css') },
    { name: 'assets/js/app.js', path: path.join(ROOT_DIR, 'assets/js/app.js') },
    { name: 'situational_tests.json', path: path.join(ROOT_DIR, 'situational_tests.json') },
    { name: 'practical_tests.json', path: path.join(ROOT_DIR, 'practical_tests.json') }
  ];

  for (const item of diskAssetsToCheck) {
    const exists = fs.existsSync(item.path);
    const size = exists ? fs.statSync(item.path).size : 0;
    record(`Asset exists on disk and non-empty: ${item.name}`, exists && size > 100, `${size} bytes`);
  }

  // Validate JSON data schemas and counts
  const sitJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'situational_tests.json'), 'utf8'));
  const pracJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'practical_tests.json'), 'utf8'));
  record('situational_tests.json count matches 95 items', sitJson.length === 95, `count=${sitJson.length}`);
  record('practical_tests.json count matches 57 items', pracJson.length === 57, `count=${pracJson.length}`);

  // Lifecycle hooks in sw.js
  record('sw.js calls skipWaiting()', swCode.includes('skipWaiting()'));
  record('sw.js calls clients.claim()', swCode.includes('clients.claim()'));
  record('sw.js implements cache-first fetch handler', swCode.includes('caches.match(event.request)'));
  record('sw.js has navigation offline fallback', swCode.includes("event.request.mode === 'navigate'") && swCode.includes('index.html'));

  // --------------------------------------------------------------------------
  // Phase 2: Live Browser CDP Setup & Service Worker Activation
  // --------------------------------------------------------------------------
  console.log('\n--- Phase 2: Live Browser Headless CDP & SW Activation ---');

  let server = await createStaticServer(ROOT_DIR, HTTP_PORT);
  console.log(`Local static server running on http://127.0.0.1:${HTTP_PORT}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-sw-test-'));

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--window-size=390,844'
  ]);

  let cdp;
  try {
    await delay(1200);

    const versionData = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    console.log(`Connected to Chrome: ${versionData['Browser']}`);

    const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
    const pageTarget = targets.find((t) => t.type === 'page');
    assert(pageTarget, 'Page target not found in Chrome');

    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    const consoleMessages = [];
    const pageErrors = [];

    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = params.args.map((a) => a.value || a.description).join(' ');
      consoleMessages.push({ type: params.type, text });
      if (params.type === 'error') {
        console.warn(`    [Browser Console Error]: ${text}`);
      }
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      const err = params.exceptionDetails.exception?.description || params.exceptionDetails.text;
      pageErrors.push(err);
      console.error(`    [Browser Exception]: ${err}`);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    // 1. Initial Online Navigation to register SW
    console.log('Navigating to initial page online to install SW...');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });
    await delay(2500);

    // Verify page title and initial DOM
    const initialTitle = await cdp.evaluate('document.title');
    record('Online initial page load succeeds', initialTitle.includes('Session'), initialTitle);

    // Wait for Service Worker registration and active status
    let swState = await cdp.evaluate(`
      (async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return { registered: false };
        return {
          supported: true,
          registered: true,
          scope: reg.scope,
          active: !!reg.active,
          installing: !!reg.installing,
          waiting: !!reg.waiting
        };
      })()
    `);

    // If still activating, wait a moment
    let retries = 10;
    while (retries > 0 && (!swState.registered || !swState.active)) {
      await delay(500);
      swState = await cdp.evaluate(`
        (async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          if (!reg) return { registered: false };
          return {
            supported: true,
            registered: true,
            scope: reg.scope,
            active: !!reg.active,
            installing: !!reg.installing,
            waiting: !!reg.waiting
          };
        })()
      `);
      retries--;
    }

    record('Service Worker is registered and active', swState.registered && swState.active, JSON.stringify(swState));

    // Verify Cache Storage population
    const cacheInspection = await cdp.evaluate(`
      (async () => {
        const cacheNames = await caches.keys();
        const targetCache = cacheNames.find(n => n === 'session-stat-v2' || n === 'session-stat-v1');
        if (!targetCache) {
          return { found: false, names: cacheNames };
        }
        const cache = await caches.open(targetCache);
        const requests = await cache.keys();
        const urls = requests.map(r => r.url);
        
        // Inspect content of cached files
        const checks = {};
        for (const req of requests) {
          const res = await cache.match(req);
          const text = await res.text();
          const cleanUrl = req.url.split('/').pop() || '/';
          checks[cleanUrl] = {
            status: res.status,
            ok: res.ok,
            length: text.length
          };
        }
        return { found: true, targetCache, urls, checks };
      })()
    `);

    record("Cache 'session-stat-v2' (or 'session-stat-v1') exists in CacheStorage", cacheInspection.found);

    const cachedFiles = cacheInspection.urls.map((u) => u.split('/').pop() || '/');
    console.log('    Cached items count:', cacheInspection.urls.length);

    record("Cache contains index.html or './'", cacheInspection.urls.some((u) => u.endsWith('/index.html') || u.endsWith('/')));
    record('Cache contains styles.css', cacheInspection.urls.some((u) => u.includes('styles.css')));
    record('Cache contains app.js', cacheInspection.urls.some((u) => u.includes('app.js')));
    record('Cache contains situational_tests.json', cacheInspection.urls.some((u) => u.includes('situational_tests.json')));
    record('Cache contains practical_tests.json', cacheInspection.urls.some((u) => u.includes('practical_tests.json')));

    // Verify cached dataset file sizes match expectations (characters count in UTF-8 string)
    const cachedSit = Object.entries(cacheInspection.checks).find(([k]) => k.includes('situational_tests.json'));
    const cachedPrac = Object.entries(cacheInspection.checks).find(([k]) => k.includes('practical_tests.json'));
    record('Cached situational_tests.json has full content', cachedSit && cachedSit[1].length > 300000, `chars=${cachedSit ? cachedSit[1].length : 0}`);
    record('Cached practical_tests.json has full content', cachedPrac && cachedPrac[1].length > 200000, `chars=${cachedPrac ? cachedPrac[1].length : 0}`);

    // ------------------------------------------------------------------------
    // Phase 3: DISCONNECT NETWORK (100% OFFLINE SIMULATION)
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 3: Simulating 100% Disconnected Subway Network ---');

    // 1. CDP Network.emulateNetworkConditions (offline = true)
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });

    // 2. ALSO shut down the HTTP server physically!
    await new Promise((resolve) => server.close(resolve));
    console.log('Static HTTP server closed! Network is 100% severed at both CDP and socket level.');

    // Verify online status in browser
    const isOnline = await cdp.evaluate('navigator.onLine');
    record('Browser reports navigator.onLine === false', isOnline === false, `onLine=${isOnline}`);

    // Verify that attempting to fetch an uncached external asset FAILS as expected (proving offline isolation)
    const testFetchFailed = await cdp.evaluate(`
      (async () => {
        try {
          await fetch('http://127.0.0.1:${HTTP_PORT}/non-existent-uncached-probe.xyz', { cache: 'no-store' });
          return false; // Should not succeed!
        } catch (e) {
          return true; // Expected failure
        }
      })()
    `);
    record('Uncached network requests fail 100% while offline', testFetchFailed);

    // ------------------------------------------------------------------------
    // Phase 4: Cold Reload Under 100% Offline Subway Conditions
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 4: Full Page Reload in Subway Offline Mode ---');

    // Reload the page while completely offline
    await cdp.send('Page.reload', { ignoreCache: false });
    await delay(2500);

    // Verify page rendered from SW cache
    const offlineTitle = await cdp.evaluate('document.title');
    record('Page successfully reloads from SW cache while 100% offline', offlineTitle.includes('Session'), offlineTitle);

    // Check offline datasets length and content
    const offlineDatasetsDebug = await cdp.evaluate(`
      (async () => {
        const mod = await import('./assets/js/app.js');
        const app = mod.app;
        const badgeSit = document.getElementById('badge-situational')?.textContent.trim();
        const badgePrac = document.getElementById('badge-practical')?.textContent.trim();
        return {
          hasApp: !!app,
          sitCount: app?.state?.datasets?.situational?.length,
          pracCount: app?.state?.datasets?.practical?.length,
          badgeSit,
          badgePrac,
          cardTitle: document.getElementById('question-topic')?.textContent,
          contextText: document.getElementById('context-text')?.textContent
        };
      })()
    `);
    console.log('    Offline datasets debug:', JSON.stringify(offlineDatasetsDebug));

    const appInitialized = offlineDatasetsDebug.sitCount === 95 && 
                           offlineDatasetsDebug.pracCount === 57 &&
                           offlineDatasetsDebug.badgeSit === '95' &&
                           offlineDatasetsDebug.badgePrac === '57';
    record('App engine initialized offline with 95 situational + 57 practical datasets', appInitialized, `sit=${offlineDatasetsDebug.sitCount}, prac=${offlineDatasetsDebug.pracCount}`);


    // Check Question 1 UI rendering
    const q1Rendered = await cdp.evaluate(`
      (() => {
        const topic = document.getElementById('question-topic')?.textContent || '';
        const prompt = document.getElementById('question-prompt')?.textContent || '';
        const optionsCount = document.querySelectorAll('.option-btn').length;
        const badgeText = document.getElementById('question-index-badge')?.textContent || '';
        return {
          topic,
          prompt,
          optionsCount,
          badgeText,
          valid: topic.length > 5 && prompt.length > 5 && optionsCount === 4
        };
      })()
    `);
    record('Question 1 rendered correctly offline (topic, prompt, 4 options)', q1Rendered.valid, `${q1Rendered.topic.substring(0, 30)}...`);

    // ------------------------------------------------------------------------
    // Phase 5: Solving, Navigation and LocalStorage Persistence Offline
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 5: Solving Questions & LocalStorage Persistence Offline ---');

    // Answer Question 1 (Situational): click option B
    const answerQ1Result = await cdp.evaluate(`
      (() => {
        const optionB = document.getElementById('option-B');
        if (!optionB) return { clicked: false };
        optionB.click();

        const isChecked = optionB.classList.contains('is-correct') || optionB.classList.contains('is-incorrect');
        const explanationVisible = document.getElementById('explanation-card')?.classList.contains('is-visible');
        
        // Inspect LocalStorage directly
        const stored = JSON.parse(localStorage.getItem('session_statistics_progress_v1') || '{}');
        const ansEntry = stored.answers?.['situational_1'];

        return {
          clicked: true,
          isChecked,
          explanationVisible,
          hasStoredAnswer: !!ansEntry,
          selectedOption: ansEntry?.selectedOption,
          isCorrect: ansEntry?.isCorrect
        };
      })()
    `);

    record('Option B click evaluated and styled offline', answerQ1Result.isChecked);
    record('Explanation card displayed offline after answering', answerQ1Result.explanationVisible);
    record('Answer persisted to LocalStorage offline', answerQ1Result.hasStoredAnswer && answerQ1Result.selectedOption === 'B');

    // Navigate to Question 2 offline
    const navQ2Result = await cdp.evaluate(`
      (() => {
        const btnNext = document.getElementById('btn-next');
        btnNext.click();
        const badge = document.getElementById('question-index-badge')?.textContent || '';
        const topic = document.getElementById('question-topic')?.textContent || '';
        const options = document.querySelectorAll('.option-btn');
        return {
          badge,
          topic,
          optionsCount: options.length,
          isQ2: badge.includes('2 из 95')
        };
      })()
    `);
    record('Offline forward navigation to Question 2', navQ2Result.isQ2, navQ2Result.badge);

    // Answer Question 2 (click option A) offline
    const answerQ2Result = await cdp.evaluate(`
      (() => {
        const optionA = document.getElementById('option-A');
        optionA.click();
        const stored = JSON.parse(localStorage.getItem('session_statistics_progress_v1') || '{}');
        const ansEntry = stored.answers?.['situational_2'];
        return {
          stored: !!ansEntry,
          selected: ansEntry?.selectedOption
        };
      })()
    `);
    record('Question 2 answered and saved to LocalStorage offline', answerQ2Result.stored && answerQ2Result.selected === 'A');

    // ------------------------------------------------------------------------
    // Phase 6: Switch Category to Practical Tasks Offline
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 6: Category Tab Switching Offline ---');

    const switchPracticalResult = await cdp.evaluate(`
      (async () => {
        const tabPrac = document.getElementById('tab-practical');
        tabPrac.click();
        const mod = await import('./assets/js/app.js');
        const currentMode = mod.app.state.mode;
        const badge = document.getElementById('question-index-badge')?.textContent || '';
        const topic = document.getElementById('question-topic')?.textContent || '';
        const optionsCount = document.querySelectorAll('.option-btn').length;
        const isTabActive = tabPrac.classList.contains('is-active');
        return {
          currentMode,
          isTabActive,
          badge,
          topic,
          optionsCount,
          isPractical: currentMode === 'practical' && isTabActive && badge.includes('из 57')
        };
      })()
    `);
    record('Switched to Practical category offline (57 questions)', switchPracticalResult.isPractical, switchPracticalResult.badge);

    // Answer Practical Question 1 offline (click option C)
    const answerPrac1Result = await cdp.evaluate(`
      (() => {
        const optionC = document.getElementById('option-C');
        optionC.click();
        const stored = JSON.parse(localStorage.getItem('session_statistics_progress_v1') || '{}');
        const ansEntry = stored.answers?.['practical_1'];
        return {
          stored: !!ansEntry,
          selected: ansEntry?.selectedOption,
          isCorrect: ansEntry?.isCorrect
        };
      })()
    `);
    record('Practical Question 1 answered and saved to LocalStorage offline', answerPrac1Result.stored && answerPrac1Result.selected === 'C');

    // ------------------------------------------------------------------------
    // Phase 7: Catalog Drawer Navigation Offline
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 7: Catalog Drawer Navigation Offline ---');

    const catalogResult = await cdp.evaluate(`
      (() => {
        const btnCat = document.getElementById('btn-catalog');
        btnCat.click();
        const backdrop = document.getElementById('sheet-backdrop');
        const isOpen = backdrop.classList.contains('is-open');
        const cells = document.querySelectorAll('.grid-cell');
        
        // Click cell 10 (Question 10)
        let clickedCell10 = false;
        if (cells.length >= 10) {
          cells[9].click();
          clickedCell10 = true;
        }

        const newBadge = document.getElementById('question-index-badge')?.textContent || '';
        const newTopic = document.getElementById('question-topic')?.textContent || '';
        return {
          isOpen,
          cellsCount: cells.length,
          clickedCell10,
          newBadge,
          newTopic,
          jumpedTo10: newBadge.includes('10 из 57')
        };
      })()
    `);
    record('Catalog drawer opens and displays 57 items offline', catalogResult.cellsCount === 57);
    record('Direct jump to Question 10 from catalog offline', catalogResult.jumpedTo10, catalogResult.newBadge);

    // ------------------------------------------------------------------------
    // Phase 8: Hard Reload & State Restoration While 100% Offline
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 8: Hard Reload & State Restoration While Offline ---');

    // Perform another page reload while server is completely stopped and offline mode active
    await cdp.send('Page.reload', { ignoreCache: false });
    await delay(2500);

    const restoreResult = await cdp.evaluate(`
      (async () => {
        const mod = await import('./assets/js/app.js');
        const mode = mod.app.state.mode;
        const currentIdx = mod.app.state.currentIndex[mode];
        const badge = document.getElementById('question-index-badge')?.textContent || '';
        const stored = JSON.parse(localStorage.getItem('session_statistics_progress_v1') || '{}');
        const sit1 = stored.answers?.['situational_1'];
        const sit2 = stored.answers?.['situational_2'];
        const prac1 = stored.answers?.['practical_1'];

        return {
          mode,
          currentIdx,
          badge,
          hasSit1: !!sit1,
          hasSit2: !!sit2,
          hasPrac1: !!prac1,
          allStored: !!(sit1 && sit2 && prac1)
        };
      })()
    `);

    record('Page restored active category (practical) after offline reload', restoreResult.mode === 'practical');
    record('Restored question index after offline reload', restoreResult.badge.includes('10 из 57'), restoreResult.badge);
    record('All previously saved answers intact in LocalStorage after reload', restoreResult.allStored);

    // ------------------------------------------------------------------------
    // Phase 9: URL Navigation Edge Cases Offline (Root '/' and Query Strings)
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 9: URL Edge Cases Offline (Root, Subpaths, Query params) ---');

    // 1. Navigation to root URL: http://127.0.0.1:8295/
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
    await delay(2000);
    const rootNavTitle = await cdp.evaluate('document.title');
    record("Offline navigation to root '/' successfully served by SW", rootNavTitle.includes('Session'), rootNavTitle);

    // 2. Navigation with query params: http://127.0.0.1:8295/?subway=metro_mode
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/?subway=metro_mode` });
    await delay(2000);
    const queryNavTitle = await cdp.evaluate('document.title');
    record("Offline navigation with query params '/?subway=metro_mode' served by SW", queryNavTitle.includes('Session'), queryNavTitle);

    // Check for any unhandled JavaScript exceptions during the entire run
    record('Zero uncaught exceptions during offline session', pageErrors.length === 0, pageErrors.join('; '));

  } finally {
    if (cdp) {
      try { cdp.close(); } catch {}
    }
    if (chromeProc) {
      try { chromeProc.kill(); } catch {}
    }
    await delay(1000);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      // Ignored if Windows file locks linger on temp dir
    }
    try {
      server.close();
    } catch {}
  }

  // --------------------------------------------------------------------------
  // Summary & Report
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(` RESULTS: ${testResults.passed} / ${testResults.total} PASSED (${testResults.failed} FAILED)`);
  console.log('===============================================================');

  const verdict = testResults.failed === 0 ? 'APPROVE' : 'REJECT/REQUEST_CHANGES';
  console.log(`VERDICT: ${verdict}\n`);

  // Write machine-readable result
  const resultJsonPath = path.join(ROOT_DIR, 'tests', 'adversarial_sw_offline_result.json');
  fs.writeFileSync(resultJsonPath, JSON.stringify({ verdict, ...testResults }, null, 2));

  return testResults.failed === 0;
}

runAdversarialOfflineTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  });
