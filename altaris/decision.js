/* ALTARIS · Investment Decision Engine — the deterministic decision layer.
 *
 * Sits ON TOP of the underwriting engine (altaris/engine.js) and never inside it:
 *   - it consumes the engine's results (run(...): facts, strategies, hurdles, risk,
 *     stresses, solvers) and PROPX context the page already loaded (read-only);
 *   - it never recalculates IRR, MOIC, capital at risk, coverage or any other metric —
 *     every figure it judges is read through the engine's own accessors
 *     (irrOf / moicOf / capOf) exactly as the page shows it;
 *   - every rule is a documented constant in POLICY; the verdict is a pure function of
 *     the engine output and the context — no randomness, no model, no language model.
 *
 * Output (decide): verdict (TAKE · TAKE_WITH_CONDITIONS · PASS · INSUFFICIENT_EVIDENCE),
 * INVESTMENT ATTRACTIVENESS 0–100 with its descriptor, EVIDENCE QUALITY (HIGH / MEDIUM / LOW —
 * the quality of the information, never a probability), the recommended and second-best
 * structure with the comparison that decides it, every gate with pass / near-miss / fail,
 * the factor groups with every sub-score and its reason, strengths, risks, the conditions
 * to proceed (model-supported facts only), the source / assumption breakdown, source
 * conflicts, freshness, and a deterministic narrative in Hebrew and English.
 *
 * flips(...) (separate, on demand — it re-runs the underwriting engine on a modified copy
 * of the deal) finds the input changes that move the verdict: PASS if the price exceeds X,
 * TAKE if the collateral is verified above Y, and so on.
 *
 * Pure: no DOM, no storage, no network, no randomness. Loaded by the page
 * (window.AltarisDecision) and by Node tests (require('./altaris/decision.js')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.AltarisDecision = factory(root.AltarisEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const VERSION = Object.freeze({
    id: 'altaris-investment-decision-v1',
    n: 1,
    label: { he: 'מתודולוגיית החלטת השקעה ALTARIS · גרסה 1', en: 'ALTARIS Investment Decision Methodology v1' },
    effective: '2026-10-16',
    engine: { version: E.VERSION },
    metricMethodology: 'altaris-metric-methodology-v2',
  });

  /* ------------------------------------------------------------------ policy */
  /* Every threshold the verdict depends on. Percent-like values are fractions. */
  const POLICY = Object.freeze({
    /* attractiveness → descriptor */
    descriptor: Object.freeze([[80, 'VERY_ATTRACTIVE'], [65, 'ATTRACTIVE'], [50, 'MARGINAL'], [0, 'WEAK']]),
    takeMin: 65,              // TAKE needs attractiveness ≥ 65 (and no open gate, acceptable downside, evidence ≥ MEDIUM)
    conditionsMin: 50,        // TAKE WITH CONDITIONS needs attractiveness ≥ 50
    downsideMin: 45,          // TAKE needs the downside-protection group ≥ 45
    /* evidence quality score → level */
    evidence: Object.freeze({ high: 70, medium: 45, insufficient: 25 }),
    /* a hurdle missed by less than this (relative to its threshold) is a NEAR MISS: a condition, not a PASS */
    nearMiss: 0.2,
    /* hurdles whose clear failure is critical (→ PASS); the rest are conditions */
    critical: Object.freeze(['irr', 'moic', 'coverage', 'ltv', 'devExposure', 'projectExposure', 'geoExposure']),
    /* downside recovery: capital lost in the downside scenario as a share of capital at risk */
    maxDownsideLoss: 0.5, nearDownsideLoss: 0.65,
    /* two independent value sources further apart than this are a SOURCE CONFLICT */
    conflictSpread: 0.15,
    /* a PROPX market read older than this is stale evidence; a transaction window ending before this is old */
    staleCheckDays: 90, oldObservationDays: 365,
    /* factor-group weights in the attractiveness score (a group without data is left out — never substituted) */
    weights: Object.freeze({ returns: 30, downside: 30, structure: 15, execution: 15, market: 10 }),
    /* FINAL DECISION (18.10.2026): the economic verdict combined with the Market & Execution Assessment (altaris/market-assessment.js,
       passed in as ctx.marketAssessment) through these rules only — nothing hidden, no upgrade ever:
       F0 no assessment / INSUFFICIENT → the economic verdict stands (the evidence quality already deducts missing market data)
       F1 economic INSUFFICIENT EVIDENCE → INSUFFICIENT EVIDENCE (the market cannot supply the missing underwriting evidence)
       F2 economic PASS → PASS (a good market never rescues bad economics)
       F3 economic TAKE + assessment CAUTION → TAKE WITH CONDITIONS, with a named market condition and what would remove it
       F4 economic TAKE WITH CONDITIONS + CAUTION → TAKE WITH CONDITIONS, the market condition added beside the economic ones
       F5 assessment STRONG or NEUTRAL → the economic verdict stands (never an upgrade, never a downgrade) */
    final: Object.freeze({ cautionDowngrades: ['TAKE'], cautionAddsCondition: ['TAKE', 'TAKE_WITH_CONDITIONS'], neverUpgrades: true, requires: { materialNegatives: 2, independentFamilies: 2 } }),
  });

  /* ----------------------------------------------------------------- helpers */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const n0 = (x) => (isNum(+x) ? +x : 0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lin = (x, pts) => (isNum(x) ? E.interp(x, pts) : null);
  const round = (x) => Math.round(x);
  const pct = (x, d = 1) => (isNum(x) ? (x * 100).toFixed(d) + '%' : '—');
  const nisM = E.fmt.nisM, mult = E.fmt.mult;
  const months = (m, L) => (isNum(m) ? `${m} ${L === 'en' ? 'mo' : 'ח׳'}` : '—');
  const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—');
  const daysBetween = (a, b) => (!a || !b ? null : (Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);
  const bi = (he, en) => ({ he, en });
  const T = (v, L) => (v && typeof v === 'object' && ('he' in v || 'en' in v) ? (v[L === 'en' ? 'en' : 'he'] ?? v.he ?? v.en ?? '') : v == null ? '' : String(v));
  const SN = { buy: 'BUY', finance: 'FINANCE', hybrid: 'HYBRID' };
  const STRATS = E.STRATS;

  /* weighted mean over the parts that have a score; a missing part is excluded, never assumed */
  function group(id, label, parts, weight) {
    const avail = parts.filter((p) => isNum(p.score));
    const tw = avail.reduce((s, p) => s + p.w, 0);
    const score = tw > 0 ? round(avail.reduce((s, p) => s + p.w * p.score, 0) / tw) : null;
    return { id, label, score, weight, parts: parts.map((p) => ({ k: p.k, label: p.label, score: isNum(p.score) ? round(p.score) : null, w: p.w, value: p.value, why: p.why })), missing: parts.filter((p) => !isNum(p.score)).map((p) => p.k) };
  }

  const VERDICT = Object.freeze({
    TAKE: { code: 'TAKE', label: bi('לקחת', 'TAKE'), rank: 3, tone: 'take' },
    TAKE_WITH_CONDITIONS: { code: 'TAKE_WITH_CONDITIONS', label: bi('לקחת בכפוף לתנאים', 'TAKE WITH CONDITIONS'), rank: 2, tone: 'cond' },
    PASS: { code: 'PASS', label: bi('לא לקחת', 'PASS'), rank: 1, tone: 'pass' },
    INSUFFICIENT_EVIDENCE: { code: 'INSUFFICIENT_EVIDENCE', label: bi('אין מספיק מידע להחלטה', 'INSUFFICIENT EVIDENCE'), rank: 0, tone: 'none' },
  });
  const DESCRIPTOR = Object.freeze({
    VERY_ATTRACTIVE: bi('אטרקטיבית מאוד', 'VERY ATTRACTIVE'), ATTRACTIVE: bi('אטרקטיבית', 'ATTRACTIVE'), MARGINAL: bi('שולית', 'MARGINAL'), WEAK: bi('חלשה', 'WEAK'),
  });
  const EVIDENCE = Object.freeze({ HIGH: bi('גבוהה', 'HIGH'), MEDIUM: bi('בינונית', 'MEDIUM'), LOW: bi('נמוכה', 'LOW') });
  const GATE_LABEL = {
    irr: bi('IRR מינימלי', 'minimum IRR'), moic: bi('MOIC מינימלי', 'minimum MOIC'), discount: bi('הנחת כניסה מינימלית', 'minimum entry discount'),
    ltv: bi('LTV מקסימלי', 'maximum LTV'), coverage: bi('כיסוי בטוחות מינימלי', 'minimum collateral coverage'), duration: bi('משך מקסימלי', 'maximum duration'),
    mos: bi('מרווח ביטחון מינימלי', 'minimum margin of safety'), devExposure: bi('חשיפה ליזם', 'developer exposure'), projectExposure: bi('חשיפה לפרויקט', 'project exposure'),
    geoExposure: bi('חשיפה גיאוגרפית', 'geographic exposure'), downsideLoss: bi('הפסד הון מקסימלי בתרחיש השלילי', 'maximum downside capital loss'),
    supportedValue: bi('ראיה לשווי נתמך', 'supported-value evidence'),
  };
  const GROUP_LABEL = {
    returns: bi('איכות התשואה', 'RETURN QUALITY'), downside: bi('הגנה בתרחיש השלילי', 'DOWNSIDE PROTECTION'), structure: bi('איכות המבנה', 'STRUCTURE QUALITY'),
    execution: bi('סיכון ביצוע', 'EXECUTION RISK'), market: bi('איכות השוק', 'MARKET QUALITY'), evidence: bi('איכות הראיות', 'EVIDENCE QUALITY'),
  };
  const fmtV = (fmt, v, L) => (!isNum(v) ? '—' : fmt === 'pct' ? pct(v) : fmt === 'x' ? mult(v) : fmt === 'months' ? months(v, L) : fmt === 'nis' ? nisM(v) : String(v));

  /* ----------------------------------------------------------- the gates */
  function gatesOf(k, s, F, set) {
    const b = s.base, d = s.downside && s.downside.ok ? s.downside : null, cap = E.capOf(b);
    const G = [];
    const add = (id, status, critical, value, limit, fmt, kind, why) => G.push({ id, label: GATE_LABEL[id], status, critical: !!critical, value, limit, fmt, kind: kind || 'economic', why });
    const nearOf = (h) => {
      if (h.pass || !isNum(h.value) || !isNum(h.limit)) return false;
      const lowerIsBetter = h.k === 'ltv' || h.k === 'duration' || /Exposure$/.test(h.k);
      return lowerIsBetter ? h.value <= h.limit * (1 + POLICY.nearMiss) : h.value >= h.limit * (1 - POLICY.nearMiss);
    };
    for (const h of s.hurdles) {
      const near = nearOf(h), status = h.pass ? 'pass' : near ? 'near' : 'fail';
      const crit = POLICY.critical.includes(h.k) && status === 'fail';
      add(h.k, status, crit, h.value, h.limit, h.fmt, 'economic',
        bi(`${fmtV(h.fmt, h.value, 'he')} מול סף הקרן ${fmtV(h.fmt, h.limit, 'he')}${near ? ' — החמצה קלה (עד 20% מהסף)' : ''}`,
          `${fmtV(h.fmt, h.value, 'en')} vs the fund threshold ${fmtV(h.fmt, h.limit, 'en')}${near ? ' — a near miss (within 20% of the threshold)' : ''}`));
    }
    /* downside recovery: how much of the capital at risk is lost in the downside scenario */
    if (d && cap > 0) {
      const loss = k === 'buy' ? Math.max(0, -d.profit) : d.recovery ? n0(d.recovery.principalLoss) : Math.max(0, -d.profit);
      const ratio = loss / cap;
      const status = ratio <= POLICY.maxDownsideLoss ? 'pass' : ratio <= POLICY.nearDownsideLoss ? 'near' : 'fail';
      add('downsideLoss', status, status === 'fail', ratio, POLICY.maxDownsideLoss, 'pct', 'economic',
        bi(`${k === 'buy' ? 'הפסד' : 'פגיעה בקרן'} של ${nisM(loss)} בתרחיש השלילי = ${pct(ratio, 0)} מההון בסיכון (תקרה ${pct(POLICY.maxDownsideLoss, 0)})`,
          `${k === 'buy' ? 'a loss' : 'principal impairment'} of ${nisM(loss)} in the downside = ${pct(ratio, 0)} of capital at risk (cap ${pct(POLICY.maxDownsideLoss, 0)})`));
    }
    /* evidence gate: an underwriting value that is not the developer's own price */
    const ev = F.smv > 0 && F.chosen && F.chosen !== 'developer';
    add('supportedValue', ev ? 'pass' : 'fail', !ev, null, null, null, 'evidence',
      ev ? bi(`שווי לחיתום נבחר במפורש (${F.chosen})`, `an underwriting value was chosen explicitly (${F.chosen})`)
        : F.chosen === 'developer' ? bi('מחיר המחירון של היזם נבחר כשווי — אינו שווי נתמך בלתי תלוי', 'the developer\'s list price is the chosen value — not an independent supported value')
          : bi('לא נבחר שווי לחיתום', 'no underwriting value was chosen'));
    return G;
  }

  /* ---------------------------------------------------- factor groups */
  function returnsOf(k, s, set) {
    const b = s.base, d = s.downside && s.downside.ok ? s.downside : null;
    const irr = E.irrOf(b), dIrr = d ? E.irrOf(d) : null, moic = E.moicOf(b), cap = E.capOf(b);
    const minIrr = set.minIrr / 100, minMoic = set.minMoic;
    const ratio = isNum(irr) && minIrr > 0 ? irr / minIrr : null;
    const roi = cap > 0 ? b.profit / cap : null;
    const turns = s.velocity ? s.velocity.turnsPerYear : null;
    return group('returns', GROUP_LABEL.returns, [
      { k: 'irr', label: bi('IRR בסיס מול רף הקרן', 'base IRR vs the fund hurdle'), w: 35, value: irr, score: isNum(irr) && irr < 0 ? 0 : lin(ratio, [[0, 0], [0.5, 25], [1, 60], [1.5, 85], [2, 100]]),
        why: bi(`IRR ${pct(irr)} = ${isNum(ratio) ? ratio.toFixed(2) : '—'}× הרף ${pct(minIrr, 0)} (0×→0 · 0.5×→25 · 1×→60 · 1.5×→85 · 2×→100)`, `IRR ${pct(irr)} = ${isNum(ratio) ? ratio.toFixed(2) : '—'}× the ${pct(minIrr, 0)} hurdle (0×→0 · 0.5×→25 · 1×→60 · 1.5×→85 · 2×→100)`) },
      { k: 'downsideIrr', label: bi('IRR בתרחיש השלילי', 'downside IRR'), w: 25, value: dIrr, score: lin(dIrr, [[-0.5, 0], [-0.2, 15], [0, 45], [0.08, 70], [0.15, 90], [0.25, 100]]),
        why: bi(`IRR שלילי ${pct(dIrr)} (−50%→0 · −20%→15 · 0%→45 · 8%→70 · 15%→90 · 25%+→100)`, `downside IRR ${pct(dIrr)} (−50%→0 · −20%→15 · 0%→45 · 8%→70 · 15%→90 · 25%+→100)`) },
      { k: 'moic', label: bi('MOIC', 'MOIC'), w: 15, value: moic, score: lin(moic, [[1, 10], [minMoic, 55], [Math.max(minMoic + 0.2, 1.3), 80], [Math.max(minMoic + 0.5, 1.6), 100]]),
        why: bi(`MOIC ${mult(moic)} (1.0x→10 · רף ${mult(minMoic)}→55 · +0.2→80 · +0.5→100)`, `MOIC ${mult(moic)} (1.0x→10 · hurdle ${mult(minMoic)}→55 · +0.2→80 · +0.5→100)`) },
      { k: 'roi', label: bi('רווח מוחלט ביחס להון בסיכון', 'absolute profit on capital at risk'), w: 10, value: roi, score: lin(roi, [[0, 0], [0.05, 40], [0.15, 75], [0.3, 100]]),
        why: bi(`רווח ${nisM(b.profit)} ÷ הון בסיכון ${nisM(cap)} = ${pct(roi)} (0→0 · 5%→40 · 15%→75 · 30%+→100)`, `profit ${nisM(b.profit)} ÷ capital at risk ${nisM(cap)} = ${pct(roi)} (0→0 · 5%→40 · 15%→75 · 30%+→100)`) },
      { k: 'velocity', label: bi('מהירות הון (סבבים בשנה)', 'capital velocity (turns per year)'), w: 15, value: turns, score: lin(turns, [[0.25, 20], [0.5, 50], [1, 80], [2, 100]]),
        why: bi(`${isNum(turns) ? turns.toFixed(2) : '—'} סבבים בשנה · משך ${b.months} חודשים (0.25→20 · 0.5→50 · 1→80 · 2+→100)`, `${isNum(turns) ? turns.toFixed(2) : '—'} turns a year · ${b.months} months (0.25→20 · 0.5→50 · 1→80 · 2+→100)`) },
    ], POLICY.weights.returns);
  }
  function downsideOf(k, s, set) {
    const b = s.base, d = s.downside && s.downside.ok ? s.downside : null, cap = E.capOf(b);
    const mos = s.mos, minMos = set.minMos / 100;
    const cov = k === 'buy' ? b.valueToBasis : b.coverage;
    const covScore = k === 'buy' ? lin(cov, E.TABLES.VALUE_BASIS) : lin(cov, E.TABLES.COVERAGE);
    const lossRatio = d && cap > 0 ? Math.max(0, -d.profit) / cap : null;
    const dScore = d ? (d.profit >= 0 ? 100 : lin(lossRatio, [[0, 70], [0.1, 45], [0.25, 20], [0.5, 0]])) : null;
    const survive = ['v5', 'v10', 'v15', 'v20'].filter((id) => s.stress && s.stress[id] && s.stress[id].ok && s.stress[id].profit >= 0).length;
    const rec = d && d.recovery ? d.recovery.rate : null;
    return group('downside', GROUP_LABEL.downside, [
      { k: 'mos', label: bi('מרווח ביטחון', 'margin of safety'), w: 30, value: mos, score: lin(mos, [[0, 0], [minMos, 55], [Math.max(minMos + 0.1, 0.2), 80], [Math.max(minMos + 0.25, 0.35), 100]]),
        why: bi(`ירידת שווי מקסימלית לפני הפסד / פגיעה בקרן ${pct(mos)} (0→0 · רף ${pct(minMos, 0)}→55 · +10pp→80 · +25pp→100)`, `maximum value decline before a loss / impairment ${pct(mos)} (0→0 · hurdle ${pct(minMos, 0)}→55 · +10pp→80 · +25pp→100)`) },
      { k: 'coverage', label: k === 'buy' ? bi('שווי נתמך ÷ בסיס כולל', 'supported value ÷ all-in basis') : bi('כיסוי בטוחות שמרני', 'conservative collateral coverage'), w: 25, value: cov, score: covScore,
        why: k === 'buy' ? bi(`${mult(cov)} (1.0x→30 · 1.15x→60 · 1.3x→80 · 1.5x+→95)`, `${mult(cov)} (1.0x→30 · 1.15x→60 · 1.3x→80 · 1.5x+→95)`) : bi(`${mult(cov)} (0.8x→10 · 1.0x→40 · 1.25x→65 · 1.5x→85 · 2x+→95)`, `${mult(cov)} (0.8x→10 · 1.0x→40 · 1.25x→65 · 1.5x→85 · 2x+→95)`) },
      { k: 'downsideProfit', label: bi('תוצאה בתרחיש השלילי', 'downside result'), w: 20, value: d ? d.profit : null, score: dScore,
        why: d ? bi(d.profit >= 0 ? `רווחי גם בתרחיש השלילי (${nisM(d.profit)}) → 100` : `הפסד ${nisM(-d.profit)} = ${pct(lossRatio, 0)} מההון בסיכון (0→70 · 10%→45 · 25%→20 · 50%+→0)`, d.profit >= 0 ? `profitable in the downside (${nisM(d.profit)}) → 100` : `loss ${nisM(-d.profit)} = ${pct(lossRatio, 0)} of capital at risk (0→70 · 10%→45 · 25%→20 · 50%+→0)`) : bi('תרחיש שלילי לא חושב', 'no downside scenario') },
      k === 'buy' || !isNum(rec)
        ? { k: 'stress', label: bi('עמידות במבחני לחץ על השווי', 'value-stress survivability'), w: 25, value: survive, score: survive * 25, why: bi(`רווחי ב-${survive} מתוך 4 מבחני ירידת שווי (−5% · −10% · −15% · −20%) × 25`, `profitable in ${survive} of 4 value stresses (−5% · −10% · −15% · −20%) × 25`) }
        : { k: 'recovery', label: bi('גבייה במימוש בטוחות', 'recovery on enforcement'), w: 25, value: rec, score: lin(rec, [[0.5, 0], [0.8, 40], [0.95, 80], [1, 100]]), why: bi(`${pct(rec, 0)} מהתביעה נגבה בתרחיש המימוש (50%→0 · 80%→40 · 95%→80 · 100%→100)`, `${pct(rec, 0)} of the claim recovered in the enforcement case (50%→0 · 80%→40 · 95%→80 · 100%→100)`) },
    ], POLICY.weights.downside);
  }
  function structureOf(k, s, F) {
    const b = s.base, cap = E.capOf(b), comp = (id) => (s.risk ? s.risk.components.find((c) => c.k === id) : null);
    const prot = comp('protection'), entry = comp('entry');
    const dep = b.finalShare, ltv = b.ltv, eff = F.smv > 0 && cap > 0 ? cap / F.smv : null;
    const inp = s.inputs || {};
    const exposures = k === 'hybrid' ? [inp.backstopOn ? bi('התחייבות גיבוי (backstop) פעילה', 'a backstop commitment is on') : null, inp.optionOn ? bi('אופציית רכישה פעילה', 'a purchase option is on') : null].filter(Boolean) : [];
    return group('structure', GROUP_LABEL.structure, [
      { k: 'protection', label: bi('הגנה מבנית (רכיב ציון הסיכון)', 'structural protection (risk-score component)'), w: 30, value: prot ? prot.score : null, score: prot ? prot.score : null, why: prot ? bi(prot.why, prot.why) : null },
      { k: 'entry', label: bi('נקודת הכניסה (רכיב ציון הסיכון)', 'entry point (risk-score component)'), w: 20, value: entry ? entry.score : null, score: entry ? entry.score : null, why: entry ? bi(entry.why, entry.why) : null },
      { k: 'exitDependency', label: bi('תלות באירוע יציאה אחד', 'dependence on a single exit event'), w: 20, value: dep, score: lin(dep, [[0.5, 100], [0.85, 60], [1, 30]]),
        why: bi(`${pct(dep, 0)} מהתקבולים מגיעים במועד אחד (≤50%→100 · 85%→60 · 100%→30)`, `${pct(dep, 0)} of the proceeds arrive on one date (≤50%→100 · 85%→60 · 100%→30)`) },
      { k: 'leverage', label: bi('מינוף', 'leverage'), w: 15, value: ltv, score: k === 'buy' ? lin(ltv, [[0, 100], [0.5, 70], [0.7, 45], [0.85, 15]]) : lin(ltv, [[0.4, 100], [0.6, 70], [0.7, 50], [0.85, 15]]),
        why: k === 'buy' ? bi(`חוב ÷ מחיר ${pct(ltv, 0)} (0→100 · 50%→70 · 70%→45 · 85%+→15)`, `debt ÷ price ${pct(ltv, 0)} (0→100 · 50%→70 · 70%→45 · 85%+→15)`) : bi(`LTV כולל שעבודים קודמים ${pct(ltv, 0)} (≤40%→100 · 60%→70 · 70%→50 · 85%+→15)`, `LTV incl. prior liens ${pct(ltv, 0)} (≤40%→100 · 60%→70 · 70%→50 · 85%+→15)`) },
      { k: 'efficiency', label: bi('יעילות הון (הון בסיכון ÷ שווי נתמך)', 'capital efficiency (capital at risk ÷ supported value)'), w: 15, value: eff, score: lin(eff, [[0.2, 100], [0.5, 70], [0.8, 40], [1.1, 10]]),
        why: bi(`${nisM(cap)} ÷ ${nisM(F.smv)} = ${pct(eff, 0)} (≤20%→100 · 50%→70 · 80%→40 · 110%+→10)${exposures.length ? ' · ' + exposures.map((x) => x.he).join(' · ') : ''}`, `${nisM(cap)} ÷ ${nisM(F.smv)} = ${pct(eff, 0)} (≤20%→100 · 50%→70 · 80%→40 · 110%+→10)${exposures.length ? ' · ' + exposures.map((x) => x.en).join(' · ') : ''}`) },
    ], POLICY.weights.structure);
  }
  function executionOf(k, s, F) {
    const comp = (id) => (s.risk ? s.risk.components.find((c) => c.k === id) : null);
    const inp = s.inputs || {};
    const src = k === 'buy' ? [inp.exitPrimary, inp.exitSecondary] : [inp.sourcePrimary, inp.sourceSecondary];
    const refi = /refinanc/.test(String(src[0] || ''));
    let depScore = 70; const why = [];
    if (refi) { depScore -= 20; why.push(bi('מקור הפירעון העיקרי הוא מחזור — תלות בשוק האשראי', 'the primary repayment source is a refinancing — credit-market dependence')); }
    if (!src[1] || src[1] === src[0]) { depScore -= 15; why.push(bi('אין מקור פירעון / יציאה משני שונה', 'no distinct secondary repayment / exit source')); }
    else why.push(bi('שני מקורות יציאה שונים', 'two distinct exit sources'));
    if (/sales/.test(String(src[0] || ''))) { depScore += 10; why.push(bi('תלות במכירות — תלוי בקצב הספיגה', 'sales dependence — absorption pace matters')); }
    const c = (id, w, label) => { const x = comp(id); return { k: id, label, w, value: x ? x.score : null, score: x ? x.score : null, why: x ? bi(x.why, x.why) : null }; };
    return group('execution', GROUP_LABEL.execution, [
      c('project', 30, bi('סטטוס הפרויקט (רכיב ציון הסיכון)', 'project status (risk-score component)')),
      c('developer', 25, bi('היזם (רכיב ציון הסיכון)', 'developer (risk-score component)')),
      c('duration', 20, bi('משך (רכיב ציון הסיכון)', 'duration (risk-score component)')),
      c('liquidity', 15, bi('נזילות יציאה (רכיב ציון הסיכון)', 'exit liquidity (risk-score component)')),
      { k: 'dependency', label: bi('תלות במחזור / במכירות', 'refinancing / sales dependency'), w: 10, value: src[0] || null, score: clamp(depScore, 0, 100), why: bi(why.map((x) => x.he).join(' · '), why.map((x) => x.en).join(' · ')) },
    ], POLICY.weights.execution);
  }
  /* PROPX market context — only where the page loaded it; every part names its geography and period */
  function marketOf(ctx) {
    const m = ctx.market || null, cbs = ctx.cbs || null;
    if (!m && !cbs) return group('market', GROUP_LABEL.market, [], POLICY.weights.market);
    const parts = [];
    if (m) {
      const tx = m.tx;
      parts.push({ k: 'transactions', label: bi('ראיות עסקאות ביישוב', 'transaction evidence in the locality'), w: 40, value: tx ? tx.n : null, score: tx ? lin(tx.n, [[0, 0], [30, 50], [100, 80], [200, 100]]) : null,
        why: tx ? bi(`${tx.n} עסקאות מגורים מתומחרות · ${dmy(tx.from)}–${dmy(tx.to)} · ${tx.via || 'רשות המסים'} · נצפה (0→0 · 30→50 · 100→80 · 200+→100)`, `${tx.n} priced residential deals · ${dmy(tx.from)}–${dmy(tx.to)} · ${tx.via || 'Tax Authority'} · OBSERVED (0→0 · 30→50 · 100→80 · 200+→100)`) : bi('עסקאות לא נטענו', 'deals not loaded') });
      const D = m.devIntel;
      parts.push({ k: 'developer', label: bi('היזם ברישום הפעילות של PROPX', 'the developer in the PROPX activity registry'), w: 25, value: D ? (D.none ? 0 : n0(D.lots) + n0(D.projects)) : null,
        score: D ? (D.none ? 35 : lin(n0(D.lots) + n0(D.projects), [[1, 55], [3, 70], [8, 85], [20, 100]])) : null,
        why: D ? (D.none ? bi('השם המדויק לא נמצא ברישום — פעילות שנצפתה במקורות PROPX בלבד → 35', 'the exact name is not in the registry — observed PROPX activity only → 35') : bi(`${n0(D.lots)} מגרשים שנזכו · ${n0(D.projects)} פרויקטי הגרלה · ${n0(D.cities)} ערים · נצפה (1→55 · 3→70 · 8→85 · 20+→100)`, `${n0(D.lots)} lots won · ${n0(D.projects)} lottery projects · ${n0(D.cities)} cities · OBSERVED (1→55 · 3→70 · 8→85 · 20+→100)`)) : bi('לא נבדק (אין שם יזם או לא נטען)', 'not checked (no developer name or not loaded)') });
    }
    if (cbs && cbs.ok) {
      parts.push({ k: 'salesMomentum', label: bi(`מומנטום מכירות דירות חדשות · ${cbs.scope.he}`, `new-home sales momentum · ${cbs.scope.en}`), w: 35, value: cbs.momentum, score: cbs.small ? null : lin(cbs.momentum, [[-30, 10], [-10, 40], [0, 55], [10, 75], [30, 100]]),
        why: cbs.small ? bi('מדגם קטן — ללא אות מגמה', 'small sample — no trend signal') : bi(`מומנטום 3 חודשים ${isNum(cbs.momentum) ? (cbs.momentum > 0 ? '+' : '') + cbs.momentum.toFixed(1) + '%' : '—'} · למ״ס · רשמי · עד ${cbs.latest} · ${cbs.freshness} (−30%→10 · −10%→40 · 0→55 · +10%→75 · +30%→100)`, `3-month momentum ${isNum(cbs.momentum) ? (cbs.momentum > 0 ? '+' : '') + cbs.momentum.toFixed(1) + '%' : '—'} · CBS · OFFICIAL · through ${cbs.latest} · ${cbs.freshness} (−30%→10 · −10%→40 · 0→55 · +10%→75 · +30%→100)`) });
    }
    return group('market', GROUP_LABEL.market, parts, POLICY.weights.market);
  }

  /* ------------------------------------------------------ evidence quality */
  function evidenceOf(k, s, R, ctx) {
    const F = R.facts, today = ctx.today || null;
    const items = []; let score = 100;
    const hit = (id, delta, cls, text) => { score += delta; items.push({ id, delta, cls, text }); };
    /* 1 the underwriting value */
    const VAL_PEN = { appraisal: 0, propx: -5, comparables: -5, units: -10, ppsqm: -15, manual: -25, developer: -35 };
    if (!F.chosen) hit('value', -40, 'MISSING', bi('לא נבחר שווי לחיתום', 'no underwriting value chosen'));
    else hit('value', VAL_PEN[F.chosen] ?? -15, F.chosen === 'manual' ? 'USER_OVERRIDE' : F.chosen === 'propx' || F.chosen === 'comparables' ? 'DERIVED' : F.chosen === 'appraisal' ? 'OBSERVED' : 'USER_ASSUMPTION',
      bi(`שווי לחיתום: ${F.chosen} (${VAL_PEN[F.chosen] ?? -15})`, `underwriting value: ${F.chosen} (${VAL_PEN[F.chosen] ?? -15})`));
    if (!(F.sources.appraisal > 0)) hit('appraisal', -10, 'MISSING', bi('לא הוזנה שומה בלתי תלויה (−10)', 'no independent appraisal entered (−10)'));
    const conflict = isNum(F.spread) && F.spread > POLICY.conflictSpread;
    if (conflict) hit('spread', F.spread > 0.3 ? -20 : -10, 'CONFLICT', bi(`פער של ${pct(F.spread, 0)} בין מקורות השווי הבלתי תלויים (${F.spread > 0.3 ? -20 : -10})`, `a ${pct(F.spread, 0)} spread between the independent value sources (${F.spread > 0.3 ? -20 : -10})`));
    /* 2 the deal's own facts */
    if (!F.status) hit('status', -10, 'MISSING', bi('סטטוס בנייה לא הוזן (−10)', 'construction status not entered (−10)'));
    if (F.developerRating === 'unassessed') hit('developer', -8, 'MISSING', bi('היזם טרם הוערך (−8)', 'developer not assessed (−8)'));
    const matDef = (s.defaulted || []).filter((d) => MATERIAL_INPUTS[k].includes(d));
    if (matDef.length) hit('defaults', -Math.min(20, 2 * matDef.length), 'USER_ASSUMPTION', bi(`${matDef.length} הנחות מהותיות של ${SN[k]} בברירת מחדל שטרם נבחנה: ${matDef.join(', ')} (−${Math.min(20, 2 * matDef.length)})`, `${matDef.length} material ${SN[k]} inputs still on an unreviewed default: ${matDef.join(', ')} (−${Math.min(20, 2 * matDef.length)})`));
    /* 3 PROPX market evidence and its freshness */
    const m = ctx.market;
    if (!m) hit('market', -10, 'MISSING', bi('נתוני השוק של PROPX לא נטענו לעסקה (−10)', 'PROPX market data not loaded for this deal (−10)'));
    else {
      const tx = m.tx;
      if (!tx || !(tx.n > 0)) hit('tx', -8, 'MISSING', bi('אין עסקאות מתומחרות ביישוב (−8)', 'no priced deals in the locality (−8)'));
      else if (tx.n < 30) hit('tx', -8, 'OBSERVED', bi(`רק ${tx.n} עסקאות — מדגם קטן (−8)`, `only ${tx.n} deals — a small sample (−8)`));
      const age = tx && tx.to && today ? daysBetween(tx.to, today) : null;
      if (isNum(age) && age > POLICY.oldObservationDays) hit('txAge', -8, 'STALE', bi(`העסקה האחרונה שנצפתה ${dmy(tx.to)} — תצפית ישנה מ-12 חודשים (−8)`, `the latest observed deal ${dmy(tx.to)} — an observation older than 12 months (−8)`));
      const chk = m.retrievedAt && today ? daysBetween(m.retrievedAt, today) : null;
      if (isNum(chk) && chk > POLICY.staleCheckDays) hit('checked', -8, 'STALE', bi(`נתוני PROPX נשלפו ${dmy(m.retrievedAt)} — לפני יותר מ-90 יום (−8)`, `PROPX data retrieved ${dmy(m.retrievedAt)} — more than 90 days ago (−8)`));
      if (tx && isNum(tx.median) && F.sqm && F.smv) {
        const propxVal = tx.median * F.sqm, dev = Math.abs(F.smv - propxVal) / propxVal;
        if (dev > POLICY.conflictSpread && F.chosen !== 'propx') hit('propxVsValue', -10, 'CONFLICT', bi(`השווי לחיתום ${nisM(F.smv)} סוטה ${pct(dev, 0)} מחציון PROPX × שטח (${nisM(propxVal)}) (−10)`, `the underwriting value ${nisM(F.smv)} deviates ${pct(dev, 0)} from the PROPX median × area (${nisM(propxVal)}) (−10)`));
      }
    }
    const cbs = ctx.cbs;
    if (cbs && cbs.freshness === 'STALE') hit('cbs', -5, 'STALE', bi('סדרת המכירות של הלמ״ס ישנה (−5)', 'the CBS sales series is stale (−5)'));
    if (cbs && cbs.ok && cbs.level === 'national' && ctx.market) hit('cbsGeo', -3, 'OFFICIAL', bi('מכירות הלמ״ס ברמה ארצית בלבד — המחוז לא זוהה (−3)', 'CBS sales national only — the district was not identified (−3)'));
    score = clamp(round(score), 0, 100);
    const level = score >= POLICY.evidence.high ? 'HIGH' : score >= POLICY.evidence.medium ? 'MEDIUM' : 'LOW';
    return { score, level, label: EVIDENCE[level], items, conflict, insufficient: score < POLICY.evidence.insufficient };
  }
  const MATERIAL_INPUTS = {
    buy: ['price', 'taxPct', 'exitMonth', 'haircutPct', 'ratePct', 'ltvPct'],
    finance: ['amount', 'collateralValue', 'ratePct', 'termMonths', 'haircutPct', 'seniority'],
    hybrid: ['capital', 'realizationValue', 'collateralValue', 'termMonths', 'couponPct', 'participationPct', 'threshold'],
  };

  /* ------------------------------------------------- per-structure verdict */
  function assess(k, R, ctx) {
    const s = R.strategies[k], F = R.facts, set = R.settings;
    if (!s.base || !s.base.ok) return { k, ok: false, missing: s.base ? s.base.missing : [], verdict: 'INSUFFICIENT_EVIDENCE', score: null };
    const gates = gatesOf(k, s, F, set);
    const groups = { returns: returnsOf(k, s, set), downside: downsideOf(k, s, set), structure: structureOf(k, s, F), execution: executionOf(k, s, F), market: marketOf(ctx) };
    const scored = Object.values(groups).filter((g) => isNum(g.score));
    const tw = scored.reduce((a, g) => a + g.weight, 0);
    let score = tw ? scored.reduce((a, g) => a + g.weight * g.score, 0) / tw : null;
    const soft = gates.filter((g) => g.kind === 'economic' && (g.status === 'near' || (g.status === 'fail' && !g.critical)));
    const penalty = Math.min(20, soft.length * 5);
    score = isNum(score) ? clamp(round(score - penalty), 0, 100) : null;
    const evidence = evidenceOf(k, s, R, ctx);
    const criticalFail = gates.filter((g) => g.kind === 'economic' && g.status === 'fail' && g.critical);
    const evidenceFail = gates.filter((g) => g.kind === 'evidence' && g.status === 'fail');
    let verdict, basis;
    if (evidenceFail.length || evidence.insufficient) { verdict = 'INSUFFICIENT_EVIDENCE'; basis = evidenceFail.length ? evidenceFail[0].why : bi('איכות הראיות נמוכה מדי להחלטה אחראית', 'evidence quality too low for a responsible decision'); }
    else if (criticalFail.length) { verdict = 'PASS'; basis = bi(`סף קריטי נכשל: ${criticalFail.map((g) => g.label.he).join(', ')}`, `a critical gate failed: ${criticalFail.map((g) => g.label.en).join(', ')}`); }
    else if (score >= POLICY.takeMin && !soft.length && groups.downside.score >= POLICY.downsideMin && evidence.level !== 'LOW') { verdict = 'TAKE'; basis = bi(`אטרקטיביות ${score} ≥ ${POLICY.takeMin}, כל הספים מתקיימים, הגנה ${groups.downside.score} ≥ ${POLICY.downsideMin}, ראיות ${evidence.label.he}`, `attractiveness ${score} ≥ ${POLICY.takeMin}, every gate met, downside ${groups.downside.score} ≥ ${POLICY.downsideMin}, evidence ${evidence.label.en}`); }
    else if (score >= POLICY.conditionsMin) {
      verdict = 'TAKE_WITH_CONDITIONS';
      const r = [];
      if (soft.length) r.push(bi(`${soft.length} ספים בהחמצה קלה / לא קריטיים`, `${soft.length} near-miss / non-critical gates`));
      if (groups.downside.score < POLICY.downsideMin) r.push(bi(`הגנה ${groups.downside.score} < ${POLICY.downsideMin}`, `downside ${groups.downside.score} < ${POLICY.downsideMin}`));
      if (evidence.level === 'LOW') r.push(bi('ראיות נמוכות', 'LOW evidence'));
      if (score < POLICY.takeMin) r.push(bi(`אטרקטיביות ${score} < ${POLICY.takeMin}`, `attractiveness ${score} < ${POLICY.takeMin}`));
      basis = bi(r.map((x) => x.he).join(' · '), r.map((x) => x.en).join(' · '));
    } else { verdict = 'PASS'; basis = bi(`אטרקטיביות ${score} < ${POLICY.conditionsMin}`, `attractiveness ${score} < ${POLICY.conditionsMin}`); }
    const descriptor = isNum(score) ? POLICY.descriptor.find(([min]) => score >= min)[1] : null;
    return { k, ok: true, verdict, basis, score, descriptor, descriptorLabel: descriptor ? DESCRIPTOR[descriptor] : null, penalty, gates, groups, evidence, soft: soft.map((g) => g.id), criticalFail: criticalFail.map((g) => g.id),
      irr: E.irrOf(s.base), irrDown: s.downside && s.downside.ok ? E.irrOf(s.downside) : null, moic: E.moicOf(s.base), capital: E.capOf(s.base), profit: s.base.profit, months: s.base.months, mos: s.mos,
      coverage: k === 'buy' ? s.base.valueToBasis : s.base.coverage, hurdles: { passed: s.hurdles.filter((h) => h.pass).length, total: s.hurdles.length }, liquidity: s.base.months <= 12 ? 'high' : s.base.months <= 24 ? 'medium' : 'low' };
  }

  /* --------------------------------------------------- structure comparison */
  function whyStructure(best, second, A, L) {
    if (!best) return [];
    const out = [];
    const a = A[best], nm = SN[best];
    for (const o of STRATS.filter((x) => x !== best)) {
      const b = A[o]; if (!b || !b.ok) { out.push({ k: o, text: bi(`${SN[o]}: לא חושב — חסרים נתוני מבנה.`, `${SN[o]}: not computed — structure inputs missing.`) }); continue; }
      const bits = [];
      if (b.verdict === 'PASS' || b.verdict === 'INSUFFICIENT_EVIDENCE') bits.push(bi(`${VERDICT[b.verdict].label.he} (${b.basis.he})`, `${VERDICT[b.verdict].label.en} (${b.basis.en})`));
      if (isNum(a.score) && isNum(b.score)) bits.push(bi(`אטרקטיביות ${b.score} מול ${a.score}`, `attractiveness ${b.score} vs ${a.score}`));
      if (isNum(a.capital) && isNum(b.capital) && b.capital > 0) { const dc = (a.capital - b.capital) / b.capital; if (Math.abs(dc) >= 0.05) bits.push(bi(`${nm} דורש ${pct(Math.abs(dc), 0)} ${dc < 0 ? 'פחות' : 'יותר'} הון בסיכון`, `${nm} puts ${pct(Math.abs(dc), 0)} ${dc < 0 ? 'less' : 'more'} capital at risk`)); }
      if (isNum(a.profit) && isNum(b.profit) && b.profit > 0 && a.profit > 0) { const share = a.profit / b.profit; if (share < 1) bits.push(bi(`שומר ${pct(share, 0)} מהרווח של ${SN[o]}`, `keeps ${pct(share, 0)} of ${SN[o]}'s profit`)); else if (share > 1.05) bits.push(bi(`רווח גבוה ב-${pct(share - 1, 0)}`, `${pct(share - 1, 0)} more profit`)); }
      if (isNum(a.irrDown) && isNum(b.irrDown)) bits.push(bi(`בתרחיש השלילי ${pct(a.irrDown)} לעומת ${pct(b.irrDown)}`, `downside ${pct(a.irrDown)} vs ${pct(b.irrDown)}`));
      if (a.groups && b.groups && isNum(a.groups.downside.score) && isNum(b.groups.downside.score)) bits.push(bi(`הגנה ${a.groups.downside.score} לעומת ${b.groups.downside.score}`, `downside protection ${a.groups.downside.score} vs ${b.groups.downside.score}`));
      out.push({ k: o, text: bi(`לעומת ${SN[o]}: ${bits.map((x) => x.he).join('; ')}.`, `vs ${SN[o]}: ${bits.map((x) => x.en).join('; ')}.`) });
    }
    return out;
  }
  function comparison(A, L) {
    const row = (id, label, f, fmt) => ({ id, label, fmt, cells: Object.fromEntries(STRATS.map((k) => [k, A[k] && A[k].ok ? f(A[k]) : null])) });
    return [
      row('verdict', bi('החלטה', 'DECISION'), (a) => a.verdict, 'verdict'),
      row('score', bi('אטרקטיביות', 'ATTRACTIVENESS'), (a) => a.score, 'score'),
      row('return', bi('תשואה (IRR בסיס)', 'RETURN (base IRR)'), (a) => a.irr, 'pct'),
      row('downside', bi('תרחיש שלילי (IRR)', 'DOWNSIDE (IRR)'), (a) => a.irrDown, 'pct'),
      row('capital', bi('הון נדרש', 'CAPITAL REQUIRED'), (a) => a.capital, 'nis'),
      row('atRisk', bi('הון בסיכון', 'CAPITAL AT RISK'), (a) => a.capital, 'nis'),
      row('duration', bi('משך', 'DURATION'), (a) => a.months, 'months'),
      row('protection', bi('הגנה (מרווח ביטחון)', 'PROTECTION (margin of safety)'), (a) => a.mos, 'pct'),
      row('liquidity', bi('נזילות', 'LIQUIDITY'), (a) => a.liquidity, 'level'),
      row('execution', bi('סיכון ביצוע (ציון)', 'EXECUTION RISK (score)'), (a) => a.groups.execution.score, 'score'),
      row('hurdles', bi('ספי קרן', 'FUND HURDLES'), (a) => `${a.hurdles.passed}/${a.hurdles.total}`, 'text'),
      row('evidence', bi('איכות ראיות', 'EVIDENCE QUALITY'), (a) => a.evidence.level, 'evidence'),
    ];
  }

  /* ----------------------------------------------- conditions to proceed */
  function conditionsOf(best, R, A, ctx) {
    if (!best) return [];
    const a = A[best], s = R.strategies[best], F = R.facts, set = R.settings, inp = s.inputs || {}, b = s.base;
    const C = [];
    const add = (id, text, basis) => C.push({ id, text, basis });
    for (const g of a.gates) {
      if (g.status === 'pass') continue;
      if (g.id === 'irr' && best === 'buy' && s.limits && isNum(s.limits.maxPrice)) add('price', bi(`מחיר רכישה ≤ ${nisM(s.limits.maxPrice)}`, `acquisition price ≤ ${nisM(s.limits.maxPrice)}`), bi(`המחיר המקסימלי שבו IRR הבסיס מגיע לרף ${set.minIrr}% (פותר המחיר של המנוע)`, `the highest price at which the base IRR meets the ${set.minIrr}% hurdle (engine price solver)`));
      else if (g.id === 'irr') add('irr', bi(`שיפור תנאים כך ש-IRR הבסיס ≥ ${set.minIrr}% (כיום ${pct(a.irr)})`, `improved terms so the base IRR ≥ ${set.minIrr}% (now ${pct(a.irr)})`), bi('רף ה-IRR של הקרן', 'the fund\'s IRR hurdle'));
      else if (g.id === 'moic') add('moic', bi(`MOIC ≥ ${mult(set.minMoic)} (כיום ${mult(a.moic)})`, `MOIC ≥ ${mult(set.minMoic)} (now ${mult(a.moic)})`), bi('רף ה-MOIC של הקרן', 'the fund\'s MOIC hurdle'));
      else if (g.id === 'discount' && isNum(F.smv)) add('discount', bi(`מחיר רכישה ≤ ${nisM(F.smv * (1 - set.minDiscount / 100))} (הנחת כניסה ≥ ${set.minDiscount}%)`, `acquisition price ≤ ${nisM(F.smv * (1 - set.minDiscount / 100))} (entry discount ≥ ${set.minDiscount}%)`), bi('רף הנחת הכניסה של הקרן על השווי הנתמך', 'the fund\'s entry-discount hurdle on the supported value'));
      else if (g.id === 'coverage' && isNum(b.exposure) && isNum(b.haircut)) { const need = (set.minCoverage * b.exposure + n0(b.priorLiens)) / (1 - b.haircut); add('collateral', bi(`שווי בטוחות מאומת ≥ ${nisM(need)} (כיסוי ${mult(set.minCoverage)})`, `verified collateral value ≥ ${nisM(need)} (coverage ${mult(set.minCoverage)})`), bi(`(כיסוי מינימלי × חשיפה ${nisM(b.exposure)} + שעבודים קודמים ${nisM(n0(b.priorLiens))}) ÷ (1 − מקדם ביטחון ${pct(b.haircut, 0)})`, `(minimum coverage × exposure ${nisM(b.exposure)} + prior liens ${nisM(n0(b.priorLiens))}) ÷ (1 − haircut ${pct(b.haircut, 0)})`)); }
      else if (g.id === 'ltv' && isNum(b.collateral)) add('ltv', bi(`LTV ≤ ${set.maxLtv}% — הלוואה ≤ ${nisM(b.collateral * set.maxLtv / 100 - n0(b.priorLiens))} על הבטוחה הנוכחית`, `LTV ≤ ${set.maxLtv}% — loan ≤ ${nisM(b.collateral * set.maxLtv / 100 - n0(b.priorLiens))} on the current collateral`), bi('תקרת ה-LTV של הקרן', 'the fund\'s LTV cap'));
      else if (g.id === 'duration') add('duration', bi(`משך ≤ ${set.maxDuration} חודשים (כיום ${a.months}) — או אישור חריג של הוועדה`, `duration ≤ ${set.maxDuration} months (now ${a.months}) — or an explicit committee exception`), bi('משך מקסימלי של הקרן', 'the fund\'s maximum duration'));
      else if (g.id === 'mos' && best === 'buy' && s.limits && isNum(s.limits.maxPrice)) add('mos', bi(`מרווח ביטחון ≥ ${set.minMos}% (כיום ${pct(a.mos)}) — מחיר נמוך יותר או שווי מאומת גבוה יותר`, `margin of safety ≥ ${set.minMos}% (now ${pct(a.mos)}) — a lower price or a higher verified value`), bi('רף מרווח הביטחון של הקרן', 'the fund\'s margin-of-safety hurdle'));
      else if (g.id === 'mos') add('mos', bi(`מרווח ביטחון ≥ ${set.minMos}% (כיום ${pct(a.mos)})`, `margin of safety ≥ ${set.minMos}% (now ${pct(a.mos)})`), bi('רף מרווח הביטחון של הקרן', 'the fund\'s margin-of-safety hurdle'));
      else if (/Exposure$/.test(g.id)) add(g.id, bi(`${g.label.he} ≤ ${pct(g.limit, 0)} מהקרן (כיום ${pct(g.value, 0)}) — הקטנת הסכום או מימוש חשיפה קיימת`, `${g.label.en} ≤ ${pct(g.limit, 0)} of the fund (now ${pct(g.value, 0)}) — a smaller ticket or an exit from existing exposure`), bi('תקרת הריכוזיות של הקרן', 'the fund\'s concentration cap'));
      else if (g.id === 'downsideLoss') add('security', bi(`ביטחונות נוספים / ערבות המכסים הפסד של ${nisM(g.value * a.capital)} בתרחיש השלילי`, `additional security / guarantee covering the ${nisM(g.value * a.capital)} downside loss`), bi('הפסד ההון בתרחיש השלילי של המנוע', 'the engine\'s downside capital loss'));
    }
    if (!(F.sources.appraisal > 0) && isNum(F.smv)) add('appraisal', bi(`שומה בלתי תלויה התומכת בשווי ≥ ${nisM(F.smv)}`, `an independent appraisal supporting a value ≥ ${nisM(F.smv)}`), bi('השווי לחיתום נשען על מקור ללא שומה', 'the underwriting value rests on a source other than an appraisal'));
    if (F.status === 'planning' || F.status === 'permit') add('permit', bi(F.status === 'planning' ? 'אבן דרך: היתר בנייה לפני העמדת ההון' : 'אבן דרך: תחילת בנייה מאומתת לפני העמדת ההון', F.status === 'planning' ? 'milestone: building permit before funding' : 'milestone: verified construction start before funding'), bi(`סטטוס הפרויקט שהוזן: ${F.status}`, `the entered project status: ${F.status}`));
    if (F.developerRating === 'unassessed') add('developer', bi('הערכת אנליסט של היזם (רקורד, איתנות) לפני ועדה', 'an analyst assessment of the developer (track record, standing) before committee'), bi('דירוג היזם טרם הוזן', 'the developer rating is not entered'));
    if (a.evidence.conflict) add('conflict', bi('יישוב הפער בין מקורות השווי לפני העמדת ההון', 'resolution of the value-source spread before funding'), bi(`פער ${pct(F.spread, 0)} בין המקורות הבלתי תלויים`, `a ${pct(F.spread, 0)} spread between the independent sources`));
    if (best !== 'buy' && isNum(b.equityCushion) && b.equityCushion <= 0) add('equity', bi('הון עצמי של היזם מתחת לחשיפת ALTARIS', 'developer equity ranking below the ALTARIS exposure'), bi(`כרית ההון המחושבת ${nisM(b.equityCushion)}`, `the computed equity cushion ${nisM(b.equityCushion)}`));
    return C;
  }

  /* -------------------------------------------- strengths and risks (ranked) */
  function strengthsRisks(a) {
    const parts = [];
    for (const g of ['returns', 'downside', 'structure', 'execution', 'market']) for (const p of a.groups[g].parts) if (isNum(p.score)) parts.push({ g, ...p });
    const strengths = parts.filter((p) => p.score >= 70).sort((x, y) => y.score - x.score).slice(0, 5).map((p) => ({ k: p.k, group: p.g, score: p.score, text: p.label, why: p.why }));
    const risks = parts.filter((p) => p.score < 50).sort((x, y) => x.score - y.score).slice(0, 5).map((p) => ({ k: p.k, group: p.g, score: p.score, text: p.label, why: p.why }));
    for (const g of a.gates) if (g.status !== 'pass') risks.unshift({ k: 'gate:' + g.id, group: 'gates', score: g.status === 'fail' ? 0 : 30, text: g.label, why: g.why });
    return { strengths, risks: risks.slice(0, 6) };
  }

  /* ----------------------------------- source / assumption breakdown */
  function breakdown(best, R, ctx) {
    const F = R.facts, s = best ? R.strategies[best] : null, m = ctx.market, ind = ctx.indicators || {}, cbs = ctx.cbs;
    const B = { OFFICIAL: [], OBSERVED: [], DERIVED: [], MODEL: [], USER_ASSUMPTION: [], USER_OVERRIDE: [], MISSING: [] };
    const put = (c, id, text) => B[c].push({ id, text });
    for (const [k, lbl] of [['boiRate', bi('ריבית בנק ישראל', 'Bank of Israel rate')], ['cpi', bi('מדד המחירים לצרכן', 'CPI')], ['newHomesIndex', bi('מדד מחירי דירות חדשות', 'new-homes price index')], ['constructionInputsIndex', bi('מדד תשומות הבנייה', 'construction-inputs index')], ['rentIndex', bi('מדד שכר הדירה (רף שוק כללי)', 'rent index (general market benchmark)')]]) if (ind[k] && isNum(ind[k].value ?? ind[k].yoy)) put('OFFICIAL', k, lbl);
    if (cbs && cbs.ok) put('OFFICIAL', 'cbsSales', bi(`מכירות דירות חדשות · ${cbs.scope.he} · עד ${cbs.latest}`, `new-home sales · ${cbs.scope.en} · through ${cbs.latest}`));
    if (cbs && isNum(cbs.inventory)) put('OFFICIAL', 'inventory', bi(`מלאי דירות חדשות ארצי ${cbs.inventoryPeriod}`, `national new-home inventory ${cbs.inventoryPeriod}`));
    if (m) {
      if (m.land) put('OFFICIAL', 'land', bi('מכרזי רמ״י ביישוב', 'ILA tenders in the locality'));
      if (m.housing) put('OFFICIAL', 'housing', bi('הגרלות דיור מסובסד ביישוב', 'subsidized-housing lotteries in the locality'));
      if (m.rental && m.rental.tenders) put('OFFICIAL', 'rental', bi('מכרזי דיור להשכרה ביישוב (צנרת — לא פרויקט מאוכלס)', 'rental-track tenders in the locality (pipeline — not an operating project)'));
      if (m.tx && m.tx.n > 0) { put('OBSERVED', 'tx', bi(`${m.tx.n} עסקאות מגורים · ${dmy(m.tx.from)}–${dmy(m.tx.to)}`, `${m.tx.n} residential deals · ${dmy(m.tx.from)}–${dmy(m.tx.to)}`)); put('DERIVED', 'txMedian', bi('חציון ₪/מ״ר של העסקאות', 'median ₪/m² of the deals')); }
      if (m.tx && m.tx.compsN >= 5) put('DERIVED', 'comps', bi(`חציון ${m.tx.compsN} עסקאות השוואה`, `median of ${m.tx.compsN} comparable deals`));
      if (m.devIntel && !m.devIntel.none) put('OBSERVED', 'devIntel', bi('פעילות היזם שנצפתה ב-PROPX', 'the developer\'s observed PROPX activity'));
      if (m.pipeline) put('DERIVED', 'pipeline', bi('פרויקטים ואתרים שנצפו ביישוב', 'observed projects and sites in the locality'));
    } else put('MISSING', 'market', bi('נתוני שוק PROPX', 'PROPX market data'));
    if (F.sources.appraisal > 0) put('OBSERVED', 'appraisal', bi('שומה בלתי תלויה', 'independent appraisal'));
    else put('MISSING', 'appraisal', bi('שומה בלתי תלויה', 'independent appraisal'));
    if (F.chosen === 'manual') put('USER_OVERRIDE', 'manualValue', bi('הערכה ידנית כשווי לחיתום', 'manual estimate as the underwriting value'));
    const V = (ctx.deal && ctx.deal.value) || {};
    for (const k of ['propx', 'comparables']) if (V[k] && V[k].auto === false) put('USER_OVERRIDE', k, bi(`ערך ${k} נקבע ידנית במקום הנגזר`, `${k} value set by hand in place of the derived one`));
    for (const id of ['irr', 'moic', 'capitalAtRisk', 'mos', 'downside', 'coverage', 'breakEven', 'riskScore']) put('MODEL', id, bi(id, id));
    if (s) {
      const def = new Set(s.defaulted || []);
      const keys = Object.keys(s.inputs || {});
      const entered = keys.filter((k) => !def.has(k)), defaulted = keys.filter((k) => def.has(k));
      put('USER_ASSUMPTION', 'entered', bi(`${entered.length} הנחות ${SN[best]} שהוזנו`, `${entered.length} ${SN[best]} inputs entered`));
      if (defaulted.length) put('USER_ASSUMPTION', 'defaulted', bi(`${defaulted.length} בברירת מחדל מסומנת`, `${defaulted.length} on a labelled default`));
      put('USER_ASSUMPTION', 'scenarios', bi('הנחות התרחיש השלילי / החיובי', 'downside / upside scenario assumptions'));
    }
    if (!F.status) put('MISSING', 'status', bi('סטטוס בנייה', 'construction status'));
    if (F.developerRating === 'unassessed') put('MISSING', 'developerRating', bi('הערכת היזם', 'developer assessment'));
    const counts = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.length]));
    const mostMaterial = F.chosen ? bi(`השווי לחיתום (${F.chosen}: ${nisM(F.smv)}) — כל תשואה, מרווח ביטחון וכיסוי נגזרים ממנו`, `the underwriting value (${F.chosen}: ${nisM(F.smv)}) — every return, margin of safety and coverage derives from it`) : bi('לא נבחר שווי לחיתום', 'no underwriting value chosen');
    return { items: B, counts, mostMaterial };
  }

  /* ----------------------------------------------------- source conflicts */
  function conflictsOf(R, ctx) {
    const F = R.facts, out = [];
    const ind = E.VALUE_SOURCES.filter((k) => F.sources[k] > 0 && k !== 'developer');
    if (ind.length >= 2 && isNum(F.spread) && F.spread > POLICY.conflictSpread) {
      out.push({ id: 'valueSources', material: true, label: bi('מקורות השווי אינם מסכימים', 'the value sources disagree'),
        values: ind.map((k) => ({ source: k, value: F.sources[k], used: F.chosen === k })),
        treatment: bi(`PROPX מציגה את כולם; לחיתום נבחר ${F.chosen} במפורש. הפער ${pct(F.spread, 0)} מוריד את איכות הראיות.`, `PROPX shows all of them; ${F.chosen} was chosen explicitly for underwriting. The ${pct(F.spread, 0)} spread lowers evidence quality.`) });
    }
    const m = ctx.market;
    if (m && m.tx && isNum(m.tx.median) && F.sqm && F.smv && F.chosen !== 'propx') {
      const propxVal = m.tx.median * F.sqm, dev = Math.abs(F.smv - propxVal) / propxVal;
      if (dev > POLICY.conflictSpread) out.push({ id: 'propxMedian', material: dev > 0.3, label: bi('חציון PROPX מול השווי לחיתום', 'PROPX median vs the underwriting value'),
        values: [{ source: 'propx-median × sqm', value: propxVal, used: false, period: `${dmy(m.tx.from)}–${dmy(m.tx.to)}` }, { source: F.chosen, value: F.smv, used: true }],
        treatment: bi('השווי שנבחר נשמר; חציון העסקאות הוא סטטיסטיקה של היישוב, לא שומה של הנכס. הפער מצוין ומוריד את איכות הראיות.', 'the chosen value stands; the deal median is a locality statistic, not an appraisal of the asset. The gap is stated and lowers evidence quality.') });
    }
    return out;
  }

  /* -------------------------------------------------------------- freshness */
  function freshnessOf(ctx) {
    const out = [], m = ctx.market, cbs = ctx.cbs, ind = ctx.indicators || {};
    if (cbs) out.push({ id: 'cbsSales', label: bi('מכירות דירות חדשות · למ״ס', 'new-home sales · CBS'), observed: cbs.latest || null, published: cbs.sourceUpdate || null, checked: cbs.checkedAt || null, state: cbs.freshness || null });
    if (ind.boiRate) out.push({ id: 'boi', label: bi('ריבית בנק ישראל', 'Bank of Israel rate'), observed: ind.boiRate.publishedAt || null, published: ind.boiRate.publishedAt || null, checked: ctx.indicatorsCheckedAt || null, state: null });
    if (m) {
      if (m.tx) out.push({ id: 'tx', label: bi('עסקאות מגורים ביישוב', 'residential deals in the locality'), observed: m.tx.to || null, published: m.tx.snapshotAt || null, checked: m.retrievedAt || null, state: null });
      if (m.rental) out.push({ id: 'rental', label: bi('מכרזי דיור להשכרה', 'rental-track tenders'), observed: null, published: null, checked: m.rental.checkedAt || m.retrievedAt || null, state: null });
      if (m.devIntel && m.devIntel.construction) out.push({ id: 'construction', label: bi('ראיות בנייה של היזם', 'the developer\'s construction evidence'), observed: m.devIntel.construction.asOf || null, published: null, checked: m.retrievedAt || null, state: null });
    }
    return out;
  }

  /* ------------------------------------------------------------- decide */
  /**
   * decide(R, ctx) — R: the engine output of run(deal); ctx: { today, deal, market (deal.market), cbs
   * ({ ok, scope, level, momentum, small, latest, freshness, sourceUpdate, checkedAt, inventory, inventoryPeriod }),
   * indicators (PROPX_MARKET.indicators), indicatorsCheckedAt }.
   */
  /* the FINAL verdict: the economic verdict and the market & execution assessment combined through POLICY.final — the only path by which
     PROPX market intelligence reaches a verdict. Returns the final verdict, whether it changed, the rule that fired, the market condition
     (when CAUTION applies) and what would remove it. Never recomputes a return; never touches the economic verdict or its basis. */
  function finalOf(verdict, basis, MA) {
    const V = (v) => ({ verdict: v, verdictLabel: VERDICT[v].label, tone: VERDICT[v].tone });
    const same = (rule, reason) => ({ ...V(verdict), changed: false, from: verdict, to: verdict, rule, reason, marketCondition: null, whatWouldRemove: [] });
    if (!MA || MA.status === 'INSUFFICIENT') return same('F0', bi('אין הערכת שוק וביצוע (ההקשר לא נטען) — ההכרעה הכלכלית עומדת; איכות הראיות כבר מנכה נתוני שוק חסרים', 'no market & execution assessment (context not loaded) — the economic verdict stands; evidence quality already deducts missing market data'));
    if (verdict === 'INSUFFICIENT_EVIDENCE') return same('F1', bi('ראיות החיתום אינן מספיקות — השוק אינו יכול להשלים אותן', 'the underwriting evidence is insufficient — the market cannot supply it'));
    if (verdict === 'PASS') return same('F2', bi(`הכלכלה אינה עומדת בספים — שוק ${T(MA.statusLabel, 'he')} אינו מציל כלכלה חלשה`, `the economics fail the hurdles — a ${T(MA.statusLabel, 'en')} market never rescues weak economics`));
    if (MA.status === 'CAUTION') {
      const neg = MA.material.negative || [];
      const list = (L) => neg.map((f) => T(f.text, L)).join('; ');
      const remove = neg.map((f) => f.remove).filter(Boolean);
      const cond = { id: 'market-caution', source: 'market', text: bi(`זהירות שוק וביצוע: ${list('he')}`, `market & execution caution: ${list('en')}`),
        basis: bi(`${neg.length} גורמים שליליים מהותיים מ-${(MA.convergence.negativeFamilies || []).length} משפחות מקור בלתי תלויות (${(MA.convergence.negativeFamilies || []).join(', ')}) — כלל F${verdict === 'TAKE' ? 3 : 4}`, `${neg.length} material negative factors from ${(MA.convergence.negativeFamilies || []).length} independent source families (${(MA.convergence.negativeFamilies || []).join(', ')}) — rule F${verdict === 'TAKE' ? 3 : 4}`),
        factors: neg.map((f) => ({ id: f.id, signal: f.signal, dimension: f.dimension, text: f.text, value: f.value, comparison: f.comparison, period: f.period, source: f.source, cls: f.cls, evidence: f.evidence, geoScope: f.geoScope, remove: f.remove || null })), remove };
      if (verdict === 'TAKE') return { ...V('TAKE_WITH_CONDITIONS'), changed: true, from: 'TAKE', to: 'TAKE_WITH_CONDITIONS', rule: 'F3', reason: bi('הכלכלה עומדת בכל הספים, אך ראיות שוק וביצוע באיכות גבוהה מתכנסות לזהירות — ההחלטה מתקדמת בתנאי', 'the economics pass every hurdle, but high-quality market & execution evidence converges on caution — the decision proceeds with a condition'), marketCondition: cond, whatWouldRemove: remove };
      return { ...V('TAKE_WITH_CONDITIONS'), changed: false, from: verdict, to: verdict, rule: 'F4', reason: bi('ההכרעה הכלכלית כבר בתנאים; תנאי השוק מתווסף לצידם', 'the economic verdict is already conditional; the market condition is added beside the economic ones'), marketCondition: cond, whatWouldRemove: remove };
    }
    return same('F5', bi(`הערכת השוק ${T(MA.statusLabel, 'he')} אינה משנה הכרעה כלכלית — לעולם לא שדרוג, לעולם לא הורדה ללא התכנסות`, `a ${T(MA.statusLabel, 'en')} assessment never moves an economic verdict — no upgrade, no downgrade without convergence`));
  }
  const slimFactor = (f) => ({ id: f.id, signal: f.signal, kind: f.kind, dimension: f.dimension, dimensionLabel: f.dimensionLabel, direction: f.direction, material: f.material, text: f.text, value: f.value, comparison: f.comparison, period: f.period, source: f.source, family: f.family, cls: f.cls, evidence: f.evidence, geoScope: f.geoScope, fresh: f.fresh, m: f.m, rule: f.rule, impact: f.impact, whyNotMaterial: f.whyNotMaterial || null, remove: f.remove || null, via: f.via });
  function decide(R, ctx) {
    ctx = ctx || {};
    const A = {}; for (const k of STRATS) A[k] = assess(k, R, ctx);
    const computed = STRATS.filter((k) => A[k].ok);
    const eligible = computed.filter((k) => A[k].verdict === 'TAKE' || A[k].verdict === 'TAKE_WITH_CONDITIONS').sort((x, y) => A[y].score - A[x].score || A[y].groups.downside.score - A[x].groups.downside.score);
    const ranked = computed.slice().sort((x, y) => (VERDICT[A[y].verdict].rank - VERDICT[A[x].verdict].rank) || (n0(A[y].score) - n0(A[x].score)));
    let verdict, recommended = null, second = null, basis;
    if (!computed.length) { verdict = 'INSUFFICIENT_EVIDENCE'; basis = bi('אף מבנה לא חושב — חסרים שווי לחיתום או תנאי מבנה', 'no structure computed — the underwriting value or structure terms are missing'); }
    else if (eligible.length) { recommended = eligible[0]; second = eligible[1] || ranked.find((k) => k !== recommended) || null; verdict = A[recommended].verdict; basis = A[recommended].basis; }
    else if (computed.some((k) => A[k].verdict === 'INSUFFICIENT_EVIDENCE')) { verdict = 'INSUFFICIENT_EVIDENCE'; const k0 = computed.find((k) => A[k].verdict === 'INSUFFICIENT_EVIDENCE'); basis = A[k0].basis; }
    else { verdict = 'PASS'; basis = A[ranked[0]].basis; }
    const lead = recommended || ranked[0] || null;
    const a = lead ? A[lead] : null;
    /* an attractiveness computed on an unsupported value is not reported at the deal level (the per-structure figures stay in the basis) */
    const scoreOk = verdict !== 'INSUFFICIENT_EVIDENCE';
    const sr = a ? strengthsRisks(a) : { strengths: [], risks: [] };
    const conds = verdict === 'TAKE_WITH_CONDITIONS' || verdict === 'TAKE' ? conditionsOf(recommended, R, A, ctx) : lead && verdict === 'PASS' ? conditionsOf(lead, R, A, ctx) : [];
    const missing = computed.length ? [] : STRATS.map((k) => ({ k, missing: A[k].missing || [] }));
    const evidence = a ? a.evidence : { score: null, level: 'LOW', label: EVIDENCE.LOW, items: [], conflict: false, insufficient: true };
    const D = {
      version: VERSION, policy: POLICY, verdict, verdictLabel: VERDICT[verdict].label, tone: VERDICT[verdict].tone, basis,
      score: a && scoreOk ? a.score : null, descriptor: a && scoreOk ? a.descriptor : null, descriptorLabel: a && scoreOk ? a.descriptorLabel : null,
      evidence, recommended, second, lead, structures: A, ranked,
      whyStructure: whyStructure(recommended, second, A), comparison: comparison(A),
      strengths: sr.strengths, risks: sr.risks, conditions: conds, missing,
      breakdown: breakdown(lead, R, ctx), conflicts: conflictsOf(R, ctx), freshness: freshnessOf(ctx),
      mainReason: sr.strengths[0] ? sr.strengths[0].text : null, mainRisk: sr.risks[0] ? sr.risks[0].text : null,
      flips: null,   // filled by flips(...) on demand
      stamp: { v: VERSION.id, verdict, score: a && scoreOk ? a.score : null, evidence: evidence.level, structure: recommended, at: ctx.today || null },
    };
    /* ---- the FINAL decision (additive): the economic verdict above is untouched; the market & execution assessment reaches the verdict
       only through POLICY.final. ctx.marketAssessment is computed by altaris/market-assessment.js (the page) — the layer itself imports only the engine. */
    const MA = ctx.marketAssessment || null;
    D.economic = { verdict, verdictLabel: VERDICT[verdict].label, tone: VERDICT[verdict].tone, basis };
    D.marketAssessment = MA ? { version: MA.version, status: MA.status, statusLabel: MA.statusLabel, statusBasis: MA.statusBasis, convergence: MA.convergence, factors: (MA.factors || []).map(slimFactor), material: { positive: (MA.material.positive || []).map(slimFactor), negative: (MA.material.negative || []).map(slimFactor) }, informational: (MA.informational || []).length, notes: MA.notes || [], freshness: MA.freshness || null, rules: MA.rules || [], basis: MA.basis || null } : null;
    D.final = finalOf(verdict, basis, MA);
    D.final.conditions = D.final.marketCondition ? conds.concat([D.final.marketCondition]) : conds.slice();
    D.marketImpact = { economic: D.economic, assessment: D.marketAssessment ? { status: D.marketAssessment.status, statusLabel: D.marketAssessment.statusLabel, convergence: D.marketAssessment.convergence } : null, final: { verdict: D.final.verdict, verdictLabel: D.final.verdictLabel, changed: D.final.changed, rule: D.final.rule, reason: D.final.reason },
      primaryFactors: D.marketAssessment ? D.marketAssessment.material.negative.concat(D.marketAssessment.material.positive) : [], conditionsAdded: D.final.marketCondition ? [D.final.marketCondition] : [], whatWouldRemove: D.final.whatWouldRemove || [], policy: POLICY.final };
    D.stamp.final = D.final.verdict; D.stamp.market = MA ? MA.status : null;
    return D;
  }

  /* ----------------------------------------------- what would change it */
  /* Each variable: get / set on a copy of the deal; `worse` = the direction that hurts the deal. */
  const scaleValue = (deal, f) => {
    const V = deal.value || {}, F = E.facts(deal), k = F.chosen; if (!k) return;
    if (k === 'units') for (const u of deal.units || []) if (isNum(+u.supported)) u.supported = Math.round(+u.supported * f);
    else if (k === 'ppsqm') V.ppsqm.psm = V.ppsqm.psm * f;
    else if ((k === 'propx' || k === 'comparables') && V[k] && V[k].auto !== false && isNum(+V[k].psm)) V[k].psm = +V[k].psm * f;
    else if (V[k]) V[k].value = +V[k].value * f;
  };
  function variablesFor(k, deal, F) {
    const vars = [];
    const push = (v) => vars.push(v);
    push({ id: 'supportedValue', label: bi('שווי נתמך', 'supported value'), fmt: 'nis', worse: 'down', get: () => F.smv, set: (d, x) => scaleValue(d, x / F.smv), lo: 0.5, hi: 1.6, when: isNum(F.smv) });
    if (k === 'buy') {
      const priceTotal = deal.price && isNum(+deal.price.total) ? +deal.price.total : null;
      push({ id: 'price', label: bi('מחיר רכישה', 'acquisition price'), fmt: 'nis', worse: 'up', get: () => F.basis,
        set: (d, x) => { const f = x / F.basis; if (priceTotal != null) d.price.total = Math.round(priceTotal * f); else for (const u of d.units || []) if (isNum(+u.proposed)) u.proposed = Math.round(+u.proposed * f); }, lo: 0.6, hi: 1.5, when: isNum(F.basis) });
      push({ id: 'exitMonth', label: bi('משך עד היציאה', 'months to exit'), fmt: 'months', worse: 'up', get: () => n0(deal.buy && deal.buy.exitMonth) || E.resolve('buy', deal, F).inputs.exitMonth, set: (d, x) => { d.buy = d.buy || {}; d.buy.exitMonth = Math.round(x); }, lo: 0.5, hi: 3, when: true, integer: true });
      const rb = E.resolve('buy', deal, F).inputs;
      if (n0(rb.ltvPct) > 0 || n0(rb.debtAmount) > 0) push({ id: 'rate', label: bi('ריבית החוב', 'debt rate'), fmt: 'pctPoints', worse: 'up', get: () => rb.ratePct, set: (d, x) => { d.buy = d.buy || {}; d.buy.ratePct = x; }, lo: 0.5, hi: 2.5, when: true });
    } else if (k === 'finance') {
      const rf = E.resolve('finance', deal, F).inputs;
      push({ id: 'collateral', label: bi('שווי הבטוחה', 'collateral value'), fmt: 'nis', worse: 'down', get: () => rf.collateralValue, set: (d, x) => { d.finance = d.finance || {}; d.finance.collateralValue = x; }, lo: 0.5, hi: 1.6, when: isNum(rf.collateralValue) });
      push({ id: 'amount', label: bi('סכום ההלוואה', 'loan amount'), fmt: 'nis', worse: 'up', get: () => rf.amount, set: (d, x) => { d.finance = d.finance || {}; d.finance.amount = x; }, lo: 0.5, hi: 1.6, when: isNum(rf.amount) });
      push({ id: 'rate', label: bi('ריבית ההלוואה', 'loan rate'), fmt: 'pctPoints', worse: 'down', get: () => rf.ratePct, set: (d, x) => { d.finance = d.finance || {}; d.finance.ratePct = x; }, lo: 0.5, hi: 2, when: true });
      push({ id: 'term', label: bi('תקופת ההלוואה', 'loan term'), fmt: 'months', worse: 'up', get: () => rf.termMonths, set: (d, x) => { d.finance = d.finance || {}; d.finance.termMonths = Math.round(x); }, lo: 0.5, hi: 3, when: true, integer: true });
    } else {
      const rh = E.resolve('hybrid', deal, F).inputs;
      push({ id: 'realization', label: bi('שווי המימוש', 'realization value'), fmt: 'nis', worse: 'down', get: () => rh.realizationValue, set: (d, x) => { d.hybrid = d.hybrid || {}; d.hybrid.realizationValue = x; }, lo: 0.5, hi: 1.6, when: isNum(rh.realizationValue) });
      push({ id: 'capital', label: bi('ההון המועמד', 'capital provided'), fmt: 'nis', worse: 'up', get: () => rh.capital, set: (d, x) => { d.hybrid = d.hybrid || {}; d.hybrid.capital = x; }, lo: 0.5, hi: 1.6, when: isNum(rh.capital) && rh.capital > 0 });
      push({ id: 'term', label: bi('תקופת המבנה', 'structure term'), fmt: 'months', worse: 'up', get: () => rh.termMonths, set: (d, x) => { d.hybrid = d.hybrid || {}; d.hybrid.termMonths = Math.round(x); }, lo: 0.5, hi: 3, when: true, integer: true });
      if (n0(rh.couponPct) > 0) push({ id: 'coupon', label: bi('הקופון', 'coupon'), fmt: 'pctPoints', worse: 'down', get: () => rh.couponPct, set: (d, x) => { d.hybrid = d.hybrid || {}; d.hybrid.couponPct = x; }, lo: 0.5, hi: 2, when: true });
    }
    push({ id: 'downsideShock', label: bi('ירידת השווי בתרחיש השלילי', 'downside value shock'), fmt: 'pctPoints', worse: 'down', get: () => E.scenario(deal, 'downside').valueShock, set: (d, x) => { d.scen = d.scen || {}; d.scen.downside = Object.assign({}, d.scen.downside || {}, { valueShock: x }); }, lo: 3, hi: 0.2, when: true, shock: true });
    return vars.filter((v) => v.when && isNum(v.get()));
  }
  /**
   * flips(R, ctx, opts) — opts.run(deal) must return the engine output for a modified deal (the page passes
   * E.run with the same settings and context). Finds, for the lead structure, the smallest change of each
   * material input that moves the deal's verdict down (TAKE → TAKE WITH CONDITIONS → PASS) and, when the
   * verdict is PASS, up. Bisection on the verdict rank; the engine is re-run, never re-implemented.
   */
  function flips(R, ctx, opts) {
    opts = opts || {};
    const D0 = opts.decision || decide(R, ctx);
    const k = D0.lead; if (!k || !opts.run) return [];
    const deal = ctx.deal; if (!deal) return [];
    const F = R.facts;
    const rank0 = VERDICT[D0.verdict].rank;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const rankAt = (v, x) => { const d = clone(deal); v.set(d, x); const R1 = opts.run(d); const D1 = decide(R1, Object.assign({}, ctx, { deal: d })); return { rank: VERDICT[D1.verdict].rank, verdict: D1.verdict, score: D1.score }; };
    const out = [];
    const budget = { runs: 0, max: opts.maxRuns || 140 };
    for (const v of variablesFor(k, deal, F)) {
      if (budget.runs >= budget.max) break;
      const cur = v.get();
      const towards = (dir) => {   // dir: 'worse' | 'better'
        const worseUp = v.worse === 'up';
        const goUp = dir === 'worse' ? worseUp : !worseUp;
        let lo = cur, hi;
        if (v.shock) hi = goUp ? Math.min(0, cur + 30) : Math.max(-60, cur - 45);   // shock in percent points (negative = decline)
        else hi = goUp ? cur * v.hi : cur * v.lo;
        if (hi === lo) return null;
        const want = dir === 'worse' ? (r) => r.rank < rank0 : (r) => r.rank > rank0;
        const end = rankAt(v, hi); budget.runs++;
        if (!want(end)) return null;   // no change inside the search range
        let a = lo, b = hi, hit = end;
        for (let i = 0; i < 9 && budget.runs < budget.max; i++) {
          const mid = v.integer ? Math.round((a + b) / 2) : (a + b) / 2;
          if (v.integer && (mid === a || mid === b)) break;
          const r = rankAt(v, mid); budget.runs++;
          if (want(r)) { b = mid; hit = r; } else a = mid;
        }
        return { at: v.integer ? Math.round(b) : b, to: hit.verdict, toRank: hit.rank, score: hit.score };
      };
      const worse = rank0 > 1 ? towards('worse') : null;
      const better = rank0 <= 2 && rank0 > 0 ? towards('better') : null;
      for (const [dir, r] of [['worse', worse], ['better', better]]) {
        if (!r) continue;
        const rel = v.shock ? Math.abs(r.at - cur) : Math.abs(r.at - cur) / Math.abs(cur || 1);
        out.push({ id: v.id, label: v.label, fmt: v.fmt, direction: dir, from: cur, at: r.at, fromVerdict: D0.verdict, toVerdict: r.to, rel, scoreAt: r.score,
          text: flipText(v, cur, r.at, D0.verdict, r.to) });
      }
    }
    out.sort((x, y) => x.rel - y.rel);
    /* two inputs that default to one another (the realization value defaults to the supported value) flip at the
       same point — keep the first, the one named by the user's own input */
    const seen = [], uniq = [];
    for (const f of out) { const key = `${f.direction}|${f.toVerdict}|${f.fmt}|${f.rel.toFixed(3)}`; if (seen.includes(key)) continue; seen.push(key); uniq.push(f); }
    return uniq.slice(0, opts.limit || 4);
  }
  const fmtFlip = (fmt, x, L) => (fmt === 'nis' ? nisM(x) : fmt === 'months' ? months(Math.round(x), L) : fmt === 'pctPoints' ? `${x.toFixed(1)}%` : String(x));
  function flipText(v, from, at, v0, v1) {
    const up = at > from;
    const he = `${VERDICT[v1].label.he} אם ${v.label.he} ${up ? 'עולה מעל' : 'יורד מתחת ל'}־${fmtFlip(v.fmt, at, 'he')} (כיום ${fmtFlip(v.fmt, from, 'he')})`;
    const en = `${VERDICT[v1].label.en} if ${v.label.en} ${up ? 'exceeds' : 'falls below'} ${fmtFlip(v.fmt, at, 'en')} (now ${fmtFlip(v.fmt, from, 'en')})`;
    return bi(he, en);
  }

  /* -------------------------------------------------------- narrative */
  /* A deterministic committee narrative built only from the decision object — never from anything else. */
  function narrative(D, L) {
    const t = (v) => T(v, L), en = L === 'en';
    const P = [];
    const nm = (k) => (k ? SN[k] : '—');
    const a = D.lead ? D.structures[D.lead] : null;
    P.push(en ? `Decision: ${t(D.verdictLabel)}${isNum(D.score) ? ` · attractiveness ${D.score}/100 (${t(D.descriptorLabel)})` : ''} · evidence quality ${t(D.evidence.label)}. Basis: ${t(D.basis)}.`
      : `החלטה: ${t(D.verdictLabel)}${isNum(D.score) ? ` · אטרקטיביות ${D.score}/100 (${t(D.descriptorLabel)})` : ''} · איכות ראיות ${t(D.evidence.label)}. הבסיס: ${t(D.basis)}.`);
    if (D.recommended) P.push((en ? `Recommended structure: ${nm(D.recommended)}${D.second ? `; second best ${nm(D.second)}` : ''}. ` : `המבנה המומלץ: ${nm(D.recommended)}${D.second ? `; המבנה השני ${nm(D.second)}` : ''}. `) + D.whyStructure.map((w) => t(w.text)).join(' '));
    else if (a) P.push(en ? `No structure is eligible; the closest is ${nm(D.lead)} (${t(VERDICT[a.verdict].label)}: ${t(a.basis)}).` : `אף מבנה אינו כשיר; הקרוב ביותר הוא ${nm(D.lead)} (${t(VERDICT[a.verdict].label)}: ${t(a.basis)}).`);
    if (D.strengths.length) P.push((en ? 'Working for the deal: ' : 'לטובת העסקה: ') + D.strengths.map((s) => `${t(s.text)} (${s.score})`).join('; ') + '.');
    if (D.risks.length) P.push((en ? 'Working against it: ' : 'נגד העסקה: ') + D.risks.map((r) => `${t(r.text)}${r.why ? ' — ' + t(r.why) : ''}`).join('; ') + '.');
    if (D.conditions.length) P.push((en ? 'Conditions to proceed: ' : 'תנאים להתקדמות: ') + D.conditions.map((c) => t(c.text)).join('; ') + '.');
    if (D.final && D.marketAssessment) P.push(en ? `Market & execution assessment: ${t(D.marketAssessment.statusLabel)}${D.final.changed ? ` — final decision ${t(D.final.verdictLabel)} (rule ${D.final.rule}: ${t(D.final.reason)})` : ` — the economic verdict stands (rule ${D.final.rule}).`}${D.final.marketCondition ? ` Market condition: ${t(D.final.marketCondition.text)}.${D.final.whatWouldRemove.length ? ` It is removed when: ${D.final.whatWouldRemove.map((r) => t(r)).join('; ')}.` : ''}` : ''}`
      : `הערכת שוק וביצוע: ${t(D.marketAssessment.statusLabel)}${D.final.changed ? ` — ההחלטה הסופית ${t(D.final.verdictLabel)} (כלל ${D.final.rule}: ${t(D.final.reason)})` : ` — ההכרעה הכלכלית עומדת (כלל ${D.final.rule}).`}${D.final.marketCondition ? ` תנאי השוק: ${t(D.final.marketCondition.text)}.${D.final.whatWouldRemove.length ? ` יוסר כאשר: ${D.final.whatWouldRemove.map((r) => t(r)).join('; ')}.` : ''}` : ''}`);
    if (D.flips && D.flips.length) P.push((en ? 'What would change the decision: ' : 'מה ישנה את ההחלטה: ') + D.flips.map((f) => t(f.text)).join('; ') + '.');
    if (D.conflicts.length) P.push((en ? 'Source conflicts: ' : 'סתירות בין מקורות: ') + D.conflicts.map((c) => `${t(c.label)} — ${c.values.map((v) => `${v.source} ${nisM(v.value)}`).join(' / ')}; ${t(c.treatment)}`).join(' '));
    const bd = D.breakdown.counts;
    P.push(en ? `Evidence basis: ${bd.OFFICIAL} official, ${bd.OBSERVED} observed, ${bd.DERIVED} derived, ${bd.MODEL} model metrics, ${bd.USER_ASSUMPTION} user-assumption groups, ${bd.USER_OVERRIDE} overrides, ${bd.MISSING} material missing. Most material assumption: ${t(D.breakdown.mostMaterial)}.`
      : `בסיס הראיות: ${bd.OFFICIAL} רשמי, ${bd.OBSERVED} נצפה, ${bd.DERIVED} נגזר, ${bd.MODEL} מדדי מודל, ${bd.USER_ASSUMPTION} קבוצות הנחות משתמש, ${bd.USER_OVERRIDE} עקיפות, ${bd.MISSING} חסרים מהותיים. ההנחה המהותית ביותר: ${t(D.breakdown.mostMaterial)}.`);
    P.push(en ? 'Generated from ALTARIS underwriting and PROPX evidence by the deterministic decision policy — not an AI recommendation.' : 'הופק מחיתום ALTARIS ומראיות PROPX לפי מדיניות ההחלטה הדטרמיניסטית — אינה המלצת AI.');
    return P;
  }

  const DISCLAIMER = bi(
    'הערכת ALTARIS מבוססת על הנתונים, המקורות וההנחות הזמינים במועד הניתוח ומהווה כלי עזר אנליטי בלבד. היא אינה תחליף לבדיקת נאותות, ייעוץ מקצועי או שיקול דעת עצמאי. ההחלטה הסופית אם לבצע השקעה ובאיזה מבנה היא באחריות המשקיע.',
    'ALTARIS assessment is based on the data, sources and assumptions available at the time of analysis and is provided as an analytical decision-support tool only. It does not replace due diligence, professional advice or independent judgment. The final investment decision and structure remain the responsibility of the investor.');

  /* the documented policy, as text, for the basis view and the exports */
  const POLICY_TEXT = Object.freeze([
    bi(`TAKE: כל הספים הקריטיים מתקיימים, אין החמצה קלה או סף לא קריטי פתוח, אטרקטיביות ≥ ${POLICY.takeMin}, הגנה בתרחיש השלילי ≥ ${POLICY.downsideMin}, איכות ראיות בינונית לפחות.`, `TAKE: every critical gate met, no near miss or open non-critical gate, attractiveness ≥ ${POLICY.takeMin}, downside protection ≥ ${POLICY.downsideMin}, evidence at least MEDIUM.`),
    bi(`TAKE WITH CONDITIONS: אין כשל קריטי; אטרקטיביות ≥ ${POLICY.conditionsMin}; לפחות אחד — החמצה קלה (עד ${pct(POLICY.nearMiss, 0)} מהסף), סף לא קריטי פתוח, הגנה מתחת ל-${POLICY.downsideMin}, ראיות נמוכות או אטרקטיביות מתחת ל-${POLICY.takeMin}. התנאים נגזרים מהספים ומהפותרים של המנוע בלבד.`, `TAKE WITH CONDITIONS: no critical failure; attractiveness ≥ ${POLICY.conditionsMin}; at least one of — a near miss (within ${pct(POLICY.nearMiss, 0)} of a threshold), an open non-critical gate, downside protection below ${POLICY.downsideMin}, LOW evidence, or attractiveness below ${POLICY.takeMin}. Conditions come only from the gates and the engine's solvers.`),
    bi(`PASS: סף קריטי נכשל בבירור (IRR, MOIC, כיסוי, LTV, ריכוזיות, הפסד הון בתרחיש השלילי מעל ${pct(POLICY.maxDownsideLoss, 0)}) או אטרקטיביות מתחת ל-${POLICY.conditionsMin}. IRR גבוה לבדו אינו TAKE.`, `PASS: a critical gate clearly failed (IRR, MOIC, coverage, LTV, concentration, downside capital loss above ${pct(POLICY.maxDownsideLoss, 0)}) or attractiveness below ${POLICY.conditionsMin}. A high IRR alone is never a TAKE.`),
    bi(`INSUFFICIENT EVIDENCE: אין שווי לחיתום בלתי תלוי (מחיר היזם אינו כזה), אף מבנה לא חושב, או ציון ראיות מתחת ל-${POLICY.evidence.insufficient}. חסר לעולם אינו מתורגם לאפס ואינו משפר דירוג.`, `INSUFFICIENT EVIDENCE: no independent underwriting value (the developer's price is not one), no structure computed, or an evidence score below ${POLICY.evidence.insufficient}. A missing value is never zero and never raises a rating.`),
    bi(`אטרקטיביות = ממוצע משוקלל של קבוצות הגורמים הזמינות (תשואה ${POLICY.weights.returns} · הגנה ${POLICY.weights.downside} · מבנה ${POLICY.weights.structure} · ביצוע ${POLICY.weights.execution} · שוק ${POLICY.weights.market}) פחות 5 לכל סף בהחמצה קלה / לא קריטי פתוח (עד 20). קבוצה ללא נתונים אינה נספרת ואינה מוחלפת בערך ניטרלי. תיאור: ≥80 אטרקטיבית מאוד · 65–79 אטרקטיבית · 50–64 שולית · <50 חלשה.`, `Attractiveness = the weighted mean of the available factor groups (return ${POLICY.weights.returns} · downside ${POLICY.weights.downside} · structure ${POLICY.weights.structure} · execution ${POLICY.weights.execution} · market ${POLICY.weights.market}) minus 5 per near-miss / open non-critical gate (max 20). A group without data is left out, never replaced by a neutral value. Descriptor: ≥80 VERY ATTRACTIVE · 65–79 ATTRACTIVE · 50–64 MARGINAL · <50 WEAK.`),
    bi(`איכות ראיות = 100 פחות ניכויים מתועדים (מקור השווי, שומה, פער בין מקורות, סטטוס, יזם, ברירות מחדל מהותיות, נתוני PROPX, גיל התצפית, גיל השליפה, סתירות, רעננות למ״ס): ≥${POLICY.evidence.high} גבוהה · ${POLICY.evidence.medium}–${POLICY.evidence.high - 1} בינונית · <${POLICY.evidence.medium} נמוכה. אינה הסתברות.`, `Evidence quality = 100 minus documented deductions (value source, appraisal, source spread, status, developer, material defaults, PROPX data, observation age, retrieval age, conflicts, CBS freshness): ≥${POLICY.evidence.high} HIGH · ${POLICY.evidence.medium}–${POLICY.evidence.high - 1} MEDIUM · <${POLICY.evidence.medium} LOW. Not a probability.`),
    bi('מבנה מומלץ = המבנה הכשיר (TAKE / בכפוף לתנאים) עם האטרקטיביות הגבוהה ביותר; שוויון נשבר לפי ההגנה בתרחיש השלילי. המבנה השני = הבא אחריו.', 'Recommended structure = the eligible structure (TAKE / WITH CONDITIONS) with the highest attractiveness; ties break on downside protection. Second best = the next one.'),
    bi('החלטה סופית = ההכרעה הכלכלית ⊕ הערכת שוק וביצוע (altaris-market-assessment-v1) ⊕ איכות ראיות ⊕ ספי הקרן, דרך הכללים F0–F5 בלבד: אין הערכה → הכלכלה עומדת; INSUFFICIENT כלכלי → INSUFFICIENT; PASS כלכלי → PASS (שוק טוב אינו מציל כלכלה חלשה); TAKE + זהירות → TAKE WITH CONDITIONS עם תנאי שוק מפורש ומה יסיר אותו; TAKE WITH CONDITIONS + זהירות → התנאי מתווסף; חזק / ניטרלי → ללא שינוי. זהירות = ≥ 2 גורמים שליליים מהותיים מ-≥ 2 משפחות מקור בלתי תלויות; אות חלש / ישן / מודל / ארצי לעולם אינו יוצר זהירות לבדו. השוק לעולם אינו משנה IRR, MOIC, תזרים, פירעון או הון בסיכון.',
      'FINAL DECISION = the economic verdict ⊕ the Market & Execution Assessment (altaris-market-assessment-v1) ⊕ evidence quality ⊕ fund gates, through rules F0–F5 only: no assessment → the economics stand; economic INSUFFICIENT → INSUFFICIENT; economic PASS → PASS (a good market never rescues weak economics); TAKE + CAUTION → TAKE WITH CONDITIONS with an explicit market condition and what would remove it; TAKE WITH CONDITIONS + CAUTION → the condition is added; STRONG / NEUTRAL → unchanged. CAUTION = ≥ 2 material negative factors from ≥ 2 independent source families; a weak / stale / model / national signal never creates CAUTION alone. The market never changes IRR, MOIC, cash flows, repayment or capital at risk.'),
  ]);

  return { VERSION, POLICY, POLICY_TEXT, VERDICT, DESCRIPTOR, EVIDENCE, GROUP_LABEL, GATE_LABEL, DISCLAIMER, decide, flips, narrative, assess, t: T, fmtV };
});
