// PROPX · Market Radar — the deterministic "what changed" engine.
//
// Every event here is read from a file the scheduled syncs already commit (history ledgers, append-only
// observation files, run logs, dated snapshots). Nothing is fetched, nothing is inferred: an event exists only
// where a source record changed between two PROPX reads, where a source published a new period, where an
// official figure was revised, or where a source's own check state changed. The rules are listed in RULES and
// each event names its rule, its data class (OFFICIAL · OBSERVED · DERIVED), its source, the date PROPX observed
// it (`at`) and — separately — the source's own date where the source gives one (`sourceDate`).
//
// Not events: the first ingestion of a dataset (a record whose history starts the day PROPX first saw it), a
// PROPX parser upgrade (the rental terms re-parsed from an unchanged notice), a replay. Significance is a
// declared constant per rule (materiality 1–3), never a model.
//
//   build({ dataDir, since, now })   → { schema, builtAt, since, counts, events }   (scripts/radar-build.js)
//   query(payload, params)           → the filtered, windowed page the API serves (lib/radar/query.js)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { tenderNumberOf } = require('../rental/dira');
const { catalog } = require('../trust/catalog');

const ROOT = path.join(__dirname, '..', '..', 'data');
const DAY = 86400e3;
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const readLines = (f) => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } const out = []; for (const l of t.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } } return out; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
/* a data file is either a bare array or an envelope { meta, <records> } */
const arrOf = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? (x.records || x.tenders || x.notices || x.sites || x.complexes || x.plans || x.lotteries || x.rows || Object.values(x).find(Array.isArray) || []) : []);
const bi = (he, en) => ({ he, en });
const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const pct = (x) => (Number.isFinite(x) ? (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—');

/* the rules — one entry per event kind; `m` = materiality (3 = a market fact a committee would note, 1 = housekeeping) */
const RULES = Object.freeze({
  'tender-published': { group: 'land', cls: 'OFFICIAL', m: 2, he: 'מכרז פורסם', en: 'tender published' },
  'tender-open': { group: 'land', cls: 'OFFICIAL', m: 2, he: 'מכרז נפתח להצעות', en: 'tender open for bids' },
  'tender-closed': { group: 'land', cls: 'OFFICIAL', m: 1, he: 'מכרז נסגר — ממתין להחלטה', en: 'tender closed — decision pending' },
  'tender-awarded': { group: 'land', cls: 'OFFICIAL', m: 3, he: 'הוכרזו זוכים', en: 'tender awarded' },
  'tender-no-award': { group: 'land', cls: 'OFFICIAL', m: 3, he: 'מכרז נדון — ללא זוכה', en: 'tender decided — no winner' },
  'tender-cancelled': { group: 'land', cls: 'OFFICIAL', m: 3, he: 'מכרז בוטל', en: 'tender cancelled' },
  'tender-frozen': { group: 'land', cls: 'OFFICIAL', m: 2, he: 'מכרז נדחה / הוקפא', en: 'tender postponed / frozen' },
  'tender-new': { group: 'land', cls: 'OFFICIAL', m: 2, he: 'מכרז חדש ברשימת רמ״י', en: 'new tender in the ILA list' },
  'developer-wins-land': { group: 'developers', cls: 'OFFICIAL', m: 3, he: 'יזם זכה בקרקע', en: 'developer wins land' },
  'developer-market-entry': { group: 'developers', cls: 'DERIVED', m: 3, he: 'יזם נכנס ליישוב', en: 'developer enters a locality' },
  'renewal-declared': { group: 'planning', cls: 'OFFICIAL', m: 3, he: 'מתחם התחדשות הוכרז', en: 'renewal complex declared' },
  'renewal-stage': { group: 'planning', cls: 'OFFICIAL', m: 2, he: 'מתחם התחדשות — שינוי שלב', en: 'renewal complex — stage changed' },
  'renewal-new': { group: 'planning', cls: 'OFFICIAL', m: 2, he: 'מתחם התחדשות חדש', en: 'new renewal complex' },
  'plan-status': { group: 'planning', cls: 'OFFICIAL', m: 3, he: 'תכנית — שינוי סטטוס תכנוני', en: 'plan — planning status changed' },
  'rental-notice-new': { group: 'rental', cls: 'OFFICIAL', m: 2, he: 'הודעת מכרז דיור להשכרה חדשה', en: 'new rental-track tender notice' },
  'rental-notice-updated': { group: 'rental', cls: 'OFFICIAL', m: 1, he: 'הודעת מכרז דיור להשכרה עודכנה', en: 'rental-track notice updated' },
  'rental-planning-updated': { group: 'rental', cls: 'OFFICIAL', m: 1, he: 'אתר דיור להשכרה בתכנון עודכן', en: 'rental planning site updated' },
  'cbs-month-published': { group: 'sales', cls: 'OFFICIAL', m: 3, he: 'הלמ״ס פרסמה חודש מכירות חדש', en: 'CBS published a new sales month' },
  'cbs-revised': { group: 'sales', cls: 'OFFICIAL', m: 2, he: 'נתון רשמי תוקן', en: 'official figure revised' },
  'boi-rate-changed': { group: 'macro', cls: 'OFFICIAL', m: 3, he: 'ריבית בנק ישראל השתנתה', en: 'Bank of Israel rate changed' },
  'index-published': { group: 'macro', cls: 'OFFICIAL', m: 2, he: 'מדד רשמי — תקופה חדשה', en: 'official index — new period' },
  'lottery-new': { group: 'housing', cls: 'OFFICIAL', m: 2, he: 'הגרלת דיור חדשה', en: 'new housing lottery' },
  'lottery-due': { group: 'housing', cls: 'OFFICIAL', m: 1, he: 'הגרלה קרובה', en: 'lottery due' },
  'source-state': { group: 'sources', cls: 'DERIVED', m: 2, he: 'מקור — שינוי מצב', en: 'source — state changed' },
  'source-stale': { group: 'sources', cls: 'DERIVED', m: 2, he: 'מקור לא עדכני', en: 'source stale' },
});
const GROUPS = Object.freeze(['sales', 'land', 'developers', 'planning', 'rental', 'housing', 'macro', 'sources']);
const LIFE = { published: bi('פורסם', 'published'), open: bi('פתוח להצעות', 'open for bids'), closed: bi('נסגר — ממתין להחלטה', 'closed — decision pending'), 'lottery-pending': bi('ממתין להגרלה', 'awaiting lottery'),
  decided: bi('נדון בוועדה', 'decided in committee'), awarded: bi('הוכרזו זוכים', 'awarded'), 'decided-no-award': bi('נדון — ללא זוכה', 'decided — no winner'), frozen: bi('נדחה / מוקפא', 'postponed / frozen'), cancelled: bi('בוטל', 'cancelled') };
const TRACK = { 'open-market': bi('שוק חופשי', 'open market'), subsidized: bi('דיור מסובסד', 'subsidized'), rental: bi('דיור להשכרה', 'rental'), 'residential-lottery': bi('הגרלה', 'lottery'), 'special-population': bi('אוכלוסייה ייעודית', 'special population'), 'mixed-use': bi('עירוב שימושים', 'mixed use'), 'commercial-other': bi('מסחר / אחר', 'commercial / other') };
const STAGE_HE = { 'land-awarded': 'קרקע נזכתה', marketed: 'שווק', permitted: 'היתר', 'construction-started': 'בנייה החלה', completed: 'הושלם', occupied: 'אוכלס', declared: 'הוכרז', planning: 'בתכנון', approved: 'מאושר', deposited: 'הופקד', 'in-force': 'בתוקף' };

/* a day on which a dataset gained more than 2% of its records (at least 50) is an ingestion day of PROPX, not a market day:
   a record first seen on such a day is not "new" */
function bulkDays(records, key = 'firstSeenAt') {
  const byDay = new Map(); for (const r of records) { const d = day(r && r[key]); if (d) byDay.set(d, (byDay.get(d) || 0) + 1); }
  const lim = Math.max(50, records.length * 0.02); const out = new Set();
  for (const [d, n] of byDay) if (n > lim) out.add(d);
  return out;
}
/* the list-level "decided" state becomes "awarded" / "no award" when PROPX first reads a tender's detail — that is a read, not a change */
const REAL_FROM = new Set(['published', 'open', 'closed', 'lottery-pending', 'frozen', 'awarded', 'decided-no-award', 'cancelled']);

function localities(dataDir) {
  const g = readJson(path.join(dataDir, 'geo', 'localities.json'));
  const arr = g && Array.isArray(g.localities) ? g.localities : [];
  const by = new Map(); for (const l of arr) by.set(String(l.code), l);
  return (code) => { const l = code != null ? by.get(String(code)) : null; return l ? { localityCode: String(l.code), city: l.he, cityEn: l.en, district: l.district } : { localityCode: code != null ? String(code) : null, city: null, cityEn: null, district: null }; };
}

/* ------------------------------------------------------------------ build */
function build({ dataDir = ROOT, since, now = Date.now(), days = 120 } = {}) {
  const sinceT = since ? Date.parse(since) : now - days * DAY;
  const inWin = (iso) => iso && Date.parse(iso) >= sinceT && Date.parse(iso) <= now + DAY;
  const geoOf = localities(dataDir);
  const E = [];
  const push = (kind, e) => { const r = RULES[kind]; E.push({ id: `${kind}:${e.key}`, kind, group: r.group, cls: r.cls, m: e.m || r.m, at: e.at, sourceDate: e.sourceDate || null, source: e.source, geo: e.geo || geoOf(null), entity: e.entity || null, title: e.title, detail: e.detail || bi('', ''), values: e.values || null }); };

  /* ---- land: lifecycle transitions, winners, new tenders */
  const tenders = arrOf(readJson(path.join(dataDir, 'land', 'tenders.json'), []));
  const tById = new Map(tenders.map((t) => [t.id, t]));
  const tenderName = (t) => (t ? t.name || t.michrazId : null);
  const tGeo = (t) => geoOf(t && t.localityCode);
  const landHist = readLines(path.join(dataDir, 'land', 'history.jsonl')).filter((h) => inWin(h.observedAt));
  const lifeSeen = new Set(), winnersSeen = new Set();
  const landSrc = 'rmi:michrazim';
  for (const h of landHist) {
    const t = tById.get(h.id); if (!t) continue;
    const firstDay = day(t.firstSeenAt);
    const initial = h.from == null || day(h.observedAt) === firstDay;   // the first ingestion / first detail read of a record is not a change
    if (h.field === 'lifecycle' && !initial && REAL_FROM.has(h.from) && h.from !== h.to) {
      const to = h.to, from = h.from;
      const kind = to === 'published' ? 'tender-published' : to === 'open' ? 'tender-open' : to === 'closed' || to === 'lottery-pending' ? 'tender-closed' : to === 'awarded' ? 'tender-awarded' : to === 'decided-no-award' ? 'tender-no-award' : to === 'cancelled' ? 'tender-cancelled' : to === 'frozen' ? 'tender-frozen' : null;
      if (!kind) continue;
      lifeSeen.add(h.id);
      const tr = TRACK[t.track] || bi(t.track || '—', t.track || '—');
      push(kind, { key: `${h.id}:${day(h.observedAt)}`, at: h.observedAt, sourceDate: t.sourceUpdatedAt || null, source: landSrc, geo: tGeo(t), entity: { type: 'tender', id: h.id, name: tenderName(t) },
        title: bi(`מכרז ${tenderName(t)} — ${LIFE[to] ? LIFE[to].he : to}`, `tender ${tenderName(t)} — ${LIFE[to] ? LIFE[to].en : to}`),
        detail: bi(`${tr.he}${t.units ? ` · ${fmtInt(t.units)} יח״ד` : ''}${from ? ` · קודם: ${LIFE[from] ? LIFE[from].he : from}` : ''}`, `${tr.en}${t.units ? ` · ${fmtInt(t.units)} units` : ''}${from ? ` · before: ${LIFE[from] ? LIFE[from].en : from}` : ''}`),
        values: { from, to }, m: to === 'awarded' && t.units >= 100 ? 3 : undefined });
    }
    if (h.field === 'winners' && Array.isArray(h.to) && h.to.length) {
      const before = new Set((Array.isArray(h.from) ? h.from : []).map((w) => `${w.lotId}|${w.name}`));
      const byName = new Map();
      for (const w of h.to) { if (!w || !w.name || before.has(`${w.lotId}|${w.name}`)) continue; const e = byName.get(w.name) || { name: w.name, lots: 0, amount: 0 }; e.lots++; e.amount += Number(w.amount) || 0; byName.set(w.name, e); }
      const realChange = Array.isArray(h.from) && h.from.length > 0;   // a winner added to an existing set
      if (!realChange && !lifeSeen.has(h.id)) continue;                 // otherwise only beside a real award transition
      for (const w of byName.values()) {
        const key = `${h.id}:${w.name}`; if (winnersSeen.has(key)) continue; winnersSeen.add(key);
        push('developer-wins-land', { key: `${key}:${day(h.observedAt)}`, at: h.observedAt, sourceDate: t.sourceUpdatedAt || null, source: landSrc, geo: tGeo(t), entity: { type: 'developer', id: null, name: w.name, tenderId: h.id, tender: tenderName(t) },
          title: bi(`${w.name} זכה ב-${w.lots} ${w.lots === 1 ? 'מגרש' : 'מגרשים'} — מכרז ${tenderName(t)}`, `${w.name} won ${w.lots} lot${w.lots === 1 ? '' : 's'} — tender ${tenderName(t)}`),
          detail: bi(`${w.amount ? `סך הצעות זוכות ${fmtInt(w.amount)} ₪ · ` : ''}${TRACK[t.track] ? TRACK[t.track].he : ''}${t.units ? ` · ${fmtInt(t.units)} יח״ד במכרז` : ''} · שם כפי שפורסם — ללא מיזוג`, `${w.amount ? `winning bids ${fmtInt(w.amount)} ₪ · ` : ''}${TRACK[t.track] ? TRACK[t.track].en : ''}${t.units ? ` · ${fmtInt(t.units)} units in the tender` : ''} · name as published — never merged`),
          values: { lots: w.lots, amount: w.amount || null } });
      }
    }
  }
  const landBulk = bulkDays(tenders);
  for (const t of tenders) {
    if (!inWin(t.firstSeenAt) || lifeSeen.has(t.id) || landBulk.has(day(t.firstSeenAt))) continue;
    const tr = TRACK[t.track] || bi(t.track || '—', t.track || '—');
    push('tender-new', { key: t.id, at: t.firstSeenAt, sourceDate: t.publishedDate || null, source: landSrc, geo: tGeo(t), entity: { type: 'tender', id: t.id, name: tenderName(t) },
      title: bi(`מכרז ${tenderName(t)} — ${LIFE[t.lifecycle] ? LIFE[t.lifecycle].he : t.lifecycle || 'ברשימה'}`, `tender ${tenderName(t)} — ${LIFE[t.lifecycle] ? LIFE[t.lifecycle].en : t.lifecycle || 'listed'}`),
      detail: bi(`${tr.he}${t.units ? ` · ${fmtInt(t.units)} יח״ד` : ''}${t.publishedDate ? ` · פורסם ${day(t.publishedDate)}` : ''}`, `${tr.en}${t.units ? ` · ${fmtInt(t.units)} units` : ''}${t.publishedDate ? ` · published ${day(t.publishedDate)}` : ''}`), values: { lifecycle: t.lifecycle } });
  }

  /* ---- developers: market entries (DERIVED by lib/entities — read through its registry, never recomputed here) */
  try {
    const Qe = require('../entities/query');
    const sig = Qe.signals({ limit: 300 }, { dataDir });
    for (const x of sig.rows || []) {
      if (!inWin(x.date)) continue;
      push('developer-market-entry', { key: `${x.developerId || x.developer}:${x.localityCode}:${day(x.date)}`, at: x.date, sourceDate: x.date, source: x.via === 'ila-win' ? landSrc : 'datagov:moch:dira-behanacha-lotteries', geo: geoOf(x.localityCode),
        entity: { type: 'developer', id: x.developerId || null, name: x.developer }, title: bi(`${x.developer} — פעילות ראשונה שנצפתה ב${x.city}`, `${x.developer} — first observed activity in ${x.cityEn || x.city}`),
        detail: bi(`${x.via === 'ila-win' ? 'זכייה במכרז רמ״י' : 'הגרלת משב״ש'} · פעל קודם במקום אחר${x.earlierActivityFrom ? ` מאז ${day(x.earlierActivityFrom)}` : ''} · נגזר מרישום הפעילות של PROPX`, `${x.via === 'ila-win' ? 'an ILA tender win' : 'a MoCH lottery'} · earlier activity elsewhere${x.earlierActivityFrom ? ` since ${day(x.earlierActivityFrom)}` : ''} · derived from the PROPX activity registry`) });
    }
  } catch (e) { /* the registry is optional here */ }

  /* ---- urban renewal: declarations and stage changes (MoCH), plan status (XPlan) */
  const complexes = arrOf(readJson(path.join(dataDir, 'renewal', 'complexes.json'), []));
  const cById = new Map(complexes.map((c) => [c.id, c]));
  const rnSrc = 'datagov:moch:urban-renewal';
  for (const h of readLines(path.join(dataDir, 'renewal', 'history.jsonl'))) {
    if (!inWin(h.observedAt)) continue;
    const c = cById.get(h.id); if (!c) continue;
    if (h.from == null && day(h.observedAt) === day(c.firstSeenAt)) continue;
    if (h.field === 'declaration' && h.to === 'declared') push('renewal-declared', { key: `${h.id}:${day(h.observedAt)}`, at: h.observedAt, sourceDate: c.declarationDate || null, source: rnSrc, geo: geoOf(c.localityCode), entity: { type: 'renewal', id: c.id, name: c.name },
      title: bi(`${c.name} (${c.city}) — הוכרז מתחם התחדשות`, `${c.name} (${c.city}) — declared a renewal complex`), detail: bi(`${c.proposedUnits ? `${fmtInt(c.proposedUnits)} יח״ד מוצעות` : ''}${c.planNumber ? ` · תכנית ${c.planNumber}` : ''}`, `${c.proposedUnits ? `${fmtInt(c.proposedUnits)} proposed units` : ''}${c.planNumber ? ` · plan ${c.planNumber}` : ''}`), values: { from: h.from, to: h.to } });
    else if (h.field === 'stage' || h.field === 'statusHe') push('renewal-stage', { key: `${h.id}:${h.field}:${day(h.observedAt)}`, at: h.observedAt, source: rnSrc, geo: geoOf(c.localityCode), entity: { type: 'renewal', id: c.id, name: c.name },
      title: bi(`${c.name} (${c.city}) — ${h.field === 'stage' ? (STAGE_HE[h.to] || h.to) : h.to}`, `${c.name} (${c.city}) — ${h.to}`), detail: bi(`קודם: ${h.from == null ? '—' : h.field === 'stage' ? (STAGE_HE[h.from] || h.from) : h.from} · סטטוס משרד הבינוי כפי שפורסם`, `before: ${h.from == null ? '—' : h.from} · the Ministry's status as published`), values: { from: h.from, to: h.to } });
  }
  const rnBulk = bulkDays(complexes);
  for (const c of complexes) if (inWin(c.firstSeenAt) && !rnBulk.has(day(c.firstSeenAt))) {
    const histDays = new Set();
    push('renewal-new', { key: c.id, at: c.firstSeenAt, sourceDate: c.declarationDate || null, source: rnSrc, geo: geoOf(c.localityCode), entity: { type: 'renewal', id: c.id, name: c.name },
      title: bi(`${c.name} (${c.city}) — מתחם חדש ברשימת משרד הבינוי`, `${c.name} (${c.city}) — new complex in the Ministry's list`), detail: bi(`${c.declaration === 'declared' ? 'מוכרז' : 'טרם הוכרז'}${c.proposedUnits ? ` · ${fmtInt(c.proposedUnits)} יח״ד מוצעות` : ''}`, `${c.declaration === 'declared' ? 'declared' : 'not yet declared'}${c.proposedUnits ? ` · ${fmtInt(c.proposedUnits)} proposed units` : ''}`) });
    void histDays;
  }
  const plans = arrOf(readJson(path.join(dataDir, 'renewal', 'planning.json'), []));
  const pById = new Map(plans.map((p) => [p.id, p]));
  const planCity = new Map(); for (const c of complexes) if (c.planKey) { const arr = planCity.get(c.planKey) || []; arr.push(c); planCity.set(c.planKey, arr); }
  for (const h of readLines(path.join(dataDir, 'renewal', 'planning-history.jsonl'))) {
    if (!inWin(h.observedAt) || !['stage', 'station', 'event'].includes(h.field)) continue;
    const p = pById.get(h.id); if (!p) continue;
    if (h.from == null && day(h.observedAt) === day(p.firstSeenAt)) continue;
    const cs = planCity.get(p.planKey) || [], c0 = cs[0];
    push('plan-status', { key: `${h.id}:${h.field}:${day(h.observedAt)}`, at: h.observedAt, sourceDate: p.lastUpdate || null, source: 'iplan:xplan:online-plans', geo: geoOf(c0 ? c0.localityCode : null), entity: { type: 'plan', id: p.id, name: p.planNumber, complexes: cs.map((x) => x.id) },
      title: bi(`תכנית ${p.planNumber}${p.name ? ` — ${p.name}` : ''}: ${h.field === 'stage' ? (STAGE_HE[h.to] || h.to) : h.to}`, `plan ${p.planNumber}${p.name ? ` — ${p.name}` : ''}: ${h.to}`),
      detail: bi(`${h.field === 'stage' ? 'שלב' : h.field === 'station' ? 'תחנה' : 'אירוע'} לפי מינהל התכנון · קודם: ${h.from == null ? '—' : h.field === 'stage' ? (STAGE_HE[h.from] || h.from) : h.from}${cs.length ? ` · ${cs.length} מתחמי התחדשות על התכנית` : ''}`, `${h.field} per the Planning Administration · before: ${h.from == null ? '—' : h.from}${cs.length ? ` · ${cs.length} renewal complexes on the plan` : ''}`), values: { field: h.field, from: h.from, to: h.to } });
  }

  /* ---- rental: new notices, status / modified changes (Dira Lehaskir) — terms re-parsed by PROPX are not source changes */
  const diraSrc = 'dira-lehaskir:wp';
  const notices = arrOf(readJson(path.join(dataDir, 'rental', 'dira-tenders.json'), []));
  const nById = new Map(notices.map((n) => [n.id, n]));
  const nGeo = (n) => { const tn = n.tender && typeof n.tender === 'object' ? n.tender : tenderNumberOf(n.title || ''); const t = tn && tn.michrazId ? tById.get(`rmi:${tn.michrazId}`) : null; return { geo: t ? tGeo(t) : geoOf(null), t, tn }; };
  const diraBulk = bulkDays(notices);
  for (const n of notices) {
    if (n.kind && n.kind !== 'developer-tender') continue;
    if (!inWin(n.firstSeenAt) || diraBulk.has(day(n.firstSeenAt))) continue;
    const { geo, t, tn } = nGeo(n);
    const T = n.terms || {};
    push('rental-notice-new', { key: n.id, at: n.firstSeenAt, sourceDate: n.published || null, source: diraSrc, geo, entity: { type: 'rental-notice', id: n.id, name: n.title, tenderId: t ? t.id : null, michrazId: tn ? tn.michrazId : null, link: n.link },
      title: bi(`דירה להשכיר: ${n.title}`, `Dira Lehaskir: ${n.title}`), detail: bi(`${T.rentalUnits ? `${fmtInt(T.rentalUnits)} יח״ד להשכרה ארוכת טווח` : 'יח״ד להשכרה לא צוינו'}${T.totalUnits ? ` מתוך ${fmtInt(T.totalUnits)}` : ''}${T.rentalYears ? ` · ${T.rentalYears} שנים` : ''}${t ? ` · מכרז רמ״י ${t.name}` : ' · מכרז רמ״י לא נמצא ברשימה'}`, `${T.rentalUnits ? `${fmtInt(T.rentalUnits)} long-term rental units` : 'rental units not stated'}${T.totalUnits ? ` of ${fmtInt(T.totalUnits)}` : ''}${T.rentalYears ? ` · ${T.rentalYears} years` : ''}${t ? ` · ILA tender ${t.name}` : ' · ILA tender not in the list'}`) });
  }
  for (const h of readLines(path.join(dataDir, 'rental', 'history.jsonl'))) {
    if (!inWin(h.observedAt) || h.field === 'terms') continue;
    if (String(h.id).startsWith('dira:michraz:')) {
      const n = nById.get(h.id); if (!n || (h.from == null && day(h.observedAt) === day(n.firstSeenAt))) continue;
      const { geo, t } = nGeo(n);
      push('rental-notice-updated', { key: `${h.id}:${h.field}:${day(h.observedAt)}`, at: h.observedAt, sourceDate: h.field === 'modified' ? h.to : n.modified || null, source: diraSrc, geo, entity: { type: 'rental-notice', id: n.id, name: n.title, tenderId: t ? t.id : null, link: n.link },
        title: bi(`דירה להשכיר: ${n.title} — ${h.field === 'status' ? `סטטוס ${typeof h.to === 'object' && h.to ? h.to.name : h.to}` : 'ההודעה עודכנה'}`, `Dira Lehaskir: ${n.title} — ${h.field === 'status' ? `status ${typeof h.to === 'object' && h.to ? h.to.slug : h.to}` : 'notice updated'}`), detail: bi(`שדה: ${h.field}`, `field: ${h.field}`), values: { field: h.field, from: h.from, to: h.to } });
    } else if (String(h.id).startsWith('dira:planning:') && h.field === 'modified') {
      const sites = arrOf(readJson(path.join(dataDir, 'rental', 'dira-planning.json'), [])); const s = sites.find((x) => x.id === h.id);
      if (!s || (h.from == null && day(h.observedAt) === day(s.firstSeenAt))) continue;
      push('rental-planning-updated', { key: `${h.id}:${day(h.observedAt)}`, at: h.observedAt, sourceDate: h.to, source: diraSrc, geo: geoOf(null), entity: { type: 'rental-planning', id: s.id, name: s.title, link: s.link },
        title: bi(`דירה להשכיר — אתר בתכנון עודכן: ${s.title}`, `Dira Lehaskir — planning site updated: ${s.title}`), detail: bi(`סטטוס החברה: ${s.status && s.status.name ? s.status.name : '—'} · ללא מספר תכנית — לא מצורף ל-XPlan`, `company status: ${s.status && s.status.name ? s.status.name : '—'} · no plan number — not joined to XPlan`) });
    }
  }

  /* ---- CBS sales: a new month published; revisions of published months (old value kept beside the new) */
  const obs = readLines(path.join(dataDir, 'cbs-sales', 'observations.jsonl'));
  const GEO = { 5069: bi('ארצי', 'national'), 5070: bi('מחוז ירושלים', 'Jerusalem district'), 5071: bi('מחוז הצפון', 'Northern district'), 5072: bi('מחוז חיפה', 'Haifa district'), 5073: bi('מחוז המרכז', 'Central district'), 5074: bi('מחוז תל אביב', 'Tel Aviv district'), 5075: bi('מחוז הדרום', 'Southern district'), 5076: bi('יהודה ושומרון', 'Judea & Samaria') };
  const cbsSrc = 'cbs:timeseries:44,10';
  const byKey = new Map(); for (const o of obs) { const a = byKey.get(o.key) || []; a.push(o); byKey.set(o.key, a); }
  const firstSeenPeriod = new Map();   // measure|cbs → period → first fetchedAt
  for (const [key, arr] of byKey) { arr.sort((a, b) => (a.revision || 0) - (b.revision || 0)); const o = arr[0]; const sk = `${o.measure}|${o.cbs}|${o.freq}`; const m = firstSeenPeriod.get(sk) || new Map(); m.set(o.period, o.fetchedAt); firstSeenPeriod.set(sk, m); }
  const natNew = firstSeenPeriod.get('new_sold|5069|M') || new Map();
  const allNatPeriods = [...natNew.keys()].sort();
  const firstRun = [...natNew.values()].sort()[0];
  for (const [period, at] of natNew) {
    if (!inWin(at) || at === firstRun) continue;   // the first ingestion brought the whole history
    const v = (byKey.get(`new_sold|5069|M|${period}`) || [])[0];
    const dists = Object.entries(GEO).filter(([c]) => c !== '5069').map(([c, nm]) => { const r = (byKey.get(`new_sold|${c}|M|${period}`) || [])[0]; return r ? `${nm.he} ${fmtInt(r.value)}` : null; }).filter(Boolean);
    push('cbs-month-published', { key: period, at, sourceDate: v ? v.sourceUpdate : null, source: cbsSrc, geo: geoOf(null), entity: { type: 'cbs-series', id: 'new_sold|5069', name: `new dwellings sold · ${period}` },
      title: bi(`הלמ״ס: מכירות דירות חדשות ${period} — ${v ? fmtInt(v.value) : '—'} ארצי`, `CBS: new dwellings sold ${period} — ${v ? fmtInt(v.value) : '—'} national`), detail: bi(`${dists.join(' · ')} · סדרה 44,10 · ${v && v.sourceUpdate ? `עדכון המקור ${v.sourceUpdate}` : ''}`, `${dists.join(' · ')} · series 44,10 · ${v && v.sourceUpdate ? `source update ${v.sourceUpdate}` : ''}`), values: { period, value: v ? v.value : null } });
  }
  void allNatPeriods;
  const revByRun = new Map();
  for (const [key, arr] of byKey) {
    arr.sort((a, b) => (a.revision || 0) - (b.revision || 0));
    for (let i = 1; i < arr.length; i++) {
      const o = arr[i], p = arr[i - 1]; if (!inWin(o.fetchedAt) || o.measure !== 'new_sold') continue;
      const rk = `${o.cbs}|${day(o.fetchedAt)}`; const e = revByRun.get(rk) || { cbs: o.cbs, at: o.fetchedAt, sourceDate: o.sourceUpdate, rows: [] }; e.rows.push({ period: o.period, from: p.value, to: o.value }); revByRun.set(rk, e);
    }
  }
  for (const [rk, e] of revByRun) {
    const nm = GEO[e.cbs] || bi(String(e.cbs), String(e.cbs));
    const big = e.rows.map((r) => ({ ...r, chg: r.from ? (r.to - r.from) / r.from : null })).sort((a, b) => Math.abs(b.chg || 0) - Math.abs(a.chg || 0));
    const maxAbs = Math.max(...big.map((r) => Math.abs(r.chg || 0)));
    push('cbs-revised', { key: rk, at: e.at, sourceDate: e.sourceDate || null, source: cbsSrc, geo: geoOf(null), entity: { type: 'cbs-series', id: `new_sold|${e.cbs}`, name: nm.en }, m: maxAbs >= 0.05 ? 3 : maxAbs >= 0.02 ? 2 : 1,
      title: bi(`הלמ״ס תיקנה ${e.rows.length} ${e.rows.length === 1 ? 'חודש' : 'חודשים'} של מכירות — ${nm.he}`, `CBS revised ${e.rows.length} month${e.rows.length === 1 ? '' : 's'} of sales — ${nm.en}`),
      detail: bi(big.slice(0, 4).map((r) => `${r.period}${r.period.length === 4 ? ' (שנתי)' : ''}: ${fmtInt(r.from)} → ${fmtInt(r.to)} (${pct(r.chg)})`).join(' · ') + (e.rows.length > 4 ? ` · ועוד ${e.rows.length - 4}` : '') + ' · הערך הישן נשמר ביומן התצפיות', big.slice(0, 4).map((r) => `${r.period}${r.period.length === 4 ? ' (annual)' : ''}: ${fmtInt(r.from)} → ${fmtInt(r.to)} (${pct(r.chg)})`).join(' · ') + (e.rows.length > 4 ? ` · and ${e.rows.length - 4} more` : '') + ' · the old value is kept in the observation ledger'), values: { rows: e.rows } });
  }

  /* ---- macro: the Bank of Israel rate and the CBS indices, from consecutive dated snapshots */
  const snapDir = path.join(dataDir, 'market', 'snapshots', 'indicators');
  let snaps = []; try { snaps = fs.readdirSync(snapDir).filter((f) => f.endsWith('.json') && f !== 'latest.json').sort().map((f) => readJson(path.join(snapDir, f))).filter((s) => s && s.payload); } catch { /* none */ }
  const IDX = { newHomesIndex: bi('מדד מחירי דירות חדשות', 'new-homes price index'), dwellingsIndex: bi('מדד מחירי הדירות', 'dwellings price index'), cpi: bi('מדד המחירים לצרכן', 'CPI'), constructionInputsIndex: bi('מדד תשומות הבנייה', 'construction-inputs index'), rentIndex: bi('מדד שכר הדירה (רף שוק כללי)', 'rent index (general market benchmark)') };
  const per = (p) => (p && p.period ? `${p.period.year}-${String(p.period.month).padStart(2, '0')}` : null);
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1].payload, b = snaps[i].payload, at = snaps[i].at; if (!inWin(at)) continue;
    if (a.boiRate && b.boiRate && Number.isFinite(b.boiRate.value) && a.boiRate.value !== b.boiRate.value) push('boi-rate-changed', { key: day(at), at, sourceDate: b.boiRate.publishedAt || null, source: 'boi:interest', geo: geoOf(null), entity: { type: 'indicator', id: 'boiRate', name: 'Bank of Israel rate' }, title: bi(`ריבית בנק ישראל: ${a.boiRate.value}% → ${b.boiRate.value}%`, `Bank of Israel rate: ${a.boiRate.value}% → ${b.boiRate.value}%`), detail: bi(`בתוקף מ-${b.boiRate.publishedAt || '—'}`, `effective ${b.boiRate.publishedAt || '—'}`), values: { from: a.boiRate.value, to: b.boiRate.value } });
    for (const [k, nm] of Object.entries(IDX)) { const pa = per(a[k]), pb = per(b[k]); if (pb && pa !== pb && b[k] && Number.isFinite(b[k].yoy)) push('index-published', { key: `${k}:${pb}`, at, sourceDate: pb, source: 'cbs:price-index', geo: geoOf(null), entity: { type: 'indicator', id: k, name: nm.en }, title: bi(`${nm.he} ${pb}: ${pct(b[k].yoy / 100)} שנתי`, `${nm.en} ${pb}: ${pct(b[k].yoy / 100)} y/y`), detail: bi(`${Number.isFinite(b[k].mom) ? `חודשי ${pct(b[k].mom / 100)} · ` : ''}למ״ס${k === 'rentIndex' ? ' · רף שוק כללי — לא שכר דירה של פרויקט' : ''}`, `${Number.isFinite(b[k].mom) ? `m/m ${pct(b[k].mom / 100)} · ` : ''}CBS${k === 'rentIndex' ? ' · general market benchmark — not a project rent' : ''}`), values: { period: pb, yoy: b[k].yoy, mom: b[k].mom ?? null } }); }
  }

  /* ---- housing lotteries: new records; lotteries due in the next two weeks */
  const lots = arrOf(readJson(path.join(dataDir, 'housing', 'lotteries.json'), []));
  const hoSrc = 'datagov:moch:dira-behanacha-lotteries';
  const hoBulk = bulkDays(lots);
  for (const l of lots) {
    if (inWin(l.firstSeenAt) && !hoBulk.has(day(l.firstSeenAt))) push('lottery-new', { key: l.id, at: l.firstSeenAt, sourceDate: l.lotteryDate || l.signupEndDate || null, source: hoSrc, geo: geoOf(l.localityCode), entity: { type: 'lottery', id: l.id, name: l.projectName, developer: l.developer || null },
      title: bi(`הגרלה חדשה: ${l.projectName || l.lotteryId} (${l.city})`, `new lottery: ${l.projectName || l.lotteryId} (${l.city})`), detail: bi(`${l.programHe || l.program || ''}${l.unitsInLottery ? ` · ${fmtInt(l.unitsInLottery)} דירות` : ''}${l.developer ? ` · ${l.developer}` : ''}${l.lotteryDate ? ` · הגרלה ${day(l.lotteryDate)}` : ''}`, `${l.program || ''}${l.unitsInLottery ? ` · ${fmtInt(l.unitsInLottery)} units` : ''}${l.developer ? ` · ${l.developer}` : ''}${l.lotteryDate ? ` · lottery ${day(l.lotteryDate)}` : ''}`) });
    const ld = l.lotteryDate ? Date.parse(l.lotteryDate) : NaN;
    if (Number.isFinite(ld) && ld >= now - DAY && ld <= now + 14 * DAY) push('lottery-due', { key: l.id, at: new Date(now).toISOString(), sourceDate: day(l.lotteryDate), source: hoSrc, geo: geoOf(l.localityCode), entity: { type: 'lottery', id: l.id, name: l.projectName }, title: bi(`הגרלה ב-${day(l.lotteryDate)}: ${l.projectName || l.lotteryId} (${l.city})`, `lottery on ${day(l.lotteryDate)}: ${l.projectName || l.lotteryId} (${l.city})`), detail: bi(`${l.unitsInLottery ? `${fmtInt(l.unitsInLottery)} דירות · ` : ''}${l.programHe || ''}`, `${l.unitsInLottery ? `${fmtInt(l.unitsInLottery)} units · ` : ''}${l.program || ''}`) });
  }

  /* ---- sources: a check state that changed between the last two real checks; a source that is stale now */
  try {
    const cat = catalog({ dataDir, now });
    for (const s of cat.sources || []) {
      const runs = s.sync || {}; const rec = runs.recent || []; const nmHe = typeof s.name === 'string' ? s.name : (s.name && s.name.he) || s.id, nmEn = s.publisherEn ? `${s.publisherEn} · ${s.id}` : s.id;
      if (rec.length >= 2) { const a = rec[rec.length - 2], b = rec[rec.length - 1]; if (a.state !== b.state && b.at && inWin(b.at)) { const alert = ['REFUSED', 'FAILED', 'SCHEMA_CHANGED', 'PARTIAL'].includes(b.state), recovered = ['REFUSED', 'FAILED', 'SCHEMA_CHANGED'].includes(a.state) && ['SUCCESS', 'UNCHANGED'].includes(b.state);
        push('source-state', { key: `${s.id}:${day(b.at)}`, at: b.at, source: s.id, geo: geoOf(null), entity: { type: 'source', id: s.id, name: nmEn }, m: alert || recovered ? 3 : 1,
          title: bi(`${nmHe}: ${a.state} → ${b.state}${recovered ? ' (התאושש)' : ''}`, `${nmEn}: ${a.state} → ${b.state}${recovered ? ' (RECOVERED)' : ''}`), detail: bi(runs.lastError ? `שגיאה אחרונה: ${runs.lastError}` : 'מצב הבדיקה האחרון של PROPX מול המקור', runs.lastError ? `last error: ${runs.lastError}` : 'the state of PROPX\'s latest check of the source'), values: { from: a.state, to: b.state } }); } }
      if (runs.state === 'STALE' && runs.lastGoodAt) push('source-stale', { key: `${s.id}:${day(runs.lastGoodAt)}`, at: new Date(now).toISOString(), sourceDate: day(runs.lastGoodAt), source: s.id, geo: geoOf(null), entity: { type: 'source', id: s.id, name: nmEn },
        title: bi(`${nmHe} — לא עדכני`, `${nmEn} — STALE`), detail: bi(`בדיקה תקינה אחרונה ${day(runs.lastGoodAt)} · הנתון האחרון נשמר ומסומן`, `last good check ${day(runs.lastGoodAt)} · the last value is kept and marked`) });
    }
  } catch (e) { /* the catalogue is optional here */ }

  /* order: newest first, then materiality; one id once */
  const seen = new Set(); const events = [];
  for (const e of E.sort((a, b) => (b.at < a.at ? -1 : b.at > a.at ? 1 : b.m - a.m))) { if (seen.has(e.id)) continue; seen.add(e.id); events.push(e); }
  const counts = {}; for (const e of events) { counts[e.group] = (counts[e.group] || 0) + 1; }
  return { schema: 1, builtAt: new Date(now).toISOString(), since: new Date(sinceT).toISOString(), rules: Object.keys(RULES).length, counts, events };
}

module.exports = { build, RULES, GROUPS, LIFE, TRACK };
