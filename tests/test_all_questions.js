/**
 * Exhaustive Empirical Test of ALL 152 Questions from Datasets
 * Tests every single situational and practical question at 320px and 280px for horizontal overflow!
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9228;
const TEMP_USER_DATA = os.tmpdir() + "/chrome_all_questions_" + Date.now();

async function testAllQuestions() {
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

    const practical = JSON.parse(fs.readFileSync('practical_tests.json', 'utf8'));
    const situational = JSON.parse(fs.readFileSync('situational_tests.json', 'utf8'));

    const all = [
      ...situational.map(q => ({ type: 'situational', id: q.case_id, data: q })),
      ...practical.map(q => ({ type: 'practical', id: q.task_id, data: q }))
    ];

    console.log(`Starting exhaustive testing of ${all.length} questions...`);

    const viewports = [320, 280];
    const report = {
      failures: [],
      passedCount: 0,
      totalChecks: 0
    };

    for (const vp of viewports) {
      console.log(`\n--- Testing all 152 questions at ${vp}px ---`);
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp,
        height: 700,
        deviceScaleFactor: 2,
        mobile: true
      });
      await new Promise(r => setTimeout(r, 100));

      for (let i = 0; i < all.length; i++) {
        report.totalChecks++;
        const item = all[i];
        const d = item.data;

        const evalRes = await send('Runtime.evaluate', {
          expression: `((item) => {
            document.getElementById('question-topic').textContent = item.title || '';
            document.getElementById('category-text').textContent = item.category || 'Общая теория статистики';
            document.getElementById('context-text').textContent = item.condition || item.situation || '';
            document.getElementById('question-prompt').textContent = item.question || '';
            
            const expCard = document.getElementById('explanation-card');
            expCard.classList.add('is-visible');
            document.getElementById('explanation-body').textContent = item.explanation || '';

            // Update options
            const optList = document.getElementById('options-list');
            optList.innerHTML = '';
            (item.options || []).forEach(o => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'option-btn';
              btn.innerHTML = '<span class=\"option-indicator\">' + (o.id || '') + '</span><span class=\"option-text\">' + (o.text || '') + '</span>';
              optList.appendChild(btn);
            });

            // Update distractors
            const dList = document.getElementById('distractors-list');
            dList.innerHTML = '';
            for (const [k, v] of Object.entries(item.distractor_explanations || {})) {
              const div = document.createElement('div');
              div.className = 'distractor-item';
              div.innerHTML = '<span class=\"distractor-tag\">Вариант ' + k + ':</span> ' + v;
              dList.appendChild(div);
            }

            const winW = window.innerWidth;
            const docW = document.documentElement.scrollWidth;
            const bodyW = document.body.scrollWidth;
            const appW = document.querySelector('.app-container').scrollWidth;

            return {
              winW,
              docW,
              bodyW,
              appW,
              overflow: Math.max(0, docW - ${vp}, bodyW - ${vp}, appW - ${vp})
            };
          })(${JSON.stringify(d)})`,
          returnByValue: true
        });

        const m = evalRes.result.value;
        if (m.overflow > 0) {
          report.failures.push({
            viewport: vp,
            type: item.type,
            id: item.id,
            title: d.title?.slice(0, 40),
            overflow: m.overflow,
            docW: m.docW,
            winW: m.winW
          });
          if (report.failures.length <= 10) {
            console.error(`  FAIL [${vp}px] ${item.type} #${item.id} "${d.title?.slice(0, 30)}": overflow=${m.overflow}px (docW=${m.docW})`);
          }
        } else {
          report.passedCount++;
        }
      }
      console.log(`Completed ${vp}px: ${report.failures.filter(f => f.viewport === vp).length} failures.`);
    }

    console.log("\n=======================================================");
    console.log(`TOTAL CHECKS: ${report.totalChecks} | PASSED: ${report.passedCount} | FAILED: ${report.failures.length}`);
    console.log("=======================================================");

    fs.writeFileSync('tests/all_questions_stress_result.json', JSON.stringify(report, null, 2));

    ws.close();

    if (report.failures.length > 0) {
      console.error(`\n❌ TEST FAILED: ${report.failures.length} questions violated viewport boundaries!`);
      process.exit(1);
    }
  } finally {
    proc.kill('SIGKILL');
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

testAllQuestions().catch((err) => {
  console.error('Fatal test error in test_all_questions:', err);
  process.exit(1);
});
