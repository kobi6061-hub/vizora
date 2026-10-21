#!/usr/bin/env node
'use strict';
/* PROPX · Explain Everything — MEASURED explanation coverage of the page's labels.
 *
 * Enumerates every label the page (index.html) can show, by fixed extraction rules (R1–R8 below, nothing sampled), classifies each
 * one as MEANINGFUL or CHROME by the explicit, reviewable lists in this file (a label in neither list is MEANINGFUL — an
 * unreviewed label counts against coverage, never for it), and reports which meaningful labels carry an explanation:
 *   INLINE       every place the renderer prints the label also prints an ⓘ (xpBtn / xpMiss / xpSig in the same construct)
 *   ANCHOR       the registry's ANCHORS maps the label to a term — lib/explain/attach.js attaches the ⓘ at run time
 *   ORIENTATION  a section heading whose section carries "how to read this" (ORIENT_IDS → registry SECTIONS)
 * Writes lib/explain/coverage.json (covered vs uncovered by page section and in total, the uncovered list, the intentional
 * exclusions with their reasons, and TERM COMPLETENESS: simple + example + why + source in he + en for every term).
 *
 * A label is identified by its string-table reference — `I18N.medPrice`, `SRT.cols.3`, `GX_I18N.c.units` — the key the renderer
 * reads, so one decision covers every place the same key is printed; a markup label by `i:<data-i key>`; an inline bilingual
 * literal by `lit:<en>|<he>`. The runtime attacher resolves the same references against the page's own tables (text match inside
 * label containers, optionally scoped), so what is measured here is what attaches there.
 *
 * Rules (main inline script unless stated):
 *   R1 markup        every `data-i="KEY"` element in the page markup
 *   R2 table head    `<th …>${EXPR}` — and `[…keys].map(k=>`<th>${OBJ[k]}`)`, `ARR.map(c=>`<th>${c}`)` (every array element)
 *   R3 columns       column configs `{k:"…",label:EXPR}` / `{key:"…",…,label:EXPR}` (ptHead tables)
 *   R4 KPI cards     `{k:"…",l:EXPR,…}` objects in renderKPIs (an `xp:` / `xm:` member = INLINE)
 *   R5 helpers       a local helper whose template prints a parameter inside a label container (class "k" / "l" / "lbl", <th>,
 *                    <dt>, <summary>, <h2–h5>) — every call of it in the same function prints that argument as a label
 *   R6 headings      `<h2–h5 …>${EXPR}` · R7 `<summary …>${EXPR}` · R8 `<dt …>${EXPR}` written inline
 * Not in the universe (stated, not hidden): form-input labels (they name the user's own inputs), button texts, notes and
 * sentences (`.ho-note`, `.gv-note`, …), status / error messages, the separately loaded modules (lib/deal/ui.js,
 * lib/changes/ui.js — their own workstreams), ALTARIS (its own page). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'lib/explain/coverage.json');

/* ---------------- the page and its string tables ---------------- */
const TABLES = ['I18N', 'TXE', 'NH_I18N', 'OT_I18N', 'TXF', 'RCT', 'TCT', 'SIT', 'STE', 'SRT', 'IN_I18N', 'DD_I18N', 'DDP_I18N', 'GX_I18N', 'TC_I18N', 'TXC', 'XP_T', 'WS_I18N'];
const ACCESSORS = { T: 'I18N', GXT: 'GX_I18N', DT: 'DD_I18N', IT: 'IN_I18N', wsT: 'WS_I18N', DP: 'DDP_I18N', txeT: 'TXE', xpT: 'XP_T', srT: 'SRT', siT: 'SIT', TT: 'TC_I18N', NT: 'NH_I18N' };
function balanced(s, i, open = '{', close = '}') {   /* s[i] === open → the index after its matching close; strings, templates and comments skipped */
  let d = 0, q = null, esc = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (q) {
      if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; }
      if (c === q) q = null; else if (q === '`' && c === '$' && s[k + 1] === '{') { const e = balanced(s, k + 1); if (e < 0) return -1; k = e - 1; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && s[k + 1] === '*') { k = s.indexOf('*/', k + 2) + 1; continue; }
    if (c === open) d++; else if (c === close) { d--; if (!d) return k + 1; }
  }
  return -1;
}
/* every identifier the table literals mention resolves to an inert stand-in, so a table evaluates without the page around it */
const STAND_IN = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : function standIn() { return ''; }), set: (t, k, v) => { t[k] = v; return true; } });
function loadPage() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('<script>', html.indexOf('/data/cbs-sales/latest.js')) + '<script>'.length;
  const b = html.indexOf('</script>', a);
  const S = html.slice(a, b);
  const markup = html.slice(html.indexOf('<body'), html.indexOf('<script src="/lib/table/core.js">'));
  const TBL = {};
  for (const name of TABLES) {
    const m = new RegExp('\\nconst ' + name + '=\\{').exec(S); if (!m) continue;
    const st = m.index + m[0].length - 1, en = balanced(S, st);
    TBL[name] = vm.runInNewContext('(' + S.slice(st, en) + ')', STAND_IN);
  }
  return { html, S, markup, TBL };
}

