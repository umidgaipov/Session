import { spawn } from 'node:child_process';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9231;
const TEMP_USER_DATA = os.tmpdir() + "/chrome_seg_" + Date.now();

async function checkSegment() {
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

    const segData = await send('Runtime.evaluate', {
      expression: `(() => {
        const segs = Array.from(document.querySelectorAll('.segment-btn')).map(b => {
          const r = b.getBoundingClientRect();
          const span = b.querySelector('span:first-child');
          const badge = b.querySelector('.segment-badge');
          return {
            id: b.id,
            w: r.width,
            h: r.height,
            spanRect: span ? span.getBoundingClientRect() : null,
            badgeRect: badge ? badge.getBoundingClientRect() : null,
            text: b.textContent.trim()
          };
        });
        return segs;
      })()`,
      returnByValue: true
    });

    console.log("Segment at 280px:", JSON.stringify(segData.result.value, null, 2));

    ws.close();
  } finally {
    proc.kill('SIGKILL');
  }
}

checkSegment().catch(console.error);
