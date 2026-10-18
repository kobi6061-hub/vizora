// PROPX · Opportunity Radar / Risk Radar — the deterministic scan of every geography PROPX can describe.
//
// NOT an investment recommendation. The scan runs the Market Dossier's explainable signals (lib/dossier/query.js:
// trigger · value · threshold · period · source · class) over Israel, the seven CBS districts and the localities with
// live ILA tenders, and sorts them into two lists: OPPORTUNITIES = markets worth investigating because an official or
// observed figure crossed a documented threshold in a direction a buyer would want to look at; RISKS = the mirror. Every
// item answers "why was this flagged?" with the trigger, the value, the threshold, a comparison (the national figure of
// the same rule, or the geography's share of it), the period, the source, the data class and the dossier's evidence
// quality. Geography is strict: a locality never carries a district or national series as its own signal.
// Materiality (1–3) is a constant per rule. Two convergence items are DERIVED from two rules firing together; they are
// named as such. Built by scripts/radar-build.js into data/radar/scan.json (a fresh checkout builds on read).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const D = require('../dossier/query');

const ROOT = path.join(__dirname, '..', '..', 'data');
const bi = (he, en) => ({ he, en });
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

/* which dossier signals are opportunities (worth investigating) and which are risks; their materiality; the geography levels they are valid at */
const RULES = {
  'sales-momentum-up': { kind: 'opportunity', m: 3, levels: ['il', 'district'], cmp: 'momentum' },
  'open-land': { kind: 'opportunity', m: 2, levels: ['il', 'district', 'locality'], cmp: 'share:unitsOpen' },
  'awarded-pipeline': { kind: 'opportunity', m: 2, levels: ['il', 'district', 'locality'], cmp: 'share:unitsAwarded' },
  'pending-decision': { kind: 'opportunity', m: 1, levels: ['il', 'district', 'locality'], cmp: 'share:unitsPendingDecision' },
  'renewal-pipeline': { kind: 'opportunity', m: 2, levels: ['il', 'district', 'locality'], cmp: 'share:renewalUnits' },
  'rental-pipeline': { kind: 'opportunity', m: 1, levels: ['il', 'district', 'locality'], cmp: 'share:rentalTenders' },
  'developer-entries': { kind: 'opportunity', m: 2, levels: ['il', 'district', 'locality'], cmp: 'share:entries' },
  'sales-momentum-down': { kind: 'risk', m: 3, levels: ['il', 'district'], cmp: 'momentum' },
  'months-of-supply': { kind: 'risk', m: 3, levels: ['il'], cmp: null },
  'failed-tenders': { kind: 'risk', m: 3, levels: ['il', 'district', 'locality'], cmp: 'ratio:failed' },
  'stale-rental-status': { kind: 'risk', m: 1, levels: ['il', 'district', 'locality'], cmp: 'share:staleRental' },
  'developer-concentration': { kind: 'risk', m: 2, levels: ['district', 'locality'], cmp: null },
  'no-recent-changes': { kind: 'risk', m: 1, levels: ['district', 'locality'], cmp: null },
  'construction-inputs': { kind: 'risk', m: 2, levels: ['il'], cmp: null },
};
const LEVEL_LABEL = { il: bi('ארצי', 'national'), district: bi('מחוז', 'district'), locality: bi('יישוב', 'locality') };
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
/* how a rule's raw value reads: momentum / inputs = a percent change, a ratio = a percent share, else a count */
const VALUE_KIND = { 'sales-momentum-up': 'pct', 'sales-momentum-down': 'pct', 'construction-inputs': 'pct', 'failed-tenders': 'ratio', 'developer-concentration': 'ratio', 'months-of-supply': 'months' };
const valueLabel = (id, v) => (!Number.isFinite(v) ? null : VALUE_KIND[id] === 'pct' ? pct1(v) : VALUE_KIND[id] === 'ratio' ? Math.round(v * 100) + '%' : VALUE_KIND[id] === 'months' ? v.toFixed(1) : fmt(v));
const pct1 = (x) => (Number.isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(1) + '%' : '—');
const iso = (txt) => '\u2066' + txt + '\u2069';   // LRI … PDI: a signed number keeps its sign on its left inside Hebrew text

