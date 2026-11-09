function luminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function hexToRgb(hex) {
  const num = parseInt(hex.replace('#', ''), 16);
  return [num >> 16, (num >> 8) & 255, num & 255];
}

function contrast(hex1, hex2) {
  const lum1 = luminance(...hexToRgb(hex1));
  const lum2 = luminance(...hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

const pairs = [
  { name: 'Primary text on warm bg', fg: '#1A1A1A', bg: '#FAFAF8' },
  { name: 'Primary text on white card', fg: '#1A1A1A', bg: '#FFFFFF' },
  { name: 'Secondary text on warm bg', fg: '#6B6B6B', bg: '#FAFAF8' },
  { name: 'Secondary text on white card', fg: '#6B6B6B', bg: '#FFFFFF' },
  { name: 'Secondary text on subtle surface', fg: '#6B6B6B', bg: '#F6F6F4' },
  { name: 'Tertiary text on subtle surface (context-label)', fg: '#9A9A96', bg: '#F6F6F4' },
  { name: 'Correct text on correct bg', fg: '#176530', bg: '#EEF8F1' },
  { name: 'Incorrect text on incorrect bg', fg: '#8E201B', bg: '#FDF2F2' },
  { name: 'Pill primary text on primary bg', fg: '#FFFFFF', bg: '#1A1A1A' }
];

console.log("=== WCAG CONTRAST AUDIT ===");
pairs.forEach(p => {
  const cr = contrast(p.fg, p.bg);
  const passAA = cr >= 4.5 ? 'PASS AA' : (cr >= 3.0 ? 'PASS AA Large / FAIL AA Normal' : 'FAIL AA');
  console.log(`${p.name} (${p.fg} on ${p.bg}): ${cr.toFixed(2)}:1 -> ${passAA}`);
});
