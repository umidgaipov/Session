/**
 * Investigate why window.innerWidth changes or if Emulation is affected
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9226;
const TEMP_USER_DATA = os.tmpdir() + "/chrome_test_" + Date.now();

async function check() {
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
    const versionRes = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json());
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

    console.log("Setting device metrics 320x600...");
    await send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 600,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 200));

    let res = await send('Runtime.evaluate', {
      expression: '({ innerWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth })',
      returnByValue: true
    });
    console.log("Initial at 320px:", res.result.value);

    // Now inject long unbroken word into title
    console.log("\nInjecting 60-char word into #question-topic...");
    await send('Runtime.evaluate', {
      expression: `document.getElementById('question-topic').textContent = 'SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious';`
    });
    await new Promise(r => setTimeout(r, 200));

    res = await send('Runtime.evaluate', {
      expression: '({ innerWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth })',
      returnByValue: true
    });
    console.log("After long word injection in title:", res.result.value);

    // Now test word-break: break-word behavior
    const computed = await send('Runtime.evaluate', {
      expression: `({
        titleWordBreak: window.getComputedStyle(document.getElementById('question-topic')).wordBreak,
        titleOverflowWrap: window.getComputedStyle(document.getElementById('question-topic')).overflowWrap,
        promptWordBreak: window.getComputedStyle(document.getElementById('question-prompt')).wordBreak,
        promptOverflowWrap: window.getComputedStyle(document.getElementById('question-prompt')).overflowWrap,
        expWordBreak: window.getComputedStyle(document.getElementById('explanation-body')).wordBreak,
        expOverflowWrap: window.getComputedStyle(document.getElementById('explanation-body')).overflowWrap
      })`,
      returnByValue: true
    });
    console.log("Computed wrap styles:", computed.result.value);

    ws.close();
  } finally {
    proc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

check().catch(console.error);
