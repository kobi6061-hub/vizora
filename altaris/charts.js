/* ALTARIS · charts — inline SVG, no library.
 * Every chart answers one investment question, carries hover/focus tips
 * (data-tip, wired by app.js) and a table twin, and colors marks with tokens:
 * strategy identity = --ax-buy/--ax-fin/--ax-hyb (validated palette), polarity
 * = --up/--down, totals = --navy. Text always wears text tokens.
 * Also exports AXF, the number/date formatting shared by the page.
 */
(function (root) {
  'use strict';
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const AXF = {
    esc,
    int: (v) => (isNum(v) ? NF.format(Math.round(v)) : '—'),
    nis: (v) => (isNum(v) ? (v < 0 ? '−' : '') + '₪' + NF.format(Math.round(Math.abs(v))) : '—'),
    m: (v) => {
      if (!isNum(v)) return '—';
      const a = Math.abs(v), s = v < 0 ? '−' : '';
      if (a >= 1e9) return s + '₪' + (a / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return s + '₪' + (a / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + 'M';
      if (a >= 1e3) return s + '₪' + Math.round(a / 1e3) + 'K';
      return s + '₪' + Math.round(a);
    },
    pct: (x, d = 1) => (isNum(x) ? (x < 0 ? '−' : '') + (Math.abs(x) * 100).toFixed(d) + '%' : '—'),
    pp: (x, d = 1) => (isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + (Math.abs(x) * 100).toFixed(d) + ' נ״א' : '—'),
    x: (v) => (isNum(v) ? v.toFixed(2) + 'x' : '—'),
    mo: (v) => (isNum(v) ? Math.round(v) + ' ח׳' : '—'),
    date: (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : '—'; },
    signed: (v) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + '₪' + NF.format(Math.round(Math.abs(v))) : '—'),
  };
  const STRAT_C = { buy: 'var(--ax-buy)', finance: 'var(--ax-fin)', hybrid: 'var(--ax-hyb)' };
  const STRAT_N = { buy: 'BUY', finance: 'FINANCE', hybrid: 'HYBRID' };

  const twin = (head, rows, title) => `<details class="ax-twin"><summary>${esc(title || 'הצג כטבלה')}</summary><div class="ax-tbl-wrap"><table class="ax-tbl data"><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  const wrap = (title, question, svg, extra) => `<figure class="ax-chart">${title ? `<h4>${esc(title)}</h4>` : ''}${question ? `<p class="q">${esc(question)}</p>` : ''}${svg}${extra || ''}</figure>`;
  const nice = (lo, hi, n = 4) => {
    if (!(hi > lo)) { hi = lo + 1; }
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0) || step0;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = []; for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo: a, hi: b, ticks };
  };
  const tipAttr = (s) => ` data-tip="${esc(s)}" tabindex="0"`;
  /* a bar with a 4px rounded data end and a square baseline end (dir: +1 grows right, −1 grows left) */
  function hbar(x0, x1, y, h, fill, tip) {
    const a = Math.min(x0, x1), w = Math.max(1, Math.abs(x1 - x0)), r = Math.min(4, w / 2, h / 2);
    const right = x1 >= x0;   // the data end is on the right when the bar grows rightwards
    const d = right
      ? `M${a},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`
      : `M${a + w},${y}h${-(w - r)}a${r},${r} 0 0 0 ${-r},${r}v${h - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${w - r}z`;
    return `<path d="${d}" fill="${fill}"${tip ? tipAttr(tip) : ''}/>`;
  }
  function vbar(x, y0, y1, w, fill, tip) {
    const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0)), r = Math.min(4, w / 2, h / 2);
    const up = y1 <= y0;
    const d = up
      ? `M${x},${top + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`
      : `M${x},${top}v${h - r}a${r},${r} 0 0 0 ${r},${r}h${w - 2 * r}a${r},${r} 0 0 0 ${r},${-r}v${-(h - r)}z`;
    return `<path d="${d}" fill="${fill}"${tip ? tipAttr(tip) : ''}/>`;
  }

  /**
   * Horizontal waterfall. items: [{label, v, total}] — a total is drawn from 0,
   * a step floats from the running sum. fmt formats values.
   */
  function waterfall(items, o) {
    o = o || {};
    const fmt = o.fmt || AXF.m;
    const W = Math.round(o.w || 640), labelW = Math.min(168, Math.round(W * 0.36)), rowH = 25, barH = 14, pad = 6;
    let cum = 0; const rows = [];
    for (const it of items) {
      if (!isNum(it.v)) continue;
      if (it.total) { rows.push({ ...it, a: 0, b: it.v }); cum = it.v; }
      else { rows.push({ ...it, a: cum, b: cum + it.v }); cum += it.v; }
    }
    if (!rows.length) return '';
    const vals = rows.flatMap((r) => [r.a, r.b]).concat([0]);
    const sc = nice(Math.min(...vals), Math.max(...vals));
    const x0 = 46, x1 = W - labelW - 12;
    const X = (v) => x0 + (v - sc.lo) / (sc.hi - sc.lo) * (x1 - x0);
    const H = pad + rows.length * rowH + 22;
    let g = '';
    for (const t of sc.ticks) g += `<line class="gr" x1="${X(t)}" x2="${X(t)}" y1="${pad - 2}" y2="${H - 20}"/><text class="lbl" x="${X(t)}" y="${H - 6}" text-anchor="middle" direction="ltr">${esc(o.tick ? o.tick(t) : fmt(t))}</text>`;
    g += `<line class="ax" x1="${X(0)}" x2="${X(0)}" y1="${pad - 2}" y2="${H - 20}"/>`;
    rows.forEach((r, i) => {
      const y = pad + i * rowH + (rowH - barH) / 2;
      const fill = r.total ? 'var(--navy)' : r.v >= 0 ? 'var(--up)' : 'var(--down)';
      const tip = `${r.label}: ${r.total ? fmt(r.v) : (r.v >= 0 ? '+' : '') + fmt(r.v)}${r.total ? '' : `\nמצטבר: ${fmt(r.b)}`}${r.how ? '\n' + r.how : ''}`;
      g += hbar(X(r.a), X(r.b), y, barH, fill, tip);
      if (i < rows.length - 1 && !rows[i + 1].total) g += `<line x1="${X(r.b)}" x2="${X(r.b)}" y1="${y + barH}" y2="${y + rowH}" stroke="var(--ax-axis)" stroke-width="1"/>`;
      const end = Math.max(X(r.a), X(r.b)), start = Math.min(X(r.a), X(r.b));
      const txt = r.total ? fmt(r.v) : (r.v >= 0 ? '+' : '') + fmt(r.v);
      const outside = end + 4 + txt.length * 6.2 < x1 + 4;
      g += `<text class="val" x="${outside ? end + 4 : start - 4}" y="${y + barH - 3}" text-anchor="${outside ? 'start' : 'end'}" direction="ltr">${esc(txt)}</text>`;
      g += `<text class="lbl" x="${W - 2}" y="${y + barH - 3}" text-anchor="start" direction="rtl" style="font-weight:${r.total ? 700 : 400}">${esc(r.label)}</text>`;
    });
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || '')}">${g}</svg>`;
    return wrap(o.title, o.question, svg, twin(['שלב', 'סכום', 'מצטבר'], rows.map((r) => [r.label, r.total ? fmt(r.v) : (r.v >= 0 ? '+' : '') + fmt(r.v), fmt(r.b)])));
  }

  /** Sources & uses: two stacked bars of equal total, segments separated by a 2px surface gap */
  function sourcesUses(su, labels, o) {
    o = o || {};
    if (!su || !(su.total > 0)) return '';
    const W = Math.round(o.w || 640), labelW = 70, x0 = 4, x1 = W - labelW - 8, barH = 22;
    const X = (v) => x0 + v / su.total * (x1 - x0);
    const COL = { price: 'var(--navy)', tax: 'var(--brass)', costs: 'var(--ax-fin)', fee: 'var(--ax-hyb)', carry: 'var(--ink-3)', debt: 'var(--ax-buy)', equity: 'var(--navy)',
      advance: 'var(--navy)', capital: 'var(--navy)' };
    let g = '';
    const row = (list, y, name) => {
      let acc = 0;
      for (const s of list) {
        if (!(s.v > 0)) continue;
        const a = X(acc), b = X(acc + s.v) - 2;
        g += `<rect x="${Math.min(a, b)}" y="${y}" width="${Math.max(1, Math.abs(b - a))}" height="${barH}" rx="3" fill="${COL[s.k] || 'var(--ink-3)'}"${tipAttr(`${labels[s.k] || s.k}: ${AXF.nis(s.v)} (${AXF.pct(s.v / su.total)})`)}/>`;
        acc += s.v;
      }
      g += `<text class="lbl" x="${W - 2}" y="${y + barH - 7}" text-anchor="start" direction="rtl" style="font-weight:700">${esc(name)}</text>`;
    };
    row(su.uses, 6, 'שימושים'); row(su.sources, 6 + barH + 12, 'מקורות');
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${6 + barH * 2 + 18}" role="img" aria-label="מקורות ושימושים">${g}</svg>`;
    const all = su.uses.concat(su.sources).filter((s) => s.v > 0);
    const legend = `<div class="ax-legend">${all.map((s) => `<span><i style="--c:${COL[s.k] || 'var(--ink-3)'}"></i>${esc(labels[s.k] || s.k)} <b class="num">${AXF.m(s.v)}</b></span>`).join('')}</div>`;
    return wrap(o.title, o.question, svg, legend + twin(['רכיב', 'סכום', 'שיעור'], all.map((s) => [labels[s.k] || s.k, AXF.nis(s.v), AXF.pct(s.v / su.total)])));
  }

  /**
   * Margin-of-safety ladder: a vertical value scale with markers, the safety band
   * (break-even → supported value) and the loss zone below break-even.
   */
  function ladder(markers, o) {
    o = o || {};
    const ms = markers.filter((m) => isNum(m.v) && m.v > 0);
    if (!ms.length) return '';
    const be = ms.find((m) => m.k === 'be');
    const top = Math.max(...ms.map((m) => m.v)) * 1.04, bot = Math.min(...ms.map((m) => m.v)) * 0.9;
    const W = Math.round(o.w || 640), H = 260, y0 = 10, y1 = H - 10, xb0 = Math.round(W * 0.47), xb1 = Math.round(W * 0.47 + Math.min(90, W * 0.16));
    const Y = (v) => y1 - (v - bot) / (top - bot) * (y1 - y0);
    let g = '';
    if (be) {
      g += `<rect x="${xb0}" y="${Y(be.v)}" width="${xb1 - xb0}" height="${y1 - Y(be.v)}" fill="var(--down-wash)"${tipAttr('אזור הפסד: מכירה מתחת לנקודת האיזון')}/>`;
      const sm = ms.find((m) => m.k === 'smv');
      if (sm) g += `<rect x="${xb0}" y="${Y(sm.v)}" width="${xb1 - xb0}" height="${Math.max(1, Y(be.v) - Y(sm.v))}" fill="var(--up-wash)"${tipAttr(`מרווח ביטחון: ${AXF.m(sm.v - be.v)} (${AXF.pct(1 - be.v / sm.v)}) בין השווי הנתמך לנקודת האיזון`)}/>`;
      if (y1 - Y(be.v) > 22) g += `<text class="lbl" x="${(xb0 + xb1) / 2}" y="${(Y(be.v) + y1) / 2 + 4}" text-anchor="middle" style="fill:var(--down);font-weight:700">הפסד</text>`;
    }
    g += `<line class="ax" x1="${xb0}" x2="${xb0}" y1="${y0}" y2="${y1}"/><line class="ax" x1="${xb1}" x2="${xb1}" y1="${y0}" y2="${y1}"/>`;
    const sorted = ms.slice().sort((a, b) => b.v - a.v);
    let lastY = -99;
    for (const m of sorted) {
      const y = Y(m.v); const ly = Math.max(y, lastY + 15); lastY = ly;
      const col = m.k === 'be' ? 'var(--down)' : m.k === 'smv' ? 'var(--navy)' : m.k === 'basis' || m.k === 'price' ? 'var(--brass)' : 'var(--ink-2)';
      g += `<line x1="${xb0 - 8}" x2="${xb1 + 8}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2"${tipAttr(`${m.label}: ${AXF.nis(m.v)}${m.note ? '\n' + m.note : ''}`)}/>`;
      g += `<text class="lbl" x="${xb1 + 14}" y="${ly + 4}" direction="ltr" text-anchor="start" style="font-weight:700;fill:var(--ink)">${esc(AXF.m(m.v))}</text>`;
      g += `<text class="lbl" x="${xb0 - 14}" y="${ly + 4}" direction="rtl" text-anchor="start" style="font-weight:${m.k === 'be' || m.k === 'smv' ? 700 : 400}">${esc(m.label)}</text>`;
    }
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${H}" role="img" aria-label="סולם מרווח הביטחון">${g}</svg>`;
    return wrap(o.title, o.question, svg, twin(['סמן', 'שווי', 'מול שווי נתמך'], sorted.map((m) => [m.label, AXF.nis(m.v), o.smv ? AXF.pct(m.v / o.smv - 1) : '—'])));
  }

  /** capital timeline: cumulative cash position per strategy (one axis, NIS) */
  function cumulative(series, o) {
    o = o || {};
    const S = series.filter((s) => s.flows && s.flows.length);
    if (!S.length) return '';
    const maxM = Math.max(...S.map((s) => s.flows[s.flows.length - 1].m));
    const cums = S.map((s) => { let c = 0; const byM = new Map(s.flows.map((f) => [f.m, f.amount])); const pts = []; for (let m = 0; m <= maxM; m++) { c += byM.get(m) || 0; pts.push(c); } return pts; });
    const all = cums.flat().concat([0]);
    const sc = nice(Math.min(...all), Math.max(...all));
    const W = Math.round(o.w || 640), H = 240, x0 = 56, x1 = W - 12, y0 = 8, y1 = H - 24;
    const X = (m) => x0 + m / Math.max(1, maxM) * (x1 - x0);
    const Y = (v) => y1 - (v - sc.lo) / (sc.hi - sc.lo) * (y1 - y0);
    let g = '';
    for (const t of sc.ticks) g += `<line class="gr" x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}"/><text class="lbl" x="${x0 - 6}" y="${Y(t) + 4}" text-anchor="end" direction="ltr">${esc(AXF.m(t))}</text>`;
    g += `<line class="ax" x1="${x0}" x2="${x1}" y1="${Y(0)}" y2="${Y(0)}"/>`;
    const stepM = maxM <= 24 ? 6 : 12;
    for (let m = 0; m <= maxM; m += stepM) g += `<text class="lbl" x="${X(m)}" y="${H - 6}" text-anchor="middle" direction="ltr">${m}</text>`;
    g += `<text class="lbl" x="${x0 + 4}" y="${y0 + 10}" direction="rtl" text-anchor="end" style="fill:var(--ink-3)">חודשים מ-T0</text>`;
    S.forEach((s, i) => {
      const pts = cums[i];
      g += `<path d="${pts.map((v, m) => `${m ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${STRAT_C[s.k]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const minV = Math.min(...pts), mi = pts.indexOf(minV);
      g += `<circle cx="${X(mi)}" cy="${Y(minV)}" r="4.5" fill="${STRAT_C[s.k]}" stroke="var(--panel)" stroke-width="2"${tipAttr(`${STRAT_N[s.k]} · שיא הון בסיכון ${AXF.m(-minV)} (חודש ${mi})`)}/>`;
      const end = pts[pts.length - 1];
      g += `<circle cx="${X(pts.length - 1)}" cy="${Y(end)}" r="4" fill="${STRAT_C[s.k]}" stroke="var(--panel)" stroke-width="2"/>`;
    });
    /* hover columns: one readout per month with every series */
    const colW = (x1 - x0) / Math.max(1, maxM);
    for (let m = 0; m <= maxM; m++) {
      const tip = `חודש ${m}\n` + S.map((s, i) => `${STRAT_N[s.k]}: ${AXF.m(cums[i][m])}`).join('\n');
      g += `<rect x="${X(m) - colW / 2}" y="${y0}" width="${colW}" height="${y1 - y0}" fill="transparent" data-tip="${esc(tip)}"/>`;
    }
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'ציר הון')}">${g}</svg>`;
    const legend = `<div class="ax-legend">${S.map((s) => `<span><i class="ln" style="--c:${STRAT_C[s.k]}"></i>${STRAT_N[s.k]}</span>`).join('')}</div>`;
    const rows = [];
    for (let m = 0; m <= maxM; m += (maxM > 36 ? 3 : 1)) rows.push([String(m)].concat(S.map((s, i) => AXF.nis(cums[i][m]))));
    return wrap(o.title, o.question, svg, legend + twin(['חודש'].concat(S.map((s) => STRAT_N[s.k])), rows));
  }

  /** strategy comparison: base vs downside IRR per structure (dumbbell), with the fund's IRR hurdle */
  function dumbbell(rows, o) {
    o = o || {};
    const R = rows.filter((r) => isNum(r.base));
    if (!R.length) return '';
    const vals = R.flatMap((r) => [r.base, r.down, r.up].filter(isNum)).concat([0, o.hurdle || 0]);
    const sc = nice(Math.min(...vals), Math.max(...vals));
    const W = Math.round(o.w || 640), labelW = 90, rowH = 40, x0 = 12, x1 = W - labelW - 12, H = R.length * rowH + 30;
    const X = (v) => x0 + (v - sc.lo) / (sc.hi - sc.lo) * (x1 - x0);
    let g = '';
    for (const t of sc.ticks) g += `<line class="gr" x1="${X(t)}" x2="${X(t)}" y1="4" y2="${H - 22}"/><text class="lbl" x="${X(t)}" y="${H - 6}" text-anchor="middle" direction="ltr">${esc(AXF.pct(t, 0))}</text>`;
    g += `<line class="ax" x1="${X(0)}" x2="${X(0)}" y1="4" y2="${H - 22}"/>`;
    if (isNum(o.hurdle)) g += `<line x1="${X(o.hurdle)}" x2="${X(o.hurdle)}" y1="2" y2="${H - 22}" stroke="var(--brass)" stroke-width="2"${tipAttr(`רף IRR של הקרן: ${AXF.pct(o.hurdle)}`)}/><text class="lbl" x="${X(o.hurdle) + 4}" y="12" direction="ltr" style="fill:var(--brass);font-weight:700">${esc('רף ' + AXF.pct(o.hurdle, 0))}</text>`;
    R.forEach((r, i) => {
      const y = 18 + i * rowH, c = STRAT_C[r.k];
      if (isNum(r.down)) g += `<line x1="${X(r.down)}" x2="${X(r.base)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="2"/>`;
      if (isNum(r.up)) g += `<line x1="${X(r.base)}" x2="${X(r.up)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="1" opacity=".5"/>`;
      if (isNum(r.down)) g += `<circle cx="${X(r.down)}" cy="${y}" r="5" fill="var(--panel)" stroke="${c}" stroke-width="2"${tipAttr(`${STRAT_N[r.k]} · שלילי: ${AXF.pct(r.down)}`)}/>`;
      if (isNum(r.up)) g += `<circle cx="${X(r.up)}" cy="${y}" r="3.5" fill="${c}" opacity=".55"${tipAttr(`${STRAT_N[r.k]} · חיובי: ${AXF.pct(r.up)}`)}/>`;
      g += `<circle cx="${X(r.base)}" cy="${y}" r="6" fill="${c}" stroke="var(--panel)" stroke-width="2"${tipAttr(`${STRAT_N[r.k]} · בסיס: ${AXF.pct(r.base)}`)}/>`;
      g += `<text class="val" x="${X(r.base)}" y="${y - 10}" text-anchor="middle" direction="ltr">${esc(AXF.pct(r.base))}</text>`;
      g += `<text class="lbl" x="${W - 2}" y="${y + 4}" text-anchor="start" direction="rtl" style="font-weight:700">${esc(STRAT_N[r.k])}</text>`;
    });
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${H}" role="img" aria-label="השוואת IRR">${g}</svg>`;
    const legend = `<div class="ax-legend"><span><i style="--c:var(--ink-2);border-radius:99px"></i>בסיס</span><span><i style="--c:transparent;border:2px solid var(--ink-2);border-radius:99px;width:9px;height:9px"></i>תרחיש שלילי</span><span><i style="--c:var(--ink-3);opacity:.55;border-radius:99px;width:7px;height:7px"></i>תרחיש חיובי</span><span><i style="--c:var(--brass);width:2px;height:12px;border-radius:0"></i>רף הקרן</span></div>`;
    return wrap(o.title, o.question, svg, legend + twin(['מבנה', 'שלילי', 'בסיס', 'חיובי'], R.map((r) => [STRAT_N[r.k], AXF.pct(r.down), AXF.pct(r.base), AXF.pct(r.up)])));
  }

  /** horizontal share bars with an optional limit marker (portfolio exposure) */
  function shareBars(rows, o) {
    o = o || {};
    if (!rows.length) return '';
    const W = Math.round(o.w || 640), labelW = Math.min(150, Math.round(W * 0.32)), rowH = 24, x0 = 4, x1 = W - labelW - 60;
    const max = Math.max(o.limit || 0, ...rows.map((r) => r.share || 0), 0.01);
    const X = (v) => x0 + v / max * (x1 - x0);
    const H = rows.length * rowH + 8;
    let g = '';
    rows.forEach((r, i) => {
      const y = 4 + i * rowH;
      const over = o.limit && r.share > o.limit;
      g += hbar(X(0), X(r.share || 0), y + 5, 13, r.c || (over ? 'var(--down)' : 'var(--navy)'), `${r.label}: ${AXF.m(r.v)} · ${AXF.pct(r.share)}${o.limit ? ` (תקרה ${AXF.pct(o.limit, 0)})` : ''}`);
      g += `<text class="val" x="${X(r.share || 0) + 5}" y="${y + 16}" direction="ltr">${esc(AXF.pct(r.share))}</text>`;
      g += `<text class="lbl" x="${W - 2}" y="${y + 16}" text-anchor="start" direction="rtl">${esc(r.label)}</text>`;
    });
    if (o.limit) g += `<line x1="${X(o.limit)}" x2="${X(o.limit)}" y1="0" y2="${H}" stroke="var(--brass)" stroke-width="2"${tipAttr(`תקרת חשיפה: ${AXF.pct(o.limit, 0)}`)}/>`;
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || '')}">${g}</svg>`;
    return wrap(o.title, o.question, svg, twin(['', 'הון', 'שיעור'], rows.map((r) => [r.label, AXF.nis(r.v), AXF.pct(r.share)])));
  }

  /** columns by period (capital return calendar / velocity cycles) */
  function columns(rows, o) {
    o = o || {};
    if (!rows.length) return '';
    const W = Math.round(o.w || 640), H = 210, x0 = 56, x1 = W - 8, y0 = 10, y1 = H - 26;
    const keys = o.series || [{ k: 'v', c: 'var(--navy)', n: '' }];
    const max = Math.max(...rows.flatMap((r) => keys.map((s) => r[s.k] || 0)), 1);
    const sc = nice(0, max);
    const Y = (v) => y1 - v / sc.hi * (y1 - y0);
    const band = (x1 - x0) / rows.length, bw = Math.min(24, band / (keys.length + 0.8));
    let g = '';
    for (const t of sc.ticks) g += `<line class="gr" x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}"/><text class="lbl" x="${x0 - 6}" y="${Y(t) + 4}" text-anchor="end" direction="ltr">${esc(AXF.m(t))}</text>`;
    rows.forEach((r, i) => {
      const cx = x0 + band * i + band / 2, start = cx - (bw * keys.length + 2 * (keys.length - 1)) / 2;
      keys.forEach((s, j) => {
        if (!(r[s.k] > 0)) return;
        g += vbar(start + j * (bw + 2), Y(0), Y(r[s.k]), bw, s.c, `${r.label}${s.n ? ' · ' + s.n : ''}: ${AXF.m(r[s.k])}`);
      });
      g += `<text class="lbl" x="${cx}" y="${H - 8}" text-anchor="middle" direction="ltr">${esc(r.label)}</text>`;
    });
    g += `<line class="ax" x1="${x0}" x2="${x1}" y1="${Y(0)}" y2="${Y(0)}"/>`;
    const svg = `<svg width="${W}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || '')}">${g}</svg>`;
    const legend = keys.length > 1 ? `<div class="ax-legend">${keys.map((s) => `<span><i style="--c:${s.c}"></i>${esc(s.n)}</span>`).join('')}</div>` : '';
    return wrap(o.title, o.question, svg, legend + twin([o.periodLabel || 'תקופה'].concat(keys.map((s) => s.n || 'סכום')), rows.map((r) => [r.label].concat(keys.map((s) => AXF.nis(r[s.k]))))));
  }

  root.AXF = AXF;
  root.AxCharts = { waterfall, sourcesUses, ladder, cumulative, dumbbell, shareBars, columns, twin, STRAT_C, STRAT_N };
})(typeof self !== 'undefined' ? self : this);
