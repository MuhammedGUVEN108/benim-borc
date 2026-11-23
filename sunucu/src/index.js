// Benim Borç sunucusu: uygulama için eşitleme API'si + Claude için MCP (Streamable HTTP, JSON yanıt).
// Erişim, adresin içindeki gizli anahtarla korunur: /api/<TOKEN>/state ve /mcp/<TOKEN>
import { todayTR, shift, date, long, fmt, money, validate, validDate, statement, statements, events, current, future, ruleAmount, monthDay } from './core.js';

const ALLOWED_ORIGINS = [/^https:\/\/muhammedguven108\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const KEEP_VERSIONS = 300;
const MAX_BODY = 4 * 1024 * 1024;

class UserError extends Error {}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (parts.length === 0) return text('Benim Borç sunucusu çalışıyor.');
      if (!env.TOKEN || env.TOKEN.length < 32 || parts.length < 2 || !safeEqual(parts[1], env.TOKEN)) return text('Bulunamadı', 404, cors);
      if (parts[0] === 'api' && parts[2] === 'state' && parts.length === 3) return await stateApi(req, env, cors);
      if (parts[0] === 'mcp' && parts.length === 2) return await mcp(req, env);
      return text('Bulunamadı', 404, cors);
    } catch (e) {
      return json({ error: e instanceof UserError ? e.message : 'Sunucu hatası' }, e instanceof UserError ? 400 : 500, cors);
    }
  },
};

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.some(r => r.test(origin))) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const text = (t, status = 200, headers = {}) => new Response(t, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}
async function readBody(req) {
  const t = await req.text();
  if (t.length > MAX_BODY) throw new UserError('İstek çok büyük.');
  try { return JSON.parse(t); } catch { throw new UserError('Geçersiz JSON.'); }
}

// ---- Depolama: her yazma yeni bir rev satırıdır; aynı rev'e ikinci yazma reddedilir. ----
async function load(env) {
  const row = await env.DB.prepare('SELECT rev, data, source, at FROM versions ORDER BY rev DESC LIMIT 1').first();
  return row ? { rev: row.rev, state: JSON.parse(row.data), source: row.source, at: row.at } : { rev: 0, state: null };
}
async function insertVersion(env, rev, state, source) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO versions (rev, data, at, source) VALUES (?, ?, ?, ?)').bind(rev, JSON.stringify(state), new Date().toISOString(), source).run();
  if (r.meta.changes !== 1) return false;
  await env.DB.prepare('DELETE FROM versions WHERE rev <= ?').bind(rev - KEEP_VERSIONS).run();
  return true;
}

async function stateApi(req, env, cors) {
  if (req.method === 'GET') { const cur = await load(env); return json({ rev: cur.rev, state: cur.state }, 200, cors); }
  if (req.method !== 'PUT') return text('Yöntem desteklenmiyor', 405, cors);
  const body = await readBody(req);
  if (!Number.isSafeInteger(body.baseRev) || body.baseRev < 0) throw new UserError('baseRev eksik.');
  try { validate(body.state); } catch (e) { throw new UserError(e.message); }
  const cur = await load(env);
  if (cur.rev !== body.baseRev || !(await insertVersion(env, body.baseRev + 1, body.state, 'uygulama'))) {
    const fresh = await load(env);
    return json({ conflict: true, rev: fresh.rev, state: fresh.state }, 409, cors);
  }
  return json({ rev: body.baseRev + 1 }, 200, cors);
}

// Oku-değiştir-yaz; arada uygulama yazdıysa en güncel sürüm üzerinde tekrar dener.
async function mutate(env, source, change) {
  for (let i = 0; i < 5; i++) {
    const cur = await load(env);
    if (!cur.state) throw new UserError('Sunucuda henüz defter yok. Önce telefondaki uygulamada Ayarlar → Claude eşitlemesi bölümünden bağlan.');
    const next = structuredClone(cur.state);
    const message = change(next, cur.state);
    try { validate(next); } catch (e) { throw new UserError('Kayıt doğrulanamadı: ' + e.message); }
    if (await insertVersion(env, cur.rev + 1, next, source)) return { message, state: next };
  }
  throw new UserError('Defter aynı anda değiştiriliyor, birazdan tekrar dene.');
}