/* the national figure a rule compares against */
function national(nat) {
  const S = nat.sections, K = (S.land && S.land.kpis) || {};
  return { momentum: S.sales && S.sales.momentum && S.sales.momentum.ok && !S.sales.small ? S.sales.momentum.pct : null,
    unitsOpen: K.unitsOpen ?? null, unitsAwarded: K.unitsAwarded ?? null, unitsPendingDecision: K.unitsPendingDecision ?? null,
    renewalUnits: S.renewal && S.renewal.kpis && S.renewal.kpis.proposedUnits ? (typeof S.renewal.kpis.proposedUnits === 'object' ? S.renewal.kpis.proposedUnits.sum : S.renewal.kpis.proposedUnits) : null,
    rentalTenders: S.rental && S.rental.pipeline ? S.rental.pipeline.tenders : null, entries: S.developers && S.developers.entries ? S.developers.entries.total : null,
    staleRental: S.rental && S.rental.pipeline && S.rental.pipeline.staleStatus ? S.rental.pipeline.staleStatus.n : null,
    /* the dossier's own failed-tender rule over the national KPIs: (decided − decided-without-detail + cancelled) ÷ tenders */
    failedRatio: K.tenders ? ((K.decided || 0) - (K.decidedWithoutDetail || 0) + (K.cancelled || 0)) / K.tenders : null, tenders: K.tenders ?? null };
}
function comparison(rule, s, N, level) {
  if (!rule.cmp || !N) return null;
  if (rule.cmp === 'momentum') return level === 'il' ? null : N.momentum == null ? null : { he: `ארצי: ${iso(pct1(N.momentum))}`, en: `national: ${pct1(N.momentum)}`, value: N.momentum, kind: 'national-value' };
  if (rule.cmp.startsWith('share:')) { const k = rule.cmp.slice(6), tot = N[k]; if (level === 'il' || !Number.isFinite(tot) || !tot || !Number.isFinite(s.value)) return null; const sh = Math.round((s.value / tot) * 1000) / 10;
    return { he: `${sh}% מהארצי (${fmt(tot)})`, en: `${sh}% of the national figure (${fmt(tot)})`, value: sh, kind: 'share-of-national' }; }
  if (rule.cmp === 'ratio:failed') return level === 'il' || N.failedRatio == null ? null : { he: `ארצי: ${Math.round(N.failedRatio * 100)}%`, en: `national: ${Math.round(N.failedRatio * 100)}%`, value: Math.round(N.failedRatio * 1000) / 10, kind: 'national-value' };
  return null;
}

