// Kullanım: node test/api-test.mjs <taban-url> <token>
// Boş bir veritabanına karşı çalıştırılmalıdır (yerel `wrangler dev`).
import assert from 'node:assert/strict';
const [BASE, TOKEN] = process.argv.slice(2);
const api = `${BASE}/api/${TOKEN}/state`, mcpUrl = `${BASE}/mcp/${TOKEN}`;
let id = 0, passed = 0;
const ok = (name) => { passed++; console.log('✓ ' + name); };
const rpc = async (method, params, notify = false) => {
  const r = await fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params }) });
  return notify ? r : r.json();
};
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); return { text: r.result.content[0].text, error: !!r.result.isError }; };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const sample = { version: 1, setup: 2, initial: 1000000, lastMethod: 'cash', cards: [{ id: 'is', name: 'İş Bankası', cut: 28, due: 7, color: '#B388FF' }, { id: 'yapi', name: 'Yapı Kredi', cut: 15, due: 25, color: '#FF9F43' }, { id: 'ziraat', name: 'Ziraat', cut: 5, due: 15, color: '#2EC4D6' }], expenses: [], incomes: [], rules: [], payments: [], adjustments: [], backupAt: null };

// Erişim
assert.equal((await fetch(BASE + '/')).status, 200);
assert.equal((await fetch(`${BASE}/api/yanlis-anahtar-yanlis-anahtar-yanlis-anahtar/state`)).status, 404);
assert.equal((await fetch(`${BASE}/mcp/yanlis`, { method: 'POST', body: '{}' })).status, 404);
ok('yanlış anahtar 404');

// CORS
const pre = await fetch(api, { method: 'OPTIONS', headers: { Origin: 'https://muhammedguven108.github.io', 'Access-Control-Request-Method': 'PUT' } });
assert.equal(pre.headers.get('access-control-allow-origin'), 'https://muhammedguven108.github.io');
const evil = await fetch(api, { headers: { Origin: 'https://kotu.example' } });
assert.equal(evil.headers.get('access-control-allow-origin'), null);
ok('CORS yalnız uygulama kaynağına açık');

// Boş sunucu
let g = await (await fetch(api)).json();
assert.deepEqual(g, { rev: 0, state: null });
assert.equal((await call('durum_ozeti')).error, true);
ok('boş defter: MCP yazmadan önce bağlantı ister');

// İlk yükleme ve çakışma
let p = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: 0, state: sample }) });
assert.equal(p.status, 200); assert.equal((await p.json()).rev, 1);
p = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: 0, state: sample }) });
assert.equal(p.status, 409); const c = await p.json(); assert.equal(c.rev, 1); assert.equal(c.state.initial, 1000000);
p = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: 1, state: { ...sample, cards: [] } }) });
assert.equal(p.status, 400);
ok('yükleme, eski sürüm çakışması (409) ve geçersiz veri reddi (400)');

// MCP el sıkışma
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
assert.equal(init.result.protocolVersion, '2025-06-18'); assert.ok(init.result.capabilities.tools);
assert.equal((await rpc('notifications/initialized', {}, true)).status, 202);
const list = await rpc('tools/list', {});
assert.equal(list.result.tools.length, 12);
assert.equal((await fetch(mcpUrl)).status, 405);
assert.equal((await rpc('yok/boyle', {})).error.code, -32601);
ok('MCP initialize / tools/list / bildirim / GET 405');

// Harcamalar
let r = await call('harcama_ekle', { tutar: 340.5, odeme: 'nakit', not: 'market' });
assert.equal(r.error, false); assert.match(r.text, /340,5 TL/); assert.match(r.text, /Bugünkü bakiye: 9\.659,5 TL/);
r = await call('harcama_ekle', { tutar: '1.250,00', odeme: 'İş Bankası', not: 'kulaklık', tarih: today });
assert.equal(r.error, false); assert.match(r.text, /son ödeme gününde düşecek/); assert.match(r.text, /9\.659,5 TL/);
r = await call('harcama_ekle', { tutar: 100, odeme: 'yapı kredi kartı' }); assert.equal(r.error, false, r.text);
r = await call('harcama_ekle', { tutar: 100, odeme: 'kart' }); assert.equal(r.error, true); assert.match(r.text, /anlaşılamadı/);
r = await call('harcama_ekle', { tutar: -5, odeme: 'nakit' }); assert.equal(r.error, true);
r = await call('harcama_ekle', { tutar: 5, odeme: 'nakit', tarih: '2026-02-30' }); assert.equal(r.error, true);
ok('harcama: nakit, kart adı, belirsiz kart, eksi tutar, geçersiz tarih');

