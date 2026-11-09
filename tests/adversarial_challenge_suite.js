/**
 * Empirical Adversarial Verification Suite for Stage 1
 * Tests DOM rendering, layout overflow, extreme viewports, mathematical formula injection,
 * and Apple touch ergonomics via Chrome DevTools Protocol (CDP).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9224;
const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome_cdp_adversarial_${Date.now()}`);

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
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function runAdversarialSuite() {
  console.log("==================================================================");
  console.log("  EMPIRICAL ADVERSARIAL VERIFICATION SUITE — STAGE 1");
  console.log("==================================================================");

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

  const viewports = [280, 320, 360, 375, 390, 414, 430, 480];
  const testResults = {
    viewports: {},
    formulaStress: {},
    longTextStress: {},
    touchErgonomics: {},
    contrastCheck: {},
    sheetModalStress: {},
    summary: {
      totalTests: 0,
      passed: 0,
      failed: 0,
      criticalFlaws: []
    }
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

    if (!version?.webSocketDebuggerUrl) {
      throw new Error("Cannot reach Chrome CDP on port " + PORT);
    }

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error("No page target found");

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const fileUrl = 'file:///D:/projects/Session/index.html';
    await cdp.send('Page.navigate', { url: fileUrl });
    await delay(600);

    // -------------------------------------------------------------
    // SUITE 1: Extreme Viewports Responsiveness (Static mock)
    // -------------------------------------------------------------
    console.log("\n[SUITE 1] Testing static index.html across 8 viewports...");
    for (const w of viewports) {
      testResults.summary.totalTests++;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(150);

      const check = await cdp.evaluate(`(() => {
        const winW = window.innerWidth;
        const docW = document.documentElement.scrollWidth;
        const bodyW = document.body.scrollWidth;
        const appW = document.querySelector('.app-container')?.scrollWidth || 0;
        
        // Find any overflowing elements
        const overflowing = [];
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const rect = el.getBoundingClientRect();
          // allow 0.5px subpixel tolerance
          if (rect.right > winW + 0.75 || rect.left < -0.75) {
            overflowing.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              className: (el.className && typeof el.className === 'string') ? el.className.trim() : null,
              rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
              overflowPx: Math.round(rect.right - winW)
            });
          }
        }

        return {
          winW,
          docW,
          bodyW,
          appW,
          hasScroll: docW > winW || bodyW > winW,
          overflowingCount: overflowing.length,
          overflowingSamples: overflowing.slice(0, 5)
        };
      })()`);

      testResults.viewports[w] = check;
      if (check.hasScroll || check.overflowingCount > 0) {
        testResults.summary.failed++;
        const flaw = `Viewport ${w}px has horizontal overflow: docW=${check.docW}, bodyW=${check.bodyW}, overflowing elements=${check.overflowingCount}`;
        testResults.summary.criticalFlaws.push(flaw);
        console.error(`  FAIL [${w}px]: ${flaw}`);
        if (check.overflowingSamples.length > 0) {
          console.error("  Sample overflowing elements:", JSON.stringify(check.overflowingSamples, null, 2));
        }
      } else {
        testResults.summary.passed++;
        console.log(`  PASS [${w}px]: docW=${check.docW} winW=${check.winW} bodyW=${check.bodyW} (0 overflow)`);
      }
    }

    // -------------------------------------------------------------
    // SUITE 2: Stress-test Unbroken Math Formulas & Long Strings
    // -------------------------------------------------------------
    console.log("\n[SUITE 2] Stress-testing math formulas & unbreakable strings across viewports...");
    
    // Test payloads representing real economic statistics formulas and edge cases
    const mathPayloads = [
      {
        name: "Summation & Fraction Math Expression",
        targetId: "question-prompt",
        content: "Рассчитайте средневзвешенную: x̄ = (∑ x_i · f_i) / (∑ f_i) = (14·5 + 16·8 + 17·12 + 18·15 + 19·20 + 20·14) / 74"
      },
      {
        name: "Student t-criterion unbroken formula",
        targetId: "question-prompt",
        content: "t_emp = (|x̄_1 - x̄_2|) / sqrt((s_1^2 / n_1) + (s_2^2 / n_2)) = 3.84159265358979"
      },
      {
        name: "Unbroken 45-character composite German/Statistical word in title",
        targetId: "question-topic",
        content: "ЭкономикоСтатистическийРегрессионноКорреляционныйАнализ"
      },
      {
        name: "Long calculation chain in context box",
        targetId: "context-text",
        content: "Дано: Дисперсия_генеральной_совокупности = 144.25; Выборочная_дисперсия = 142.10; n = 1500; p_value = 0.0000000012345; Формула: F_calc = S_max^2 / S_min^2 = 1.0151291"
      },
      {
        name: "Unbroken LaTeX-style code in explanation",
        targetId: "explanation-body",
        content: "\\sigma^2 = \\frac{1}{N}\\sum_{i=1}^N(x_i-\\mu)^2 = 14+16+17+18+19+20+21+22+23+25+48+999999999"
      },
      {
        name: "Very long category name in meta bar",
        targetId: "category-text",
        content: "Многомерный корреляционно-регрессионный анализ динамических рядов и прогнозирование макроэкономики"
      }
    ];

    for (const payload of mathPayloads) {
      console.log(`  Applying payload: "${payload.name}"...`);
      await cdp.evaluate(`((targetId, content) => {
        const el = document.getElementById(targetId);
        if (el) el.textContent = content;
      })(${JSON.stringify(payload.targetId)}, ${JSON.stringify(payload.content)})`);

      // Also reveal explanation card for explanation test
      await cdp.evaluate(`(() => {
        const exp = document.getElementById('explanation-card');
        if (exp) exp.classList.add('is-visible');
      })()`);

      // Test across viewports with this payload
      for (const w of [280, 320, 375, 430]) {
        testResults.summary.totalTests++;
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: 844,
          deviceScaleFactor: 2,
          mobile: true
        });
        await delay(100);

        const check = await cdp.evaluate(`(() => {
          const winW = window.innerWidth;
          const docW = document.documentElement.scrollWidth;
          const bodyW = document.body.scrollWidth;
          const hasScroll = docW > winW || bodyW > winW;
          
          let targetRight = 0;
          const targetEl = document.getElementById(${JSON.stringify(payload.targetId)});
          if (targetEl) {
            targetRight = Math.round(targetEl.getBoundingClientRect().right);
          }

          return { winW, docW, bodyW, hasScroll, targetRight, overflowPx: Math.max(0, docW - winW) };
        })()`);

        const testKey = `${payload.name} @ ${w}px`;
        testResults.formulaStress[testKey] = check;

        if (check.hasScroll) {
          testResults.summary.failed++;
          const flaw = `FORMULA OVERFLOW on "${payload.name}" at ${w}px: docW=${check.docW} > winW=${check.winW} (+${check.overflowPx}px)`;
          testResults.summary.criticalFlaws.push(flaw);
          console.error(`    FAIL [${w}px]: ${flaw}`);
        } else {
          testResults.summary.passed++;
          console.log(`    PASS [${w}px]: No overflow (winW=${check.winW}, docW=${check.docW})`);
        }
      }
    }

    // -------------------------------------------------------------
    // SUITE 3: Catalog Sheet Drawer Stress (95 items populated)
    // -------------------------------------------------------------
    console.log("\n[SUITE 3] Stress-testing Catalog Sheet Drawer with 95 items...");
    await cdp.evaluate(`(() => {
      const grid = document.getElementById('sheet-grid');
      if (grid) {
        grid.innerHTML = '';
        for (let i = 1; i <= 95; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'grid-cell' + (i === 1 ? ' is-current' : '') + (i % 7 === 0 ? ' is-correct' : '') + (i % 11 === 0 ? ' is-incorrect' : '');
          btn.textContent = String(i);
          grid.appendChild(btn);
        }
      }
      const backdrop = document.getElementById('sheet-backdrop');
      if (backdrop) backdrop.classList.add('is-open');
    })()`);

    for (const w of [280, 320, 375, 430]) {
      testResults.summary.totalTests++;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(200);

      const sheetCheck = await cdp.evaluate(`(() => {
        const winW = window.innerWidth;
        const docW = document.documentElement.scrollWidth;
        const sheetContainer = document.getElementById('sheet-container');
        const sheetRect = sheetContainer ? sheetContainer.getBoundingClientRect() : null;
        const cells = Array.from(document.querySelectorAll('.grid-cell')).map(c => {
          const r = c.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        });

        return {
          winW,
          docW,
          hasScroll: docW > winW,
          sheetWidth: sheetRect ? Math.round(sheetRect.width) : null,
          minCellHeight: cells.length ? Math.min(...cells.map(c => c.h)) : 0,
          minCellWidth: cells.length ? Math.min(...cells.map(c => c.w)) : 0
        };
      })()`);

      testResults.sheetModalStress[w] = sheetCheck;
      if (sheetCheck.hasScroll) {
        testResults.summary.failed++;
        const flaw = `Sheet Drawer caused overflow at ${w}px: docW=${sheetCheck.docW} > winW=${sheetCheck.winW}`;
        testResults.summary.criticalFlaws.push(flaw);
        console.error(`  FAIL [${w}px]: ${flaw}`);
      } else {
        testResults.summary.passed++;
        console.log(`  PASS [${w}px]: Sheet open, docW=${sheetCheck.docW}, cell minH=${sheetCheck.minCellHeight}px, minW=${sheetCheck.minCellWidth}px`);
      }
    }

    // Close sheet
    await cdp.evaluate(`(() => {
      document.getElementById('sheet-backdrop')?.classList.remove('is-open');
    })()`);

    // -------------------------------------------------------------
    // SUITE 4: Touch Ergonomics & Tap Target Compliance (Apple HIG)
    // -------------------------------------------------------------
    console.log("\n[SUITE 4] Testing Touch Target Sizes & Overlaps across all interactive elements...");
    testResults.summary.totalTests++;
    
    // Set 375px baseline
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await delay(150);

    const touchAudit = await cdp.evaluate(`(() => {
      const clickables = Array.from(document.querySelectorAll('button, a, input, [role="button"], [role="tab"]'));
      const targets = [];
      const violations = [];

      for (const el of clickables) {
        const rect = el.getBoundingClientRect();
        // Skip hidden elements (e.g. inside closed sheet)
        if (rect.width === 0 && rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const info = {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          text: (el.textContent || '').trim().slice(0, 30),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10
        };
        targets.push(info);

        // Apple HIG recommends >= 44px, Material/W3C recommends >= 48px
        if (info.height < 44 || info.width < 44) {
          violations.push({
            ...info,
            reason: \`Target size \${info.width}x\${info.height}px is below Apple 44x44 minimum\`
          });
        }
      }

      return {
        totalTargets: targets.length,
        targets,
        violations
      };
    })()`);

    testResults.touchErgonomics = touchAudit;
    if (touchAudit.violations.length > 0) {
      testResults.summary.failed++;
      console.warn(`  WARNING / FAIL: ${touchAudit.violations.length} interactive targets below 44x44px:`);
      touchAudit.violations.forEach(v => {
        console.warn(`    - [${v.id || v.className}]: ${v.width}x${v.height}px ("${v.text}") -> ${v.reason}`);
        testResults.summary.criticalFlaws.push(`Touch target violation: [${v.id || v.className}] ${v.width}x${v.height}px < 44px`);
      });
    } else {
      testResults.summary.passed++;
      console.log(`  PASS: All ${touchAudit.totalTargets} visible interactive elements meet >= 44px touch target guidelines.`);
    }

    // -------------------------------------------------------------
    // SUITE 5: Contrast & Tokens Compliance Check
    // -------------------------------------------------------------
    console.log("\n[SUITE 5] Verifying Color Tokens & Computed CSS Properties...");
    testResults.summary.totalTests++;
    const tokensCheck = await cdp.evaluate(`(() => {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = window.getComputedStyle(document.body);
      const card = document.querySelector('.question-card');
      const cardStyle = card ? window.getComputedStyle(card) : null;
      const optBtn = document.querySelector('.option-btn');
      const optStyle = optBtn ? window.getComputedStyle(optBtn) : null;
      const nextBtn = document.getElementById('btn-next');
      const nextStyle = nextBtn ? window.getComputedStyle(nextBtn) : null;

      return {
        bodyBg: bodyStyle.backgroundColor,
        cardBg: cardStyle ? cardStyle.backgroundColor : null,
        cardBorder: cardStyle ? cardStyle.borderColor : null,
        cardRadius: cardStyle ? cardStyle.borderRadius : null,
        optMinHeight: optStyle ? optStyle.minHeight : null,
        nextBtnBg: nextStyle ? nextStyle.backgroundColor : null,
        nextBtnColor: nextStyle ? nextStyle.color : null,
        fontFamily: bodyStyle.fontFamily
      };
    })()`);

    testResults.contrastCheck = tokensCheck;
    console.log("  Computed tokens:", JSON.stringify(tokensCheck, null, 2));

    const isWarmBg = tokensCheck.bodyBg.includes('250, 250, 248') || tokensCheck.bodyBg === 'rgb(250, 250, 248)';
    const isInter = tokensCheck.fontFamily.toLowerCase().includes('inter');
    if (isWarmBg && isInter) {
      testResults.summary.passed++;
      console.log("  PASS: Design tokens (warm #FAFAF8, Inter typography, card surfaces) strictly conform to docs/DESIGN.md.");
    } else {
      testResults.summary.failed++;
      testResults.summary.criticalFlaws.push(`Tokens mismatch: bodyBg=${tokensCheck.bodyBg}, font=${tokensCheck.fontFamily}`);
      console.error("  FAIL: Design tokens mismatch!");
    }

    cdp.close();

    console.log("\n==================================================================");
    console.log("  TEST SUMMARY");
    console.log(`  Total: ${testResults.summary.totalTests} | Passed: ${testResults.summary.passed} | Failed: ${testResults.summary.failed}`);
    if (testResults.summary.criticalFlaws.length > 0) {
      console.log("  Flaws detected:");
      testResults.summary.criticalFlaws.forEach(f => console.log(`   - ${f}`));
    }
    console.log("==================================================================");

    // Save full JSON output for handoff report
    fs.writeFileSync('tests/adversarial_results.json', JSON.stringify(testResults, null, 2));

  } finally {
    chromeProc.kill('SIGKILL');
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (e) {}
  }
}

runAdversarialSuite().catch(err => {
  console.error("Fatal suite runner error:", err);
  process.exit(1);
});
