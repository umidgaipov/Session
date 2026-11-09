/**
 * Test real practical_tests.json task #10 explanation inside .explanation-body
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9227;
const TEMP_USER_DATA = os.tmpdir() + "/chrome_test_p10_" + Date.now();

async function testTask10() {
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

    // Read task 10 explanation from practical_tests.json
    const practical = JSON.parse(fs.readFileSync('practical_tests.json', 'utf8'));
    const t10 = practical.find(t => t.task_id === 10);
    console.log("Task 10 Title:", t10.title);
    console.log("Task 10 Question:", t10.question);

    await send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 600,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 200));

    // Inject task 10
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        document.getElementById('question-topic').textContent = ${JSON.stringify(t10.title)};
        document.getElementById('question-prompt').textContent = ${JSON.stringify(t10.question)};
        document.getElementById('context-text').textContent = ${JSON.stringify(t10.condition)};
        const exp = document.getElementById('explanation-card');
        exp.classList.add('is-visible');
        document.getElementById('explanation-body').textContent = ${JSON.stringify(t10.explanation)};

        return {
          innerWidth: window.innerWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          appScrollWidth: document.querySelector('.app-container').scrollWidth
        };
      })()`,
      returnByValue: true
    });

    console.log("Task 10 rendered at 320px viewport metrics:", res.result.value);

    ws.close();
  } finally {
    proc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

testTask10().catch(console.error);
