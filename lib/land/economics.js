'use strict';
/* PROPX · LAND ECONOMICS 2.0 (17.10.2026) — the land-cost read of one geography, from the Israel Land Authority's tender records.
 *
 *   economics({ level: 'il' | 'district' | 'locality', code, now, months = 36 })  →  one read, or null for an unknown geography
 *
 * Three universes, kept apart and never averaged together:
 *   · competitive-bid lots on the OPEN-MARKET track — ₪ per unit (the winning sum ÷ the lot's units; nominal, before development
 *     costs and VAT): the lot-level quartiles (p25 · median · p75) and the unit-weighted figure of the land read model
 *     (`landPerUnitOver`), over the lots DECIDED in the window (36 months) and, beside them, the prior 36 months — a change is
 *     stated only when both windows hold ≥ 5 lots;
 *   · ₪/m² bids (מחיר למשתכן / מופחת tracks) — a different measure (price per built m² bid down), its own count and quartiles;
 *   · outcomes of the tenders PUBLISHED in the window — awarded / decided without a winner / cancelled / pending — the
 *     dossier's own failed-tender ratio; re-tenders through the Authority's lot file id only (lib/land/lineage.js, never by
 *     name or geometry); the top winner's share of the competitive-bid lots (exact legal name, typographic variants only).
 * A locality read carries its district's competitive-bid block of the SAME universe as context (never the other way round).
 * Every figure: n, period, basis, formula. Missing → null with a reason. No estimate, no index-linking, no "land value". */
const path = require('node:path');
const LQ = require('./query');
let NAMES = null; try { NAMES = require('../entities/names'); } catch { /* the entity names helper ships separately */ }

const VERSION = { id: 'propx-land-economics-v1', effective: '2026-10-17' };
const bi = (he, en) => ({ he, en });
const DAY = 86400000, MONTH = 30.4375 * DAY, MIN_N = 5, FAILED = new Set(['decided-no-award', 'cancelled', 'frozen']);
const day = (v) => (v ? String(v).slice(0, 10) : null);
const decisionDateOf = (r) => r.committeeDate || r.lotteryDate || r.closeDate || r.publishedDate || null;
const q = (arr, p) => (arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]) : null);
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const DISTRICTS = { 'd-jm': bi('מחוז ירושלים', 'Jerusalem district'), 'd-north': bi('מחוז הצפון', 'Northern district'), 'd-haifa': bi('מחוז חיפה', 'Haifa district'), 'd-center': bi('מחוז המרכז', 'Central district'), 'd-ta': bi('מחוז תל אביב', 'Tel Aviv district'), 'd-south': bi('מחוז הדרום', 'Southern district'), 'js-area': bi('יהודה ושומרון', 'Judea and Samaria Area') };

let LOC = null;
function localities(dataDir) {
  if (LOC && LOC.dir === dataDir) return LOC.map;
  const map = new Map();
  try { const arr = JSON.parse(require('node:fs').readFileSync(path.join(dataDir, 'geo', 'localities.json'), 'utf8')); for (const l of Array.isArray(arr) ? arr : arr.localities || []) map.set(String(l.code), l); } catch { /* registry absent */ }
  LOC = { dir: dataDir, map }; return map;
}

/* the competitive-bid block over a set of rows: lot-level quartiles + the unit-weighted figure, open-market only */
function bidBlock(rows, from, to) {
  const over = LQ.landPerUnitOver(rows, { from, to, dateField: 'decision' });
  const enough = over.lots >= MIN_N;   /* quartiles only over ≥ 5 lots; the unit-weighted figure keeps its n and is flagged small below that */
  return { lots: over.lots, tenders: over.tenders, units: over.units, unitWeighted: over.perUnit, small: over.lots > 0 && !enough, median: enough ? over.medianLotPerUnit : null, p25: enough ? over.p25LotPerUnit : null, p75: enough ? over.p75LotPerUnit : null, meanUnitsPerLot: over.lots && over.units ? Math.round((over.units / over.lots) * 10) / 10 : null,
    basis: over.basis, tracks: over.tracks, excluded: over.excluded, formula: over.formula, consideration: over.consideration, vat: over.vat, period: { from, to, dateField: 'decision' } };
}