// ---- MCP ----
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Benim Borç, kullanıcının Türkçe kişisel borç ve nakit akışı defteridir. Tutarlar TL'dir (ondalık nokta ile sayı ver, ör. 340.5). Tarihler YYYY-AA-GG biçimindedir ve Türkiye saatine göredir; tarih verilmezse bugün kullanılır.
Kartlar: is (İş Bankası), yapi (Yapı Kredi), ziraat (Ziraat). Kartla yapılan harcama bakiyeden hemen düşmez, ekstrenin son ödeme gününde düşer. Nakit harcama hemen düşer.
Kullanıcı harcamanın nakit mi kartla mı yapıldığını söylemediyse ve bağlamdan anlaşılmıyorsa eklemeden önce sor. Diğer durumlarda doğrudan ekle ve kısa sonucu bildir.
Düzenleme veya silme için önce kayitlari_listele ile kaydın kimliğini (id) bul. Yanlış bir değişiklik olursa son_degisikligi_geri_al kullanılabilir.`;

const AMOUNT = { type: 'number', description: 'TL cinsinden tutar, ör. 340.5' };
const DATE = d => ({ type: 'string', description: d + ' (YYYY-AA-GG)' });
const TUR = { type: 'string', enum: ['harcama', 'gelir', 'duzenli_gelir', 'planli_odeme', 'duzeltme'], description: 'Kayıt türü' };
const TOOLS = [
  { name: 'durum_ozeti', title: 'Durum özeti', description: 'Bugünkü bakiye, kartların dönem içi borçları ve son ödeme tarihleri, bekleyen gelirler ve önümüzdeki günlerin nakit akışı.', inputSchema: { type: 'object', properties: { gun: { type: 'integer', minimum: 1, maximum: 366, description: 'Kaç günlük ileriye bakılsın (varsayılan 30)' } } }, annotations: { readOnlyHint: true } },
  { name: 'harcama_ekle', title: 'Harcama ekle', description: 'Nakit veya kredi kartı harcaması ekler.', inputSchema: { type: 'object', properties: { tutar: AMOUNT, odeme: { type: 'string', description: 'nakit, is (İş Bankası), yapi (Yapı Kredi) veya ziraat; kart adı da yazılabilir' }, tarih: DATE('Harcama tarihi, boşsa bugün'), not: { type: 'string', description: 'Kısa açıklama, ör. market' } }, required: ['tutar', 'odeme'] } },
  { name: 'gelir_ekle', title: 'Tek seferlik gelir ekle', description: 'Tek seferlik gelir ekler. Bugün veya geçmiş tarihli gelir gelmiş sayılır; gelecek tarihli gelir beklenen olarak eklenir ve vadesinde uygulamada onay sorulur.', inputSchema: { type: 'object', properties: { tutar: AMOUNT, ad: { type: 'string', description: 'Gelirin adı, ör. Harçlık' }, tarih: DATE('Gelir tarihi, boşsa bugün') }, required: ['tutar', 'ad'] } },
  { name: 'duzenli_gelir_ekle', title: 'Düzenli gelir ekle', description: 'Her ay aynı gün gelen gelir (burs, maaş) ekler. Vadesi gelen tutarlar gerçekleşmiş sayılır.', inputSchema: { type: 'object', properties: { ad: { type: 'string' }, tutar: AMOUNT, gun: { type: 'integer', minimum: 1, maximum: 31, description: 'Ayın kaçında' }, baslangic: DATE('Kuralın başlangıcı, boşsa bugün') }, required: ['ad', 'tutar', 'gun'] } },
  { name: 'planli_odeme_ekle', title: 'Planlı ödeme ekle', description: 'Tek seferlik veya aylık tekrarlanan planlı ödeme (kira, fatura, borç) ekler. Vadesinde ödenmiş sayılır.', inputSchema: { type: 'object', properties: { ad: { type: 'string' }, tutar: AMOUNT, tarih: DATE('Ödeme tarihi; aylıkta ilk ödeme'), tekrar: { type: 'string', enum: ['tek', 'aylik'], description: 'Varsayılan tek' } }, required: ['ad', 'tutar', 'tarih'] } },
  { name: 'kayitlari_listele', title: 'Kayıtları listele', description: 'Kayıtları kimlikleriyle (id) birlikte yeniden eskiye listeler. Düzenleme/silme öncesi kullan.', inputSchema: { type: 'object', properties: { tur: { type: 'string', enum: ['hepsi', 'harcama', 'gelir', 'duzenli_gelir', 'planli_odeme', 'duzeltme'], description: 'Varsayılan hepsi' }, arama: { type: 'string', description: 'Ad veya notta geçen metin' }, baslangic: DATE('Bu tarihten itibaren'), bitis: DATE('Bu tarihe kadar'), adet: { type: 'integer', minimum: 1, maximum: 200, description: 'Varsayılan 20' } } }, annotations: { readOnlyHint: true } },
  { name: 'kayit_guncelle', title: 'Kaydı güncelle', description: 'Var olan bir kaydı değiştirir. Yalnız verilen alanlar değişir. Düzenli gelirde yalnız ad değişir; tutar için duzenli_gelir_tutar_degistir kullan. duzeltme türünde tutar, bakiyeye eklenen farktır (eksi olabilir).', inputSchema: { type: 'object', properties: { tur: TUR, id: { type: 'string' }, tutar: AMOUNT, tarih: DATE('Yeni tarih'), ad: { type: 'string' }, not: { type: 'string' }, odeme: { type: 'string', description: 'Harcamada: nakit, is, yapi, ziraat' }, tekrar: { type: 'string', enum: ['tek', 'aylik'] } }, required: ['tur', 'id'] } },
  { name: 'kayit_sil', title: 'Kaydı sil', description: 'Bir kaydı siler. Düzenli gelir silinirse geçmiş tüm gelirleri de hesaptan çıkar.', inputSchema: { type: 'object', properties: { tur: TUR, id: { type: 'string' } }, required: ['tur', 'id'] }, annotations: { destructiveHint: true } },
  { name: 'gelir_onayla', title: 'Bekleyen geliri onayla', description: 'Beklenen tek seferlik gelirin geldiğini işaretler.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, tarih: DATE('Gerçekte geldiği tarih, boşsa kayıttaki tarih (gelecekteyse bugün)') }, required: ['id'] } },
  { name: 'duzenli_gelir_tutar_degistir', title: 'Düzenli gelire zam', description: 'Düzenli gelirin tutarını gelecekteki bir tarihten itibaren değiştirir; geçmiş gelirler korunur.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, yeni_tutar: AMOUNT, gecerlilik: DATE('Bugünden sonraki geçerlilik tarihi') }, required: ['id', 'yeni_tutar', 'gecerlilik'] } },
  { name: 'bakiye_duzelt', title: 'Bakiyeyi düzelt', description: 'Kullanıcının elindeki gerçek toplam parayı girer; aradaki fark bugüne düzeltme kaydı olarak eklenir.', inputSchema: { type: 'object', properties: { gercek_bakiye: { type: 'number', description: 'Şu an elindeki gerçek toplam para (TL)' } }, required: ['gercek_bakiye'] } },
  { name: 'son_degisikligi_geri_al', title: 'Son değişikliği geri al', description: 'Defteri bir önceki sürümüne döndürür (uygulamadan veya Claude\'dan gelen son değişiklik).', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
];

async function mcp(req, env) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  let msg;
  try { msg = await readBody(req); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const batch = Array.isArray(msg), out = [];
  for (const m of batch ? msg : [msg]) { const r = await handleRpc(m, env); if (r) out.push(r); }
  if (!out.length) return new Response(null, { status: 202 });
  return json(batch ? out : out[0]);
}

async function handleRpc(m, env) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return m && m.id !== undefined ? { jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'Invalid Request' } } : null;
  if (m.id === undefined || m.id === null) return null; // bildirim
  const ok = result => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'benim-borc', title: 'Benim Borç', version: '1.0.0' }, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = m.params?.name, args = m.params?.arguments || {};
      const tool = TOOL_IMPL[name];
      if (!tool) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Bilinmeyen araç: ' + name } };
      try { return ok({ content: [{ type: 'text', text: await tool(args, env) }] }); }
      catch (e) { return ok({ content: [{ type: 'text', text: e instanceof UserError || e?.message ? 'Hata: ' + e.message : 'Hata oluştu.' }], isError: true }); }
    }
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } };
  }
}

// ---- Araç yardımcıları ----
const norm = s => String(s ?? '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
function amountArg(v, label = 'tutar', allowNegative = false) {
  if (v === undefined || v === null || v === '') throw new UserError(label + ' gerekli.');
  let n;
  try { n = money(v); } catch (e) { throw new UserError(e.message); }
  if (!allowNegative && n <= 0) throw new UserError('Tutar sıfırdan büyük olmalı.');
  return n;
}
function dateArg(v, fallback, label = 'tarih') {
  if (v === undefined || v === null || v === '') { if (fallback) return fallback; throw new UserError(label + ' gerekli.'); }
  if (!validDate(v)) throw new UserError(label + ' YYYY-AA-GG biçiminde geçerli bir tarih olmalı.');
  return v;
}
function textArg(v, label, required = true, max = 80) {
  const s = String(v ?? '').trim();
  if (!s && required) throw new UserError(label + ' gerekli.');
  if (s.length > max) throw new UserError(label + ' en fazla ' + max + ' karakter olabilir.');
  return s;
}
function methodArg(state, v) {
  const n = norm(v);
  if (!n) throw new UserError('Ödeme yöntemi gerekli: nakit, is, yapi veya ziraat.');
  if (['nakit', 'cash', 'pesin'].includes(n)) return 'cash';
  const hit = state.cards.filter(c => n === c.id || norm(c.name) === n || norm(c.name).startsWith(n) || n.startsWith(norm(c.name)) || n.replace(/\s/g, '').includes(norm(c.name).replace(/\s/g, '')));
  if (hit.length === 1) return hit[0].id;
  throw new UserError(`Ödeme yöntemi anlaşılamadı (“${v}”). Seçenekler: nakit, ${state.cards.map(c => `${c.id} (${c.name})`).join(', ')}.`);
}
const repeatArg = v => (v === undefined || v === null || v === '' ? 'once' : { tek: 'once', aylik: 'monthly', once: 'once', monthly: 'monthly' }[norm(v)] || (() => { throw new UserError('tekrar tek veya aylik olmalı.'); })());
const uid = () => crypto.randomUUID();
const KEYS = { harcama: 'expenses', gelir: 'incomes', duzenli_gelir: 'rules', planli_odeme: 'payments', duzeltme: 'adjustments' };
function findRecord(state, tur, id) {
  const key = KEYS[tur];
  if (!key) throw new UserError('tur şunlardan biri olmalı: ' + Object.keys(KEYS).join(', '));
  const rec = state[key].find(r => r.id === id);
  if (!rec) throw new UserError(`Bu kimlikle ${tur} bulunamadı. Önce kayitlari_listele ile kontrol et.`);
  return { key, rec };
}
const methodName = (state, m) => (m === 'cash' ? 'Nakit' : state.cards.find(c => c.id === m)?.name || m);
const balanceLine = state => { const t = todayTR(); return `Bugünkü bakiye: ${fmt(current(state, t))}`; };
function cardEffect(state, e) {
  if (e.method === 'cash') return 'Bakiyeden hemen düştü.';
  const c = state.cards.find(c => c.id === e.method);
  if (!c?.cut || !c.due) return 'Kartın kesim/son ödeme günleri girilmemiş; ekstreye eklenemedi.';
  const s = statement(e, c);
  return `${long(s.cut)} kesimli ekstreye girdi; bakiyeden ${long(s.due)} son ödeme gününde düşecek.`;
}

function describe(kind, r, state) {
  switch (kind) {
    case 'harcama': return `${long(r.date)} · harcama ${fmt(r.amount)} · ${methodName(state, r.method)}${r.note ? ' · ' + r.note : ''}`;
    case 'gelir': return `${long(r.date)} · gelir ${fmt(r.amount)} · ${r.name} · ${r.confirmed ? 'geldi' : 'bekleniyor'}`;
    case 'duzenli_gelir': return `${long(r.start)} itibarıyla her ayın ${r.day}. günü · düzenli gelir · ${r.name} · şu an ${fmt(ruleAmount(r, todayTR()))}${(r.rates || []).filter(x => x.from > todayTR()).map(x => ` (${long(x.from)} itibarıyla ${fmt(x.amount)})`).join('')}`;
    case 'planli_odeme': return `${long(r.date)} · planlı ödeme ${fmt(r.amount)} · ${r.name} · ${r.repeat === 'monthly' ? 'aylık' : 'tek seferlik'}`;
    case 'duzeltme': return `${long(r.date)} · bakiye düzeltmesi ${fmt(r.amount, true)}`;
  }
}

const KIND_LABEL = { statement: 'Kart ekstresi', rule: 'Düzenli gelir', payment: 'Planlı ödeme', income: 'Tek seferlik gelir', expense: 'Nakit harcama', adjustment: 'Bakiye düzeltmesi' };

const TOOL_IMPL = {
  async durum_ozeti(a, env) {
    const { state, rev } = await load(env);
    if (!state) throw new UserError('Sunucuda henüz defter yok. Önce telefondaki uygulamada eşitlemeyi bağla.');
    const t = todayTR(), days = Math.min(366, Math.max(1, Number.isInteger(a.gun) ? a.gun : 30));
    const evYear = events(state, shift(t, 366), t), bal = current(state, t, evYear);
    const lines = [`Bugün: ${long(t)}`, `Bugünkü bakiye: ${fmt(bal)}`];
    let b = bal, first;
    for (const e of future(evYear, t)) { const before = b; b += e.amount; if (!first && before >= 0 && b < 0) first = e; }
    if (bal < 0) lines.push(`UYARI: Bakiye şu anda eksi.`);
    else if (first) lines.push(`UYARI: ${long(first.date)} tarihinde ${first.name} nedeniyle bakiye eksiye düşüyor.`);
    const ss = statements(state);
    lines.push('', 'Kartlar:');
    for (const c of state.cards) {
      if (!c.cut || !c.due) { lines.push(`- ${c.name}: günler girilmemiş`); continue; }
      const d = date(t), cut = monthDay(d.getFullYear(), d.getMonth(), c.cut), activeCut = t <= cut ? cut : monthDay(d.getFullYear(), d.getMonth() + 1, c.cut);
      const active = ss.find(s => s.card === c.id && s.cut === activeCut), next = ss.find(s => s.card === c.id && s.date >= t);
      lines.push(`- ${c.name}: dönem içi ${fmt(active?.amount || 0)} (kesim ${long(activeCut)})${next ? `; sıradaki ödeme ${fmt(next.amount)}, son ödeme ${long(next.date)}` : '; bekleyen ekstre yok'}`);
    }
    const pending = state.incomes.filter(i => !i.confirmed);
    if (pending.length) { lines.push('', 'Bekleyen gelirler:'); for (const i of pending) lines.push(`- ${long(i.date)} · ${i.name} · ${fmt(i.amount)}${i.date < t ? ' (vadesi geçti)' : ''} — id: ${i.id}`); }
    const upcoming = future(events(state, shift(t, days), t), t);
    lines.push('', `Önümüzdeki ${days} gün:`);
    let run = bal;
    if (!upcoming.length) lines.push('- Planlanmış hareket yok.');
    for (const e of upcoming) { run += e.amount; lines.push(`- ${long(e.date)} · ${e.name} (${KIND_LABEL[e.kind]}${e.pending ? ', bekleniyor' : ''}) ${fmt(e.amount, true)} → ${fmt(run)}`); }
    lines.push('', `(Defter sürümü ${rev})`);
    return lines.join('\n');
  },

  async harcama_ekle(a, env) {
    const { message } = await mutate(env, 'claude:harcama_ekle', s => {
      const item = { id: uid(), amount: amountArg(a.tutar), date: dateArg(a.tarih, todayTR()), method: methodArg(s, a.odeme), note: textArg(a.not, 'not', false, 160) };
      s.expenses.push(item); s.lastMethod = item.method;
      return `Eklendi: ${describe('harcama', item, s)} (id: ${item.id}). ${cardEffect(s, item)} ${balanceLine(s)}`;
    });
    return message;
  },

  async gelir_ekle(a, env) {
    const { message } = await mutate(env, 'claude:gelir_ekle', s => {
      const d = dateArg(a.tarih, todayTR()), item = { id: uid(), amount: amountArg(a.tutar), date: d, name: textArg(a.ad, 'ad'), confirmed: d <= todayTR() };
      s.incomes.push(item);
      return `Eklendi: ${describe('gelir', item, s)} (id: ${item.id}). ${item.confirmed ? '' : 'Vadesinde uygulamada onay sorulacak. '}${balanceLine(s)}`;
    });
    return message;
  },

  async duzenli_gelir_ekle(a, env) {
    const { message } = await mutate(env, 'claude:duzenli_gelir_ekle', s => {
      const gun = Number(a.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 31) throw new UserError('gun 1–31 arasında olmalı.');
      const item = { id: uid(), name: textArg(a.ad, 'ad'), amount: amountArg(a.tutar), day: gun, start: dateArg(a.baslangic, todayTR()), rates: [] };
      s.rules.push(item);
      return `Eklendi: ${describe('duzenli_gelir', item, s)} (id: ${item.id}). ${balanceLine(s)}`;
    });
    return message;
  },

  async planli_odeme_ekle(a, env) {
    const { message } = await mutate(env, 'claude:planli_odeme_ekle', s => {
      const item = { id: uid(), name: textArg(a.ad, 'ad'), amount: amountArg(a.tutar), date: dateArg(a.tarih, null), repeat: repeatArg(a.tekrar) };
      s.payments.push(item);
      return `Eklendi: ${describe('planli_odeme', item, s)} (id: ${item.id}). ${balanceLine(s)}`;
    });
    return message;
  },

  async kayitlari_listele(a, env) {
    const { state } = await load(env);
    if (!state) throw new UserError('Sunucuda henüz defter yok.');
    const tur = a.tur || 'hepsi', limit = Math.min(200, Math.max(1, Number.isInteger(a.adet) ? a.adet : 20)), q = norm(a.arama);
    if (tur !== 'hepsi' && !KEYS[tur]) throw new UserError('Geçersiz tur.');
    if (a.baslangic) dateArg(a.baslangic, null, 'baslangic');
    if (a.bitis) dateArg(a.bitis, null, 'bitis');
    let rows = [];
    for (const [kind, key] of Object.entries(KEYS)) if (tur === 'hepsi' || tur === kind) for (const r of state[key]) rows.push({ kind, r, d: kind === 'duzenli_gelir' ? r.start : r.date });
    rows = rows.filter(x => (!q || norm(x.r.name).includes(q) || norm(x.r.note).includes(q)) && (!a.baslangic || x.d >= a.baslangic) && (!a.bitis || x.d <= a.bitis));
    rows.sort((x, y) => y.d.localeCompare(x.d));
    const total = rows.length;
    rows = rows.slice(0, limit);
    if (!rows.length) return 'Uygun kayıt bulunamadı.';
    return `${total} kayıttan ${rows.length} tanesi (yeniden eskiye):\n` + rows.map(x => `- [${x.kind}] ${describe(x.kind, x.r, state)} — id: ${x.r.id}`).join('\n');
  },

  async kayit_guncelle(a, env) {
    const { message } = await mutate(env, 'claude:kayit_guncelle', s => {
      const { rec } = findRecord(s, a.tur, a.id), before = describe(a.tur, structuredClone(rec), s);
      const has = k => a[k] !== undefined && a[k] !== null && a[k] !== '';
      const allowed = { harcama: ['tutar', 'tarih', 'not', 'odeme'], gelir: ['tutar', 'tarih', 'ad'], duzenli_gelir: ['ad'], planli_odeme: ['tutar', 'tarih', 'ad', 'tekrar'], duzeltme: ['tutar', 'tarih'] }[a.tur];
      const given = ['tutar', 'tarih', 'ad', 'not', 'odeme', 'tekrar'].filter(k => (k === 'not' ? a.not !== undefined && a.not !== null : has(k)));
      const bad = given.filter(k => !allowed.includes(k));
      if (bad.length) throw new UserError(`${a.tur} için değiştirilemeyen alan: ${bad.join(', ')}.${a.tur === 'duzenli_gelir' && bad.includes('tutar') ? ' Tutar için duzenli_gelir_tutar_degistir kullan.' : ''}`);
      if (!given.length) throw new UserError('Değiştirilecek alan verilmedi.');
      if (has('tutar')) rec.amount = amountArg(a.tutar, 'tutar', a.tur === 'duzeltme');
      if (has('tarih')) { rec.date = dateArg(a.tarih, null); if (a.tur === 'gelir') rec.confirmed = rec.date <= todayTR(); }
      if (has('ad')) rec.name = textArg(a.ad, 'ad');
      if (a.not !== undefined && a.tur === 'harcama') rec.note = textArg(a.not, 'not', false, 160);
      if (has('odeme')) { rec.method = methodArg(s, a.odeme); s.lastMethod = rec.method; }
      if (has('tekrar')) rec.repeat = repeatArg(a.tekrar);
      return `Güncellendi.\nÖnce: ${before}\nSonra: ${describe(a.tur, rec, s)}\n${balanceLine(s)}`;
    });
    return message;
  },

  async kayit_sil(a, env) {
    const { message } = await mutate(env, 'claude:kayit_sil', s => {
      const { key, rec } = findRecord(s, a.tur, a.id), what = describe(a.tur, rec, s);
      s[key] = s[key].filter(r => r.id !== a.id);
      return `Silindi: ${what}. ${balanceLine(s)}`;
    });
    return message;
  },

  async gelir_onayla(a, env) {
    const { message } = await mutate(env, 'claude:gelir_onayla', s => {
      const { rec } = findRecord(s, 'gelir', a.id), t = todayTR();
      if (rec.confirmed) throw new UserError('Bu gelir zaten gelmiş olarak işaretli.');
      rec.date = a.tarih ? dateArg(a.tarih, null) : rec.date > t ? t : rec.date;
      if (rec.date > t) throw new UserError('Gelmiş gelirin tarihi gelecekte olamaz.');
      rec.confirmed = true;
      return `Onaylandı: ${describe('gelir', rec, s)}. ${balanceLine(s)}`;
    });
    return message;
  },

  async duzenli_gelir_tutar_degistir(a, env) {
    const { message } = await mutate(env, 'claude:duzenli_gelir_tutar_degistir', s => {
      const { rec } = findRecord(s, 'duzenli_gelir', a.id), amount = amountArg(a.yeni_tutar, 'yeni_tutar'), eff = dateArg(a.gecerlilik, null, 'gecerlilik');
      if (eff <= todayTR()) throw new UserError('Geçmiş gelirleri korumak için bugünden sonraki bir geçerlilik tarihi seç.');
      if (eff < rec.start) throw new UserError('Geçerlilik tarihi kural başlangıcından önce olamaz.');
      if (amount === ruleAmount(rec, eff)) return `Tutar zaten ${long(eff)} itibarıyla ${fmt(amount)}; değişiklik yapılmadı.`;
      rec.rates = (rec.rates || []).filter(r => r.from !== eff);
      rec.rates.push({ from: eff, amount });
      rec.rates.sort((x, y) => x.from.localeCompare(y.from));
      return `Güncellendi: ${rec.name} ${long(eff)} itibarıyla ${fmt(amount)}. Geçmiş gelirler değişmedi.`;
    });
    return message;
  },

  async bakiye_duzelt(a, env) {
    const { message } = await mutate(env, 'claude:bakiye_duzelt', s => {
      const target = amountArg(a.gercek_bakiye, 'gercek_bakiye', true), t = todayTR(), now = current(s, t), diff = target - now;
      if (diff === 0) return `Bakiye zaten ${fmt(now)}; düzeltme gerekmedi.`;
      s.adjustments.push({ id: uid(), date: t, amount: diff });
      return `Bakiye ${fmt(now)} → ${fmt(target)} olarak düzeltildi (fark ${fmt(diff, true)}).`;
    });
    return message;
  },

  async son_degisikligi_geri_al(a, env) {
    const cur = await load(env);
    if (cur.rev < 2) throw new UserError('Geri alınacak önceki sürüm yok.');
    const prev = await env.DB.prepare('SELECT rev, data FROM versions WHERE rev < ? ORDER BY rev DESC LIMIT 1').bind(cur.rev).first();
    if (!prev) throw new UserError('Önceki sürüm artık saklanmıyor.');
    const state = validate(JSON.parse(prev.data));
    if (!(await insertVersion(env, cur.rev + 1, state, 'claude:geri_al'))) throw new UserError('Defter az önce değişti; tekrar dene.');
    const who = cur.source === 'uygulama' ? 'uygulamadan yapılan' : cur.source.startsWith('claude:') ? `Claude'un yaptığı (${cur.source.slice(7)})` : cur.source;
    return `Geri alındı: ${who} son değişiklik (${new Date(cur.at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}). Defter sürüm ${prev.rev} durumuna döndü. ${balanceLine(state)}`;
  },
};
