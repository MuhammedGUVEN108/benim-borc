// index.html içindeki hesaplama ve doğrulama kodunun sunucu kopyası.
// Uygulamadaki kurallar değişirse burası da aynı şekilde güncellenmelidir (test: test/core-parity.mjs).
// Tüm tutarlar kuruş cinsinden tam sayıdır. Tarihler YYYY-MM-DD ve Türkiye saatine göredir.

export const TZ = 'Europe/Istanbul';
export const todayTR = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export function day(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function date(s) { return new Date(s + 'T12:00:00'); }
export const shift = (s, n) => { const d = date(s); d.setDate(d.getDate() + n); return day(d); };
export function monthDay(y, m, d) { return day(new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()), 12)); }
export function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' && s <= '2100-12-31' && day(date(s)) === s; }

export const fmt = (n, sign = false) => (sign && n > 0 ? '+' : '') + new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(n / 100) + ' TL';
export const long = s => date(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

// Sayı (340.5) veya Türkçe metin ("12.450,50") kabul eder; kuruş döndürür.
export function money(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.abs(v) > 1e10) throw Error('Geçerli bir tutar girin.');
    return Math.round(v * 100);
  }
  let s = String(v ?? '').trim().replace(/\s|TL|₺/gi, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(s)) throw Error('Geçerli bir tutar girin. Örnek: 12450.50');
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > 1e10) throw Error('Geçerli bir tutar girin.');
  return Math.round(n * 100);
}

