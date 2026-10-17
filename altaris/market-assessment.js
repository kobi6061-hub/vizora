/* ALTARIS · MARKET & EXECUTION ASSESSMENT (altaris-market-assessment-v1, 18.10.2026)
 *
 *   assess(market, cbs, { today })  →  { version, status, factors, convergence, material, informational, notes, rules, basis }
 *
 * A deterministic assessment layer BESIDE the economics, never inside them. It reads only what the ALTARIS market panel
 * already holds for the deal's locality — the PROPX Market Dossier signals, the Opportunity / Risk radar items, the land
 * economics line, the transaction depth, the developer registry read and the CBS district series — and sorts them into
 * explainable FACTORS, each with: dimension · direction · value · comparison · period · source · class · evidence quality ·
 * geographic scope · freshness · the rule that fired · its impact on the assessment · what would remove it.
 *
 * Status: STRONG · NEUTRAL · CAUTION · INSUFFICIENT.
 *   A factor is MATERIAL only when ALL hold: its direction is positive or negative (a supply count alone is context);
 *   its class is OFFICIAL or OBSERVED (a DERIVED or MODEL figure is informational); its evidence quality is HIGH or
 *   MEDIUM; its geography is the deal's own locality or the locality's district (a national figure is context for a
 *   local deal); the read is fresh (the dossier / scan built within 30 days of today); its materiality is 2 or 3.
 *   CAUTION  = at least two MATERIAL NEGATIVE factors from at least two INDEPENDENT source families (CBS vs ILA vs MoCH
 *              vs the register …). One weak, stale, modelled or national signal never produces CAUTION on its own.
 *   STRONG   = at least two material positive factors from two independent families and no material negative factor.
 *   INSUFFICIENT = no dossier and no radar loaded for the locality (the panel has nothing to assess).
 *   NEUTRAL  = everything else; a single material negative is NOTED, never enough alone.
 * The assessment never recomputes a return, never reads a deal assumption, never changes a number of the engine or of the
 * decision policy. altaris/decision.js combines it with the ECONOMIC verdict through the documented FINAL rules only
 * (POLICY.final): a good market never rescues bad economics; CAUTION turns TAKE into TAKE WITH CONDITIONS with a named
 * market condition and what would remove it. UMD: the page loads /altaris/market-assessment.js; Node tests require it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AltarisMarket = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = Object.freeze({ id: 'altaris-market-assessment-v1', n: 1, effective: '2026-10-18' });
  const bi = (he, en) => ({ he, en });
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const DAY = 86400000;
  const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / DAY) : null);
  const FRESH_DAYS = 30, MIN_INDEPENDENT = 2, MIN_MATERIAL = 2;

  const STATUS = Object.freeze({
    STRONG: { label: bi('חזק', 'STRONG'), d: bi('לפחות שני גורמים חיוביים מהותיים משתי משפחות מקור בלתי תלויות, ללא גורם שלילי מהותי', 'at least two material positive factors from two independent source families and no material negative') },
    NEUTRAL: { label: bi('ניטרלי', 'NEUTRAL'), d: bi('אין התכנסות של גורמים מהותיים; גורם שלילי יחיד נרשם ואינו מספיק לבדו', 'no convergence of material factors; a single material negative is noted and never enough alone') },
    CAUTION: { label: bi('זהירות', 'CAUTION'), d: bi('לפחות שני גורמים שליליים מהותיים משתי משפחות מקור בלתי תלויות', 'at least two material negative factors from two independent source families') },
    INSUFFICIENT: { label: bi('אין הערכה', 'INSUFFICIENT'), d: bi('תיק השוק והרדאר של היישוב לא נטענו — אין מה להעריך', 'the locality\'s dossier and radar were not loaded — nothing to assess') },
  });
  const DIM = Object.freeze({
    DEMAND: bi('ביקוש', 'DEMAND'), SUPPLY: bi('היצע', 'SUPPLY'), LAND_MARKET: bi('שוק הקרקע', 'LAND MARKET'), TRANSACTION_LIQUIDITY: bi('נזילות עסקאות', 'TRANSACTION LIQUIDITY'),
    EXECUTION: bi('ביצוע', 'EXECUTION'), DEVELOPER: bi('יזם / צד נגדי', 'DEVELOPER / COUNTERPARTY'), MACRO: bi('מאקרו', 'MACRO'), DATA_QUALITY: bi('איכות נתונים', 'DATA QUALITY'), RENTAL: bi('הקשר השכרה', 'RENTAL CONTEXT'),
  });
  /* every PROPX signal id the dossier / radar can emit → its dimension, direction, materiality (the scan's constant), geographic scope for a
     LOCALITY deal, and what would remove it (the rule's own threshold — never a deal assumption) */
  const SIGNALS = Object.freeze({
    'sales-momentum-up': { dim: 'DEMAND', dir: 'positive', m: 3, geo: 'district', family: 'cbs' },
    'sales-momentum-down': { dim: 'DEMAND', dir: 'negative', m: 3, geo: 'district', family: 'cbs', remove: bi('מומנטום 3 החודשים של סדרת המחוז חוזר מעל −10% בפרסום למ״ס מאוחר יותר', 'the district series\' 3-month momentum back above −10% in a later CBS release') },
    'demand-with-supply': { dim: 'DEMAND', dir: 'positive', m: 3, geo: 'district', family: 'cbs+rmi' },
    'months-of-supply': { dim: 'SUPPLY', dir: 'negative', m: 3, geo: 'national', family: 'cbs', remove: bi('חודשי ההיצע הארציים מתחת ל-18 בסדרת הלמ״ס', 'national months of supply below 18 in the CBS series') },
    'inventory-plus-pipeline': { dim: 'SUPPLY', dir: 'negative', m: 3, geo: 'national', family: 'cbs+rmi', remove: bi('אחד משני הכללים (חודשי היצע ≥ 18, צנרת שנזכתה ≥ 1,000 יח״ד) נכבה', 'one of the two rules (months of supply ≥ 18, awarded pipeline ≥ 1,000 units) goes off') },
    'open-land': { dim: 'SUPPLY', dir: 'neutral', m: 2, geo: 'own', family: 'rmi' },
    'awarded-pipeline': { dim: 'SUPPLY', dir: 'neutral', m: 2, geo: 'own', family: 'rmi' },
    'pending-decision': { dim: 'SUPPLY', dir: 'neutral', m: 1, geo: 'own', family: 'rmi' },
    'renewal-pipeline': { dim: 'SUPPLY', dir: 'neutral', m: 2, geo: 'own', family: 'moch' },
    'rental-pipeline': { dim: 'RENTAL', dir: 'neutral', m: 1, geo: 'own', family: 'rmi' },
    'failed-tenders': { dim: 'LAND_MARKET', dir: 'negative', m: 3, geo: 'own', family: 'rmi', remove: bi('יחס המכרזים שנדונו ללא זוכה / בוטלו ביישוב יורד מתחת ל-30% (רמ״י, היקף נוכחי, ≥ 5 מכרזים)', 'the locality\'s decided-without-a-winner / cancelled ratio below 30% (ILA, current scope, ≥ 5 tenders)') },
    'developer-concentration': { dim: 'LAND_MARKET', dir: 'negative', m: 2, geo: 'own', family: 'rmi', remove: bi('היזם המוביל מתחת ל-50% מהמגרשים שנזכו ביישוב על ידי יזמים רשומים', 'the top developer below 50% of the lots won in the locality by listed developers') },
    'stale-rental-status': { dim: 'EXECUTION', dir: 'negative', m: 1, geo: 'own', family: 'rmi', remove: bi('סטטוס עדכני מ-36 חודשים למכרזי ההשכרה', 'a rental-tender status newer than 36 months') },
    'no-recent-changes': { dim: 'EXECUTION', dir: 'negative', m: 1, geo: 'own', family: 'propx', remove: bi('אירוע שנצפה ביישוב ב-30 הימים', 'an observed event in the locality within 30 days') },
    'developer-entries': { dim: 'DEVELOPER', dir: 'positive', m: 2, geo: 'own', family: 'propx' },
    'construction-inputs': { dim: 'MACRO', dir: 'negative', m: 2, geo: 'national', family: 'cbs', remove: bi('מדד תשומות הבנייה מתחת ל-+3% שנתי', 'the construction-inputs index below +3% y/y') },
  });
  const FAMILY_OF = (src) => { const s = String(src || '').toLowerCase(); if (/cbs/.test(s) && /rmi|michraz/.test(s)) return 'cbs+rmi'; if (/cbs|boi/.test(s)) return 'cbs'; if (/rmi|michraz/.test(s)) return 'rmi'; if (/moch|datagov/.test(s)) return 'moch'; if (/over|tax|govmap|transactions/.test(s)) return 'register'; if (/dira|renten/.test(s)) return 'dira'; return 'propx'; };
  const familiesOf = (list) => [...new Set(list.flatMap((f) => String(f.family || '').split('+')))].filter(Boolean);
  const T = (v, L) => (v == null ? '' : typeof v === 'object' ? (v[L] != null ? v[L] : v.en) : String(v));

  /** the assessment of one deal's loaded market context (market = deal.market as the page keeps it; cbs = the CBS context of the deal's locality) */
  function assess(market, cbs, opt) {
    opt = opt || {};
    const today = opt.today || null, m = market || null;
    const factors = [], notes = [];
    const dossier = m && m.dossier ? m.dossier : null, radar = m && m.radar ? m.radar : null;
    if (!dossier && !radar) {
      return { version: VERSION, status: 'INSUFFICIENT', statusLabel: STATUS.INSUFFICIENT.label, statusBasis: STATUS.INSUFFICIENT.d, factors, material: { positive: [], negative: [] }, informational: [], convergence: { negative: 0, positive: 0, negativeFamilies: [], positiveFamilies: [] },
        notes: [bi('תיק השוק והרדאר לא נטענו לעסקה — ההערכה אינה זמינה; איכות הראיות של ההחלטה כבר מנכה את היעדר נתוני השוק', 'the dossier and radar were not loaded for the deal — no assessment; the decision\'s evidence quality already deducts the missing market data')], rules: RULES, basis: BASIS };
    }
    const dossierAge = dossier && dossier.generatedAt && today ? daysBetween(String(dossier.generatedAt).slice(0, 10), today) : null;
    const radarAge = radar && radar.builtAt && today ? daysBetween(String(radar.builtAt).slice(0, 10), today) : null;
    const freshDossier = dossierAge == null || dossierAge <= FRESH_DAYS, freshRadar = radarAge == null || radarAge <= FRESH_DAYS;
    const evOf = (x) => (x && x.evidence && x.evidence.level) || (dossier && dossier.quality && dossier.quality.level) || null;
    const seen = new Set();
    const add = (f) => { if (seen.has(f.id)) return; seen.add(f.id); const S = SIGNALS[f.signal] || {}; const dir = f.direction || S.dir || 'neutral';
      const reasons = [];
      if (dir === 'neutral') reasons.push(bi('הקשר — ללא כיוון (ספירה או מידע, לא ראיה מכוּונת)', 'context — no direction (a count or information, not directional evidence)'));
      if (!['OFFICIAL', 'OBSERVED'].includes(f.cls)) reasons.push(bi(`סיווג ${f.cls} — מידע, לא ראיה מהותית`, `class ${f.cls} — informational, not material evidence`));
      if (!['HIGH', 'MEDIUM'].includes(f.evidence)) reasons.push(bi(`איכות ראיות ${f.evidence || '—'}`, `evidence quality ${f.evidence || '—'}`));
      if (!['own', 'district'].includes(f.geoScope)) reasons.push(bi('נתון ארצי — הקשר לעסקה מקומית', 'a national figure — context for a local deal'));
      if (!f.fresh) reasons.push(bi(`קריאה ישנה מ-${FRESH_DAYS} ימים`, `a read older than ${FRESH_DAYS} days`));
      if (!(f.m >= 2)) reasons.push(bi('מהותיות 1 — תחזוקה', 'materiality 1 — housekeeping'));
      const material = reasons.length === 0;
      factors.push({ ...f, direction: dir, material, whyNotMaterial: material ? null : reasons, impact: material ? (dir === 'negative' ? bi('גורם שלילי מהותי — נספר להתכנסות', 'material negative — counts toward convergence') : bi('גורם חיובי מהותי — נספר להתכנסות', 'material positive — counts toward convergence')) : bi('מידע — אינו משנה את ההערכה לבדו', 'informational — does not move the assessment on its own') }); };
    const fromItem = (x, kind) => { const S = SIGNALS[x.signal] || {}; add({ id: 'radar:' + x.signal, signal: x.signal, kind, dimension: S.dim || (kind === 'risk' ? 'EXECUTION' : 'DEMAND'), dimensionLabel: DIM[S.dim || (kind === 'risk' ? 'EXECUTION' : 'DEMAND')], direction: S.dir || (kind === 'risk' ? 'negative' : 'positive'), m: isNum(x.m) ? x.m : (S.m || 1),
      text: x.text, value: x.valueLabel != null ? x.valueLabel : x.value, comparison: x.comparison || null, period: x.period || null, source: x.source || null, family: S.family || FAMILY_OF(x.source), cls: x.cls || null, evidence: evOf(x), evidenceScore: x.evidence ? x.evidence.score : (dossier && dossier.quality ? dossier.quality.score : null), geoScope: S.geo || 'own', fresh: freshRadar, rule: x.threshold || null, remove: S.remove || null, derived: !!x.derived, via: 'radar' }); };
    if (radar) { for (const x of radar.risks || []) fromItem(x, 'risk'); for (const x of radar.opportunities || []) fromItem(x, 'opportunity'); }
    /* dossier signals the radar does not carry at locality level (the district's sales momentum, labelled district) */
    if (dossier) for (const [kind, list] of [['risk', dossier.risk || []], ['watch', dossier.watch || []]]) for (const s of list) { if (seen.has('radar:' + s.id)) continue; const S = SIGNALS[s.id] || {};
      add({ id: 'dossier:' + s.id, signal: s.id, kind: kind === 'risk' ? 'risk' : 'opportunity', dimension: S.dim || 'EXECUTION', dimensionLabel: DIM[S.dim || 'EXECUTION'], direction: S.dir || (kind === 'risk' ? 'negative' : 'positive'), m: S.m || 1, text: s.text, value: s.valueLabel != null ? s.valueLabel : (s.value != null ? s.value : null), comparison: null, period: s.period || null, source: s.source || null, family: S.family || FAMILY_OF(s.source), cls: s.cls || null, evidence: dossier.quality ? dossier.quality.level : null, evidenceScore: dossier.quality ? dossier.quality.score : null, geoScope: S.geo || 'own', fresh: freshDossier, rule: s.threshold || null, remove: S.remove || null, derived: s.cls === 'DERIVED', via: 'dossier' }); }
    /* transaction depth in the locality window (the register republication): OBSERVED, own geography */
    const tx = m && m.tx ? m.tx : null;
    if (tx && isNum(tx.n)) { const n = tx.n, dir = n >= 100 ? 'positive' : n < 10 ? 'negative' : 'neutral';
      add({ id: 'tx:depth', signal: 'tx-depth', kind: dir === 'negative' ? 'risk' : 'opportunity', dimension: 'TRANSACTION_LIQUIDITY', dimensionLabel: DIM.TRANSACTION_LIQUIDITY, direction: dir, m: dir === 'neutral' ? 1 : 2, text: bi(`${n} עסקאות מגורים מתומחרות ביישוב${tx.from && tx.to ? ` (${tx.from} → ${tx.to})` : ''}`, `${n} priced residential deals in the locality${tx.from && tx.to ? ` (${tx.from} → ${tx.to})` : ''}`), value: n, comparison: bi('≥ 100 חיובי · < 10 שלילי', '≥ 100 positive · < 10 negative'), period: tx.from && tx.to ? `${tx.from} → ${tx.to}` : null, source: tx.via || 'over:deals-republication', family: 'register', cls: 'OBSERVED', evidence: n >= 30 ? 'HIGH' : n >= 10 ? 'MEDIUM' : 'LOW', evidenceScore: null, geoScope: 'own', fresh: tx.to && today ? daysBetween(tx.to, today) <= 365 : true, rule: bi('עומק עסקאות: ≥ 100 → חיובי; < 10 → שלילי; אחרת הקשר', 'transaction depth: ≥ 100 → positive; < 10 → negative; else context'), remove: dir === 'negative' ? bi('לפחות 10 עסקאות מתומחרות בחלון היישוב', 'at least 10 priced deals in the locality window') : null, derived: false, via: 'transactions' }); }
    /* land economics: the window comparison is informational (a lot-mix warning may explain it) */
    const le = dossier && dossier.landEconomics ? dossier.landEconomics : null;
    if (le && isNum(le.medianPct)) add({ id: 'land:median-change', signal: 'land-median-change', kind: 'info', dimension: 'LAND_MARKET', dimensionLabel: DIM.LAND_MARKET, direction: 'neutral', m: 1, text: bi(`חציון ₪/יח״ד של קרקע מדינה ${le.medianPct > 0 ? '+' : ''}${le.medianPct}% מול 36 החודשים הקודמים${le.mixWarning ? ' (תמהיל המגרשים השתנה)' : ''}`, `state-land median ₪/unit ${le.medianPct > 0 ? '+' : ''}${le.medianPct}% vs the prior 36 months${le.mixWarning ? ' (the lot mix changed)' : ''}`), value: le.medianPct, comparison: null, period: le.from && le.to ? `${le.from} → ${le.to}` : null, source: 'rmi:michrazim', family: 'rmi', cls: 'DERIVED', evidence: dossier.quality ? dossier.quality.level : null, evidenceScore: null, geoScope: 'own', fresh: freshDossier, rule: bi('הקשר בלבד — תמורה נומינלית, לא שווי קרקע', 'context only — nominal consideration, not a land value'), remove: null, derived: true, via: 'dossier' });
    /* the developer in the PROPX registry: an exact-name miss is informational */
    const dv = m && m.devIntel ? m.devIntel : null;
    if (dv && dv.none) add({ id: 'developer:unlisted', signal: 'developer-unlisted', kind: 'info', dimension: 'DEVELOPER', dimensionLabel: DIM.DEVELOPER, direction: 'neutral', m: 1, text: bi('השם המדויק של היזם אינו ברישום הפעילות של PROPX — פעילות שנצפתה במקורות ציבוריים בלבד', 'the developer\'s exact name is not in the PROPX activity registry — observed public-channel activity only'), value: null, comparison: null, period: null, source: 'lib/entities', family: 'propx', cls: 'MISSING', evidence: null, evidenceScore: null, geoScope: 'own', fresh: true, rule: bi('הקשר — לא שיפוט על היזם', 'context — not a judgement on the developer'), remove: null, derived: false, via: 'registry' });
    /* data quality of the read itself */
    if (dossier && dossier.quality) add({ id: 'data:dossier-quality', signal: 'dossier-quality', kind: 'info', dimension: 'DATA_QUALITY', dimensionLabel: DIM.DATA_QUALITY, direction: 'neutral', m: 1, text: bi(`איכות הראיות של תיק השוק: ${dossier.quality.level} (מדד ${dossier.quality.score}/100)`, `dossier evidence quality: ${dossier.quality.level} (index ${dossier.quality.score}/100)`), value: dossier.quality.score, comparison: null, period: null, source: 'lib/dossier', family: 'propx', cls: 'DERIVED', evidence: dossier.quality.level, evidenceScore: dossier.quality.score, geoScope: 'own', fresh: freshDossier, rule: bi('מדד ראיות — לא הסתברות', 'an evidence index — not a probability'), remove: null, derived: true, via: 'dossier' });

    const material = { positive: factors.filter((f) => f.material && f.direction === 'positive'), negative: factors.filter((f) => f.material && f.direction === 'negative') };
    const informational = factors.filter((f) => !f.material);
    const negativeFamilies = familiesOf(material.negative), positiveFamilies = familiesOf(material.positive);
    let status = 'NEUTRAL';
    if (material.negative.length >= MIN_MATERIAL && negativeFamilies.length >= MIN_INDEPENDENT) status = 'CAUTION';
    else if (material.positive.length >= MIN_MATERIAL && positiveFamilies.length >= MIN_INDEPENDENT && material.negative.length === 0) status = 'STRONG';
    if (status === 'NEUTRAL' && material.negative.length === 1) notes.push(bi(`גורם שלילי מהותי אחד (${T(material.negative[0].text, 'he')}) — נרשם; לבדו אינו משנה את ההערכה`, `one material negative factor (${T(material.negative[0].text, 'en')}) — noted; alone it does not move the assessment`));
    if (status === 'NEUTRAL' && material.negative.length >= 2 && negativeFamilies.length < MIN_INDEPENDENT) notes.push(bi(`${material.negative.length} גורמים שליליים מהותיים ממשפחת מקור אחת (${negativeFamilies.join(', ')}) — ללא עצמאות, אין זהירות`, `${material.negative.length} material negatives from one source family (${negativeFamilies.join(', ')}) — no independence, no caution`));
    if (!freshDossier || !freshRadar) notes.push(bi(`קריאת התיק / הסריקה ישנה מ-${FRESH_DAYS} ימים — גורמיה מידע בלבד`, `the dossier / scan read is older than ${FRESH_DAYS} days — its factors are informational only`));
    return { version: VERSION, status, statusLabel: STATUS[status].label, statusBasis: STATUS[status].d, factors, material, informational, convergence: { negative: material.negative.length, positive: material.positive.length, negativeFamilies, positiveFamilies, minMaterial: MIN_MATERIAL, minIndependent: MIN_INDEPENDENT }, notes, freshness: { dossierGeneratedAt: dossier ? dossier.generatedAt || null : null, radarBuiltAt: radar ? radar.builtAt || null : null, dossierAgeDays: dossierAge, radarAgeDays: radarAge, freshDays: FRESH_DAYS }, rules: RULES, basis: BASIS };
  }

  const RULES = Object.freeze([
    bi('גורם מהותי = כיוון חיובי/שלילי, סיווג רשמי או נצפה, איכות ראיות HIGH/MEDIUM, גאוגרפיה של היישוב או מחוזו, קריאה טרייה (≤ 30 ימים), מהותיות ≥ 2', 'material = a positive / negative direction, class OFFICIAL or OBSERVED, evidence HIGH / MEDIUM, the locality or its district, a read ≤ 30 days old, materiality ≥ 2'),
    bi('זהירות = ≥ 2 גורמים שליליים מהותיים מ-≥ 2 משפחות מקור בלתי תלויות', 'CAUTION = ≥ 2 material negatives from ≥ 2 independent source families'),
    bi('חזק = ≥ 2 גורמים חיוביים מהותיים מ-≥ 2 משפחות וללא שלילי מהותי', 'STRONG = ≥ 2 material positives from ≥ 2 families and no material negative'),
    bi('אין הערכה = תיק ורדאר לא נטענו; ניטרלי = כל השאר; אות חלש / ישן / מודל / ארצי לעולם אינו יוצר זהירות לבדו', 'INSUFFICIENT = no dossier and no radar; NEUTRAL = everything else; a weak / stale / model / national signal never creates CAUTION alone'),
    bi('ההערכה לעולם אינה מחשבת תשואה, אינה קוראת הנחת עסקה ואינה משנה מספר של המנוע או של מדיניות ההחלטה', 'the assessment never computes a return, reads no deal assumption and changes no engine or decision-policy number'),
  ]);
  const BASIS = bi('הערכת שוק וביצוע לצד הכלכלה — לא בתוכה: כל גורם עם ערך · השוואה · תקופה · מקור · סיווג · איכות ראיות · היקף גאוגרפי · רעננות · כלל · השפעה · מה יסיר אותו. מה שלא נטען — "אין הערכה", לעולם לא ניטרלי-חיובי.',
    'A market & execution assessment beside the economics — never inside them: every factor with value · comparison · period · source · class · evidence quality · geographic scope · freshness · rule · impact · what would remove it. What is not loaded is INSUFFICIENT, never neutral-positive.');
  return { VERSION, STATUS, DIM, SIGNALS, assess, RULES, BASIS, FRESH_DAYS, MIN_MATERIAL, MIN_INDEPENDENT };
});
