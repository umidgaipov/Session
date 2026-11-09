/**
 * Targeted Diagnostics: 280px overflow, math overflow, and touch target heights
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9225;
const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome_cdp_diag_${Date.now()}`);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runDiag() {
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

  try {
    for (let i = 0; i < 20; i++) {
      await delay(200);
      try {
        const v = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        if (v?.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.id && callbacks.has(data.id)) {
        const cb = callbacks.get(data.id);
        callbacks.delete(data.id);
        if (data.error) cb.reject(data.error);
        else cb.resolve(data.result);
      }
    };
    await new Promise(res => ws.onopen = res);

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'file:///D:/projects/Session/index.html' });
    await delay(500);

    console.log("=== DIAGNOSTIC 1: Viewport 280px Layout Metrics ===");
    await send('Emulation.setDeviceMetricsOverride', {
      width: 280,
      height: 653,
      deviceScaleFactor: 2,
      mobile: true
    });
    await delay(200);

    const diag280 = await evaluate(`(() => {
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;
      const appContainer = document.querySelector('.app-container');
      const bottomNav = document.querySelector('.bottom-nav-bar');
      const bottomInner = document.querySelector('.bottom-nav-inner');
      const btnPrev = document.getElementById('btn-prev');
      const btnCatalog = document.getElementById('btn-catalog');
      const btnNext = document.getElementById('btn-next');
      const categoryTag = document.getElementById('category-tag');
      const categoryText = document.getElementById('category-text');
      const questionIndexBadge = document.getElementById('question-index-badge');
      const segmentedControl = document.querySelector('.segmented-control');

      return {
        winW,
        docW,
        bodyW,
        appContainer: {
          scrollWidth: appContainer.scrollWidth,
          clientWidth: appContainer.clientWidth,
          rect: appContainer.getBoundingClientRect()
        },
        bottomInner: {
          scrollWidth: bottomInner.scrollWidth,
          clientWidth: bottomInner.clientWidth,
          rect: bottomInner.getBoundingClientRect()
        },
        btnPrevRect: btnPrev.getBoundingClientRect(),
        btnCatalogRect: btnCatalog.getBoundingClientRect(),
        btnNextRect: btnNext.getBoundingClientRect(),
        categoryTag: {
          scrollWidth: categoryTag.scrollWidth,
          rect: categoryTag.getBoundingClientRect()
        },
        categoryText: {
          scrollWidth: categoryText.scrollWidth,
          rect: categoryText.getBoundingClientRect()
        },
        questionIndexBadgeRect: questionIndexBadge.getBoundingClientRect(),
        segmentedControlRect: segmentedControl.getBoundingClientRect()
      };
    })()`);

    console.log("Diag 280px:", JSON.stringify(diag280, null, 2));

    console.log("\n=== DIAGNOSTIC 2: Filter chip height inside sheet ===");
    const chipDiag = await evaluate(`(() => {
      const backdrop = document.getElementById('sheet-backdrop');
      backdrop.classList.add('is-open');
      const chips = Array.from(document.querySelectorAll('.filter-chip')).map(c => {
        const r = c.getBoundingClientRect();
        const style = window.getComputedStyle(c);
        return {
          text: c.textContent,
          w: r.width,
          h: r.height,
          padding: style.padding,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          minHeight: style.minHeight
        };
      });
      return chips;
    })()`);
    console.log("Chip Diag (sheet open):", JSON.stringify(chipDiag, null, 2));

    console.log("\n=== DIAGNOSTIC 3: Unbroken word overflow in Title & Question ===");
    // Reset to 320px
    await send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 653,
      deviceScaleFactor: 2,
      mobile: true
    });
    await delay(200);

    const wordDiag = await evaluate(`(() => {
      const title = document.getElementById('question-topic');
      title.textContent = "ЭкономикоСтатистическийРегрессионноКорреляционныйАнализ";
      
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;
      const cardW = document.getElementById('question-card').scrollWidth;
      const titleRect = title.getBoundingClientRect();

      return {
        winW,
        docW,
        bodyW,
        cardW,
        titleRect: { left: titleRect.left, right: titleRect.right, width: titleRect.width },
        overflow: docW - winW
      };
    })()`);
    console.log("Word Diag at 320px:", JSON.stringify(wordDiag, null, 2));

    console.log("\n=== DIAGNOSTIC 4: Formula overflow in prompt at 320px ===");
    const formulaDiag = await evaluate(`(() => {
      const prompt = document.getElementById('question-prompt');
      prompt.textContent = "t_emp = (|x̄_1-x̄_2|)/sqrt((s_1^2/n_1)+(s_2^2/n_2))=3.84159265358979";
      
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;
      const promptRect = prompt.getBoundingClientRect();

      return {
        winW,
        docW,
        bodyW,
        promptRect: { left: promptRect.left, right: promptRect.right, width: promptRect.width },
        overflow: docW - winW
      };
    })()`);
    console.log("Formula Diag at 320px:", JSON.stringify(formulaDiag, null, 2));

    console.log("\n=== DIAGNOSTIC 5: Formula in explanation-body at 320px ===");
    const expDiag = await evaluate(`(() => {
      const expCard = document.getElementById('explanation-card');
      expCard.classList.add('is-visible');
      const expBody = document.getElementById('explanation-body');
      expBody.textContent = "Formula: \\\\sigma^2=\\\\frac{1}{N}\\\\sum_{i=1}^N(x_i-\\\\mu)^2=14+16+17+18+19+20+21+22+23+25+48";
      
      const winW = window.innerWidth;
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;
      const expRect = expBody.getBoundingClientRect();

      return {
        winW,
        docW,
        bodyW,
        expRect: { left: expRect.left, right: expRect.right, width: expRect.width },
        overflow: docW - winW
      };
    })()`);
    console.log("Explanation Diag at 320px:", JSON.stringify(expDiag, null, 2));

    ws.close();
  } finally {
    chromeProc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

runDiag().catch(console.error);