export function validate(o) {
  if (!o || o.version !== 1 || ![0, 1, 2].includes(o.setup) || !Number.isSafeInteger(o.initial) || Math.abs(o.initial) > 1e12) throw Error('Bu dosya geçerli bir Benim Borç yedeği değil.');
  for (const k of ['cards', 'expenses', 'incomes', 'rules', 'payments', 'adjustments']) if (!Array.isArray(o[k]) || o[k].length > 10000) throw Error('Yedekte eksik veya çok fazla kayıt var.');
  if (o.cards.length !== 3) throw Error('Yedek üç kart tanımı içermeli.');
  const ids = new Set();
  for (const c of o.cards) {
    if (!['is', 'yapi', 'ziraat'].includes(c.id) || ids.has(c.id) || typeof c.name !== 'string' || c.name.length > 80 || !/^#[0-9a-f]{6}$/i.test(c.color)) throw Error('Kart bilgileri geçersiz.');
    ids.add(c.id);
    for (const k of ['cut', 'due']) if (c[k] !== null && (!Number.isInteger(c[k]) || c[k] < 1 || c[k] > 31)) throw Error('Kart günü 1–31 arasında olmalı.');
  }
  for (const k of ['expenses', 'incomes', 'rules', 'payments', 'adjustments']) {
    const seen = new Set();
    for (const r of o[k]) {
      if (typeof r.id !== 'string' || r.id.length > 100 || seen.has(r.id) || !Number.isSafeInteger(r.amount) || Math.abs(r.amount) > 1e12 || (k !== 'adjustments' && r.amount <= 0)) throw Error('İşlem tutarı veya kimliği geçersiz.');
      seen.add(r.id);
      if (!validDate(k === 'rules' ? r.start : r.date)) throw Error('İşlem tarihi geçersiz.');
      if (k === 'expenses' && !['cash', ...ids].includes(r.method)) throw Error('Ödeme yöntemi geçersiz.');
      if (k === 'rules' && (!Number.isInteger(r.day) || r.day < 1 || r.day > 31)) throw Error('Gelir günü geçersiz.');
      if (k === 'payments' && !['once', 'monthly'].includes(r.repeat)) throw Error('Tekrar bilgisi geçersiz.');
      if (k === 'incomes' && typeof r.confirmed !== 'boolean') throw Error('Gelir durumu geçersiz.');
      for (const field of ['name', 'note']) if (r[field] !== undefined && (typeof r[field] !== 'string' || r[field].length > 160)) throw Error('Metin alanı geçersiz.');
    }
  }
  for (const r of o.rules) {
    if (r.rates !== undefined) {
      if (!Array.isArray(r.rates) || r.rates.length > 1000) throw Error('Gelir tutar geçmişi geçersiz.');
      let previous = '';
      for (const rate of r.rates) {
        if (!validDate(rate.from) || rate.from < r.start || rate.from <= previous || !Number.isSafeInteger(rate.amount) || rate.amount <= 0 || rate.amount > 1e12) throw Error('Gelir tutar geçmişi geçersiz.');
        previous = rate.from;
      }
    }
  }
  if (o.setup === 2 && o.cards.some(c => !c.cut || !c.due)) throw Error('Kart günleri eksik.');
  return o;
}

export function statement(exp, card) {
  let d = date(exp.date), cut = monthDay(d.getFullYear(), d.getMonth(), card.cut);
  if (exp.date > cut) cut = monthDay(d.getFullYear(), d.getMonth() + 1, card.cut);
  d = date(cut);
  let due = monthDay(d.getFullYear(), d.getMonth(), card.due);
  if (due <= cut) due = monthDay(d.getFullYear(), d.getMonth() + 1, card.due);
  return { cut, due };
}

export function statements(state) {
  const map = new Map();
  for (const e of state.expenses) {
    if (e.method === 'cash') continue;
    const c = state.cards.find(c => c.id === e.method);
    if (!c?.cut || !c.due) continue;
    const s = statement(e, c), key = c.id + '|' + s.cut;
    if (!map.has(key)) map.set(key, { id: key, card: c.id, cut: s.cut, date: s.due, amount: 0, name: c.name, color: c.color, kind: 'statement' });
    map.get(key).amount += e.amount;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function occurrences(start, end, d) {
  let cur = date(start), last = date(end), result = [];
  for (let y = cur.getFullYear(), m = cur.getMonth(); y < last.getFullYear() || y === last.getFullYear() && m <= last.getMonth();) {
    const s = monthDay(y, m, d);
    if (s >= start && s <= end) result.push(s);
    if (++m === 12) { m = 0; y++; }
  }
  return result;
}

export function ruleAmount(rule, onDate) { let amount = rule.amount; for (const rate of rule.rates || []) if (rate.from <= onDate) amount = rate.amount; return amount; }

export function events(state, end, t) {
  const out = [];
  const add = (r, kind, amount, extra = {}) => out.push({ ...r, kind, amount, ...extra });
  for (const e of state.expenses) if (e.method === 'cash') add(e, 'expense', -e.amount, { name: e.note || 'Nakit harcama' });
  for (const i of state.incomes) add(i, 'income', i.amount, { pending: !i.confirmed, date: !i.confirmed && i.date < t ? t : i.date, originalDate: i.date });
  for (const r of state.rules) for (const d of occurrences(r.start, end, r.day)) add({ ...r, date: d, id: r.id + '|' + d }, 'rule', ruleAmount(r, d));
  for (const p of state.payments) for (const d of p.repeat === 'monthly' ? occurrences(p.date, end, date(p.date).getDate()) : [p.date]) add({ ...p, date: d, id: p.id + '|' + d }, 'payment', -p.amount);
  for (const s of statements(state)) add(s, 'statement', -s.amount);
  for (const a of state.adjustments) add(a, 'adjustment', a.amount, { name: 'Bakiye düzeltmesi' });
  return out.filter(e => e.date <= end).sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'adjustment' ? 1 : 0) - (b.kind === 'adjustment' ? 1 : 0) || a.id.localeCompare(b.id));
}

export function current(state, t, ev = events(state, t, t)) { return state.initial + ev.filter(e => e.date <= t && !e.pending).reduce((s, e) => s + e.amount, 0); }
export const future = (ev, t) => ev.filter(e => e.date > t || e.pending);
