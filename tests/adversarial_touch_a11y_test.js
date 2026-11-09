/**
 * Adversarial Empirical Verification Suite for Stage 1 Interactive Touch Targets & Accessibility
 * Tests touch target sizes, focus indicators, touch-action, tap highlights, ARIA, and contrast.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9224;
const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome_cdp_adv_${Date.now()}`);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
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
    return res.result.value;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log(`Starting headless Chrome for Adversarial Test on port ${PORT}...`);
  fs.mkdirSync(TEMP_USER_DATA, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${TEMP_USER_DATA}`,
    'about:blank'
  ], { stdio: 'ignore' });

  const results = {
    touchTargets: [],
    focusStates: [],
    touchAction: [],
    tapHighlight: [],
    ariaChecks: [],
    contrastChecks: [],
    verdict: "PENDING",
    failures: []
  };

  try {
    let version = null;
    for (let i = 0; i < 25; i++) {
      await delay(200);
      try {
        version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        if (version && version.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    if (!version || !version.webSocketDebuggerUrl) {
      throw new Error("Failed to connect to Chrome CDP endpoint");
    }

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error("No page target found in Chrome");
    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');

    const htmlUrl = 'file:///D:/projects/Session/index.html';
    await cdp.send('Page.navigate', { url: htmlUrl });
    await delay(600);

    // Populate sample grid cells in #sheet-grid for realistic measurement of .grid-cell
    await cdp.evaluate(`(() => {
      const grid = document.getElementById('sheet-grid');
      if (grid && grid.children.length === 0) {
        for (let i = 1; i <= 20; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'grid-cell' + (i === 1 ? ' is-current' : '') + (i === 2 ? ' is-correct' : '');
          btn.textContent = i;
          btn.setAttribute('aria-label', 'Вопрос ' + i);
          grid.appendChild(btn);
        }
      }
    })()`);

    const viewports = [320, 360, 375, 390, 430, 768];

    console.log("=================================================");
    console.log("SECTION 1: TOUCH TARGET DIMENSIONS (Apple HIG >= 44x44px)");
    console.log("=================================================");

    for (const vpWidth of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vpWidth,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(150);

      // Measure closed state targets + open sheet state targets
      const targetMetrics = await cdp.evaluate(`(() => {
        const items = [];
        
        // Main view elements
        const elementsToCheck = [
          { sel: '#btn-reset', name: 'Header Reset Button (.btn-pill-icon)' },
          { sel: '#tab-situational', name: 'Mode Tab Situational (.segment-btn)' },
          { sel: '#tab-practical', name: 'Mode Tab Practical (.segment-btn)' },
          { sel: '#option-A', name: 'Option A (.option-btn)' },
          { sel: '#option-B', name: 'Option B (.option-btn)' },
          { sel: '#option-C', name: 'Option C (.option-btn)' },
          { sel: '#option-D', name: 'Option D (.option-btn)' },
          { sel: '#btn-prev', name: 'Bottom Nav Prev (.btn-pill)' },
          { sel: '#btn-catalog', name: 'Bottom Nav Catalog (.btn-pill-icon)' },
          { sel: '#btn-next', name: 'Bottom Nav Next (.btn-pill-primary)' }
        ];

        for (const item of elementsToCheck) {
          const el = document.querySelector(item.sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            items.push({
              name: item.name,
              selector: item.sel,
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
              visible: rect.width > 0 && rect.height > 0
            });
          }
        }

        // Open sheet temporarily to measure sheet elements
        const backdrop = document.getElementById('sheet-backdrop');
        if (backdrop) backdrop.classList.add('is-open');

        const sheetElements = [
          { sel: '#btn-close-sheet', name: 'Close Sheet Button (.btn-pill-icon)' },
          { sel: '.filter-chip[data-filter="all"]', name: 'Filter Chip All (.filter-chip)' },
          { sel: '.filter-chip[data-filter="unsolved"]', name: 'Filter Chip Unsolved (.filter-chip)' },
          { sel: '.grid-cell', name: 'First Grid Cell (.grid-cell)' }
        ];

        for (const item of sheetElements) {
          const el = document.querySelector(item.sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            items.push({
              name: item.name,
              selector: item.sel,
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
              visible: rect.width > 0 && rect.height > 0
            });
          }
        }

        // Restore sheet
        if (backdrop) backdrop.classList.remove('is-open');

        return items;
      })()`);

      for (const t of targetMetrics) {
        const passesHigMin = t.width >= 44 && t.height >= 44;
        const entry = {
          viewport: `${vpWidth}px`,
          element: t.name,
          selector: t.selector,
          width: t.width,
          height: t.height,
          passesHigMin
        };
        results.touchTargets.push(entry);

        if (!passesHigMin) {
          const failMsg = `[Touch Target Violation] At ${vpWidth}px viewport, ${t.name} (${t.selector}) has dimensions ${t.width}px x ${t.height}px (Apple HIG requires >= 44px min in both dimensions)`;
          results.failures.push(failMsg);
          console.error(`FAIL: ${failMsg}`);
        }
      }
    }

    console.log("\n=================================================");
    console.log("SECTION 2: KEYBOARD FOCUS & FOCUS-VISIBLE");
    console.log("=================================================");

    const focusMetrics = await cdp.evaluate(`(() => {
      const interactiveSelectors = [
        '#btn-reset',
        '#tab-situational',
        '#tab-practical',
        '#option-A',
        '#option-B',
        '#btn-prev',
        '#btn-catalog',
        '#btn-next',
        '#btn-close-sheet',
        '.filter-chip[data-filter="all"]',
        '.grid-cell'
      ];

      const report = [];

      // Open sheet so sheet elements are focusable
      const backdrop = document.getElementById('sheet-backdrop');
      if (backdrop) backdrop.classList.add('is-open');

      for (const sel of interactiveSelectors) {
        const el = document.querySelector(sel);
        if (!el) {
          report.push({ selector: sel, error: 'Element not found' });
          continue;
        }

        const isCurrentlyDisabled = el.hasAttribute('disabled');
        // If disabled, temporarily enable to test focus state rules
        if (isCurrentlyDisabled) el.removeAttribute('disabled');

        el.focus();
        const style = window.getComputedStyle(el);
        const outlineStyle = style.outlineStyle;
        const outlineWidth = style.outlineWidth;
        const outlineColor = style.outlineColor;
        const boxShadow = style.boxShadow;
        const borderColor = style.borderColor;

        const hasVisibleOutline = outlineStyle !== 'none' && parseFloat(outlineWidth) > 0;
        const hasVisibleBoxShadow = boxShadow && boxShadow !== 'none' && !boxShadow.includes('rgba(0, 0, 0, 0)');
        const hasFocusIndicator = hasVisibleOutline || hasVisibleBoxShadow;

        report.push({
          selector: sel,
          outlineStyle,
          outlineWidth,
          outlineColor,
          boxShadow,
          hasFocusIndicator
        });

        if (isCurrentlyDisabled) el.setAttribute('disabled', '');
      }

      if (backdrop) backdrop.classList.remove('is-open');

      return report;
    })()`);

    for (const f of focusMetrics) {
      results.focusStates.push(f);
      if (!f.hasFocusIndicator) {
        const failMsg = `[Keyboard Focus Violation] Element ${f.selector} has NO visible focus indicator when focused! (outlineStyle=${f.outlineStyle}, outlineWidth=${f.outlineWidth}, boxShadow=${f.boxShadow})`;
        results.failures.push(failMsg);
        console.error(`FAIL: ${failMsg}`);
      } else {
        console.log(`PASS: ${f.selector} has visible focus indicator (outline: ${f.outlineWidth} ${f.outlineStyle})`);
      }
    }

    console.log("\n=================================================");
    console.log("SECTION 3: TOUCH-ACTION AND TAP HIGHLIGHT");
    console.log("=================================================");

    const touchMetrics = await cdp.evaluate(`(() => {
      const selectors = [
        'body',
        '.site-header',
        '#tab-situational',
        '#option-A',
        '#btn-prev',
        '#btn-next',
        '#btn-catalog',
        '.filter-chip',
        '.grid-cell'
      ];

      return selectors.map(sel => {
        const el = document.querySelector(sel);
        if (!el) return { selector: sel, notFound: true };
        const cs = window.getComputedStyle(el);
        return {
          selector: sel,
          touchAction: cs.touchAction,
          webkitTapHighlightColor: cs.webkitTapHighlightColor
        };
      });
    })()`);

    for (const tm of touchMetrics) {
      results.touchAction.push(tm);
      console.log(`Selector: ${tm.selector} -> touchAction: "${tm.touchAction}", tapHighlight: "${tm.webkitTapHighlightColor}"`);
      if (tm.webkitTapHighlightColor !== 'rgba(0, 0, 0, 0)') {
        const failMsg = `[Tap Highlight Violation] ${tm.selector} does not have transparent tap highlight (${tm.webkitTapHighlightColor})`;
        results.failures.push(failMsg);
      }
    }

    console.log("\n=================================================");
    console.log("SECTION 4: ARIA SEMANTICS & ACCESSIBILITY AUDIT");
    console.log("=================================================");

    const ariaAudit = await cdp.evaluate(`(() => {
      const issues = [];

      // 1. Progress bar accessible name
      const progressBar = document.getElementById('progress-bar');
      if (progressBar) {
        const role = progressBar.getAttribute('role');
        const ariaLabel = progressBar.getAttribute('aria-label');
        const ariaLabelledby = progressBar.getAttribute('aria-labelledby');
        const hasAccessibleName = !!(ariaLabel || ariaLabelledby);
        if (!hasAccessibleName) {
          issues.push({
            rule: 'WCAG 4.1.2 Name, Role, Value',
            element: '#progress-bar',
            message: 'Element with role="progressbar" has no aria-label or aria-labelledby'
          });
        }
      }

      // 2. Dialog container inside aria-hidden parent
      const sheetBackdrop = document.getElementById('sheet-backdrop');
      const sheetContainer = document.getElementById('sheet-container');
      if (sheetBackdrop && sheetContainer) {
        const backdropAriaHidden = sheetBackdrop.getAttribute('aria-hidden');
        const isChild = sheetBackdrop.contains(sheetContainer);
        if (backdropAriaHidden === 'true' && isChild) {
          issues.push({
            rule: 'WAI-ARIA Dialog Embedding',
            element: '#sheet-container',
            message: 'role="dialog" (#sheet-container) is nested directly inside parent (#sheet-backdrop) which has aria-hidden="true". This hides the entire dialog from assistive technology or creates invalid accessibility tree state.'
          });
        }
      }

      // 3. Tablist and Tabs pattern
      const tabSituational = document.getElementById('tab-situational');
      const tabPractical = document.getElementById('tab-practical');
      if (tabSituational && tabPractical) {
        const hasAriaControls = tabSituational.hasAttribute('aria-controls') || tabPractical.hasAttribute('aria-controls');
        if (!hasAriaControls) {
          issues.push({
            rule: 'WAI-ARIA Tabs Pattern',
            element: '.segmented-control [role="tab"]',
            message: 'role="tab" buttons lack aria-controls referencing a valid tabpanel, and no role="tabpanel" exists in the document.'
          });
        }
      }

      // 4. List and Listitem relationship in sheet-grid
      const sheetGrid = document.getElementById('sheet-grid');
      if (sheetGrid && sheetGrid.getAttribute('role') === 'list') {
        const buttons = sheetGrid.querySelectorAll('.grid-cell');
        for (const btn of buttons) {
          if (btn.getAttribute('role') !== 'listitem' && btn.parentElement.tagName !== 'LI') {
            issues.push({
              rule: 'WAI-ARIA List/Listitem Contract',
              element: '#sheet-grid .grid-cell',
              message: 'Parent #sheet-grid has role="list", but child .grid-cell has no role="listitem" and is not wrapped in <li>.'
            });
            break;
          }
        }
      }

      return issues;
    })()`);

    for (const issue of ariaAudit) {
      results.ariaChecks.push(issue);
      const failMsg = `[A11y/ARIA Defect] ${issue.rule} on ${issue.element}: ${issue.message}`;
      results.failures.push(failMsg);
      console.error(`FAIL: ${failMsg}`);
    }

    console.log("\n=================================================");
    console.log("SECTION 5: COLOR CONTRAST (WCAG AA 4.5:1 / 3.0:1)");
    console.log("=================================================");

    const contrastAudit = await cdp.evaluate(`(() => {
      function parseColor(str) {
        if (!str) return null;
        if (str.startsWith('rgb')) {
          const match = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
          if (match) {
            return {
              r: parseInt(match[1]),
              g: parseInt(match[2]),
              b: parseInt(match[3]),
              a: match[4] !== undefined ? parseFloat(match[4]) : 1
            };
          }
        }
        return null;
      }

      function getLuminance(r, g, b) {
        const a = [r, g, b].map(v => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
      }

      function getContrastRatio(fgRgb, bgRgb) {
        const lum1 = getLuminance(fgRgb.r, fgRgb.g, fgRgb.b);
        const lum2 = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
        const brightest = Math.max(lum1, lum2);
        const darkest = Math.min(lum1, lum2);
        return (brightest + 0.05) / (darkest + 0.05);
      }

      const elementsToCheck = [
        { sel: '#question-topic', name: 'Question Topic', expectedMin: 4.5 },
        { sel: '#question-prompt', name: 'Question Prompt', expectedMin: 4.5 },
        { sel: '#category-text', name: 'Category Tag Text', expectedMin: 4.5 },
        { sel: '#tab-practical', name: 'Inactive Tab Text', expectedMin: 4.5 },
        { sel: '.filter-chip[data-filter="unsolved"]', name: 'Inactive Filter Chip', expectedMin: 4.5 },
        { sel: '#progress-text', name: 'Progress Text', expectedMin: 4.5 },
        { sel: '.option-indicator', name: 'Option Indicator Letter', expectedMin: 3.0 }
      ];

      const report = [];

      for (const item of elementsToCheck) {
        const el = document.querySelector(item.sel);
        if (!el) continue;
        const style = window.getComputedStyle(el);
        const fg = parseColor(style.color);

        // Approximate effective background color
        let current = el;
        let bg = null;
        while (current && current !== document.documentElement) {
          const s = window.getComputedStyle(current);
          const c = parseColor(s.backgroundColor);
          if (c && c.a > 0.5) {
            bg = c;
            break;
          }
          current = current.parentElement;
        }
        if (!bg) bg = { r: 250, g: 250, b: 248, a: 1 }; // var(--bg-warm)

        const ratio = Math.round(getContrastRatio(fg, bg) * 100) / 100;
        report.push({
          name: item.name,
          selector: item.sel,
          fg: style.color,
          contrast: ratio,
          expectedMin: item.expectedMin,
          passes: ratio >= item.expectedMin
        });
      }

      return report;
    })()`);

    for (const c of contrastAudit) {
      results.contrastChecks.push(c);
      if (!c.passes) {
        console.warn(`WARNING: Contrast ratio for ${c.name} (${c.selector}) is ${c.contrast}:1, expected >= ${c.expectedMin}:1`);
      } else {
        console.log(`PASS: Contrast ratio for ${c.name} is ${c.contrast}:1 (>= ${c.expectedMin}:1)`);
      }
    }

    cdp.close();

    console.log("\n=================================================");
    console.log("VERDICT CALCULATION");
    console.log("=================================================");
    console.log(`Total failures found: ${results.failures.length}`);

    if (results.failures.length > 0) {
      results.verdict = "REJECT";
      console.log("OVERALL VERDICT: REJECT / REQUEST_CHANGES");
    } else {
      results.verdict = "APPROVE";
      console.log("OVERALL VERDICT: APPROVE");
    }

    fs.writeFileSync('tests/adversarial_results.json', JSON.stringify(results, null, 2));

  } finally {
    chromeProc.kill('SIGKILL');
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (e) {}
  }
}

run().catch(err => {
  console.error("Fatal test suite crash:", err);
  process.exit(1);
});