function economics({ level = 'il', code = null, dataDir = null, now = Date.now(), months = 36 } = {}) {
  const C = LQ.load(dataDir || undefined);
  const DATA = dataDir || path.join(__dirname, '..', '..', 'data');
  const L = localities(DATA);
  let geo;
  if (level === 'locality') { const l = L.get(String(code)); if (!l) return null; geo = { level, code: String(l.code), name: bi(l.he, l.en), district: l.district || null }; }
  else if (level === 'district') { if (!DISTRICTS[code]) return null; geo = { level, code, name: DISTRICTS[code], district: code }; }
  else if (!level || level === 'il') geo = { level: 'il', code: 'il', name: bi('ישראל', 'Israel'), district: null };
  else return null;
  const inGeo = (r) => (geo.level === 'il' ? true : geo.level === 'locality' ? String(r.localityCode) === geo.code : (L.get(String(r.localityCode)) || {}).district === geo.district);
  const to = day(new Date(now).toISOString()), from = day(new Date(now - months * MONTH).toISOString()), priorFrom = day(new Date(now - 2 * months * MONTH).toISOString());
  const rows = C.live.filter(inGeo);
  const decidedIn = (r, a, b) => { const d = day(decisionDateOf(r)); return d && d >= a && d < b; };
  const cur = rows.filter((r) => decidedIn(r, from, to + '￿')), prior = rows.filter((r) => decidedIn(r, priorFrom, from));

  /* ---- 1 · competitive-bid open-market ₪/unit: now vs the prior window */
  const current = bidBlock(cur, from, to), previous = bidBlock(prior, priorFrom, from);
  const mixRatio = current.meanUnitsPerLot && previous.meanUnitsPerLot ? current.meanUnitsPerLot / previous.meanUnitsPerLot : null;
  const mixWarning = mixRatio != null && (mixRatio >= 2 || mixRatio <= 0.5) ? bi(`תמהיל המגרשים השתנה: ${current.meanUnitsPerLot} יח״ד למגרש בממוצע עכשיו מול ${previous.meanUnitsPerLot} בחלון הקודם — השינוי משקף גם סוג מגרש אחר, לא רק מחיר`, `the lot mix changed: ${current.meanUnitsPerLot} units per lot on average now vs ${previous.meanUnitsPerLot} in the prior window — the change also reflects a different kind of lot, not only price`) : null;
  const change = current.lots >= MIN_N && previous.lots >= MIN_N ? { medianPct: pct(current.median, previous.median), unitWeightedPct: pct(current.unitWeighted, previous.unitWeighted), small: false, mixWarning, formula: '(current median − prior median) ÷ prior median × 100; the same for the unit-weighted figure' } : { medianPct: null, unitWeightedPct: null, small: true, mixWarning: null, reason: bi(`פחות מ-${MIN_N} מגרשים באחד החלונות — ללא שינוי`, `fewer than ${MIN_N} lots in one of the windows — no change stated`) };
  const competitiveBid = { cls: 'DERIVED', source: 'rmi:michrazim', current, prior: previous, change, window: { months, from, to, priorFrom, dateField: 'decision' },
    basis: bi('מגרשי הצעה תחרותית במסלול שוק חופשי בלבד; סכום הזכייה ÷ יח״ד לכל מגרש; רבעונים של היחסים לצד הממוצע משוקלל-היחידות; תמורה נומינלית ללא הוצאות פיתוח ומע״מ', 'competitive-bid lots on the open-market track only; the winning sum ÷ units per lot; the quartiles of those ratios beside the unit-weighted figure; nominal consideration before development costs and VAT') };

  /* ---- 2 · ₪/m² bids (subsidized tracks) — a different measure, its own universe */
  const psmLots = cur.filter((r) => r.priceBasis === 'price-per-sqm-bid').flatMap((r) => (r.winners || []).map((l) => ({ ...l, tender: r.id, track: r.track }))).filter((l) => Number.isFinite(l.amount) && l.amount > 0);
  const psm = psmLots.map((l) => l.amount).sort((a, b) => a - b);
  const psmLatest = rows.filter((r) => r.priceBasis === 'price-per-sqm-bid' && (r.winners || []).length).map((r) => day(decisionDateOf(r))).filter(Boolean).sort().pop() || null;
  const perSqmBid = { cls: 'DERIVED', source: 'rmi:michrazim', lots: psmLots.length, tenders: new Set(psmLots.map((l) => l.tender)).size, median: psm.length >= MIN_N ? q(psm, 0.5) : null, p25: psm.length >= MIN_N ? q(psm, 0.25) : null, p75: psm.length >= MIN_N ? q(psm, 0.75) : null, min: psm.length ? psm[0] : null, max: psm.length ? psm[psm.length - 1] : null, tracks: [...new Set(psmLots.map((l) => l.track))].sort(), period: { from, to, dateField: 'decision' },
    latestDecision: psmLatest, reason: psmLots.length ? null : psmLatest ? bi(`אין זכיות ₪/מ״ר בחלון — ההחלטה האחרונה במסלול בגאוגרפיה: ${psmLatest}`, `no ₪/m² awards in the window — the track's latest decision in the geography: ${psmLatest}`) : bi('אין זכיות ₪/מ״ר בגאוגרפיה ברשימה החיה', 'no ₪/m² awards in the geography in the live list'),
    basis: bi('הצעות ₪/מ״ר בנוי (מחיר למשתכן / מופחת) — מדד אחר, לעולם לא ממוצע עם ₪/יח״ד של קרקע', '₪ per built m² bids (Mechir LaMishtaken / reduced-price tracks) — a different measure, never averaged with land ₪/unit') };

  /* ---- 3 · outcomes of the tenders published in the window (the dossier's own failed-tender rule) */
  const pubIn = rows.filter((r) => r.publishedDate && day(r.publishedDate) >= from && day(r.publishedDate) <= to);
  const K = LQ.kpis(pubIn, {}, C);
  const failed = (K.decided || 0) - (K.decidedWithoutDetail || 0) + (K.cancelled || 0);
  const outcomes = { cls: 'OFFICIAL', source: 'rmi:michrazim', tenders: K.tenders || 0, awarded: K.awarded || 0, decidedWithoutWinner: (K.decided || 0) - (K.decidedWithoutDetail || 0), cancelled: K.cancelled || 0, decidedNotRead: K.decidedWithoutDetail || 0, pending: (K.closed || 0) + (K.lotteryPending || 0), open: (K.open || 0) + (K.published || 0),
    failedRatio: K.tenders ? Math.round((failed / K.tenders) * 1000) / 1000 : null, period: { from, to, dateField: 'published' },
    basis: bi('מכרזים שפורסמו בחלון לפי מחזור החיים של רשות מקרקעי ישראל: (נדונו ללא זוכה + בוטלו) ÷ פורסמו; "נדונו — הפרטים לא נקראו" אינם נספרים ככישלון', 'tenders published in the window by the Authority\'s lifecycle: (decided without a winner + cancelled) ÷ published; "decided — details not read" never count as failed') };

  /* ---- 4 · re-tenders through the lot file id (lineage), tenders in the window that re-market a lot an earlier tender carried */
  let reTenders = { cls: 'OFFICIAL', source: 'rmi:michrazim', tenders: null, ofTenders: pubIn.length, relations: {}, basis: bi('קישור רק דרך מזהה תיק המגרש של רמ״י (TikID) — לעולם לא לפי שם או גאומטריה; "אותו גוש/חלקה" אינו נספר', 'linked only through the Authority\'s lot file id (TikID) — never by name or geometry; "same block/parcel" is not counted'), period: { from, to, dateField: 'published' } };
  try { const ln = LQ.lineageOf(C); const ids = new Set(pubIn.map((r) => r.id)); let n = 0; const rel = {};
    for (const r of pubIn) { const me = ln.byTender.get(r.id); if (!me) continue; const preds = me.predecessors.filter((l) => l.relation !== 'same-parcel'); if (preds.length) { n++; for (const l of preds) rel[l.relation] = (rel[l.relation] || 0) + 1; } }
    reTenders = { ...reTenders, tenders: n, relations: rel, ofTenders: ids.size }; } catch { /* lineage unavailable */ }

  /* ---- 5 · the top winner's share of the competitive-bid open-market lots decided in the window (exact legal name; typographic variants only) */
  const bidLots = cur.filter((r) => r.priceBasis === 'competitive-bid' && r.track === 'open-market').flatMap((r) => (r.winners || []).filter((l) => l.name && Number.isFinite(l.amount)));
  const byName = new Map();
  for (const l of bidLots) { const k = NAMES ? NAMES.canonicalName(l.name) : String(l.name).trim(); const e = byName.get(k) || { name: k, lots: 0, units: 0 }; e.lots++; e.units += l.units || 0; byName.set(k, e); }
  const winners = [...byName.values()].sort((a, b) => b.lots - a.lots || b.units - a.units);
  const top = winners[0] || null;
  const concentration = { cls: 'OBSERVED', source: 'rmi:michrazim', lots: bidLots.length, winners: winners.length, top: top ? { name: top.name, lots: top.lots, units: top.units, share: bidLots.length ? Math.round((top.lots / bidLots.length) * 1000) / 10 : null } : null, period: { from, to, dateField: 'decision' },
    basis: bi('שם משפטי מדויק (וריאנטים טיפוגרפיים בלבד); זוכים פרטיים ללא סימון תאגיד נספרים ואינם נמנים בשם', 'exact legal name (typographic variants only); unmarked private winners are counted, never named') };

  /* ---- 6 · a locality's district, same universe, as context */
  let districtContext = null;
  if (geo.level === 'locality' && geo.district && DISTRICTS[geo.district]) { const drows = C.live.filter((r) => (L.get(String(r.localityCode)) || {}).district === geo.district && decidedIn(r, from, to + '￿')); const db = bidBlock(drows, from, to); districtContext = { district: geo.district, name: DISTRICTS[geo.district], current: db, cls: 'DERIVED', source: 'rmi:michrazim', scope: bi('המחוז — אותו יקום (הצעה תחרותית, שוק חופשי), הקשר בלבד', 'the district — the same universe (competitive bid, open market), context only') }; }

  const missing = [];
  if (current.lots < MIN_N) missing.push({ id: 'small_sample', he: `פחות מ-${MIN_N} מגרשי הצעה תחרותית בשוק החופשי נדונו ב-${months} החודשים — ללא רבעונים`, en: `fewer than ${MIN_N} competitive-bid open-market lots decided in ${months} months — no quartiles` });
  missing.push({ id: 'private-land', he: 'קרקע פרטית: אין מקור — מחירי קרקע פרטית אינם נצפים', en: 'private land: no source — private land prices are not observed' });
  missing.push({ id: 'development-costs', he: 'הוצאות פיתוח ומע״מ אינם בתמורה; עלות כוללת ליח״ד אינה מחושבת', en: 'development costs and VAT are outside the consideration; an all-in cost per unit is not computed' });
  return { schema: 1, version: VERSION, geo, generatedAt: new Date(now).toISOString(), window: { months, from, to, priorFrom }, competitiveBid, perSqmBid, outcomes, reTenders, concentration, districtContext, missing,
    freshness: { checkedAt: C.meta && C.meta.checkedAt ? C.meta.checkedAt : null, latestPublished: C.meta && C.meta.latestPublished ? C.meta.latestPublished : null, source: 'rmi:michrazim' },
    basis: bi('שלושה יקומים שלעולם אינם ממוצעים יחד: ₪/יח״ד של מגרשי הצעה תחרותית בשוק החופשי · הצעות ₪/מ״ר במסלולים מסובסדים · תוצאות המכרזים; כל נתון עם n, תקופה, בסיס ונוסחה; תמורה נומינלית — לא שווי קרקע, לא עלות כוללת.', 'three universes never averaged together: ₪/unit of competitive-bid open-market lots · ₪/m² bids on subsidized tracks · tender outcomes; every figure with n, period, basis and formula; nominal consideration — not a land value, not an all-in cost.') };
}

module.exports = { economics, VERSION, MIN_N, DISTRICTS };
