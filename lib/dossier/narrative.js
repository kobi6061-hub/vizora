'use strict';
/* PROPX · "Why this market?" — a deterministic narrative over one dossier (17.10.2026).
 *
 *   narrative(D, { scan, supply })  →  { schema, geo, lead: [ids], sentences: [...], counts, basis }
 *
 * Composes ordered bilingual sentences from a dossier already computed by lib/dossier/query.js, the geography's
 * Opportunity / Risk radar items (lib/radar/scan.js forGeo) and its supply pipeline (lib/supply/pipeline.js).
 * Every sentence carries its data class (OFFICIAL · OBSERVED · DERIVED · MISSING), its source id(s), its period, its
 * geographic scope (own · district · national) and the registry term the ⓘ opens (lib/explain/registry.js).
 *
 * Rules: a sentence is composed only from figures the read models hold — a missing input makes the sentence say so or
 * drops it (never a default); unit universes are never added; a locality's sales sentence names the DISTRICT series;
 * comparisons only inside one series (district vs national momentum of the same CBS series; a share of the national
 * figure of the same universe); exact developer names; signed numbers isolated (LRI … PDI) in Hebrew; never a
 * recommendation, a probability or a score of attractiveness. Pure: no fetch, no model call, no randomness. */
const DQ = require('./query');

const bi = (he, en) => ({ he, en });
const iso = (txt) => '⁦' + txt + '⁩';
/* Hebrew text taken from another module (the scan's comparisons) may carry an unisolated signed number — wrap it here too (never twice) */
const isoSigns = (t) => String(t).replace(/(?<!\u2066)([+\u2212-]\d[\d.,]*%)(?!\u2069)/g, '\u2066$1\u2069');
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const pct1 = (x) => (Number.isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(1) + '%' : '—');
const plural = (n, one, many) => (n === 1 ? one : many);
const oneClass = (items) => { const s = new Set((items || []).map((x) => x.cls)); return s.size === 1 ? [...s][0] : 'DERIVED'; };
const heItems = (n) => (n === 1 ? 'פריט אחד' : `${n} פריטים`);
const pctShare = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? Math.round((100 * a) / b) : null);
const L = (v, lang) => (v == null ? '' : typeof v === 'object' ? (v[lang] != null ? v[lang] : v.en) : String(v));
const LEVEL = { il: bi('ארצי', 'national'), district: bi('מחוז', 'district'), locality: bi('יישוב', 'locality') };

const VERSION = { id: 'propx-dossier-narrative-v1', effective: '2026-10-17' };
const BASIS = bi('קריאה דטרמיניסטית של נתוני התיק: כל משפט עם סיווגו, מקורו, תקופתו והיקפו הגאוגרפי; יקומי יחידות לעולם אינם מחוברים; השוואה רק בתוך אותה סדרה; מה שחסר נאמר. תיאור — לא המלצה, לא הסתברות ולא ציון אטרקטיביות.',
  'A deterministic read of the dossier\'s figures: every sentence with its class, source, period and geographic scope; unit universes are never added; comparisons only inside one series; what is missing is said. A description — not a recommendation, a probability or an attractiveness score.');

