import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9225;
const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome_adv_${Date.now()}`);

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
  console.log(`Starting headless Chrome for Adversarial Stress Test...`);
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
    let version = null;
    for (let i = 0; i < 25; i++) {
      await delay(200);
      try {
        version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        if (version && version.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    if (!version) throw new Error("Could not connect to Chrome CDP");

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page');
    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const htmlUrl = 'file:///D:/projects/Session/index.html';
    await cdp.send('Page.navigate', { url: htmlUrl });
    await delay(500);

    console.log('\n--- TEST A: Explanation Card VISIBLE across all viewports ---');
    await cdp.evaluate(`document.getElementById('explanation-card').classList.add('is-visible');`);

    const viewports = [320, 360, 375, 390, 414, 430];
    for (const w of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(150);

      const res = await cdp.evaluate(`(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const bodyW = document.body.scrollWidth;
        const expl = document.getElementById('explanation-card');
        const explRect = expl.getBoundingClientRect();
        return {
          viewport: ${w},
          docW,
          winW,
          bodyW,
          explW: Math.round(explRect.width),
          hasOverflow: docW > winW || bodyW > winW
        };
      })()`);
      console.log(`Viewport ${w}px: overflow = ${res.hasOverflow} (docW=${res.docW}, winW=${res.winW}, explW=${res.explW})`);
      if (res.hasOverflow) {
        console.error(`FAILURE: Explanation card causes horizontal scroll at ${w}px!`);
      }
    }

    console.log('\n--- TEST B: Catalog Sheet OPEN with 95 items ---');
    await cdp.evaluate(`(() => {
      document.getElementById('sheet-backdrop').classList.add('is-open');
      const grid = document.getElementById('sheet-grid');
      grid.innerHTML = '';
      for (let i = 1; i <= 95; i++) {
        const b = document.createElement('button');
        b.className = 'grid-cell' + (i === 1 ? ' is-current' : (i < 5 ? ' is-correct' : (i === 6 ? ' is-incorrect' : '')));
        b.textContent = String(i);
        grid.appendChild(b);
      }
    })()`);

    for (const w of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(150);

      const res = await cdp.evaluate(`(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const bodyW = document.body.scrollWidth;
        const sheet = document.getElementById('sheet-container');
        const sheetRect = sheet.getBoundingClientRect();
        return {
          viewport: ${w},
          docW,
          winW,
          bodyW,
          sheetW: Math.round(sheetRect.width),
          sheetRight: Math.round(sheetRect.right),
          hasOverflow: docW > winW || bodyW > winW
        };
      })()`);
      console.log(`Viewport ${w}px (Sheet open): overflow = ${res.hasOverflow} (sheetW=${res.sheetW}, winW=${res.winW})`);
    }

    console.log('\n--- TEST C: Interactive Element Dimensions & Touch Target Compliance ---');
    const elements = await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], .filter-chip, .grid-cell'));
      return items.map(el => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id || '',
          cls: el.className,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 25),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10
        };
      }).filter(x => x.w > 0 && x.h > 0);
    })()`);

    console.table(elements.slice(0, 15));

    console.log('\n--- TEST D: Long Formula & Unbroken Strings Stress Test ---');
    await cdp.evaluate(`(() => {
      document.getElementById('sheet-backdrop').classList.remove('is-open');
      const box = document.getElementById('context-text');
      box.innerHTML = 'Формула: R^2 = 1 - (SS_res / SS_tot) = 1 - (sum_{i=1}^n(y_i - hat{y}_i)^2 / sum_{i=1}^n(y_i - bar{y})^2). Оценка F-критерия Фишера: F_calc = (R^2 / k) / ((1 - R^2) / (n - k - 1)). Критическое_значение_распределения_Стьюдента_t_крит_альфа_001_при_числах_степеней_свободы_df_94 = 2.63.';
    })()`);

    for (const w of [320, 360, 390]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(150);

      const res = await cdp.evaluate(`(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const bodyW = document.body.scrollWidth;
        return {
          viewport: ${w},
          docW,
          winW,
          bodyW,
          hasOverflow: docW > winW || bodyW > winW
        };
      })()`);
      console.log(`Stress Test ${w}px: overflow = ${res.hasOverflow} (docW=${res.docW}, winW=${res.winW})`);
    }

    cdp.close();
    console.log('\nALL ADVERSARIAL STRESS TESTS COMPLETED.');

  } finally {
    chromeProc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

run().catch(err => {
  console.error("Fatal stress test error:", err);
  process.exit(1);
});