/** the items of one dossier (already computed), geography-strict; `nat` = the national dossier for comparisons */
function classify(d, nat) {
  const N = nat ? national(nat) : null, out = [];
  const geo = { level: d.geo.level, code: d.geo.code, name: d.geo.name, district: d.geo.district || null, districtName: d.geo.districtName || null, levelLabel: LEVEL_LABEL[d.geo.level] };
  for (const s of d.signals) {
    const rule = RULES[s.id]; if (!rule || !rule.levels.includes(d.geo.level)) continue;
    out.push({ id: `${geo.level}:${geo.code}:${s.id}`, kind: rule.kind, m: rule.m, signal: s.id, geo, text: s.text, trigger: s.text, value: s.value ?? null, valueLabel: valueLabel(s.id, s.value), threshold: s.threshold, comparison: comparison(rule, s, N, d.geo.level),
      period: s.period || null, source: s.source, cls: s.cls, evidence: { level: d.quality.level, score: d.quality.score }, derived: false });
  }
  /* convergence (DERIVED): two rules firing together — named, never a score */
  const has = (id) => d.signals.find((s) => s.id === id);
  if (d.geo.level !== 'locality' && has('sales-momentum-up') && has('open-land')) out.push({ id: `${geo.level}:${geo.code}:demand-with-supply`, kind: 'opportunity', m: 3, signal: 'demand-with-supply', geo,
    text: bi('מומנטום מכירות רשמי חיובי לצד קרקע מדינה פתוחה למכרז — ביקוש והיצע בבנייה באותה גאוגרפיה (נגזר משני כללים)', 'positive official sales momentum beside open state land — demand and supply building in the same geography (derived from two rules)'),
    trigger: bi('sales-momentum-up ∧ open-land', 'sales-momentum-up ∧ open-land'), value: null, threshold: bi('שני הכללים מתקיימים', 'both rules hold'), comparison: null, period: has('sales-momentum-up').period, source: 'cbs:timeseries:44,10 · rmi:michrazim', cls: 'DERIVED', evidence: { level: d.quality.level, score: d.quality.score }, derived: true });
  if (d.geo.level === 'il' && has('months-of-supply') && has('awarded-pipeline')) out.push({ id: `${geo.level}:${geo.code}:inventory-plus-pipeline`, kind: 'risk', m: 3, signal: 'inventory-plus-pipeline', geo,
    text: bi('חודשי היצע ארציים גבוהים לצד צנרת קרקע שנזכתה — מלאי קיים ועוד היצע עתידי (נגזר משני כללים; יקומים שונים, לא סכום)', 'high national months of supply beside an awarded-land pipeline — existing inventory plus future supply (derived from two rules; different universes, not a sum)'),
    trigger: bi('months-of-supply ∧ awarded-pipeline', 'months-of-supply ∧ awarded-pipeline'), value: null, threshold: bi('שני הכללים מתקיימים', 'both rules hold'), comparison: null, period: has('months-of-supply').period, source: 'cbs:timeseries:44,10 · rmi:michrazim', cls: 'DERIVED', evidence: { level: d.quality.level, score: d.quality.score }, derived: true });
  return out;
}

/* Radar 2.0 (18.10.2026): every geography carries a signal STATE — SIGNALS (≥ 1 rule fired), NO_SIGNAL (a valid read: the data is there and no
   documented threshold was crossed) or INSUFFICIENT_DATA (evidence quality LOW, or no tracked record) — never a score, never a default. */
const STATES = Object.freeze({ SIGNALS: bi('עם אותות', 'signals'), NO_SIGNAL: bi('ללא אות', 'NO SIGNAL'), INSUFFICIENT_DATA: bi('נתונים לא מספיקים', 'INSUFFICIENT DATA') });
const trackedOf = (d) => (d.geo.level === 'locality' ? D.trackedRecords(d.sections) : null);
const stateOf = (d, n) => (n > 0 ? 'SIGNALS' : d.quality.level !== 'LOW' && (d.geo.level !== 'locality' || trackedOf(d) >= 1) ? 'NO_SIGNAL' : 'INSUFFICIENT_DATA');
/* why a geography is in its state — the reason is part of the read, never implied */
const stateReason = (d, n) => (n > 0 ? bi(`${n} אותות לפי הכללים המתועדים`, `${n} items under the documented rules`)
  : d.quality.level === 'LOW' ? bi('איכות הראיות של התיק נמוכה', 'the dossier evidence quality is LOW')
  : d.geo.level === 'locality' && !(trackedOf(d) >= 1) ? bi('אין רשומה שמורה לגאוגרפיה (מכרזים בהיקף הנוכחי ומכרזי השכרה; מתחמי התחדשות ופרויקטי הגרלה כפי שפורסמו) — ההיסטוריה בלבד', 'no stored record for the geography (tenders in the current scope and rental tenders; renewal complexes and lottery projects as published) — history only')
  : d.geo.level === 'locality' && trackedOf(d) < D.TRACKED_MIN && d.sections && d.sections.changes && d.sections.changes.total === 0 ? bi(`אף סף מתועד לא נחצה; כלל "צנרת שקטה" אינו חל (פחות מ-${D.TRACKED_MIN} רשומות שמורות)`, `no documented threshold was crossed; the quiet-pipeline rule is not applicable (fewer than ${D.TRACKED_MIN} stored records)`)
  : bi('הנתונים קיימים ואף סף מתועד לא נחצה', 'the data is there and no documented threshold was crossed'));

