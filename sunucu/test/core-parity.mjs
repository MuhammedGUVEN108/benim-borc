// index.html içindeki hesaplama fonksiyonlarını ayıklar ve sunucu kopyasıyla (src/core.js) rastgele defterlerde karşılaştırır.
// Kullanım: node test/core-parity.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../src/core.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + ' bulunamadı');
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const names = ['day', 'date', 'monthDay', 'validDate', 'validate', 'statement', 'statements', 'occurrences', 'ruleAmount', 'events', 'current'];
const src = `let state, T; const today=()=>T, shift=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return day(d)};
${names.map(extract).join('\n')}
return { set(s,t){state=s;T=t}, validate, events, current, statements };`;
const app = new Function(src)();

let seed = 7;
const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pick = a => a[rnd(a.length)];
const d0 = '2026-01-01';
const rd = () => core.shift(d0, rnd(500));
function randomState() {
  const s = { version: 1, setup: 2, initial: rnd(2000000) - 500000, lastMethod: 'cash', cards: [{ id: 'is', name: 'İş', cut: 1 + rnd(31), due: 1 + rnd(31), color: '#B388FF' }, { id: 'yapi', name: 'Yapı', cut: 1 + rnd(31), due: 1 + rnd(31), color: '#FF9F43' }, { id: 'ziraat', name: 'Ziraat', cut: 1 + rnd(31), due: 1 + rnd(31), color: '#2EC4D6' }], expenses: [], incomes: [], rules: [], payments: [], adjustments: [], backupAt: null };
  for (let i = 0; i < 40; i++) s.expenses.push({ id: 'e' + i, amount: 1 + rnd(500000), date: rd(), method: pick(['cash', 'is', 'yapi', 'ziraat']), note: pick(['', 'market', 'yol']) });
  for (let i = 0; i < 8; i++) s.incomes.push({ id: 'i' + i, amount: 1 + rnd(900000), date: rd(), name: 'gelir' + i, confirmed: !!rnd(2) });
  for (let i = 0; i < 3; i++) { const start = rd(); s.rules.push({ id: 'r' + i, name: 'kural' + i, amount: 1 + rnd(500000), day: 1 + rnd(31), start, rates: rnd(2) ? [{ from: core.shift(start, 40 + rnd(100)), amount: 1 + rnd(600000) }] : [] }); }
  for (let i = 0; i < 4; i++) s.payments.push({ id: 'p' + i, name: 'ödeme' + i, amount: 1 + rnd(400000), date: rd(), repeat: pick(['once', 'monthly']) });
  for (let i = 0; i < 3; i++) s.adjustments.push({ id: 'a' + i, date: rd(), amount: rnd(200000) - 100000 });
  return s;
}

let checks = 0;
for (let k = 0; k < 60; k++) {
  const s = randomState(), t = rd();
  app.set(s, t);
  assert.doesNotThrow(() => { app.validate(structuredClone(s)); core.validate(structuredClone(s)); });
  for (const end of [t, core.shift(t, 30), core.shift(t, 366)]) {
    assert.deepEqual(core.events(s, end, t), app.events(end), 'events ayrıştı');
    checks++;
  }
  assert.equal(core.current(s, t), app.current()); checks++;
  assert.deepEqual(core.statements(s), app.statements()); checks++;
}
// Doğrulayıcılar aynı bozuk verileri reddetmeli
const bad = [{ ...randomState(), cards: [] }, { ...randomState(), initial: 1.5 }, (() => { const s = randomState(); s.expenses[0].method = 'x'; return s; })(), (() => { const s = randomState(); s.rules[0].rates = [{ from: '1999-01-01', amount: 5 }]; return s; })()];
for (const b of bad) { assert.throws(() => app.validate(b)); assert.throws(() => core.validate(b)); checks++; }
console.log(`✓ uygulama ve sunucu hesaplaması ${checks} karşılaştırmada aynı.`);
