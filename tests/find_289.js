import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9230;
const TEMP_USER_DATA = os.tmpdir() + "/chrome_find_289_" + Date.now();

async function find289() {
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

    // Reveal explanation card
    await send('Runtime.evaluate', {
      expression: `document.getElementById('explanation-card').classList.add('is-visible');`
    });

    const report = await send('Runtime.evaluate', {
      expression: `(() => {
        const docW = document.documentElement.scrollWidth;
        const bodyW = document.body.scrollWidth;
        const appW = document.querySelector('.app-container').scrollWidth;
        
        const overflowing = [];
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollWidth > 280) {
            overflowing.push({
              tag: el.tagName.toLowerCase(),
              id: el.id,
              className: el.className,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth
            });
          }
        }
        return { docW, bodyW, appW, overflowing };
      })()`,
      returnByValue: true
    });

    console.log("When explanation visible at 280px:", JSON.stringify(report.result.value, null, 2));

    ws.close();
  } finally {
    proc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

find289().catch(console.error);