/** the scan over every geography: national, the districts, every locality with a live ILA tender (Radar 2.0; a number limits to the top-N by live tenders) */
function build({ dataDir = ROOT, now = Date.now(), localities = 'all' } = {}) {
  const t0 = Date.now();
  const nat = D.dossier({ level: 'il', now, dataDir });
  const ix = D.index({ dataDir, limit: Infinity });
  const nLoc = localities === 'all' ? ix.localities.length : Math.max(0, Math.min(Number(localities) || 0, ix.localities.length));
  const geos = [nat, ...ix.districts.map((x) => D.dossier({ level: 'district', code: x.code, now, dataDir })).filter(Boolean), ...ix.localities.slice(0, nLoc).map((x) => D.dossier({ level: 'locality', code: x.code, now, dataDir })).filter(Boolean)];
  const items = geos.flatMap((d) => classify(d, nat));
  const RULE_ORDER = Object.keys(RULES).concat(['demand-with-supply', 'inventory-plus-pipeline']);
  /* materiality first, then the rule table's order (values of different rules have different units — never compared), then the value inside one rule, then the geography */
  const rank = (a, b) => b.m - a.m || RULE_ORDER.indexOf(a.signal) - RULE_ORDER.indexOf(b.signal) || Math.abs(b.value || 0) - Math.abs(a.value || 0) || String(a.geo.code).localeCompare(String(b.geo.code));
  const geographies = geos.map((d) => { const its = items.filter((x) => x.geo.level === d.geo.level && x.geo.code === d.geo.code); return { level: d.geo.level, code: d.geo.code, name: d.geo.name, district: d.geo.district || null, districtName: d.geo.districtName || null,
    quality: { level: d.quality.level, score: d.quality.score }, signalState: stateOf(d, its.length), stateReason: stateReason(d, its.length), tracked: trackedOf(d), opportunities: its.filter((x) => x.kind === 'opportunity').length, risks: its.filter((x) => x.kind === 'risk').length, mOpp: its.filter((x) => x.kind === 'opportunity').reduce((s, x) => s + x.m, 0), mRisk: its.filter((x) => x.kind === 'risk').reduce((s, x) => s + x.m, 0) }; });
  return { schema: 1, builtAt: new Date(now).toISOString(), basis: BASIS, rules: Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, { kind: r.kind, m: r.m, levels: r.levels }])), levels: LEVEL_LABEL,
    scope: { national: 1, districts: ix.districts.length, localities: nLoc, localitiesWithLiveTenders: ix.localities.length, localityRule: nLoc >= ix.localities.length ? bi('כל יישוב עם מכרז רמ״י אחד לפחות ברשימה העדכנית', 'every locality with at least one ILA tender in the latest list') : bi('היישובים עם הכי הרבה מכרזי רמ״י חיים', 'the localities with the most live ILA tenders') },
    states: STATES,
    counts: { opportunities: items.filter((x) => x.kind === 'opportunity').length, risks: items.filter((x) => x.kind === 'risk').length, geographies: geos.length, states: geographies.reduce((o, g) => { o[g.signalState] = (o[g.signalState] || 0) + 1; return o; }, { SIGNALS: 0, NO_SIGNAL: 0, INSUFFICIENT_DATA: 0 }) },
    geographies, opportunities: items.filter((x) => x.kind === 'opportunity').sort(rank), risks: items.filter((x) => x.kind === 'risk').sort(rank), ms: Date.now() - t0 };
}
const BASIS = bi('לא המלצת השקעה. הזדמנות = גאוגרפיה ששווה לבדוק כי נתון רשמי או שנצפה חצה סף מתועד; סיכון = התמונה ההפוכה. כל פריט מסביר: טריגר · ערך · סף · השוואה · תקופה · מקור · סיווג · איכות ראיות. גאוגרפיה קפדנית: יישוב לעולם אינו נושא סדרה מחוזית או ארצית כאות משלו. מהותיות = קבוע לכל כלל.',
  'Not an investment recommendation. An opportunity = a geography worth investigating because an official or observed figure crossed a documented threshold; a risk = the mirror. Every item explains: trigger · value · threshold · comparison · period · source · class · evidence quality. Geography is strict: a locality never carries a district or national series as its own signal. Materiality = a constant per rule.');

