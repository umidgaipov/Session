/**
 * Keyboard Navigation & Tab Sequence Verification using CDP Input.dispatchKeyEvent
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9225;
const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome_cdp_tab_${Date.now()}`);

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

  async pressTab() {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      key: 'Tab',
      code: 'Tab'
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      key: 'Tab',
      code: 'Tab'
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log(`Starting headless Chrome on port ${PORT}...`);
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

    if (!version || !version.webSocketDebuggerUrl) {
      throw new Error("Failed to connect to Chrome CDP endpoint");
    }

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page');
    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const htmlUrl = 'file:///D:/projects/Session/index.html';
    await cdp.send('Page.navigate', { url: htmlUrl });
    await delay(500);

    console.log("\n--- Testing Tab Navigation Sequence ---");

    const tabSequence = [];

    // Press Tab 12 times to traverse the main page elements
    for (let step = 1; step <= 12; step++) {
      await cdp.pressTab();
      await delay(100);

      const active = await cdp.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: 'BODY', id: '', class: '', outline: '' };
        const cs = window.getComputedStyle(el);
        return {
          step: ${step},
          tag: el.tagName,
          id: el.id,
          className: el.className,
          text: el.innerText ? el.innerText.substring(0, 30).trim() : '',
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow,
          hasVisibleFocus: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
        };
      })()`);

      tabSequence.push(active);
      console.log(`Step ${step}: <${active.tag} id="${active.id}" class="${active.className}"> Focus visible: ${active.hasVisibleFocus ? 'YES (' + active.outlineWidth + ' ' + active.outlineStyle + ' ' + active.outlineColor + ')' : 'NO'}`);
    }

    // Now test catalog sheet tab sequence
    console.log("\n--- Testing Catalog Sheet Tab Sequence ---");
    await cdp.evaluate(`(() => {
      const backdrop = document.getElementById('sheet-backdrop');
      if (backdrop) backdrop.classList.add('is-open');
      const grid = document.getElementById('sheet-grid');
      if (grid && grid.children.length === 0) {
        for (let i = 1; i <= 5; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'grid-cell';
          btn.textContent = i;
          grid.appendChild(btn);
        }
      }
      document.getElementById('btn-close-sheet').focus();
    })()`);

    for (let step = 1; step <= 10; step++) {
      const active = await cdp.evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: 'BODY', id: '', class: '', outline: '' };
        const cs = window.getComputedStyle(el);
        return {
          step: ${step},
          tag: el.tagName,
          id: el.id,
          className: el.className,
          text: el.innerText ? el.innerText.substring(0, 30).trim() : '',
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow,
          hasVisibleFocus: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
        };
      })()`);

      console.log(`Sheet Step ${step}: <${active.tag} id="${active.id}" class="${active.className}"> Focus visible: ${active.hasVisibleFocus ? 'YES (' + active.outlineWidth + ' ' + active.outlineStyle + ')' : 'NO'}`);
      await cdp.pressTab();
      await delay(100);
    }

    cdp.close();

  } finally {
    chromeProc.kill('SIGKILL');
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch (e) {}
  }
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