// Gelirler
r = await call('gelir_ekle', { tutar: 2000, ad: 'Harçlık', tarih: plus(today, 5) });
assert.match(r.text, /bekleniyor/); const pendingId = r.text.match(/id: ([\w-]+)/)[1];
r = await call('durum_ozeti', { gun: 30 }); assert.match(r.text, /Bekleyen gelirler/); assert.match(r.text, /Harçlık/);
r = await call('gelir_onayla', { id: pendingId }); assert.equal(r.error, false, r.text); assert.match(r.text, /11\.659,5 TL/);
r = await call('gelir_onayla', { id: pendingId }); assert.equal(r.error, true);
ok('gelecek gelir bekler, onaylanınca bugüne eklenir');

// Düzenli gelir + zam
r = await call('duzenli_gelir_ekle', { ad: 'KYK', tutar: 3500, gun: 15, baslangic: plus(today, 1) });
const ruleId = r.text.match(/id: ([\w-]+)/)[1];
r = await call('duzenli_gelir_tutar_degistir', { id: ruleId, yeni_tutar: 4000, gecerlilik: today }); assert.equal(r.error, true);
r = await call('duzenli_gelir_tutar_degistir', { id: ruleId, yeni_tutar: 4000, gecerlilik: plus(today, 40) }); assert.equal(r.error, false, r.text);
r = await call('kayit_guncelle', { tur: 'duzenli_gelir', id: ruleId, tutar: 1 }); assert.equal(r.error, true); assert.match(r.text, /duzenli_gelir_tutar_degistir/);
ok('düzenli gelir, geçmişe zam reddi, gelecek zam');

// Planlı ödeme, listeleme, güncelleme, silme
r = await call('planli_odeme_ekle', { ad: 'Kira', tutar: 5000, tarih: plus(today, 3), tekrar: 'aylik' }); assert.match(r.text, /aylık/);
r = await call('kayitlari_listele', { tur: 'harcama', arama: 'market' });
assert.match(r.text, /^1 kayıttan 1/); const expId = r.text.match(/id: ([\w-]+)/)[1];
r = await call('kayit_guncelle', { tur: 'harcama', id: expId, tutar: 300, not: 'market alışverişi' });
assert.match(r.text, /Önce: .*340,5 TL/); assert.match(r.text, /Sonra: .*300 TL · Nakit · market alışverişi/);
r = await call('kayit_sil', { tur: 'harcama', id: 'yok' }); assert.equal(r.error, true);
r = await call('kayit_sil', { tur: 'harcama', id: expId }); assert.match(r.text, /Silindi/); assert.match(r.text, /12\.000 TL/);
ok('planlı ödeme, liste/arama, güncelle, sil');

// Bakiye düzeltme ve geri alma
r = await call('bakiye_duzelt', { gercek_bakiye: 11500 }); assert.match(r.text, /12\.000 TL → 11\.500 TL/);
r = await call('durum_ozeti'); assert.match(r.text, /Bugünkü bakiye: 11\.500 TL/);
r = await call('son_degisikligi_geri_al'); assert.match(r.text, /bakiye_duzelt/); assert.match(r.text, /12\.000 TL/);
ok('bakiye düzeltme ve geri alma');

// Uygulama tarafı: sunucudaki sürüm ilerledi, eski rev ile yazma 409 döner
g = await (await fetch(api)).json();
assert.ok(g.rev > 10); assert.equal(g.state.payments[0].repeat, 'monthly'); assert.equal(g.state.rules[0].rates[0].amount, 400000);
p = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRev: 1, state: sample }) });
assert.equal(p.status, 409);
ok('Claude değişikliklerinden sonra eski uygulama sürümü yazamaz');

// Birden fazla istek aynı anda: hiçbiri kaybolmamalı
await Promise.all(Array.from({ length: 6 }, (_, i) => call('harcama_ekle', { tutar: 1, odeme: 'nakit', not: 'eşzamanlı ' + i })));
g = await (await fetch(api)).json();
assert.equal(g.state.expenses.filter(e => e.note.startsWith('eşzamanlı')).length, 6);
ok('eşzamanlı 6 ekleme kaybolmadı');

console.log(`\n${passed} test grubu geçti.`);
