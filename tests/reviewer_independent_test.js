import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert';

const ROOT_DIR = 'd:\\projects\\Session';
const PORT = 8371;
const CDP_PORT = 9371;

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome executable not found');
}

function startServer() {
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  };

  const server = http.createServer((req, res) => {
    let cleanUrl = req.url.split('?')[0];
    if (cleanUrl === '/' || cleanUrl === '') cleanUrl = '/index.html';
    const filePath = path.join(ROOT_DIR, cleanUrl.replace(/^\//, ''));

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Reviewer Server] Running on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(data.error.message));
          else cb.resolve(data.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${res.exceptionDetails.text} (${JSON.stringify(res.exceptionDetails)})`);
    }
    return res.result.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runIndependentAudit() {
  console.log('=================================================================');
  console.log('REVIEWER INDEPENDENT VERIFICATION & ADVERSARIAL STRESS AUDIT');
  console.log('=================================================================');

  const server = await startServer();
  const chromePath = findChromePath();
  const userDataDir = path.join(os.tmpdir(), `reviewer_chrome_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ]);

  let cdp;

  try {
    await new Promise(r => setTimeout(r, 1200));

    // Get CDP WebSocket target
    const targetInfo = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          const list = JSON.parse(raw);
          const page = list.find(t => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) resolve(page);
          else reject(new Error('No debuggable page found'));
        });
      }).on('error', reject);
    });

    cdp = new CdpConnection(targetInfo.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1200));

    // Ensure completely fresh state
    await cdp.evaluate(`
      localStorage.clear();
      location.reload();
    `);
    await new Promise(r => setTimeout(r, 1200));

    // ------------------------------------------------------------------------
    // CHECK 1: Filter chip live counts precision through full lifecycle
    // ------------------------------------------------------------------------
    console.log('\n--- CHECK 1: Filter Chip Live Count Accuracy Lifecycle ---');

    const initialCounters = await cdp.evaluate(`
      (() => {
        return {
          all: document.getElementById('filter-count-all')?.textContent.trim(),
          unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
          incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
          correct: document.getElementById('filter-count-correct')?.textContent.trim()
        };
      })()
    `);
    console.log('Initial Counters (Situational Cold Start):', initialCounters);
    assert.strictEqual(initialCounters.all, '95', 'Initial All count must be 95');
    assert.strictEqual(initialCounters.unsolved, '95', 'Initial Unsolved count must be 95');
    assert.strictEqual(initialCounters.incorrect, '0', 'Initial Incorrect count must be 0');
    assert.strictEqual(initialCounters.correct, '0', 'Initial Correct count must be 0');
    console.log('✓ Initial counts match baseline: 95 / 95 / 0 / 0');

    // Answer Q1 correctly
    await cdp.evaluate(`document.getElementById('option-B').click();`);
    const afterQ1 = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('After Q1 Correct Answer:', afterQ1);
    assert.strictEqual(afterQ1.all, '95', 'All count must remain 95');
    assert.strictEqual(afterQ1.unsolved, '94', 'Unsolved must decrement to 94');
    assert.strictEqual(afterQ1.incorrect, '0', 'Incorrect must be 0');
    assert.strictEqual(afterQ1.correct, '1', 'Correct must increment to 1');
    console.log('✓ Answer Q1 correctly: 95 / 94 / 0 / 1');

    // Navigate to Q2 and answer incorrectly
    await cdp.evaluate(`
      document.getElementById('btn-next').click();
      document.getElementById('option-A').click();
    `);
    const afterQ2 = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('After Q2 Incorrect Answer:', afterQ2);
    assert.strictEqual(afterQ2.all, '95', 'All count must remain 95');
    assert.strictEqual(afterQ2.unsolved, '93', 'Unsolved must decrement to 93');
    assert.strictEqual(afterQ2.incorrect, '1', 'Incorrect must increment to 1');
    assert.strictEqual(afterQ2.correct, '1', 'Correct must remain 1');
    console.log('✓ Answer Q2 incorrectly: 95 / 93 / 1 / 1');

    // Switch Category to Practical
    console.log('\n--- Switching to Practical Mode (57 questions) ---');
    await cdp.evaluate(`document.getElementById('tab-practical').click();`);
    const practicalCounters = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('Practical Counters (Cold Switch):', practicalCounters);
    assert.strictEqual(practicalCounters.all, '57', 'Practical All count must be 57');
    assert.strictEqual(practicalCounters.unsolved, '57', 'Practical Unsolved count must be 57');
    assert.strictEqual(practicalCounters.incorrect, '0', 'Practical Incorrect count must be 0');
    assert.strictEqual(practicalCounters.correct, '0', 'Practical Correct count must be 0');
    console.log('✓ Category switch to Practical: 57 / 57 / 0 / 0');

    // Answer Practical Q1 with option B (which is incorrect, since C is correct)
    await cdp.evaluate(`document.getElementById('option-B').click();`);
    const practicalAfterQ1 = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('Practical after Q1 incorrect answer (Option B):', practicalAfterQ1);
    assert.strictEqual(practicalAfterQ1.all, '57');
    assert.strictEqual(practicalAfterQ1.unsolved, '56');
    assert.strictEqual(practicalAfterQ1.incorrect, '1');
    assert.strictEqual(practicalAfterQ1.correct, '0');
    console.log('✓ Answer Practical Q1 incorrectly: 57 / 56 / 1 / 0');

    // Answer Practical Q2 (navigate next, click option A or find correct option)
    await cdp.evaluate(`
      document.getElementById('btn-next').click();
      // On Q2, find which option is correct or click option C
      document.getElementById('option-B').click();
    `);
    const practicalAfterQ2 = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('Practical after Q2 answer:', practicalAfterQ2);
    assert.strictEqual(practicalAfterQ2.all, '57');
    assert.strictEqual(practicalAfterQ2.unsolved, '55');
    assert.strictEqual(Number(practicalAfterQ2.incorrect) + Number(practicalAfterQ2.correct), 2);
    console.log(`✓ Answer Practical Q2: 57 / 55 / ${practicalAfterQ2.incorrect} / ${practicalAfterQ2.correct}`);

    // Switch back to Situational - counts must reflect situational state (95 / 93 / 1 / 1)
    await cdp.evaluate(`document.getElementById('tab-situational').click();`);
    const backToSitCounters = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('Back to Situational counters:', backToSitCounters);
    assert.strictEqual(backToSitCounters.all, '95');
    assert.strictEqual(backToSitCounters.unsolved, '93');
    assert.strictEqual(backToSitCounters.incorrect, '1');
    assert.strictEqual(backToSitCounters.correct, '1');
    console.log('✓ Category return preserves situational counts: 95 / 93 / 1 / 1');

    // Reset progress
    console.log('\n--- Reset Progress Test ---');
    await cdp.evaluate(`
      window.confirm = () => true;
      document.getElementById('btn-reset').click();
    `);
    const afterResetCounters = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('Counters after reset:', afterResetCounters);
    assert.strictEqual(afterResetCounters.all, '95');
    assert.strictEqual(afterResetCounters.unsolved, '95');
    assert.strictEqual(afterResetCounters.incorrect, '0');
    assert.strictEqual(afterResetCounters.correct, '0');
    console.log('✓ Reset flow resets situational counts to: 95 / 95 / 0 / 0');

    // Check practical mode after reset
    await cdp.evaluate(`document.getElementById('tab-practical').click();`);
    const practicalAfterReset = await cdp.evaluate(`
      (() => ({
        all: document.getElementById('filter-count-all')?.textContent.trim(),
        unsolved: document.getElementById('filter-count-unsolved')?.textContent.trim(),
        incorrect: document.getElementById('filter-count-incorrect')?.textContent.trim(),
        correct: document.getElementById('filter-count-correct')?.textContent.trim()
      }))()
    `);
    console.log('Practical counters after global reset:', practicalAfterReset);
    assert.strictEqual(practicalAfterReset.all, '57');
    assert.strictEqual(practicalAfterReset.unsolved, '57');
    assert.strictEqual(practicalAfterReset.incorrect, '0');
    assert.strictEqual(practicalAfterReset.correct, '0');
    console.log('✓ Global reset clears practical counts as well: 57 / 57 / 0 / 0');

    // ------------------------------------------------------------------------
    // CHECK 2: Touch Ergonomics (>= 44px min-height) across Mobile Viewports
    // ------------------------------------------------------------------------
    console.log('\n--- CHECK 2: Touch Ergonomics (>= 44px) & Target Sizing ---');

    const viewports = [
      { width: 320, height: 640 },
      { width: 360, height: 740 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 430, height: 932 }
    ];

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: true
      });
      await new Promise(r => setTimeout(r, 100));

      // Main page interactive elements (sheet closed)
      const mainTouchMeasurements = await cdp.evaluate(`
        (() => {
          const results = [];
          
          // Option buttons
          document.querySelectorAll('.option-btn').forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            results.push({
              category: 'option-btn',
              index: i,
              height: rect.height,
              width: rect.width
            });
          });

          // Main pill buttons (prev, next, catalog, reset)
          ['btn-prev', 'btn-next', 'btn-catalog', 'btn-reset'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
              const rect = el.getBoundingClientRect();
              results.push({
                category: 'btn-pill',
                id: el.id,
                height: rect.height,
                width: rect.width
              });
            }
          });

          // Segment buttons
          document.querySelectorAll('.segment-btn').forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            results.push({
              category: 'segment-btn',
              id: el.id,
              height: rect.height,
              width: rect.width
            });
          });

          return results;
        })()
      `);

      for (const item of mainTouchMeasurements) {
        assert(item.height >= 44, `Main target ${item.category} ${item.id || item.index} height ${item.height}px < 44px at ${vp.width}px`);
      }

      // Now open catalog drawer to measure drawer touch elements
      await cdp.evaluate(`document.getElementById('btn-catalog').click();`);
      await new Promise(r => setTimeout(r, 100));

      const drawerTouchMeasurements = await cdp.evaluate(`
        (() => {
          const results = [];

          // Filter chips
          document.querySelectorAll('.filter-chip').forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            results.push({
              category: 'filter-chip',
              index: i,
              text: el.textContent.trim(),
              height: rect.height,
              width: rect.width
            });
          });

          // Close button
          const btnClose = document.getElementById('btn-close-sheet');
          if (btnClose) {
            const rect = btnClose.getBoundingClientRect();
            results.push({
              category: 'btn-pill-icon',
              id: 'btn-close-sheet',
              height: rect.height,
              width: rect.width
            });
          }

          // Grid cells
          document.querySelectorAll('.grid-cell').forEach((el, i) => {
            if (i < 10) { // sample first 10
              const rect = el.getBoundingClientRect();
              results.push({
                category: 'grid-cell',
                index: i,
                height: rect.height,
                width: rect.width
              });
            }
          });

          return results;
        })()
      `);

      for (const item of drawerTouchMeasurements) {
        assert(item.height >= 44, `Drawer target ${item.category} ${item.id || item.text || item.index} height ${item.height}px < 44px at ${vp.width}px`);
      }

      // Close catalog drawer
      await cdp.evaluate(`document.getElementById('btn-close-sheet').click();`);
      await new Promise(r => setTimeout(r, 100));

      console.log(`✓ All touch targets (main page & drawer) at ${vp.width}px viewport >= 44px (checked ${mainTouchMeasurements.length + drawerTouchMeasurements.length} elements)`);
    }

    // ------------------------------------------------------------------------
    // CHECK 3: Zero Horizontal Scroll across all Mobile Viewports
    // ------------------------------------------------------------------------
    console.log('\n--- CHECK 3: Zero Horizontal Scroll (Closed & Open Drawer) ---');

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: true
      });
      await new Promise(r => setTimeout(r, 100));

      // Test with Catalog Drawer Closed
      const closedOverflow = await cdp.evaluate(`
        (() => {
          return {
            windowInnerWidth: window.innerWidth,
            docClientWidth: document.documentElement.clientWidth,
            docScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth
          };
        })()
      `);
      assert.strictEqual(closedOverflow.hasHorizontalScroll, false, `Horizontal overflow detected at ${vp.width}px (closed)`);

      // Test with Catalog Drawer Open
      await cdp.evaluate(`document.getElementById('btn-catalog').click();`);
      await new Promise(r => setTimeout(r, 100));

      const openOverflow = await cdp.evaluate(`
        (() => {
          return {
            windowInnerWidth: window.innerWidth,
            docClientWidth: document.documentElement.clientWidth,
            docScrollWidth: document.documentElement.scrollWidth,
            sheetContainerScrollWidth: document.getElementById('sheet-container')?.scrollWidth,
            sheetContainerClientWidth: document.getElementById('sheet-container')?.clientWidth,
            hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth
          };
        })()
      `);
      assert.strictEqual(openOverflow.hasHorizontalScroll, false, `Horizontal overflow detected at ${vp.width}px (open drawer)`);

      // Close Catalog Drawer
      await cdp.evaluate(`document.getElementById('btn-close-sheet').click();`);
      await new Promise(r => setTimeout(r, 100));

      console.log(`✓ Viewport ${vp.width}px: Zero horizontal scroll (closed & open catalog drawer)`);
    }

    // ------------------------------------------------------------------------
    // CHECK 4: CSS Stylesheet Integrity Verification
    // ------------------------------------------------------------------------
    console.log('\n--- CHECK 4: CSS Stylesheet Rule Verification ---');
    const cssRulesCheck = await cdp.evaluate(`
      (() => {
        const filtersEl = document.querySelector('.sheet-filters');
        const computedFilters = window.getComputedStyle(filtersEl);
        const chipEl = document.querySelector('.filter-chip');
        const computedChip = window.getComputedStyle(chipEl);

        return {
          filtersOverflowX: computedFilters.overflowX,
          filtersOverscrollBehaviorX: computedFilters.overscrollBehaviorX,
          chipMinHeight: computedChip.minHeight,
          chipFontVariantNumeric: computedChip.fontVariantNumeric
        };
      })()
    `);
    console.log('Computed CSS Values:', cssRulesCheck);
    assert.strictEqual(cssRulesCheck.filtersOverflowX, 'auto', 'Filters overflow-x must be auto');
    assert.strictEqual(cssRulesCheck.filtersOverscrollBehaviorX, 'contain', 'Filters overscroll-behavior-x must be contain');
    assert.strictEqual(cssRulesCheck.chipMinHeight, '44px', 'Filter chip min-height must be 44px');
    assert.strictEqual(cssRulesCheck.chipFontVariantNumeric, 'tabular-nums', 'Filter chip font-variant-numeric must be tabular-nums');
    console.log('✓ CSS stylesheet rules verified in computed browser styles');

    console.log('\n=================================================================');
    console.log('ALL REVIEWER INDEPENDENT CHECKS & VERIFICATIONS PASSED 100%!');
    console.log('=================================================================');
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill('SIGKILL');
    server.close();
    if (fs.existsSync(userDataDir)) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

runIndependentAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ REVIEWER AUDIT FAILED:', err);
    process.exit(1);
  });