/** the narrative of one dossier. `scan` = forGeo(...) of the same geography (optional), `supply` = supply(...) of it (optional). */
function narrative(D, { scan = null, supply = null } = {}) {
  if (!D || !D.geo) return null;
  const S = D.sections || {}, geo = D.geo, lvl = geo.level, out = [];
  const add = (id, group, kind, text, meta) => { if (text) out.push({ id, group, kind, he: text.he, en: text.en, cls: meta.cls, source: meta.source, period: meta.period || null, geoScope: meta.geoScope || 'own', term: meta.term || null }); };
  const name = geo.name, lvlLabel = LEVEL[lvl] || LEVEL.il;

  /* 1 · position: what PROPX observes here (one sentence per universe, never summed) */
  const K = S.land && S.land.kpis;
  if (K && Number.isFinite(K.tenders) && K.tenders > 0) {
    const parts = (lang) => [Number.isFinite(K.unitsOpen) ? (lang === 'he' ? `${fmt(K.unitsOpen)} יח״ד במכרזים פתוחים / שפורסמו` : `${fmt(K.unitsOpen)} units in open / published tenders`) : null,
      Number.isFinite(K.unitsAwarded) ? (lang === 'he' ? `${fmt(K.unitsAwarded)} יח״ד במגרשים שנזכו (24 חודשים)` : `${fmt(K.unitsAwarded)} units in awarded lots (24 months)`) : null,
      Number.isFinite(K.unitsPendingDecision) ? (lang === 'he' ? `${fmt(K.unitsPendingDecision)} יח״ד ממתינות להחלטה` : `${fmt(K.unitsPendingDecision)} units awaiting a decision`) : null].filter(Boolean);
    add('position-land', 'position', 'fact',
      bi(`${name.he} (${lvlLabel.he}): ${fmt(K.tenders)} מכרזי רמ״י בהיקף הנוכחי${parts('he').length ? ' — ' + parts('he').join(', ') : ''}${K.byLocalities ? ' (סכום יישובי המחוז)' : ''}.`,
        `${name.en} (${lvlLabel.en}): ${fmt(K.tenders)} ILA tenders in the current scope${parts('en').length ? ' — ' + parts('en').join(', ') : ''}${K.byLocalities ? ' (the district\'s localities summed)' : ''}.`),
      { cls: 'OFFICIAL', source: 'rmi:michrazim', period: bi('היקף נוכחי', 'current scope'), term: 'tender_units_open' });
  }
  else add('position-land', 'position', 'gap', bi(`${name.he} (${lvlLabel.he}): אין מכרזי רמ״י נוכחיים בקריאה.`, `${name.en} (${lvlLabel.en}): no current ILA tenders in this read.`), { cls: 'MISSING', source: 'rmi:michrazim', term: 'tender_units_open' });

  /* 2 · demand: the official series — national, the district's, or (for a locality) the district's named as such */
  const sl = S.sales;
  if (sl && sl.latest && sl.scope) {
    const geoScope = lvl === 'locality' ? 'district' : 'own';
    const mom = sl.momentum && sl.momentum.ok && !sl.small ? sl.momentum.pct : null;
    /* the national comparison of the SAME series comes from the scan item that fired on it (district level only) */
    const momItem = lvl === 'district' && scan ? [...(scan.opportunities || []), ...(scan.risks || [])].find((x) => /^sales-momentum-/.test(x.signal) && x.comparison) : null;
    const momCmp = momItem ? bi(` (${isoSigns(L(momItem.comparison, 'he'))})`, ` (${L(momItem.comparison, 'en')})`) : bi('', '');
    const momTxt = mom != null ? bi(` מומנטום 3 חודשים ${iso(pct1(mom))}${momCmp.he}`, ` 3-month momentum ${pct1(mom)}${momCmp.en}`) : sl.small ? bi(' מדגם קטן — המומנטום אינו נקרא', ' small sample — momentum not read') : bi('', '');
    const nat = lvl !== 'il' && sl.national && Number.isFinite(sl.national.t12) ? bi(` (ארצי: ${fmt(sl.national.t12)} ב-12 החודשים)`, ` (national: ${fmt(sl.national.t12)} in 12 months)`) : bi('', '');
    add('demand', 'demand', 'fact',
      bi(`מכירות דירות חדשות רשמיות — ${sl.scope.he}: ${fmt(sl.latestValue)} ב-${sl.latest}; ${fmt(sl.t12 && sl.t12.value)} ב-12 החודשים${nat.he};${momTxt.he}.`,
        `Official new-home sales — ${sl.scope.en}: ${fmt(sl.latestValue)} in ${sl.latest}; ${fmt(sl.t12 && sl.t12.value)} in 12 months${nat.en};${momTxt.en}.`),
      { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10', period: sl.latest, geoScope, term: lvl === 'locality' ? 'district_series_for_locality' : 'official_new_home_sales' });
  } else add('demand', 'demand', 'gap', bi('אין סדרת מכירות רשמית לגאוגרפיה הזו.', 'No official sales series for this geography.'), { cls: 'MISSING', source: 'cbs:timeseries:44,10', term: 'official_new_home_sales' });
  if (S.inventory && Number.isFinite(S.inventory.value)) add('inventory', 'demand', 'fact',
    bi(`מלאי שטרם נמכר (ארצי): ${fmt(S.inventory.value)} דירות ב-${S.inventory.period}${Number.isFinite(S.inventory.monthsSupply) ? `; חודשי היצע לפי סדרת הלמ״ס (ממוצע מבוסס מגמה): ${S.inventory.monthsSupply.toFixed(1)}` : ''}.`,
      `Unsold inventory (national): ${fmt(S.inventory.value)} homes in ${S.inventory.period}${Number.isFinite(S.inventory.monthsSupply) ? `; months of supply per the CBS series (a trend-based average): ${S.inventory.monthsSupply.toFixed(1)}` : ''}.`),
    { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10', period: S.inventory.period, term: 'months_of_supply' });

  /* 3 · supply: the DERIVED indicators of the pipeline — pressure (national / district) and the readable momenta */
  const IND = supply && Array.isArray(supply.indicators) ? supply.indicators : [];
  const sp = IND.find((i) => i.id === 'supply-pressure');
  if (sp && Number.isFinite(sp.value)) add('supply-pressure', 'supply', 'derived',
    bi(`לחץ היצע: ${sp.value.toFixed(1)} חודשי קרקע מדינה שנזכתה בקצב המכירות הרשמי (יח״ד שנזכו ב-24 חודשים ÷ מכירות חודשיות של 12 החודשים; ${L(sp.inputs && sp.inputs.salesScope, 'he')}) — קרקע מדינה בלבד, נזכה ≠ נבנה.`,
      `Supply pressure: ${sp.value.toFixed(1)} months of awarded state land at the official sales pace (units awarded in 24 months ÷ monthly sales of the last 12; ${L(sp.inputs && sp.inputs.salesScope, 'en')}) — state land only, awarded ≠ built.`),
    { cls: 'DERIVED', source: 'rmi:michrazim · cbs:timeseries:44,10', period: sp.period, term: 'supply_pressure' });
  else if (sp && sp.reason) add('supply-pressure', 'supply', 'gap', bi(`לחץ היצע אינו נקרא: ${L(sp.reason, 'he')}.`, `Supply pressure is not read: ${L(sp.reason, 'en')}.`), { cls: 'MISSING', source: 'rmi:michrazim · cbs:timeseries:44,10', term: 'supply_pressure' });
  const moms = IND.filter((i) => i.unit === '%');
  const readable = moms.filter((i) => Number.isFinite(i.value)), unread = moms.filter((i) => !Number.isFinite(i.value));
  if (readable.length) add('supply-momentum', 'supply', 'derived',
    bi(`מומנטום 12 חודשים (נגזר, כל יקום לעצמו): ${readable.map((i) => `${L(i.label, 'he')} ${iso(pct1(i.value))}`).join('; ')}${unread.length ? `; לא נקרא: ${unread.map((i) => L(i.label, 'he')).join(', ')}` : ''}.`,
      `12-month momentum (derived, each universe on its own): ${readable.map((i) => `${L(i.label, 'en')} ${pct1(i.value)}`).join('; ')}${unread.length ? `; not read: ${unread.map((i) => L(i.label, 'en')).join(', ')}` : ''}.`),
    { cls: 'DERIVED', source: 'lib/supply', period: readable[0].period, term: 'momentum_12m' });
  else if (moms.length) add('supply-momentum', 'supply', 'gap', bi(`אף מומנטום היצע אינו נקרא: ${unread.map((i) => `${L(i.label, 'he')} — ${L(i.reason, 'he') || '—'}`).join('; ')}.`, `No supply momentum is readable: ${unread.map((i) => `${L(i.label, 'en')} — ${L(i.reason, 'en') || '—'}`).join('; ')}.`), { cls: 'MISSING', source: 'lib/supply', term: 'momentum_12m' });
  const LE = S.landEconomics && S.landEconomics.competitiveBid;
  if (LE && LE.current && LE.current.lots >= 5) { const c = LE.current, ch = LE.change, O = S.landEconomics.outcomes, RT = S.landEconomics.reTenders;
    const chTxt = ch && !ch.small && Number.isFinite(ch.medianPct) ? bi(`; מול 36 החודשים הקודמים: חציון ${iso(pct1(ch.medianPct))}${ch.mixWarning ? ' (תמהיל המגרשים השתנה)' : ''}`, `; vs the prior 36 months: median ${pct1(ch.medianPct)}${ch.mixWarning ? ' (the lot mix changed)' : ''}`) : bi('', '');
    add('land-economics', 'supply', 'derived',
      bi(`כלכלת קרקע (קרקע מדינה, הצעה תחרותית, שוק חופשי): חציון ${fmt(c.median)} ₪ ליח״ד (p25 ${fmt(c.p25)} – p75 ${fmt(c.p75)}) על ${fmt(c.lots)} מגרשים ב-${fmt(c.tenders)} מכרזים שנדונו ב-36 חודשים${chTxt.he}${O && O.tenders ? `; ${Math.round(100 * (O.failedRatio || 0))}% מ-${fmt(O.tenders)} המכרזים שפורסמו בחלון נדונו ללא זוכה / בוטלו` : ''}${RT && RT.tenders ? `; ${fmt(RT.tenders)} שיווקים חוזרים (דרך תיק המגרש)` : ''} — תמורה נומינלית, לא שווי קרקע.`,
        `Land economics (state land, competitive bid, open market): median ₪${fmt(c.median)} per unit (p25 ${fmt(c.p25)} – p75 ${fmt(c.p75)}) over ${fmt(c.lots)} lots in ${fmt(c.tenders)} tenders decided in 36 months${chTxt.en}${O && O.tenders ? `; ${Math.round(100 * (O.failedRatio || 0))}% of the ${fmt(O.tenders)} tenders published in the window were decided without a winner / cancelled` : ''}${RT && RT.tenders ? `; ${fmt(RT.tenders)} re-tenders (through the lot file)` : ''} — nominal consideration, not a land value.`),
      { cls: 'DERIVED', source: 'rmi:michrazim', period: c.period ? `${c.period.from} → ${c.period.to}` : null, term: 'land_cost_quartiles' }); }
  const R = S.renewal && S.renewal.kpis;
  if (R && Number.isFinite(R.complexes)) { const pu = R.proposedUnits && typeof R.proposedUnits === 'object' ? R.proposedUnits : { sum: R.proposedUnits, of: null }; const decl = S.renewal.declaration;
    add('renewal', 'supply', 'fact',
      bi(`התחדשות עירונית: ${fmt(R.complexes)} מתחמים${decl ? ` (${fmt(decl.declared)} מוכרזים)` : ''}, ${fmt(pu.sum)} יח״ד מוצעות כפי שפורסם${pu.of != null ? ` (ב-${fmt(pu.of)} מתחמים עם נתון)` : ''} — הכרזה אינה בנייה, ויח״ד אלה אינן מתווספות ליח״ד המכרזים.`,
        `Urban renewal: ${fmt(R.complexes)} complexes${decl ? ` (${fmt(decl.declared)} declared)` : ''}, ${fmt(pu.sum)} proposed units as published${pu.of != null ? ` (in ${fmt(pu.of)} complexes with a figure)` : ''} — a declaration is not construction, and these units are never added to tender units.`),
      { cls: 'OFFICIAL', source: 'datagov:moch:urban-renewal', period: bi('כפי שפורסם', 'as published'), term: 'renewal_proposed_units' }); }
  const H = S.housing && S.housing.kpis;
  if (H && Number.isFinite(H.lotteries) && H.lotteries > 0) add('lotteries', 'supply', 'fact',
    bi(`דיור מסובסד: ${fmt(H.lotteries)} הגרלות${Number.isFinite(H.unitsFirst) ? `, ${fmt(H.unitsFirst)} דירות בהגרלות ראשונות` : ''}${Number.isFinite(H.applicantsPerUnit) ? `, ${H.applicantsPerUnit.toFixed(0)} מבקשים ליחידה` : ''}${H.byLocalities ? ' (ספירת הגרלות לפי יישוב; דירות ומבקשים אינם מסוכמים)' : ''} — יקום נפרד.`,
      `Subsidized housing: ${fmt(H.lotteries)} ${plural(H.lotteries, 'lottery', 'lotteries')}${Number.isFinite(H.unitsFirst) ? `, ${fmt(H.unitsFirst)} units in first lotteries` : ''}${Number.isFinite(H.applicantsPerUnit) ? `, ${H.applicantsPerUnit.toFixed(0)} applicants per unit` : ''}${H.byLocalities ? ' (lottery counts per locality; units and applicants not summed)' : ''} — a separate universe.`),
    { cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries', period: bi('כל התקופה', 'all periods'), term: 'applicants_per_unit' });

  /* 4 · the radar: opportunities and risks of THIS geography (geography-strict items; the scan's own comparisons) */
  const opps = scan && Array.isArray(scan.opportunities) ? scan.opportunities : null, risks = scan && Array.isArray(scan.risks) ? scan.risks : null;
  const item = (x, lang) => { const s = `${L(x.text, lang)}${x.comparison ? ` [${L(x.comparison, lang)}]` : ''}`; return lang === 'he' ? isoSigns(s) : s; };
  if (opps) add('opportunities', 'radar', opps.length ? 'watch' : 'fact',
    opps.length ? bi(`רדאר הזדמנויות: ${heItems(opps.length)} — ${opps.slice(0, 3).map((x) => item(x, 'he')).join('; ')}${opps.length > 3 ? ` (+${opps.length - 3})` : ''}.`, `Opportunity radar: ${opps.length} ${plural(opps.length, 'item', 'items')} — ${opps.slice(0, 3).map((x) => item(x, 'en')).join('; ')}${opps.length > 3 ? ` (+${opps.length - 3})` : ''}.`)
      : bi('רדאר הזדמנויות: אף כלל לא נדלק בגאוגרפיה הזו.', 'Opportunity radar: no rule fired for this geography.'),
    { cls: oneClass(opps), source: 'lib/radar', period: bi('לפי כל פריט', 'per item'), term: 'opportunity_signal' });
  if (risks) add('risks', 'radar', risks.length ? 'risk' : 'fact',
    risks.length ? bi(`רדאר סיכונים: ${heItems(risks.length)} — ${risks.slice(0, 3).map((x) => item(x, 'he')).join('; ')}${risks.length > 3 ? ` (+${risks.length - 3})` : ''}.`, `Risk radar: ${risks.length} ${plural(risks.length, 'item', 'items')} — ${risks.slice(0, 3).map((x) => item(x, 'en')).join('; ')}${risks.length > 3 ? ` (+${risks.length - 3})` : ''}.`)
      : bi('רדאר סיכונים: אף כלל לא נדלק בגאוגרפיה הזו.', 'Risk radar: no rule fired for this geography.'),
    { cls: oneClass(risks), source: 'lib/radar', period: bi('לפי כל פריט', 'per item'), term: 'risk_signal' });

  /* 5 · developers: observed PROPX activity, exact names */
  const DV = S.developers;
  if (DV && Number.isFinite(DV.total)) {
    const top = DV.top && DV.top[0], tot = DV.lotsHereTotal, share = top ? pctShare(top.lotsHere, tot) : null;
    const ent = DV.entries && Number.isFinite(DV.entries.total) ? DV.entries.total : null;
    add('developers', 'actors', 'fact',
      bi(`יזמים: ${fmt(DV.total)} ישויות עם פעילות שנצפתה כאן (מגרשים שנזכו / פרויקטי הגרלה)${top && top.lotsHere ? ` — הגדולה: ${top.name}, ${fmt(top.lotsHere)} מגרשים${share != null ? ` (${share}% מהמגרשים שנזכו כאן על ידי יזמים רשומים)` : ''}` : ''}${ent != null ? `; ${fmt(ent)} כניסות ראשונות ב-24 חודשים` : ''} — פעילות שנצפתה, לא מאגר קרקעות.`,
        `Developers: ${fmt(DV.total)} entities with observed activity here (lots won / lottery projects)${top && top.lotsHere ? ` — the largest: ${top.name}, ${fmt(top.lotsHere)} lots${share != null ? ` (${share}% of the lots won here by listed developers)` : ''}` : ''}${ent != null ? `; ${fmt(ent)} first entries in 24 months` : ''} — observed activity, not a land bank.`),
      { cls: 'OBSERVED', source: 'lib/entities', period: bi('פעילות שנצפתה', 'observed activity'), term: 'developer_observed_activity' });
  }

  /* 6 · macro context (national — never a local figure) */
  const M = S.macro;
  if (M && (M.boiRate || M.newHomesIndex || M.constructionInputsIndex)) {
    const parts = (lang) => [M.boiRate && Number.isFinite(M.boiRate.value) ? (lang === 'he' ? `ריבית בנק ישראל ${M.boiRate.value}%` : `Bank of Israel rate ${M.boiRate.value}%`) : null,
      M.newHomesIndex && Number.isFinite(M.newHomesIndex.yoy) ? (lang === 'he' ? `מדד דירות חדשות ${iso(pct1(M.newHomesIndex.yoy))} שנתי` : `new-homes index ${pct1(M.newHomesIndex.yoy)} y/y`) : null,
      M.constructionInputsIndex && Number.isFinite(M.constructionInputsIndex.yoy) ? (lang === 'he' ? `תשומות בנייה ${iso(pct1(M.constructionInputsIndex.yoy))} שנתי` : `construction inputs ${pct1(M.constructionInputsIndex.yoy)} y/y`) : null,
      M.districtIndex && Number.isFinite(M.districtIndex.yoy) ? (lang === 'he' ? `מדד מחירי הדירות במחוז ${iso(pct1(M.districtIndex.yoy))} (${M.districtIndex.period || '—'})` : `district dwellings price index ${pct1(M.districtIndex.yoy)} (${M.districtIndex.period || '—'})`) : null].filter(Boolean);
    add('macro', 'context', 'context', bi(`הקשר ארצי: ${parts('he').join(', ')} — הקשר, לא נתון מקומי.`, `National context: ${parts('en').join(', ')} — context, not a local figure.`),
      { cls: 'OFFICIAL', source: 'boi:interest · cbs:price-index', period: M.boiRate && M.boiRate.period ? (typeof M.boiRate.period === 'object' ? `${M.boiRate.period.year}-${String(M.boiRate.period.month).padStart(2, '0')}` : String(M.boiRate.period)) : null, geoScope: lvl === 'il' ? 'own' : 'national', term: 'boi_rate' });
  }

  /* 7 · what changed (the radar feed of the dossier) */
  const C = S.changes;
  if (C && Number.isFinite(C.total)) { const kinds = C.counts && typeof C.counts === 'object' ? Object.entries(C.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') : '';
    add('changes', 'changes', C.total ? 'fact' : 'gap', C.total ? bi(`שינויים: PROPX צפתה ${fmt(C.total)} אירועים ב-${C.window}${kinds ? ` (${kinds})` : ''} — כל אירוע נושא את סיווגו שלו (תיקון רשמי = רשמי).`, `Changes: PROPX observed ${fmt(C.total)} ${plural(C.total, 'event', 'events')} in ${C.window}${kinds ? ` (${kinds})` : ''} — every event keeps its own class (an official revision is OFFICIAL).`) : bi(`שינויים: אין אירועים שנצפו ב-${C.window} — צנרת שקטה או מקור שלא התעדכן.`, `Changes: no observed events in ${C.window} — a quiet pipeline or a source that did not update.`),
      { cls: 'OBSERVED', source: 'lib/radar', period: C.window, term: 'data_revision' }); }

  /* 8 · evidence and gaps */
  const Q = D.quality;
  if (Q) add('evidence', 'evidence', 'derived', bi(`איכות ראיות ${Q.label.he} (${Q.score}/100): ${(Q.items || []).map((i) => i.he).join('; ') || 'ללא ניכויים'} — ניכויים מתועדים, לא הסתברות.`, `Evidence quality ${Q.label.en} (${Q.score}/100): ${(Q.items || []).map((i) => i.en).join('; ') || 'no deductions'} — documented deductions, not a probability.`), { cls: 'DERIVED', source: 'lib/dossier', period: null, term: 'evidence_quality' });
  const miss = (D.missing || []).map((m) => m.id);
  if (miss.length) add('gaps', 'evidence', 'gap', bi(`לא בקריאה הזו: ${(D.missing || []).map((m) => m.he.split(':')[0]).join(' · ')}.`, `Not in this read: ${(D.missing || []).map((m) => m.en.split(':')[0]).join(' · ')}.`), { cls: 'MISSING', source: 'lib/dossier', period: null, term: null });

  /* the lead: position · demand · the radar line that fired (risks first), then everything in order */
  const lead = ['position-land', 'demand'];
  const firstRadar = out.find((s) => s.id === 'risks' && s.kind === 'risk') || out.find((s) => s.id === 'opportunities' && s.kind === 'watch') || out.find((s) => s.id === 'supply-pressure' && s.kind === 'derived');
  if (firstRadar) lead.push(firstRadar.id);
  const counts = { sentences: out.length, opportunities: opps ? opps.length : null, risks: risks ? risks.length : null, gaps: out.filter((s) => s.kind === 'gap').length };
  return { schema: 1, version: VERSION, geo: { level: geo.level, code: geo.code, name: geo.name }, generatedAt: D.generatedAt || null, lead: lead.filter((id) => out.some((s) => s.id === id)), sentences: out, counts, basis: BASIS };
}

/** convenience: the narrative of a geography computed end to end (tests, CLI) */
function forGeo({ level = 'il', code = null, dataDir, now } = {}) {
  const D = DQ.dossier({ level, code, dataDir, now }); if (!D) return null;
  let scan = null, supply = null;
  try { scan = require('../radar/scan').forGeo({ level, code: code || 'il' }, { dataDir }); } catch { /* the scan ships separately */ }
  try { supply = require('../supply/pipeline').supply({ level, code, dataDir, now }); } catch { /* the pipeline ships separately */ }
  return narrative(D, { scan, supply });
}

module.exports = { narrative, forGeo, VERSION, BASIS };
