/* PROPX · tables — the one sorting and filtering standard (audit 14.10.2026).
 *
 * Shared by the page (window.PropxTable, loaded from /lib/table/core.js and inlined in the offline build), the API
 * query modules (require('../table/core')) and ALTARIS. Pure functions, no DOM.
 *
 *  · Sort cycle: first click = the column's primary order (numbers / currency / percent high → low, dates newest →
 *    oldest, yes before no, text א → ת / A → Z, status in lifecycle order); second click = the reverse; third click =
 *    the table's default order. On the default column the cycle is default → reverse → default.
 *  · Missing values (null, undefined, NaN, "", "—", "MISSING", "חסר") ALWAYS sort last, in both directions — never 0.
 *  · Stable: ties keep their previous order (or a caller tie-break), so paging never shuffles equal rows.
 *  · Typed column filters, written to the URL as f_<column>=…:
 *      text      contains          f_name=רמת
 *      enum      any of            f_track=rental,open-market
 *      number    min..max          f_units=100..500   (either side may be empty: 100.. / ..500)
 *      currency  min..max          f_land=..5000000
 *      percent   min..max          f_yield=3..        (in the unit shown: 3 = 3%)
 *      date      from..to          f_close=2025-01-01..2025-12-31
 *      bool      yes | no          f_awarded=yes
 *      geo       exact code/name   f_city=5000
 *    A missing value never satisfies an active filter (an unknown is not "between 100 and 500").
 *    Filters intersect; sorting applies to the filtered rows.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PropxTable = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MISSING_TEXT = new Set(['', '—', '–', '-', '−', 'MISSING', 'missing', 'N/A', 'n/a', 'NA', 'חסר', 'לא ידוע', 'null', 'undefined']);
  /** null / undefined / NaN / ±Infinity / an empty or dash string / MISSING — never a zero */
  function isMissing(v) {
    if (v == null) return true;
    if (typeof v === 'number') return !Number.isFinite(v);
    if (typeof v === 'string') return MISSING_TEXT.has(v.trim());
    if (v instanceof Date) return Number.isNaN(v.getTime());
    return false;
  }

  const TYPES = ['number', 'currency', 'percent', 'date', 'text', 'enum', 'status', 'bool', 'geo'];
  const NUMERIC = new Set(['number', 'currency', 'percent']);
  /** the order a first click gives */
  const primaryDir = (type) => (NUMERIC.has(type) || type === 'date' || type === 'bool' ? 'desc' : 'asc');
  const reverse = (d) => (d === 'asc' ? 'desc' : 'asc');

  const COLLATORS = {};
  function collator(lang) {
    const k = lang === 'en' ? 'en' : 'he';
    if (!COLLATORS[k]) {
      try { COLLATORS[k] = new Intl.Collator(k === 'en' ? ['en', 'he'] : ['he', 'en'], { sensitivity: 'base', numeric: true }); }
      catch (e) { COLLATORS[k] = { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) }; }
    }
    return COLLATORS[k];
  }

  /** a number from a number or a displayed string ("₪1,234", "3.1%", "+0.4", "1.2M") — null when there is none */
  function toNumber(v) {
    if (isMissing(v)) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    let s = String(v).replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/[−–]/g, '-').trim();
    let mul = 1;
    const suf = s.match(/(K|M|B|אלף|מ׳|מיליון|מיליארד)\s*$/i);
    if (suf) { const u = suf[1].toLowerCase(); mul = u === 'k' || u === 'אלף' ? 1e3 : u === 'b' || u === 'מיליארד' ? 1e9 : 1e6; s = s.slice(0, suf.index); }
    const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]) * mul;
    return Number.isFinite(n) ? n : null;
  }

  /** a sortable day key "YYYY-MM-DD" (or "YYYY-MM" / "YYYY") from ISO, dd.mm.yyyy, mm/yyyy or a Date — null when none */
  function toDateKey(v) {
    if (isMissing(v)) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[./](\d{4})$/);
    if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})$/);
    return m ? m[1] : null;
  }

  const textKey = (v) => String(v == null ? '' : v).normalize('NFKC').replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[׳'`’‘״"“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const toBool = (v) => (v === true || v === 1 || /^(1|true|yes|y|כן)$/i.test(String(v)) ? true
    : v === false || v === 0 || /^(0|false|no|n|לא)$/i.test(String(v)) ? false : null);

  /** the comparable key of a value for its column type — null when missing */
  function keyOf(v, type) {
    if (isMissing(v)) return null;
    if (NUMERIC.has(type)) return toNumber(v);
    if (type === 'date') return toDateKey(v);
    if (type === 'bool') { const b = toBool(v); return b == null ? null : b ? 1 : 0; }
    return String(v);
  }

  /**
   * Compare two values of one column. Missing ALWAYS last (whatever the direction).
   * opt.order: the lifecycle order of a status column (unknown statuses after the known ones, alphabetically);
   * opt.lang: 'he' | 'en' for the text collation.
   */
  function compareValues(a, b, type, dir, opt) {
    opt = opt || {};
    const x = keyOf(a, type), y = keyOf(b, type);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    let c;
    if (NUMERIC.has(type) || type === 'bool') c = x - y;
    else if (type === 'date') c = x < y ? -1 : x > y ? 1 : 0;
    else if (type === 'status' && Array.isArray(opt.order)) {
      const i = opt.order.indexOf(x), j = opt.order.indexOf(y);
      c = i >= 0 && j >= 0 ? i - j : i >= 0 ? -1 : j >= 0 ? 1 : collator(opt.lang).compare(x, y);
    } else c = collator(opt.lang).compare(x, y);
    return dir === 'desc' ? -c : c;
  }

  /**
   * Stable sort of rows by one column. get(row) returns the semantic value shown in the cell.
   * tie(a, b): optional tie-break (e.g. the record id) — applied after the column, before the original order.
   */
  function sortRows(rows, get, type, dir, opt) {
    opt = opt || {};
    return rows.map((r, i) => [r, i]).sort((p, q) => compareValues(get(p[0]), get(q[0]), type, dir, opt) || (opt.tie ? opt.tie(p[0], q[0]) : 0) || p[1] - q[1]).map((p) => p[0]);
  }

  /**
   * The next sort state after a click on column `key`.
   * cur: {key, dir, isDefault}; def: the table's default {key, dir}; type: the clicked column's type.
   */
  function nextSort(cur, key, type, def, primary) {
    const first = primary || primaryDir(type);
    const isDef = (s) => !!s && s.key === def.key && s.dir === def.dir;
    if (!cur || cur.key !== key) return { key, dir: first, isDefault: isDef({ key, dir: first }) };
    if (cur.isDefault || isDef(cur)) return { key, dir: reverse(cur.dir), isDefault: false };   /* the default column: default → reverse */
    if (cur.dir === first) { const s = { key, dir: reverse(first) }; return isDef(s) ? { key: def.key, dir: def.dir, isDefault: true } : { ...s, isDefault: false }; }
    return { key: def.key, dir: def.dir, isDefault: true };
  }

  /* ------------------------------------------------------------ filters */
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  const num = (s) => { if (s == null || String(s).trim() === '') return null; const n = Number(String(s).replace(/,/g, '').trim()); return Number.isFinite(n) ? n : NaN; };
  const day = (s) => { if (s == null || String(s).trim() === '') return null; const k = toDateKey(String(s).trim()); return k && ISO_DAY.test(k) ? k : NaN; };

  /** a URL value → a filter spec for the type, or null (empty / invalid values are ignored, never guessed) */
  function parseFilter(type, raw) {
    if (raw == null) return null;
    const s = String(raw).trim().slice(0, 200);
    if (!s) return null;
    if (type === 'text') return { q: s };
    if (type === 'enum' || type === 'status') {
      const xs = s.split(',').map((x) => { try { return decodeURIComponent(x).trim(); } catch (e) { return x.trim(); } }).filter(Boolean);
      return xs.length ? { in: [...new Set(xs)] } : null;
    }
    if (type === 'geo') return { eq: s };
    if (type === 'bool') return /^(yes|1|true)$/i.test(s) ? { is: 'yes' } : /^(no|0|false)$/i.test(s) ? { is: 'no' } : null;
    if (NUMERIC.has(type) || type === 'date') {
      const parts = s.includes('..') ? s.split('..') : [s, s];
      if (parts.length !== 2) return null;
      const P = type === 'date' ? day : num;
      const lo = P(parts[0]), hi = P(parts[1]);
      if (Number.isNaN(lo) || Number.isNaN(hi) || (lo == null && hi == null)) return null;
      if (lo != null && hi != null && lo > hi) return null;
      return type === 'date' ? { from: lo, to: hi } : { min: lo, max: hi };
    }
    return null;
  }

  /** a filter spec → its URL value (null = no filter) */
  function formatFilter(type, spec) {
    if (!spec) return null;
    if (type === 'text') return spec.q ? String(spec.q) : null;
    if (type === 'enum' || type === 'status') return spec.in && spec.in.length ? spec.in.map((x) => String(x).replace(/[,%]/g, encodeURIComponent)).join(',') : null;
    if (type === 'geo') return spec.eq ? String(spec.eq) : null;
    if (type === 'bool') return spec.is === 'yes' || spec.is === 'no' ? spec.is : null;
    if (type === 'date') return spec.from == null && spec.to == null ? null : `${spec.from || ''}..${spec.to || ''}`;
    if (NUMERIC.has(type)) return spec.min == null && spec.max == null ? null : `${spec.min == null ? '' : spec.min}..${spec.max == null ? '' : spec.max}`;
    return null;
  }

  /** does one value satisfy one filter? A missing value never satisfies an active filter. */
  function matchFilter(type, v, spec, opt) {
    if (!spec) return true;
    opt = opt || {};
    if (type === 'enum' || type === 'status') {
      const vs = Array.isArray(v) ? v : [v];
      return vs.some((x) => !isMissing(x) && spec.in.includes(String(x)));
    }
    if (isMissing(v)) return false;
    if (type === 'text') { const q = textKey(spec.q); return (Array.isArray(v) ? v : [v]).some((x) => textKey(x).includes(q)); }
    if (type === 'geo') return (Array.isArray(v) ? v : [v]).some((x) => String(x) === String(spec.eq) || textKey(x) === textKey(spec.eq));
    if (type === 'bool') { const b = toBool(v); return b != null && (spec.is === 'yes' ? b : !b); }
    if (type === 'date') { const k = toDateKey(v); if (!k) return false; const d = k.length === 7 ? k + '-01' : k; return (spec.from == null || d >= spec.from) && (spec.to == null || d.slice(0, spec.to.length) <= spec.to); }
    const n = toNumber(v); if (n == null) return false;
    const x = opt.scale ? n * opt.scale : n;
    return (spec.min == null || x >= spec.min) && (spec.max == null || x <= spec.max);
  }

  /**
   * Column filters from URL parameters. cols: {key: {type, filter: true}} — only columns marked filter: true are read.
   * prefix: 'f_' (the API) or '<table>.f_' (the page URL).
   */
  function filtersFromParams(params, cols, prefix) {
    const p = prefix == null ? 'f_' : prefix, out = {};
    const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params ? params[k] : null);
    for (const [k, c] of Object.entries(cols || {})) {
      if (!c || !c.filter) continue;
      const spec = parseFilter(c.type, get(p + k));
      if (spec) out[k] = spec;
    }
    return out;
  }
  function filtersToParams(filters, cols, prefix) {
    const p = prefix == null ? 'f_' : prefix, out = [];
    for (const [k, spec] of Object.entries(filters || {})) {
      const c = cols && cols[k]; if (!c) continue;
      const v = formatFilter(c.type, spec);
      if (v != null) out.push([p + k, v]);
    }
    return out;
  }

  /** rows that satisfy every active column filter (an intersection); get(row, key) returns the column's value */
  function applyFilters(rows, cols, filters, get) {
    const active = Object.entries(filters || {}).filter(([k, s]) => s && cols[k] && cols[k].filter);
    if (!active.length) return rows.slice();
    return rows.filter((r) => active.every(([k, s]) => matchFilter(cols[k].type, get(r, k), s, cols[k])));
  }

  /**
   * One table query over the full dataset: filter, then sort, then page.
   * cols: {key: {type, get(row), order?, filter?}}; q: {sort, order, page, size, filters, lang, def: {key, dir}}
   */
  function query(rows, cols, q) {
    q = q || {};
    const def = q.def || { key: Object.keys(cols)[0], dir: 'desc' };
    const get = (r, k) => (cols[k] && cols[k].get ? cols[k].get(r, q.lang) : r[k]);
    /* a column may filter on more than it shows in one line (every winner of a tender, not only the first) */
    const fget = (r, k) => (cols[k] && cols[k].fget ? cols[k].fget(r, q.lang) : get(r, k));
    const filtered = applyFilters(rows, cols, q.filters, fget);
    const key = Object.prototype.hasOwnProperty.call(cols, q.sort) && cols[q.sort].sort !== false ? q.sort : def.key;
    const dir = q.order === 'asc' || q.order === 'desc' ? q.order : key === def.key ? def.dir : primaryDir(cols[key].type);
    const c = cols[key];
    const sorted = sortRows(filtered, (r) => get(r, key), c.type, dir, { order: c.order, lang: q.lang, tie: q.tie });
    const size = Math.min(q.maxSize || 100, Math.max(1, Number(q.size) || 25));
    const pages = Math.max(1, Math.ceil(sorted.length / size));
    const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
    return { total: sorted.length, unfiltered: rows.length, page, pages, size, sort: key, order: dir,
      filters: filtersToParams(q.filters, cols, 'f_').reduce((o, [k, v]) => (o[k] = v, o), {}),
      rows: sorted.slice((page - 1) * size, page * size) };
  }

  return { TYPES, isMissing, toNumber, toDateKey, textKey, toBool, keyOf, primaryDir, reverse, compareValues, sortRows, nextSort,
    parseFilter, formatFilter, matchFilter, filtersFromParams, filtersToParams, applyFilters, query, collator };
}));
