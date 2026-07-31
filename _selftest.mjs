/* Self-test for the MCP tool implementations, importing the REAL num() rather than a
   retyped copy — a retyped regex in a test is how a passing test proves nothing. */
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./vaultpdf-mcp.mjs', import.meta.url), 'utf8');
const numSrc = src.slice(src.indexOf('function num(raw)'), src.indexOf('async function runTool'));
const num = new Function(numSrc + '; return num;')();
const CSV = '/home/rpareaper/Aleph1/biz/campaigns/vaultpdf/testdata/invoices.csv';
for (const col of [4, 5, 0]) {
  const rows = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean).slice(1);
  const vals = [], rej = [];
  rows.forEach(l => { const c = l.split(',')[col]; const v = num(c);
    if (v === null) { if (String(c ?? '').trim()) rej.push(String(c).trim()); } else vals.push(v); });
  if (!vals.length) console.log('col', col, '-> REFUSED  examples:', rej.slice(0, 2).join(', '));
  else console.log('col', col, '-> sum', vals.reduce((a, b) => a + b, 0).toFixed(2), ' n=' + vals.length,
                   ' skipped=' + rej.length);
}
console.log('num("$2,150.00") =', num('$2,150.00'));
console.log('num("2026-03-15") =', num('2026-03-15'), '(must be null)');
console.log('num("(1,234.50)") =', num('(1,234.50)'));