/* ---------------- expressions → string-table references ---------------- */
function makeResolver(S, TBL) {
  const lines = []; for (let i = 0; i < S.length; i++) if (i === 0 || S[i - 1] === '\n') lines.push(i);
  const TOP = /^(?:async )?function \w|^const \w+=(?:\(|async|function|\w+=>)|^let \w+=/;
  const tops = lines.filter((ls) => TOP.test(S.slice(ls, ls + 60)));
  const blockStart = (pos) => { let lo = 0, hi = tops.length - 1, r = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= pos) { r = tops[mid]; lo = mid + 1; } else hi = mid - 1; } return r; };
  const blockEnd = (pos) => { for (const t of tops) if (t > pos) return t; return S.length; };
  const blockName = (pos) => { const bs = blockStart(pos); const m = /^(?:async )?function (\w+)|^const (\w+)|^let (\w+)/.exec(S.slice(bs, bs + 80)); return m ? (m[1] || m[2] || m[3]) : '?'; };
  const pathOf = (s) => { const out = []; const re = /\.(\w+)|\[(?:"([^"]+)"|(\d+))\]/g; let m; while ((m = re.exec(s || ''))) out.push(m[1] || m[2] || m[3]); return out; };
  const LANGIDX = /^(\w+)\[(?:state\.lang(?:==="en"\?"en":"he")?|L|lang|he\?"he":"en")\]((?:\.\w+|\[(?:"[^"]+"|\d+)\])*)$/;
  function bindOf(v, pos, depth) {
    if (depth > 5) return null;
    const bs = blockStart(pos), seg = S.slice(bs, pos);
    const re = new RegExp('(?:^|[\\s,;({])' + v + '=([^,;\\n]+?)(?=[,;\\n]|$)', 'g'); let m, last = null, at = 0;
    while ((m = re.exec(seg))) { last = m[1].trim(); at = m.index; }
    return last ? resolve(last, bs + at, depth + 1) : null;
  }
  function resolve(e, pos, depth = 0) {
    e = e.trim(); let m;
    if ((m = /^(\w+)\(\)((?:\.\w+|\[(?:"[^"]+"|\d+)\])*)$/.exec(e)) && ACCESSORS[m[1]]) return { t: ACCESSORS[m[1]], p: pathOf(m[2]) };
    if ((m = LANGIDX.exec(e)) && TBL[m[1]]) return { t: m[1], p: pathOf(m[2]) };
    if ((m = /^(\w+)((?:\.\w+|\[(?:"[^"]+"|\d+)\])*)$/.exec(e))) { const b = bindOf(m[1], pos, depth); return b ? { t: b.t, p: b.p.concat(pathOf(m[2])) } : null; }
    return null;
  }
  const valueOf = (ref) => { const [t, ...p] = ref.split('.'); const o = { he: TBL[t] && TBL[t].he, en: TBL[t] && TBL[t].en }; for (const k of p) { o.he = o.he == null ? undefined : o.he[k]; o.en = o.en == null ? undefined : o.en[k]; } return o; };
  /* a label expression → { ref } | { lit } | { raw } (raw = not a fixed label: a value, a name, a computed string) */
  function label(e, pos) {
    e = e.trim(); let m;
    while ((m = /^(?:ldE|inE|ptEsc|bl)\((.*)\)$/s.exec(e))) e = m[1].trim();
    if ((m = /^(?:state\.lang|L)==="en"\?"([^"]*)":"([^"]*)"$/.exec(e))) return { lit: { en: m[1], he: m[2] } };
    if ((m = /^he\?"([^"]*)":"([^"]*)"$/.exec(e))) return { lit: { en: m[2], he: m[1] } };
    if ((m = /^"([^"]+)"$/.exec(e))) return { lit: { en: m[1], he: m[1] } };                 /* a language-free literal ("HHI") */
    let call = false;
    if ((m = /^([\w.]+(?:\[(?:"[^"]+"|\d+)\])*)\(.*\)$/s.exec(e)) && /\./.test(m[1])) { e = m[1]; call = true; }
    const r = resolve(e, pos); if (!r || !r.p.length) return { raw: e };
    const ref = r.t + '.' + r.p.join('.'); const v = valueOf(ref);
    if (v.he === undefined && v.en === undefined) return { raw: e, missingRef: ref };
    return { ref, call: call || typeof v.en === 'function' };
  }
  return { blockStart, blockEnd, blockName, resolve, label, valueOf };
}
/* split a call's argument text at top-level commas */
function splitArgs(s) {
  const out = []; let d = 0, q = null, esc = false, cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) q = null; else if (q === '`' && c === '$' && s[k + 1] === '{') { const e = balanced(s, k + 1); cur += s.slice(k + 1, e); k = e - 1; } continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}
const XPRE = /xpBtn\(|xpMiss\(|xpSig\(/;

/* ---------------- the extraction rules ---------------- */
function extract(page) {
  const { S, markup, TBL } = page, R = makeResolver(S, TBL), sites = [];
  /* one label expression may name several labels: `c?A:B` (both), `A+" "+…` / `` `${A} …` `` (the first), `OBJ[k]` inside
     `[…keys].map(k=>…)` (each key), `A||x` (A) */
  const exprs = (e, pos) => {
    e = e.trim(); let m;
    while ((m = /^(?:ldE|inE|ptEsc|bl)\((.*)\)$/s.exec(e))) e = m[1].trim();
    if ((m = /^`\$\{([^`]*?)\}(?:[^`]*)`$/s.exec(e)) && !/\$\{/.test(m[1])) return exprs(m[1], pos);
    if ((m = /^([\w.]+(?:\[\w+\])?)\|\|\w+$/.exec(e))) return exprs(m[1], pos);
    if ((m = /^[^?:`"]+\?([\w.()[\]]+):([\w.()[\]]+)$/.exec(e))) return exprs(m[1], pos).concat(exprs(m[2], pos));
    if ((m = /^([\w.]+(?:\([^()]*\))?)\+/.exec(e)) && !/^state\./.test(e)) return exprs(m[1], pos);
    if ((m = /^([\w.()]+)\[(\w+)\]$/.exec(e)) && !/^\d+$/.test(m[2])) {
      const back = S.slice(Math.max(0, pos - 500), pos), km = [...back.matchAll(new RegExp('\\[((?:"\\w+",?)+)\\]\\.map\\(\\s*\\(?' + m[2] + '\\)?\\s*=>', 'g'))].pop();
      const base = R.resolve(m[1], pos); if (!base) return [e];
      const obj = R.valueOf(base.t + '.' + base.p.join('.')).en;
      const keys = km ? km[1].match(/\w+/g) : obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : null;
      return keys ? keys.map((k) => ({ ref: base.t + '.' + base.p.concat(k).join('.') })) : [e];
    }
    return [e];
  };
  /* covered: a boolean, or a function of the resolved reference (a helper that marks only some labels, e.g. LDXP) */
  const add = (kind, expr, pos, covered, ctx) => { for (const x of exprs(expr, pos)) { const L = typeof x === 'string' ? R.label(x, pos) : { ref: x.ref, call: typeof R.valueOf(x.ref).en === 'function' }; sites.push(Object.assign({ kind, fn: R.blockName(pos), ctx: ctx || null, covered: typeof covered === 'function' ? !!covered(L.ref) : !!covered }, L)); } };
  const addRef = (kind, ref, pos, covered, ctx) => { sites.push({ kind, fn: R.blockName(pos), ctx: ctx || null, covered: !!covered, ref, call: typeof R.valueOf(ref).en === 'function' }); };
  /* the table a header sits in, as a CSS selector the attacher can scope by: its data-ptdom / data-ptkey key, else a distinctive
     class or attribute of the <table> tag itself (never a neighbouring table's key) */
  const tableKeyNear = (pos) => {
    const w = S.slice(Math.max(0, pos - 900), pos), i = w.lastIndexOf('<table'); if (i < 0) return null;
    const tag = w.slice(i, w.indexOf('>', i) + 1 || w.length);
    let m;
    if ((m = /data-pt(?:dom|key)="(\w+)"/.exec(tag))) return `[data-ptdom="${m[1]}"],[data-ptkey="${m[1]}"]`;
    if ((m = /data-ptdom="\$\{key\}"/.exec(tag))) return '[data-ptdom]';
    if ((m = /\b(data-[\w-]+)(?=[\s>])/.exec(tag)) && !/data-pt/.test(m[1])) return `[${m[1]}]`;
    if ((m = /class="[^"]*?\b((?:sr|gx|dd|ot|ci|rt)-[\w-]+)/.exec(tag))) return '.' + m[1];
    return null;
  };
  /* R2 table heads */
  for (const m of S.matchAll(/<th(?: [^>]*)?>\$\{/g)) {
    const st = m.index + m[0].length - 2, en = balanced(S, st); if (en < 0) continue;
    const expr = S.slice(st + 2, en - 1), close = S.indexOf('</th>', en);
    if (/^\w+$/.test(expr.trim())) continue;   /* a map variable — R2b below */
    add('th', expr, m.index, XPRE.test(S.slice(en, close)), tableKeyNear(m.index));
  }
  for (const m of S.matchAll(/\[((?:"\w+",?)+)\]\.map\(\s*(\w+)\s*=>\s*`<th[^>]*>\$\{([\w.()]+)\[\2\]/g)) {
    const keys = m[1].match(/\w+/g), base = R.resolve(m[3], m.index); if (!base) continue;
    const ctx = tableKeyNear(m.index), close = S.indexOf('</th>', m.index);
    for (const k of keys) addRef('th', base.t + '.' + base.p.concat(k).join('.'), m.index, XPRE.test(S.slice(m.index, close)), ctx);
  }
  for (const m of S.matchAll(/\$\{([\w.()]+(?:\[[^\]]+\])?)\.map\(\s*\(?(\w+)\)?\s*=>\s*`<th[^>]*>\$\{(?:inE\()?\2\)?\}/g)) {
    const base = R.resolve(m[1], m.index); if (!base) continue;
    const arr = R.valueOf(base.t + '.' + base.p.join('.')); if (!Array.isArray(arr.en)) continue;
    const ctx = tableKeyNear(m.index + 80);
    arr.en.forEach((_, i) => addRef('th', base.t + '.' + base.p.concat(String(i)).join('.'), m.index, false, ctx));
  }
  /* R3 ptHead column configs */
  const COLS_TABLE = { txCols: 'tx', hoCols: 'ho', ldCols: 'ld', ldCityCols: 'ldc', ldDevCols: 'ldd', rtCols: 'ldr', inCols: 'ind,inp,ine,inr', tcCols: 'tc', renderTable: 'board' };
  for (const m of S.matchAll(/\{k(?:ey)?:"(\w+)"[^{}]*?label:([^,}]+(?:\([^)]*\))?)/g)) {
    const fn = R.blockName(m.index), keys = (COLS_TABLE[fn] || '').split(',').filter(Boolean);
    add('col', m[2], m.index, false, keys.length ? keys.map((k) => `[data-ptdom="${k}"],[data-ptkey="${k}"]`).join(',') : fn + ':' + m[1]);
  }
  /* R3b column factories — `const n=(k,label,o)=>({k,label,…})`, called as n("key",LABEL,…) inside a cols function */
  for (const m of S.matchAll(/(?:const |,)(\w+)=\(k,label(?:,\w+)?\)=>\(\{k,label/g)) {
    const name = m[1], fn = R.blockName(m.index), keys = (COLS_TABLE[fn] || '').split(',').filter(Boolean), be = R.blockEnd(m.index);
    const callRe = new RegExp('(?<![\\w.])' + name + '\\("(\\w+)",', 'g'); callRe.lastIndex = m.index + m[0].length;
    let c; const region = S.slice(0, be);
    while ((c = callRe.exec(region))) {
      const ae = balanced(S, c.index + name.length, '(', ')'); if (ae < 0) continue;
      const args = splitArgs(S.slice(c.index + name.length + 1, ae - 1)); if (!args[1]) continue;
      add('col', args[1], c.index, false, keys.length ? keys.map((k) => `[data-ptdom="${k}"],[data-ptkey="${k}"]`).join(',') : fn + ':' + c[1]);
    }
  }
  /* R4 KPI cards */
  { const st = S.indexOf('function renderKPIs('), en = S.indexOf('\nfunction ', st + 10);
    for (const m of S.slice(st, en).matchAll(/\{k:"(\w+)",l:([^,]+(?:\([^)]*\))?),/g)) { const objEnd = balanced(S, st + m.index); const body = S.slice(st + m.index, objEnd); add('kpi', m[2], st + m.index, /\b(?:xp|xm):/.test(body), 'kpi:' + m[1]); } }
  /* R5 label helpers */
  const LABEL_SLOT = (p) => new RegExp('(?:class="(?:k|l|lbl)"[^>]*>|<th[^>]*>|<dt[^>]*>|<summary[^>]*>|<h[2-5][^>]*>)(?:<b>)?\\$\\{' + p + '\\}');
  for (const m of S.matchAll(/(?:const |,)(\w+)=\(([\w,=" ]*)\)=>`/g)) {
    const name = m[1], params = m[2].split(',').map((x) => x.split('=')[0].trim()), tplStart = m.index + m[0].length - 1;
    let tplEnd = tplStart + 1; { let q = '`', esc = false; for (let k = tplStart + 1; k < S.length; k++) { const c = S[k]; if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === '$' && S[k + 1] === '{') { k = balanced(S, k + 1) - 1; continue; } if (c === q) { tplEnd = k + 1; break; } } }
    const tpl = S.slice(tplStart, tplEnd); if (name === 'ptHead' || name === 'ptTh') continue;
    const slot = params.findIndex((p) => p && LABEL_SLOT(p).test(tpl));
    const navSummary = /<summary>\$\{t\.nav\[id\]/.test(tpl);
    if (slot < 0 && !navSummary) continue;
    const always = /xpBtn\("\w+"\)|xpBtn\(xp\)/.test(tpl) && /xp="\w+"/.test(m[2]);
    const xpParam = params.findIndex((p) => p && new RegExp('xpBtn\\(' + p + '\\)|\\$\\{' + p + '(?:\\|\\|"")?\\}').test(tpl) && /^(?:x|xp|term|xm|tag)$/.test(p));
    const ldxp = /LDXP\[l\]/.test(tpl);
    const bs = R.blockStart(m.index), be = R.blockEnd(m.index);
    const callRe = new RegExp('(?<![\\w.])' + name + '\\(', 'g'); callRe.lastIndex = tplEnd;
    const region = S.slice(0, be); let c;
    while ((c = callRe.exec(region))) {
      const ae = balanced(S, c.index + name.length, '(', ')'); if (ae < 0) continue;
      const args = splitArgs(S.slice(c.index + name.length + 1, ae - 1));
      if (navSummary) { const id = /^"(\w+)"$/.exec(args[0] || ''); const b = R.resolve('t', c.index); if (id && b) addRef('summary', b.t + '.nav.' + id[1], c.index, !!(args[4] && args[4] !== '""'), 'sec'); continue; }
      const lab = args[slot]; if (!lab) continue;
      let cov = always || XPRE.test(args.slice(slot).join(',')) && (xpParam >= 0 ? XPRE.test(args[xpParam] || '') || XPRE.test(lab) : true);
      if (xpParam >= 0 && args[xpParam] && /^"\w+"$/.test(args[xpParam].trim()) && /xpBtn\(/.test(tpl)) cov = true;
      const base = cov || XPRE.test(lab);
      add('helper', lab, c.index, ldxp ? (ref) => base || (ref && page.LDXP && page.LDXP.has(ref)) : base, name);
    }
    void bs;
  }
  /* R6 / R7 / R8 inline headings, summaries, definition terms */
  for (const [re, kind, tag] of [[/<h([2-5])(?: [^>]*)?>\$\{/g, 'heading', 'h'], [/<summary(?: [^>]*)?>(?:<b>)?\$\{/g, 'summary', 'summary'], [/<dt(?: [^>]*)?>\$\{/g, 'dt', 'dt']]) {
    for (const m of S.matchAll(re)) {
      const st = m.index + m[0].length - 2, en = balanced(S, st); if (en < 0) continue;
      const expr = S.slice(st + 2, en - 1); if (/^\w+$/.test(expr.trim()) && !/^t$/.test(expr)) { const pre = S.slice(Math.max(0, m.index - 200), m.index); if (/=>`$|=>`<[^`]*$/.test(pre)) continue; }
      const closeTag = tag === 'h' ? '</h' + m[1] + '>' : '</' + tag + '>', close = S.indexOf(closeTag, en);
      add(kind, expr, m.index, XPRE.test(S.slice(en, close < 0 ? en + 200 : close)), null);
    }
  }
  /* R1 markup */
  const mlines = markup.split('\n');
  let sec = 'header';
  for (const line of mlines) {
    const s = /<section[^>]*\bid="(\w+)"/.exec(line) || /<div class="secgrp" id="(\w+)"/.exec(line); if (s) sec = s[1];
    if (/<nav class="rail"/.test(line)) sec = 'rail';
    if (/<div class="command">/.test(line)) sec = 'command';
    if (/<div class="tape"/.test(line)) sec = 'tape';
    if (/<div class="m-mode">/.test(line)) sec = 'command';
    for (const m of line.matchAll(/<(\w+)([^>]*?)\bdata-i="(\w+)"/g)) sites.push({ kind: 'markup', tag: m[1], fn: 'markup', ctx: sec, covered: /class="xp\b/.test(line), ref: 'i:' + m[3], call: false, insideLink: /<a\b[^>]*>(?:(?!<\/a>).)*data-i="/.test(line) || m[1] === 'button' });
  }
  return { sites, R };
}

/* ---------------- page sections (for the report) ---------------- */
const FN_SECTION = [
  [/^markup$/, null], [/^renderKPIs$|^renderCrumbs$|^renderCmd$/, 'overview'], [/^renderProfile$|^renderOfficialTrend$|^renderSVR$|^ot/, 'prices'],
  [/^renderMap$|^mapContext$/, 'map'], [/^renderTable$|^renderRankings$/, 'table'], [/^renderCompare$|^cmp/, 'compare'], [/^renderInsights$|^renderConfidence$/, 'insights'],
  [/^tx|^renderTx$|^countsHTML$|^recent|^events/, 'txSection'], [/^calc|^renderCalc$/, 'calc'], [/^nh|^renderNewHome$/, 'calc'], [/^ci|^renderCapital$|^renderCITeaser$/, 'capital'],
  [/^si|^geo|^openGeoView$|^renderGeoView$/, 'street'], [/^sr/, 'streetReport'], [/^ho|^renderHousing$|^renderHoDrawer$/, 'housing'],
  [/^ld|^rt|^renderLand$|^renderLdDrawer$|^land/, 'land'], [/^in|^di|^pi|^renderIntel$|^renderInDrawer|^renderRenewal$|^renewal|^rn/, 'intel'], [/^dd/, 'intel:dd'], [/^gx/, 'intel:group'],
  [/^tc|^txc|^renderTrust$/, 'sources'], [/^pu|^renderPulse$|^renderPuRadar$/, 'pulse'], [/^ds|^renderDossier/, 'dossier'], [/^ws/, 'workspace'], [/^xp|^renderOrient$/, 'explain'],
];
const sectionOf = (site) => { if (site.kind === 'markup') return site.ctx || 'header'; for (const [re, s] of FN_SECTION) if (re.test(site.fn)) return s || site.ctx; return 'other'; };

/* ---------------- the explicit classification lists ----------------
   CHROME: navigation, actions, generic words, page furniture — a label that names no financial, statistical, geographic,
   planning or valuation concept and no data-quality term. Each entry is a reference (or a /pattern/ over references) with
   its reason; review the list, never a heuristic. Everything not listed here is MEANINGFUL. */
const CHROME_REASONS = {
  nav: 'navigation — a rail / launchpad / section-group link, not a figure',
  action: 'an action or control (a button, a toggle, a mode switch)',
  furniture: 'page furniture — product name, slogan, layer tag, build stamp',
  heading: 'a section or block title — the section carries "how to read this" or its figures carry their own ⓘ',
  descriptor: 'a plain identifier column (a name, a date, an address, a number as published) that needs no method to read',
  prose: 'a sentence or note that explains itself in place',
  workspace: 'the private workspace (identity / sign-in) — not market data',
  legend: 'an evidence-class chip — clicking it opens its own legend entry',
};
const CHROME = [
  /* markup */
  [/^i:(nav\w+|lp\d(s)?|lpHint|grp\d(s)?)$/, 'nav'], [/^i:(slogan|pageCtx|cmdKicker|h1|footRight|lyr\w*|geoLyr|calcLyr)$/, 'furniture'],
  [/^i:(sale|rent|logout|geoClose)$/, 'action'], [/^i:(\w+Note|\w+Sub|trendNA\w+|basisNote|srcAText|srcADemo|ciDisc|ciTeaserNote|ciPortNote|gdNote|gd\d[ab])$/, 'prose'],
  /* workspace (identity) and explanation chrome */
  [/^WS_I18N\./, 'workspace'], [/^XP_T\./, 'furniture'],
  /* every other CHROME decision, one label at a time (generated from the reviewed decisions; regenerate, never hand-patch) */
  /* @chrome:begin */
  /* header · command · tape */
   ['i:calBadge', 'furniture'],
  /* prices — profile, sale vs rent, official indices */
   ['i:vcNA', 'legend'],
   ['OT_I18N.distName', 'descriptor'],
  /* transactions — the union table, the recent layer, the counts, the unplaced list */
   ['I18N.thDate', 'descriptor'], ['I18N.thFloor', 'descriptor'], ['I18N.thRooms', 'descriptor'], ['I18N.thStreet', 'descriptor'],
   ['RCT.cols.0', 'descriptor'], ['RCT.cols.1', 'descriptor'], ['RCT.cols.2', 'descriptor'], ['RCT.cols.10', 'descriptor'],
   ['STE.cols.0', 'descriptor'], ['STE.cols.1', 'descriptor'], ['STE.cols.2', 'descriptor'], ['TXC.u.cols.0', 'descriptor'],
   ['TXC.u.cols.2', 'descriptor'], ['TXC.u.cols.3', 'descriptor'],
  /* street — Street Intelligence */
   ['SIT.cols.0', 'descriptor'], ['SIT.cols.1', 'descriptor'], ['SIT.cols.2', 'descriptor'], ['SIT.cols.9', 'descriptor'],
   ['SIT.compsCols.1', 'descriptor'], ['SIT.compsCols.7', 'descriptor'], ['SIT.compsCols.8', 'descriptor'], ['SIT.compsCols.11', 'descriptor'],
   ['SIT.pcols.0', 'descriptor'], ['SIT.permCols.0', 'descriptor'], ['SIT.permCols.1', 'descriptor'], ['SIT.permCols.2', 'descriptor'],
   ['SIT.permCols.3', 'descriptor'], ['SIT.siteCols.1', 'descriptor'], ['SIT.siteCols.3', 'descriptor'],
   ['SIT.deep', 'heading'], ['SIT.five', 'heading'], ['SIT.one', 'heading'], ['SIT.knows', 'heading'], ['SIT.notKnows', 'heading'],
   ['SIT.method', 'heading'], ['SIT.plan', 'heading'], ['SRT.evH', 'heading'],
  /* street report */
   ['SRT.cols.0', 'descriptor'], ['SRT.cols.1', 'descriptor'], ['SRT.cols.4', 'descriptor'], ['SRT.det.id', 'descriptor'],
   ['SRT.det.notes', 'descriptor'], ['SRT.det.reasons', 'descriptor'], ['SRT.plCols.2', 'descriptor'], ['SRT.plCols.3', 'descriptor'],
   ['SRT.srcCols.0', 'descriptor'], ['SRT.suCtCols.0', 'descriptor'], ['SRT.suEduCols.0', 'descriptor'], ['SRT.suEduCols.1', 'descriptor'],
   ['SRT.trCols.0', 'descriptor'], ['SRT.trCols.1', 'descriptor'], ['SRT.vtCols.2', 'descriptor'], ['SRT.vtCols.3', 'descriptor'],
   ['SRT.nav.map', 'heading'], ['SRT.nav.src', 'heading'],
  /* land — tenders, cities, developers, the drawer, rental */
   ['I18N.ldC.committee', 'descriptor'], ['I18N.ldC.place', 'descriptor'], ['I18N.ldC.tender', 'descriptor'], ['I18N.ldCCity', 'descriptor'],
   ['I18N.ldDComm', 'descriptor'], ['I18N.ldDGeo', 'descriptor'], ['I18N.ldDId', 'descriptor'], ['I18N.ldDL.lot', 'descriptor'],
   ['I18N.ldDName', 'descriptor'], ['I18N.ldDP.link', 'descriptor'], ['I18N.ldDP.plan', 'descriptor'], ['I18N.ldDRegion', 'descriptor'],
   ['I18N.ldDSrc', 'descriptor'], ['I18N.ldPipePlansN', 'descriptor'], ['I18N.rtC.city', 'descriptor'], ['I18N.rtC.tender', 'descriptor'],
   ['I18N.ldDIds', 'heading'], ['I18N.ldTblT', 'heading'], ['I18N.ldTblTNone', 'heading'],
  /* housing — lotteries, projects, the drawer */
   ['I18N.hoC.place', 'descriptor'], ['I18N.hoC.project', 'descriptor'], ['I18N.hoDBody', 'descriptor'], ['I18N.hoDLotId', 'descriptor'],
   ['I18N.hoDParent', 'descriptor'], ['I18N.hoDProjId', 'descriptor'], ['I18N.hoDRes', 'descriptor'], ['I18N.hoDRound', 'descriptor'],
   ['I18N.hoDRow', 'descriptor'], ['I18N.hoDSrc', 'descriptor'],
   ['I18N.hoDDates', 'heading'], ['I18N.hoDIds', 'heading'], ['I18N.hoTblT', 'heading'], ['I18N.hoTblTNone', 'heading'],
  /* intel — developers, projects, entries, renewal */
   ['IN_I18N.c.date', 'descriptor'], ['IN_I18N.c.ecity', 'descriptor'], ['IN_I18N.c.kind', 'descriptor'], ['IN_I18N.c.place', 'descriptor'],
   ['IN_I18N.c.pname', 'descriptor'], ['IN_I18N.dProj', 'descriptor'], ['IN_I18N.dSrc', 'descriptor'], ['IN_I18N.lt.date', 'descriptor'],
   ['IN_I18N.pPlace', 'descriptor'], ['IN_I18N.rn.c.city', 'descriptor'], ['IN_I18N.rn.c.name', 'descriptor'], ['IN_I18N.rn.c.plan', 'descriptor'],
   ['IN_I18N.rn.d.ids', 'descriptor'], ['IN_I18N.rn.d.links', 'descriptor'], ['IN_I18N.rn.d.map', 'descriptor'], ['IN_I18N.rn.d.num', 'descriptor'],
   ['IN_I18N.rn.d.site', 'descriptor'], ['IN_I18N.rn.pl.cityC.city', 'descriptor'], ['IN_I18N.rn.pl.committee', 'descriptor'],
   ['IN_I18N.rn.pl.district', 'descriptor'], ['IN_I18N.rn.pl.juris', 'descriptor'], ['IN_I18N.rn.pl.kind', 'descriptor'],
   ['IN_I18N.rn.pl.name', 'descriptor'], ['IN_I18N.rn.pl.plan', 'descriptor'], ['IN_I18N.sLot', 'descriptor'], ['IN_I18N.sTender', 'descriptor'],
   ['IN_I18N.di.limits', 'heading'], ['IN_I18N.di.signals', 'heading'], ['IN_I18N.di.title', 'heading'], ['IN_I18N.dIds', 'heading'],
   ['IN_I18N.dMeth', 'heading'], ['IN_I18N.pi.title', 'heading'], ['IN_I18N.rn.tblT', 'heading'],
  /* intel — due diligence */
   ['DD_I18N.dates', 'descriptor'], ['DD_I18N.src', 'descriptor'], ['lit:Charge id|מזהה שעבוד', 'descriptor'],
   ['lit:Contractor no.|מס׳ קבלן', 'descriptor'], ['lit:Date|תאריך', 'descriptor'], ['lit:Event|אירוע', 'descriptor'], ['lit:Kind|סוג', 'descriptor'],
   ['lit:Link|קישור', 'descriptor'], ['lit:Site|אתר', 'descriptor'], ['lit:Use|שימוש', 'descriptor'],
   ['DD_I18N.fiveMin', 'heading'], ['DD_I18N.oneMin', 'heading'], ['DDP_I18N.rules', 'heading'],
   ['DD_I18N.truths', 'prose'],
  /* intel — developer group (Sponsor X-Ray) */
   ['DD_I18N.number', 'descriptor'], ['GX_I18N.c.city', 'descriptor'], ['GX_I18N.c.date', 'descriptor'], ['GX_I18N.c.district', 'descriptor'],
   ['GX_I18N.c.kind', 'descriptor'], ['GX_I18N.c.project', 'descriptor'], ['GX_I18N.c.source', 'descriptor'], ['GX_I18N.c.type', 'descriptor'],
   ['GX_I18N.c.measure', 'descriptor'],
   ['GX_I18N.dp.rules', 'heading'], ['GX_I18N.dp.truths', 'heading'], ['GX_I18N.fiveMin', 'heading'], ['GX_I18N.oneMin', 'heading'],
   ['GX_I18N.sec.formulas', 'heading'], ['GX_I18N.sec.graph', 'heading'], ['GX_I18N.sec.lineage', 'heading'], ['GX_I18N.sec.meth', 'heading'],
   ['GX_I18N.sec.raw', 'heading'],
  /* dossier */
   ['I18N.dsFreshT.0', 'descriptor'],
   ['I18N.dsSup.why', 'prose'],
   ['I18N.dsWhy.more', 'heading'],
  /* capital — the capital model */
   ['i:ciChip', 'furniture'],
  /* sources — calibration basis, data types, the Trust Center */
   ['i:srcB1a', 'prose'], ['i:srcB1b', 'prose'], ['i:srcB2a', 'prose'], ['i:srcB2b', 'prose'], ['i:srcB3a', 'prose'], ['i:srcB3b', 'prose'],
   ['i:srcB4a', 'prose'], ['i:srcB4b', 'prose'],
   ['I18N.ptTcName', 'descriptor'], ['I18N.ptTcVert', 'descriptor'],
   ['TC_I18N.d.method', 'heading'],
  /* pulse — revisions */
   ['I18N.puRevCols.0', 'descriptor'], ['I18N.puRevCols.1', 'descriptor'],
   ['I18N.puWhy', 'prose'],
  /* guide */
   ['i:gdTitle', 'heading'],
  /* @chrome:end */
];
/* EXCLUDED: meaningful labels intentionally left without an explanation, each with its reason (shown in the report). */
const EXCLUDED = {};

function classify(ref) {
  for (const [pat, why] of CHROME) if (pat instanceof RegExp ? pat.test(ref) : pat === ref) return { cls: 'CHROME', why };
  return { cls: 'MEANINGFUL', why: null };
}

/* ---------------- term completeness ---------------- */
function termCompleteness(X) {
  const need = ['simple', 'example', 'why'], rows = [];
  for (const t of X.TERMS) {
    const miss = [];
    for (const k of need) for (const L of ['he', 'en']) if (!t[k] || typeof t[k][L] !== 'string' || !t[k][L].trim()) miss.push(k + '.' + L);
    if (!(t.source && Array.isArray(t.source.ids) && t.source.ids.length && t.source.ids.every((s) => X.canonicalSource(s)))) miss.push('source');
    if (t.example && !(/^For example/.test(t.example.en || '') && /^לדוגמה/.test(t.example.he || ''))) miss.push('example.label');
    rows.push({ id: t.id, group: t.group, complete: !miss.length, missing: miss });
  }
  return { total: rows.length, complete: rows.filter((r) => r.complete).length, incomplete: rows.filter((r) => !r.complete) };
}

/* ---------------- the analysis ---------------- */
function analyze({ registry } = {}) {
  const X = registry || require(path.join(ROOT, 'lib/explain/registry.js'));
  const page = loadPage();
  { const m = /const LDXP=\{([^}]*)\}/.exec(page.S); page.LDXP = new Set(); if (m) { const R0 = makeResolver(page.S, page.TBL); for (const k of m[1].matchAll(/\[t\.(\w+)\]/g)) page.LDXP.add('I18N.' + k[1]); void R0; } }
  const { sites } = extract(page);
  const ORIENT = JSON.parse((/const ORIENT_IDS=(\[[^\]]*\])/.exec(page.S) || [0, '[]'])[1]);
  const anchors = X.ANCHORS || {};
  const termOf = (v) => (Array.isArray(v) ? v[0] : v);
  const labels = new Map();
  for (const s of sites) {
    if (!s.ref && !s.lit) continue;            /* raw: a value / name / computed string — not a fixed label */
    const ref = s.ref || ('lit:' + s.lit.en + '|' + s.lit.he);
    let L = labels.get(ref);
    if (!L) {
      const v = s.lit || (ref.startsWith('i:') ? page.R2 || null : null);
      L = { ref, sites: [], sections: new Set(), kinds: new Set(), text: null, call: !!s.call };
      labels.set(ref, L);
    }
    L.sites.push(s); L.sections.add(sectionOf(s)); L.kinds.add(s.kind);
  }
  const R = makeResolver(page.S, page.TBL);
  const textOf = (ref) => {
    if (ref.startsWith('i:')) { const k = ref.slice(2); const v = { he: page.TBL.I18N.he[k], en: page.TBL.I18N.en[k] }; return { he: typeof v.he === 'string' ? v.he : null, en: typeof v.en === 'string' ? v.en : null }; }
    if (ref.startsWith('lit:')) { const [en, he] = ref.slice(4).split('|'); return { he, en }; }
    const v = R.valueOf(ref); const f = (x) => (typeof x === 'string' ? x : typeof x === 'function' ? (() => { try { return String(x('␟', '␟', '␟')).split('␟')[0] + '…'; } catch (e) { return '(a computed label)'; } })() : null);
    return { he: f(v.he), en: f(v.en) };
  };
  const rows = [];
  for (const L of labels.values()) {
    const c = classify(L.ref), text = textOf(L.ref);
    const markupSites = L.sites.filter((s) => s.kind === 'markup');
    const inline = L.sites.every((s) => s.covered);
    const anchor = anchors[L.ref] && X.term(termOf(anchors[L.ref])) ? termOf(anchors[L.ref]) : null;   /* an anchor to a term that does not exist covers nothing */
    const orientation = markupSites.length > 0 && markupSites.every((s) => ORIENT.includes(s.ctx)) && /Title$|^i:h\d/.test(L.ref) && !L.sites.some((s) => s.kind !== 'markup');
    const excluded = EXCLUDED[L.ref] || null;
    const via = inline ? 'INLINE' : anchor ? 'ANCHOR' : orientation ? 'ORIENTATION' : null;
    const tables = L.sites.every((s) => (s.kind === 'th' || s.kind === 'col') && s.ctx && /^[\[.]/.test(s.ctx)) ? [...new Set(L.sites.map((s) => s.ctx))].join(',') : null;
    rows.push({ ref: L.ref, he: text.he, en: text.en, cls: c.cls, chrome: c.why, sections: [...L.sections].sort(), kinds: [...L.kinds].sort(), sites: L.sites.length, tables,
      covered: !!via, via, term: anchor || null, excluded: excluded || null });
  }
  rows.sort((a, b) => (a.sections[0] || '').localeCompare(b.sections[0] || '') || a.ref.localeCompare(b.ref));
  const M = rows.filter((r) => r.cls === 'MEANINGFUL');
  const inScope = M.filter((r) => !r.excluded);
  const bySection = {};
  for (const r of M) { const s = r.sections[0] || 'other'; const o = bySection[s] || (bySection[s] = { meaningful: 0, covered: 0, excluded: 0, uncovered: 0 }); o.meaningful++; if (r.excluded) o.excluded++; else if (r.covered) o.covered++; else o.uncovered++; }
  const covered = inScope.filter((r) => r.covered).length;
  /* the page without the attacher: what is explained in place (INLINE + ORIENTATION) — the measured "before" */
  const baseline = inScope.filter((r) => r.via === 'INLINE' || r.via === 'ORIENTATION').length;
  /* label sites that print a computed string (a name, a value, an error, a count) — not fixed labels, listed so nothing hides */
  const computed = sites.filter((s) => !s.ref && !s.lit).map((s) => `${s.fn} · ${s.kind} · ${String(s.raw || '').slice(0, 70)}`);
  const anchorProblems = [];
  for (const [ref, v] of Object.entries(anchors)) { const id = termOf(v); if (!X.term(id)) anchorProblems.push({ ref, problem: 'unknown term ' + id }); if (!labels.has(ref) && !/^(id|sel):/.test(ref)) anchorProblems.push({ ref, problem: 'no such label on the page' }); }
  return {
    generatedBy: 'scripts/explain-coverage.js', registryVersion: X.VERSION.id,
    rules: ['R1 markup data-i', 'R2 table heads', 'R3 ptHead columns', 'R4 KPI cards', 'R5 label helpers', 'R6 headings', 'R7 summaries', 'R8 definition terms'],
    sites: sites.length, sitesWithFixedLabel: sites.filter((s) => s.ref || s.lit).length,
    labels: rows.length, chrome: rows.length - M.length, meaningful: M.length, excluded: M.length - inScope.length,
    coverage: { covered, total: inScope.length, pct: inScope.length ? Math.round(covered / inScope.length * 1000) / 10 : 100,
      byVia: { INLINE: inScope.filter((r) => r.via === 'INLINE').length, ANCHOR: inScope.filter((r) => r.via === 'ANCHOR').length, ORIENTATION: inScope.filter((r) => r.via === 'ORIENTATION').length } },
    baseline: { covered: baseline, total: inScope.length, pct: inScope.length ? Math.round(baseline / inScope.length * 1000) / 10 : 100, note: 'without the attacher: labels explained in place (INLINE) or by a section orientation' },
    computedLabelSites: { count: computed.length, sites: [...new Set(computed)].sort() },
    bySection, uncovered: inScope.filter((r) => !r.covered).map((r) => ({ ref: r.ref, he: r.he, en: r.en, sections: r.sections, kinds: r.kinds })),
    exclusions: M.filter((r) => r.excluded).map((r) => ({ ref: r.ref, en: r.en, reason: r.excluded })),
    anchorProblems, terms: termCompleteness(X), chromeReasons: CHROME_REASONS, rows,
  };
}

module.exports = { analyze, loadPage, extract, classify, CHROME, CHROME_REASONS, EXCLUDED, TABLES, ACCESSORS };

if (require.main === module) {
  const r = analyze();
  /* the summary indented, every label one compact line (reviewable in a diff) */
  const head = Object.assign({}, r); delete head.rows;
  const lines = r.rows.map((x) => JSON.stringify({ ref: x.ref, en: x.en, he: x.he, cls: x.cls, chrome: x.chrome || undefined, via: x.via || undefined, term: x.term || undefined, sections: x.sections, kinds: x.kinds, excluded: x.excluded || undefined }));
  const body = JSON.stringify(head, null, 1);
  fs.writeFileSync(OUT, body.slice(0, -2) + ',\n "labelsList": [\n  ' + lines.join(',\n  ') + '\n ]\n}\n');
  console.log(`explain coverage: ${r.coverage.covered} / ${r.coverage.total} meaningful labels covered (${r.coverage.pct} %) — INLINE ${r.coverage.byVia.INLINE} · ANCHOR ${r.coverage.byVia.ANCHOR} · ORIENTATION ${r.coverage.byVia.ORIENTATION} · without the attacher ${r.baseline.covered} (${r.baseline.pct} %)`);
  console.log(`  ${r.labels} labels from ${r.sitesWithFixedLabel} label sites (${r.sites} sites) · chrome ${r.chrome} · excluded ${r.excluded}`);
  console.log(`  terms complete: ${r.terms.complete} / ${r.terms.total}` + (r.anchorProblems.length ? ` · ANCHOR PROBLEMS ${r.anchorProblems.length}` : ''));
  for (const [s, o] of Object.entries(r.bySection).sort()) console.log(`  ${s.padEnd(16)} ${o.covered} / ${o.meaningful - o.excluded}` + (o.excluded ? ` (+${o.excluded} excluded)` : ''));
}