let cache = { key: null, payload: null };
function load({ dataDir = ROOT, now = Date.now() } = {}) {
  const f = path.join(dataDir, 'radar', 'scan.json');
  let st = null; try { st = fs.statSync(f); } catch { /* absent */ }
  const key = st ? `${f}|${st.mtimeMs}|${st.size}` : `build|${dataDir}`;
  if (cache.key === key && cache.payload) return cache.payload;
  const payload = st ? readJson(f) : null;
  cache = { key, payload: payload && payload.schema === 1 ? { ...payload, served: 'file' } : { ...build({ dataDir, now }), served: 'built-on-read' } };
  return cache.payload;
}
/** the view: kind=opportunity|risk (default both), level=il|district|locality, city=<code>, district=<d-…>, m (min materiality), limit */
function scan(params = {}, opt = {}) {
  const P = load(opt);
  const lim = Math.max(1, Math.min(200, Number(params.limit) || 40)), m = Math.max(1, Math.min(3, Number(params.m) || 1));
  const pick = (list) => list.filter((x) => x.m >= m && (!params.level || x.geo.level === params.level) && (!params.city || (x.geo.level === 'locality' && x.geo.code === String(params.city))) && (!params.district || x.geo.district === params.district || (x.geo.level === 'district' && x.geo.code === params.district))).slice(0, lim);
  return { basis: P.basis, builtAt: P.builtAt, served: P.served, scope: P.scope, counts: P.counts, states: P.states || STATES, levels: P.levels, rules: P.rules, geographies: P.geographies,
    opportunities: params.kind === 'risk' ? [] : pick(P.opportunities), risks: params.kind === 'opportunity' ? [] : pick(P.risks) };
}
/** the items of one geography — from the scan file when it is covered, else computed from its dossier with the same rules */
function forGeo({ level, code }, opt = {}) {
  const P = load(opt);
  const covered = P.geographies.find((g) => g.level === level && String(g.code) === String(code));
  if (covered) return { served: P.served, builtAt: P.builtAt, signalState: covered.signalState || null, signalStateLabel: covered.signalState ? STATES[covered.signalState] : null, stateReason: covered.stateReason || null, tracked: covered.tracked ?? null, opportunities: P.opportunities.filter((x) => x.geo.level === level && String(x.geo.code) === String(code)), risks: P.risks.filter((x) => x.geo.level === level && String(x.geo.code) === String(code)) };
  const d = D.dossier({ level, code, dataDir: opt.dataDir }); if (!d) return null;
  const nat = D.dossier({ level: 'il', dataDir: opt.dataDir }), items = classify(d, nat);
  const st = stateOf(d, items.length);
  return { served: 'computed', builtAt: new Date().toISOString(), signalState: st, signalStateLabel: STATES[st], stateReason: stateReason(d, items.length), tracked: trackedOf(d), opportunities: items.filter((x) => x.kind === 'opportunity'), risks: items.filter((x) => x.kind === 'risk') };
}

module.exports = { build, load, scan, forGeo, classify, RULES, BASIS, STATES };
