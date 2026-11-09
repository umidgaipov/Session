/**
 * Pinpoint the exact elements causing 289px width at 280px viewport
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9229;
const TEMP_USER_DATA = os.tmpdir() + "/chrome_pinpoint_" + Date.now();

async function pinpoint() {
  fs.mkdirSync(TEMP_USER_DATA, { recursive: true });
  const proc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${TEMP_USER_DATA}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    await new Promise(r => setTimeout(r, 1000));
    const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
    const page = targets.find(t => t.type === 'page');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 1;
    const send = (method, params = {}) => new Promise((resolve) => {
      const msgId = id++;
      const handler = (e) => {
        const d = JSON.parse(e.data);
        if (d.id === msgId) {
          ws.removeEventListener('message', handler);
          resolve(d.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'file:///D:/projects/Session/index.html' });
    await new Promise(r => setTimeout(r, 500));

    await send('Emulation.setDeviceMetricsOverride', {
      width: 280,
      height: 700,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 100));

    const analysis = await send('Runtime.evaluate', {
      expression: `(() => {
        const winW = 280;
        const culprits = [];
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.width > winW || r.right > winW) {
            culprits.push({
              tag: el.tagName.toLowerCase(),
              id: el.id,
              className: el.className,
              rect: { left: r.left, right: r.right, width: r.width },
              computedWidth: window.getComputedStyle(el).width,
              padding: window.getComputedStyle(el).padding,
              margin: window.getComputedStyle(el).margin
            });
          }
        }
        return {
          windowInnerWidth: window.innerWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          culprits
        };
      })()`,
      returnByValue: true
    });

    console.log("Analysis at 280px:", JSON.stringify(analysis.result.value, null, 2));

    ws.close();
  } finally {
    proc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

pinpoint().catch(console.error);
