import fs from 'node:fs';

const practical = JSON.parse(fs.readFileSync('practical_tests.json', 'utf8'));
const situational = JSON.parse(fs.readFileSync('situational_tests.json', 'utf8'));

console.log('=== DATASET ANALYSIS ===');
console.log('Practical tests:', practical.length);
console.log('Situational tests:', situational.length);

const allDatasets = [
  { name: 'practical', data: practical },
  { name: 'situational', data: situational }
];

const longWords = [];
const longFormulas = [];

for (const ds of allDatasets) {
  for (const item of ds.data) {
    const fields = [
      { name: 'title', val: item.title },
      { name: 'condition', val: item.condition },
      { name: 'question', val: item.question },
      { name: 'explanation', val: item.explanation },
      ...(item.options || []).map((o, idx) => ({ name: `option_${o.id || idx}`, val: o.text })),
      ...Object.entries(item.distractor_explanations || {}).map(([k, v]) => ({ name: `distractor_${k}`, val: v }))
    ];

    for (const f of fields) {
      if (!f.val) continue;
      // Find long contiguous tokens without whitespace
      const tokens = f.val.split(/\s+/);
      for (const token of tokens) {
        if (token.length >= 25) {
          longWords.push({
            dataset: ds.name,
            id: item.task_id || item.case_id,
            field: f.name,
            len: token.length,
            token
          });
        }
        if (token.includes('=') || token.includes('/') || token.includes('\\') || token.includes('∑') || token.includes('x̄') || token.includes('σ')) {
          if (token.length >= 15) {
            longFormulas.push({
              dataset: ds.name,
              id: item.task_id || item.case_id,
              field: f.name,
              len: token.length,
              token
            });
          }
        }
      }
    }
  }
}

console.log(`\nTokens >= 25 chars: ${longWords.length}`);
longWords.sort((a, b) => b.len - a.len);
longWords.slice(0, 10).forEach(w => {
  console.log(`[${w.dataset} #${w.id} in ${w.field}] (${w.len} chars): ${w.token}`);
});

console.log(`\nFormula tokens >= 15 chars: ${longFormulas.length}`);
longFormulas.sort((a, b) => b.len - a.len);
longFormulas.slice(0, 10).forEach(f => {
  console.log(`[${f.dataset} #${f.id} in ${f.field}] (${f.len} chars): ${f.token}`);
});
