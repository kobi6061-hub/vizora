/* PROPX · Explain Everything — the attacher: adds an accessible ⓘ next to every page label the registry's ANCHORS maps to a term
   and that is not already explained in place. Loaded after the main script (inlined in the offline build).

   How a label is found (the same references scripts/explain-coverage.js measures):
     i:<key>          the markup element [data-i="<key>"]
     TABLE.path       a string-table key the renderers print (I18N.medPrice, SRT.cols.3 …) — matched by its text, in the
                      current language, inside a label container (a table head, a heading, a summary, a <dt>, a tile / KPI label)
     lit:<en>|<he>    an inline bilingual literal, matched the same way
   An anchor may carry a scope (a CSS selector the label must sit inside); when two anchors share the words, the one whose scope
   is the closest ancestor wins, and a tie between different terms attaches nothing. Idempotent (a label that already holds an ⓘ —
   its own or an inline one — is skipped), cheap (a debounced MutationObserver scans only the subtrees that changed) and re-run on
   "propx:lang". The button is the page's own ⓘ (class "xp", data-xp), so the page's one dialog (xpOpen) explains it. */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const X = () => (typeof window !== 'undefined' && window.PropxExplain) || null;
  const lang = () => (typeof state !== 'undefined' && state && state.lang === 'en' ? 'en' : 'he');
  /* the page's string tables — top-level constants of the main script, reachable by name from this script */
  const TABLES = {
    I18N: () => (typeof I18N !== 'undefined' ? I18N : null), TXE: () => (typeof TXE !== 'undefined' ? TXE : null), NH_I18N: () => (typeof NH_I18N !== 'undefined' ? NH_I18N : null),
    OT_I18N: () => (typeof OT_I18N !== 'undefined' ? OT_I18N : null), TXF: () => (typeof TXF !== 'undefined' ? TXF : null), RCT: () => (typeof RCT !== 'undefined' ? RCT : null),
    TCT: () => (typeof TCT !== 'undefined' ? TCT : null), SIT: () => (typeof SIT !== 'undefined' ? SIT : null), STE: () => (typeof STE !== 'undefined' ? STE : null),
    SRT: () => (typeof SRT !== 'undefined' ? SRT : null), IN_I18N: () => (typeof IN_I18N !== 'undefined' ? IN_I18N : null), DD_I18N: () => (typeof DD_I18N !== 'undefined' ? DD_I18N : null),
    DDP_I18N: () => (typeof DDP_I18N !== 'undefined' ? DDP_I18N : null), GX_I18N: () => (typeof GX_I18N !== 'undefined' ? GX_I18N : null), TC_I18N: () => (typeof TC_I18N !== 'undefined' ? TC_I18N : null),
    TXC: () => (typeof TXC !== 'undefined' ? TXC : null),
  };
  /* where a label may sit, and what inside it is not label text */
  const CONTAINERS = 'th, h2, h3, h4, h5, summary, dt, .l, .k, .lbl, .ci-col-t, .ho-fact, .dd-k, .gx-rat > span:first-child, .txe-rec > div';
  /* containers that print the label first and the value after it in the same element: only the leading words are the label */
  const LEAD = '.ho-fact, .txe-rec > div';
  const NOT_TEXT = '.xp, .vc, .ho-chip, .num, .kpop, small, .pt-a, .pt-f, svg, .sr-sum, .dd-m, .dd-pc, input, select, textarea, .ho-na, .ds-m, .bs-p, .sr-nb, .rct-chip, .xp-auto';
  const INLINE = 'b, bdi, strong, span, em, i, .pt-h, .pt-s, .pt-l, button.pt-s';
  /* not ours: the dialog itself, navigation, the workspace (every id beginning "ws" — the offline build carries none of it),
     and the sections other modules render and explain themselves */
  const SKIP = '#xpPop, #xpScrim, .rail, .lang, [id^="ws"], .search-pop, #dealLab, #changes';
  const norm = (s) => String(s == null ? '' : s).replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim().replace(/[\s:·•\-–—…]+$/u, '').trim().toLowerCase();

  /* ---- the index of the current language: text → anchors, prefix anchors (computed labels), markup anchors ---- */
  let IDX = null;
  function valueAt(ref, L) {
    const parts = ref.split('.'), get = TABLES[parts[0]]; const tbl = get && get(); if (!tbl || !tbl[L]) return undefined;
    let v = tbl[L]; for (const k of parts.slice(1)) { if (v == null) return undefined; v = v[k]; } return v;
  }
  function build() {
    const R = X(); if (!R || !R.ANCHORS) return null;
    const L = lang(), text = new Map(), prefix = [], markup = [];
    for (const [ref, v] of Object.entries(R.ANCHORS)) {
      const a = Array.isArray(v) ? { ref, term: v[0], scope: v[1] || null } : { ref, term: v, scope: null };
      if (!R.term(a.term)) continue;
      if (ref.startsWith('i:')) { markup.push(Object.assign(a, { key: ref.slice(2) })); continue; }
      let t;
      if (ref.startsWith('lit:')) { const [en, he] = ref.slice(4).split('|'); t = L === 'en' ? en : he; }
      else {
        const val = valueAt(ref, L);
        if (typeof val === 'function') {
          let p = ''; try { p = String(val('␟', '␟', '␟')).split('␟')[0]; } catch (e) { p = ''; }
          p = norm(p); if (p.length >= 3) prefix.push(Object.assign(a, { prefix: p }));
          continue;
        }
        t = typeof val === 'string' ? val : null;
      }
      const n = norm(t); if (!n) continue;
      if (!text.has(n)) text.set(n, []); text.get(n).push(a);
    }
    return { L, text, prefix, markup };
  }
  const index = () => { if (!IDX || IDX.L !== lang()) IDX = build(); return IDX; };

  /* ---- the label text a container shows (its own words, not its chips, counts or buttons) ---- */
  function own(el) {
    if (el.matches(LEAD)) { let s = ''; for (const n of el.childNodes) { if (n.nodeType !== 3) break; s += n.nodeValue; } return s; }
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1 && !n.matches(NOT_TEXT) && n.matches(INLINE)) s += own(n);
    }
    return s;
  }
  /* the closest scope wins; unscoped anchors rank last; a tie between different terms → none */
  function choose(el, cands) {
    let best = null, bestD = Infinity, tie = false;
    for (const a of cands) {
      let d = 1e6;
      if (a.scope) { const host = el.closest(a.scope); if (!host) continue; d = 0; for (let p = el; p && p !== host; p = p.parentElement) d++; }
      if (d < bestD) { best = a; bestD = d; tie = false; } else if (d === bestD && best && best.term !== a.term) tie = true;
    }
    return tie ? null : best;
  }
  const explained = (el) => !!(el.querySelector('.xp, [data-xp], [data-xpm], [data-xps]') ||
    (el.matches('.lbl') && el.closest('.kpi') && el.closest('.kpi').querySelector('.xp')) ||
    (el.matches('summary') && el.parentElement && el.parentElement.querySelector(':scope > .sr-xp .xp')) ||
    (el.matches('[data-i]') && el.parentElement && el.parentElement.matches('.tp') && el.parentElement.querySelector('.xp')));
  function button(term) {
    const R = X(), t = R && R.level1(term, lang()); if (!t) return null;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'xp xp-auto'; b.dataset.xp = term; b.textContent = 'ⓘ';
    const nm = `${lang() === 'en' ? 'Explain' : 'הסבר'}: ${t.title}`; b.setAttribute('aria-label', nm); b.title = nm;
    return b;
  }
  function place(el, term) {
    if (explained(el)) return false;
    const b = button(term); if (!b) return false;
    if (el.matches('.lbl') && el.closest('.kpi')) { const cmp = el.closest('.kpi').querySelector('.cmp'); (cmp || el.parentElement).appendChild(b); return true; }
    if (el.matches('[data-i]') && el.parentElement && el.parentElement.matches('.tp')) { b.classList.add('tp-xp'); el.parentElement.insertBefore(b, el.parentElement.firstChild); return true; }
    if (el.matches(LEAD)) { let n = el.firstChild; while (n && n.nodeType === 3) n = n.nextSibling; el.insertBefore(b, n); if (n) el.insertBefore(document.createTextNode(' '), n); return true; }
    const host = el.matches('th') && el.querySelector('.pt-h') || el;
    host.appendChild(document.createTextNode(' ')); host.appendChild(b);
    return true;
  }
  function scan(root) {
    const I = index(); if (!I || !root || root.nodeType !== 1) return 0;
    if (root.closest(SKIP)) return 0;
    let n = 0;
    for (const a of I.markup) for (const el of root.querySelectorAll(`[data-i="${a.key}"]`)) {
      if (el.closest('a, button, ' + SKIP)) continue; if (a.scope && !el.closest(a.scope)) continue;
      if (place(el, a.term)) n++;
    }
    const els = root.matches(CONTAINERS) ? [root, ...root.querySelectorAll(CONTAINERS)] : root.querySelectorAll(CONTAINERS);
    for (const el of els) {
      if (el.closest('a, ' + SKIP) || (el.closest('button') && !el.matches('th'))) continue;
      const t = norm(own(el)); if (!t || t.length > 120) continue;
      let cands = I.text.get(t) || [];
      if (!cands.length && I.prefix.length) cands = I.prefix.filter((a) => t.startsWith(a.prefix));
      if (!cands.length) continue;
      const a = choose(el, cands); if (a && place(el, a.term)) n++;
    }
    return n;
  }
  /* the page's static ⓘ (the tape) name what they explain, in the current language */
  function relabel() {
    const R = X(); if (!R) return;
    for (const b of document.querySelectorAll('button.xp[data-xp]')) {
      const t = R.level1(b.dataset.xp, lang()); if (!t) continue;
      const nm = `${lang() === 'en' ? 'Explain' : 'הסבר'}: ${t.title}`;
      if (b.getAttribute('aria-label') !== nm) { b.setAttribute('aria-label', nm); b.title = nm; }
    }
  }

  /* ---- when to run: once at start, on every change of the page's content (debounced), and after a language switch ---- */
  const pending = new Set(); let timer = 0, all = false;
  function flush() {
    timer = 0;
    const roots = all ? [document.body] : [...pending].filter((r) => r.isConnected && ![...pending].some((o) => o !== r && o.contains(r)));
    pending.clear(); all = false;
    for (const r of roots) scan(r);
    relabel();
  }
  const schedule = (root) => { if (root === 'all') all = true; else pending.add(root); if (!timer) timer = setTimeout(flush, 80); };
  function onMutations(list) {
    for (const m of list) {
      if (m.type !== 'childList') continue;
      const t = m.target; if (!t || t.nodeType !== 1) continue;
      if (t.closest && t.closest('#xpPop')) continue;
      const added = [...m.addedNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains('xp-auto')) && !(n.nodeType === 3 && !n.nodeValue.trim()));
      if (!added.length) continue;
      schedule(t);
    }
  }
  function start() {
    if (!X() || !X().ANCHORS) return;
    schedule('all');
    try { new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* no observer: the first scan stands */ }
    document.addEventListener('propx:lang', () => { IDX = null; setTimeout(() => schedule('all'), 0); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  /* for tests and the browser check: what this module would attach, without touching the page */
  if (typeof window !== 'undefined') window.PropxExplainAttach = Object.freeze({ scan: (root) => scan(root || document.body), index: () => index(), norm });
}());
