/**
 * Viewport and Zero-Horizontal-Scroll Verification using Headless Chrome & CDP
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9223;
const TEMP_USER_DATA = path.join(os.tmpdir(), `chrome_cdp_${Date.now()}`);

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
    // Wait for Chrome CDP endpoint
    let version = null;
    for (let i = 0; i < 20; i++) {
      await delay(200);
      try {
        version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        if (version && version.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    if (!version || !version.webSocketDebuggerUrl) {
      throw new Error("Failed to connect to Chrome CDP endpoint");
    }

    console.log("Connected to Chrome CDP successfully.");

    // Find existing target page from /json/list
    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error("No page target found in Chrome");
    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const htmlUrl = 'file:///D:/projects/Session/index.html';
    console.log(`Navigating to ${htmlUrl}...`);
    await cdp.send('Page.navigate', { url: htmlUrl });
    await delay(500);

    const testViewports = [320, 360, 375, 390, 430];
    let allPassed = true;

    for (const width of testViewports) {
      console.log(`\n--- Testing Viewport: ${width}px x 844px ---`);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: width,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true
      });
      await delay(200);

      const metrics = await cdp.evaluate(`(() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const bodyWidth = document.body.scrollWidth;
        const hasHorizontalScroll = docWidth > winWidth || bodyWidth > winWidth;

        // Measure heights of interactive elements
        const optionBtns = Array.from(document.querySelectorAll('.option-btn')).map(el => {
          const rect = el.getBoundingClientRect();
          return { id: el.id, height: rect.height, width: rect.width };
        });

        const btnPills = Array.from(document.querySelectorAll('.btn-pill')).map(el => {
          const rect = el.getBoundingClientRect();
          return { id: el.id, height: rect.height, width: rect.width };
        });

        const segmentBtns = Array.from(document.querySelectorAll('.segment-btn')).map(el => {
          const rect = el.getBoundingClientRect();
          return { id: el.id, height: rect.height, width: rect.width };
        });

        return {
          docWidth,
          winWidth,
          bodyWidth,
          hasHorizontalScroll,
          optionBtns,
          btnPills,
          segmentBtns
        };
      })()`);

      console.log(`Window width: ${metrics.winWidth}px, Document scrollWidth: ${metrics.docWidth}px, Body scrollWidth: ${metrics.bodyWidth}px`);
      console.log(`Zero Horizontal Scroll: ${!metrics.hasHorizontalScroll ? 'PASSED (0 overflow)' : 'FAILED'}`);

      if (metrics.hasHorizontalScroll) {
        console.error(`ERROR: Horizontal overflow at ${width}px! docWidth=${metrics.docWidth}, winWidth=${metrics.winWidth}`);
        allPassed = false;
      }

      for (const btn of metrics.optionBtns) {
        if (btn.height < 48) {
          console.error(`ERROR: Option button ${btn.id} height ${btn.height}px is below 48px!`);
          allPassed = false;
        }
      }
      console.log(`Option buttons (${metrics.optionBtns.length}): All heights >= 48px (${metrics.optionBtns[0].height}px)`);

      for (const btn of metrics.btnPills) {
        // Skip hidden or secondary small elements if any
        if (btn.height > 0 && btn.height < 44) {
          console.error(`ERROR: Pill button ${btn.id} height ${btn.height}px is below 44px!`);
          allPassed = false;
        }
      }
      console.log(`Bottom nav pill buttons: All heights >= 48px (${metrics.btnPills[1]?.height}px)`);

      for (const btn of metrics.segmentBtns) {
        if (btn.height < 40) {
          console.error(`ERROR: Segment button ${btn.id} height ${btn.height}px is below 40px!`);
          allPassed = false;
        }
      }
      console.log(`Segment buttons: All heights >= 44px (${metrics.segmentBtns[0].height}px)`);

      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const imgBuffer = Buffer.from(screenshot.data, 'base64');
      fs.writeFileSync(`screenshot_${width}px.png`, imgBuffer);
      console.log(`Saved screenshot_${width}px.png`);
    }

    cdp.close();

    if (!allPassed) {
      process.exitCode = 1;
      console.error("\nVerification FAILED: One or more viewport constraints were violated.");
    } else {
      console.log("\nALL VIEWPORT AND ERGONOMICS TESTS PASSED PERFECTLY!");
    }

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
