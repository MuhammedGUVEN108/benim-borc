// Uygulama eşitleme testi: Edge + puppeteer-core, yerel `wrangler dev` (127.0.0.1:8787) ve boş yerel D1.
// Uygulamanın canlı sunucu adresine giden istekleri yerel sunucuya yönlendirir; canlı veriye dokunmaz.
// Kullanım: node test/app-test.cjs <puppeteer-core yolu>
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const puppeteer = require(process.argv[2]);
const ROOT = path.resolve(__dirname, '../..'), LIVE = 'https://benim-borc.gmuhammed108.workers.dev', LOCAL = 'http://127.0.0.1:8787';
const TOKEN = 'devtoken-0123456789abcdef0123456789abcdef', API = `${LOCAL}/api/${TOKEN}/state`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let passed = 0; const ok = n => { passed++; console.log('✓ ' + n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const sample = { version: 1, setup: 2, initial: 1000000, lastMethod: 'cash', cards: [{ id: 'is', name: 'İş Bankası', cut: 28, due: 7, color: '#B388FF' }, { id: 'yapi', name: 'Yapı Kredi', cut: 15, due: 25, color: '#FF9F43' }, { id: 'ziraat', name: 'Ziraat', cut: 5, due: 15, color: '#2EC4D6' }], expenses: [{ id: 'e1', amount: 5000, date: today, method: 'cash', note: 'çay' }], incomes: [], rules: [], payments: [], adjustments: [], backupAt: null };
let rpcId = 0;
const tool = async (name, args) => { const r = await (await fetch(`${LOCAL}/mcp/${TOKEN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })).json(); assert.ok(!r.result.isError, r.result.content[0].text); return r.result.content[0].text; };
const server = async () => (await fetch(API)).json();

(async () => {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const ORIGIN = `http://127.0.0.1:${srv.address().port}`;
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run'] });
  const errors = [];
  async function open(ctx) {
    const page = await ctx.newPage();
    await page.setViewport({ width: 430, height: 932, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', r => r.url().startsWith(LIVE) ? r.continue({ url: r.url().replace(LIVE, LOCAL) }) : r.continue());
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
    return page;
  }
  const local = page => page.evaluate(() => JSON.parse(localStorage.getItem('benim-borc-v1')));
  const label = page => page.$eval('[data-sync-label]', el => el.textContent).catch(() => null);
  const waitLabel = async (page, text) => { for (let i = 0; i < 50; i++) { if ((await label(page)) === text) return; await sleep(100); } assert.equal(await label(page), text); };
  const settle = async page => { await page.evaluate(() => syncNow()); for (let i = 0; i < 60; i++) { if (!(await page.evaluate(() => syncBusy))) return; await sleep(100); } };

  try {
    // 1. Bağlanmamış cihaz: eskisi gibi yalnız yerel
    const ctxA = await browser.createBrowserContext(), A = await open(ctxA);
    await A.goto(ORIGIN + '/'); await A.evaluate(s => localStorage.setItem('benim-borc-v1', JSON.stringify(s)), sample); await A.reload();
    assert.equal(await label(A), 'Yalnızca bu cihazda');
    assert.equal((await server()).rev, 0);
    ok('bağlanmadan önce hiçbir şey gönderilmiyor');

    // 2. Yanlış anahtar ve ardından doğru anahtarla bağlanma: boş sunucuya yerel defter yüklenir
    await A.click('[data-action="settings"]'); await A.click('[data-action="sync"]');
    await A.type('#syncToken', 'yanlis-anahtar-yanlis-anahtar-yanlis-anahtar'); await A.click('#doConnect');
    await A.waitForFunction(() => document.querySelector('#syncErr').textContent.includes('kabul edilmedi'));
    await A.$eval('#syncToken', el => el.value = ''); await A.type('#syncToken', TOKEN); await A.click('#doConnect');
    await A.waitForFunction(() => !document.querySelector('#sheet').open);
    await settle(A);
    let s = await server(); assert.equal(s.rev, 1); assert.deepEqual(s.state, await local(A));
    await A.click('[data-action="tab"][data-tab="home"]'); await waitLabel(A, 'Claude ile eşitlendi');
    ok('yanlış anahtar reddedildi; doğru anahtarla telefon defteri sunucuya yüklendi');

    // 3. Claude ekler → uygulama görünür olunca çeker ve ekranda gösterir
    await tool('harcama_ekle', { tutar: 340.5, odeme: 'nakit', not: 'market' });
    await settle(A);
    assert.ok((await local(A)).expenses.some(e => e.note === 'market' && e.amount === 34050));
    assert.match(await A.$eval('.balance strong', el => el.textContent), /9\.609,5/);
    ok('Claude’un eklediği harcama uygulamaya geldi, bakiye güncellendi');

    // 4. Uygulamada form ile kayıt → sunucuya gider
    await A.click('[data-action="add"]'); await A.click('#sheetBody [data-action="expense"]');
    await A.type('#f-amount', '25'); await A.select('#f-method', 'is'); await A.type('#f-note', 'kitap'); await A.click('#editor button[type=submit]');
    await A.waitForFunction(() => !document.querySelector('#sheet').open); await settle(A);
    s = await server(); assert.ok(s.state.expenses.some(e => e.note === 'kitap' && e.method === 'is'));
    ok('uygulamada girilen kart harcaması sunucuya gönderildi');

    // 5. Çevrimdışı giriş + aynı anda Claude değişikliği → birleşir, hiçbiri kaybolmaz
    await A.setOfflineMode(true); await A.evaluate(() => window.dispatchEvent(new Event('offline')));
    await A.evaluate(() => commit(s => { s.expenses.push({ id: 'off1', amount: 1000, date: today(), method: 'cash', note: 'otobüs' }); s.expenses = s.expenses.filter(e => e.note !== 'çay'); }));
    await settle(A); assert.match(await label(A), /Çevrimdışı · değişiklikler bekliyor/);
    const kitap = (await local(A)).expenses.find(e => e.note === 'kitap');
    await tool('gelir_ekle', { tutar: 2000, ad: 'Harçlık' });
    await tool('kayit_guncelle', { tur: 'harcama', id: kitap.id, tutar: 30 });
    await A.setOfflineMode(false); await settle(A);
    s = await server(); const l = await local(A);
    assert.deepEqual(s.state, l);
    assert.ok(l.expenses.some(e => e.id === 'off1'), 'çevrimdışı kayıt');
    assert.ok(!l.expenses.some(e => e.note === 'çay'), 'çevrimdışı silme');
    assert.ok(l.incomes.some(i => i.name === 'Harçlık'), 'Claude geliri');
    assert.equal(l.expenses.find(e => e.id === kitap.id).amount, 3000, 'Claude güncellemesi');
    await waitLabel(A, 'Claude ile eşitlendi');
    ok('çevrimdışı ekleme/silme ile Claude’un ekleme/güncellemesi birleşti');

    // 6. Aynı kayıt iki tarafta değişirse telefondaki son değişiklik kazanır, diğerleri korunur
    await A.setOfflineMode(true);
    await A.evaluate(id => commit(s => { s.expenses.find(e => e.id === id).note = 'kitap (telefon)'; }), kitap.id);
    await tool('kayit_guncelle', { tur: 'harcama', id: kitap.id, not: 'kitap (claude)' });
    await tool('planli_odeme_ekle', { ad: 'Kira', tutar: 5000, tarih: today, tekrar: 'aylik' });
    await A.setOfflineMode(false); await settle(A);
    s = await server();
    assert.equal(s.state.expenses.find(e => e.id === kitap.id).note, 'kitap (telefon)');
    assert.ok(s.state.payments.some(p => p.name === 'Kira'));
    ok('aynı kayıtta çakışma: telefondaki düzenleme kazandı, Claude’un yeni kaydı korundu');

    // 7. Yeni cihaz (boş): anahtar linkiyle açılır, sunucudaki defter yüklenir, anahtar adresten silinir
    const ctxB = await browser.createBrowserContext(), B = await open(ctxB);
    await B.goto(ORIGIN + '/#anahtar=' + TOKEN);
    await B.waitForSelector('#doConnect'); assert.equal(await B.evaluate(() => location.hash), '');
    assert.equal(await B.$eval('#syncToken', el => el.value), TOKEN);
    await B.click('#doConnect'); await B.waitForFunction(() => !document.querySelector('#sheet').open || document.querySelector('#sheetTitle').textContent === 'Gelirini doğrula');
    assert.deepEqual(await local(B), (await server()).state);
    ok('yeni cihaz kurulum linkiyle bağlandı, anahtar adres çubuğundan silindi, defter yüklendi');

    // 8. Farklı verisi olan cihaz: hangi defterin kullanılacağı sorulur
    const ctxC = await browser.createBrowserContext(), C = await open(ctxC);
    await C.goto(ORIGIN + '/'); await C.evaluate(s => localStorage.setItem('benim-borc-v1', JSON.stringify({ ...s, initial: 1 })), sample); await C.reload();
    await C.click('[data-action="settings"]'); await C.click('[data-action="sync"]'); await C.type('#syncToken', TOKEN); await C.click('#doConnect');
    await C.waitForSelector('#useRemote'); await C.click('#useRemote'); await settle(C);
    assert.deepEqual(await local(C), (await server()).state);
    ok('farklı verili cihazda seçim soruldu, sunucudaki kullanıldı');

    // 9. İki cihaz: B'de eklenen A'ya gelir
    await B.evaluate(() => commit(s => s.expenses.push({ id: 'b1', amount: 777, date: today(), method: 'cash', note: 'B cihazı' })));
    await settle(B); await settle(A);
    assert.ok((await local(A)).expenses.some(e => e.id === 'b1'));
    ok('ikinci cihazdaki kayıt ilk cihaza geldi');

    // 10. Bağlantıyı kaldırma: yerel kayıtlar kalır, artık gönderilmez
    const revBefore = (await server()).rev;
    await C.click('[data-action="settings"]'); await C.click('[data-action="syncOff"]'); await C.click('#confirmSyncOff');
    await C.evaluate(() => commit(s => s.expenses.push({ id: 'c1', amount: 1, date: today(), method: 'cash', note: 'yerel' }))); await sleep(800);
    assert.equal((await server()).rev, revBefore);
    assert.equal(await C.evaluate(() => localStorage.getItem('benim-borc-sync')), null);
    ok('bağlantı kaldırılınca gönderim durdu, yerel kayıtlar kaldı');

    // 11. Ekran: menü ve ayarlar paneli dar ekranda taşmıyor
    for (const w of [320, 430]) {
      await A.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
      await A.click('[data-action="settings"]');
      const over = await A.evaluate(() => [...document.querySelectorAll('#app *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).length);
      assert.equal(over, 0, w + 'px taşma');
    }
    ok('320/430 px genişlikte taşma yok');

    assert.deepEqual(errors, []);
    ok('JS hatası yok');
  } finally { await browser.close(); srv.close(); }
  console.log(`\n${passed} test geçti.`);
})().catch(e => { console.error('✗', e); process.exit(1); });
