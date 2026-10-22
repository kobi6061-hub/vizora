/* PROPX · CUSTOMIZABLE NAVIGATION (22.10.2026) — the reader's own order of the rail and of the page sections it leads to.
 *
 * Presentation only: no data, API, calculation, authentication or security is touched. The default order — index.html as shipped,
 * pinned by test/hierarchy.test.js — is never rewritten. A custom order lives in this browser only (localStorage "propx:nav:v1",
 * schema "propx-nav-v1"; nothing when the order is the default) and is applied by MOVING the existing elements: every section,
 * anchor, lazy loader (one IntersectionObserver per element), rail link and launchpad tile stays the same element.
 *
 *  · FIXED, never moved: Overview (the board and the geography view at the top of the page) and every rail link without a page
 *    section (ALTARIS, a separate application — it keeps its slot in the rail); the rail's utility buttons (customize · theme ·
 *    sign-out) stay at its end. Everything else is MOVABLE.
 *  · A movable item's page BLOCK = its section + the sections without a rail item that follow it (Sale vs rent → Prices, Market
 *    rankings → Neighbourhoods). The page keeps Overview + the geography view on top, then the blocks in the reader's order.
 *  · The four group headings and the rail dividers describe the DEFAULT grouping: while a custom order is in use they are hidden
 *    (html.nv-custom); "Reset to default" puts every element back exactly where index.html has it.
 *  · Hidden items (the capital model while it is off, an item the offline build hides) keep their place in the order and are
 *    skipped by the editor; an item the page does not carry (the live-only features in the offline build) is dropped from a stored
 *    order, and a new item appears at its default place.
 *
 * The editor ("Customize navigation", the rail's reorder button): drag with a mouse or a finger (pointer events; the handle does
 * not scroll the list), Up / Down buttons, the handle's Up / Down / Home / End keys, a drop indicator at the place the item will
 * land, a polite live region, Done / Reset to default, Escape, focus kept inside and returned to the button. Hebrew (RTL) and
 * English (LTR) from <html lang>, re-rendered on "propx:lang".
 *
 * UMD: node tests require the pure order model; the page loads /lib/nav/order.js before its main script (inlined in the offline
 * build), which applies a stored order before any section renders. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.PropxNav = api;
    if (typeof document !== 'undefined') { try { api.mount(document); } catch (e) { /* the default order stands */ } }
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'propx:nav:v1';
  const SCHEMA = 'propx-nav-v1';
  const FIXED = ['overview'];

  /* ---------------- the pure order model ---------------- */

  /* a stored order against the movable keys the page carries now: unknown / repeated keys dropped, a missing key inserted after
     its nearest default predecessor that is present (or first) — the default order when nothing usable is stored */
  function normalize(stored, movable) {
    if (!Array.isArray(stored)) return movable.slice();
    const known = new Set(movable), seen = new Set(), out = [];
    for (const k of stored) if (typeof k === 'string' && known.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
    movable.forEach((k, i) => {
      if (seen.has(k)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(movable[j]); if (p >= 0) { at = p + 1; break; } }
      out.splice(at, 0, k); seen.add(k);
    });
    return out;
  }
  const isDefault = (order, movable) => order.length === movable.length && order.every((k, i) => k === movable[i]);

  /* the rail: a fixed item keeps its default slot, the movable items fill the other slots in the reader's order */
  function layout(seq, order) {
    const out = new Array(seq.length);
    let m = 0;
    for (let i = 0; i < seq.length; i++) out[i] = seq[i].fixed ? seq[i].key : order[m++];
    return out;
  }

  /* key just before (after = false) or just after (after = true) ref */
  function place(order, key, ref, after) {
    if (!order.includes(key) || key === ref) return order.slice();
    const o = order.filter((k) => k !== key);
    let p = o.indexOf(ref);
    if (p < 0) return order.slice();
    if (after) p += 1;
    o.splice(p, 0, key);
    return o;
  }
  /* one step among the VISIBLE movable items (−1 up, +1 down); a hidden item keeps its place in the order */
  function move(order, key, delta, visible) {
    const v = order.filter((k) => !visible || visible.has(k));
    const i = v.indexOf(key), j = i + Math.sign(delta || 0);
    if (i < 0 || !delta || j < 0 || j >= v.length) return order.slice();
    return place(order, key, v[j], delta > 0);
  }
  /* a drop: key becomes the index-th of the visible movable items other than itself (0 = first, ≥ count = last) */
  function dropAt(order, key, index, visible) {
    if (!order.includes(key)) return order.slice();
    const v = order.filter((k) => k !== key && (!visible || visible.has(k)));
    if (!v.length) return order.slice();
    if (index <= 0) return place(order, key, v[0], false);
    if (index >= v.length) return place(order, key, v[v.length - 1], true);
    return place(order, key, v[index], false);
  }

  /* the page: children = main's element children in default order as { id, heading }. Everything before the first movable section
     is the LEAD (Overview + the geography view); a movable section opens its block; a child without a rail item joins the open
     block; the group headings are listed apart */
  function mainPlan(children, movable) {
    const keys = new Set(movable), lead = [], headings = [], blocks = {}, keyOrder = [];
    let cur = null;
    children.forEach((c, i) => {
      if (c.heading) { headings.push(i); return; }
      if (c.id && keys.has(c.id) && !blocks[c.id]) { cur = c.id; blocks[cur] = [i]; keyOrder.push(cur); return; }
      if (cur) blocks[cur].push(i); else lead.push(i);
    });
    return { lead, headings, blocks, keyOrder, n: children.length };
  }
  /* the children's order for a reader's order: the identity for the default; else lead · blocks in order · headings (hidden) —
     every child exactly once */
  function mainSequence(plan, order, movable) {
    if (movable && isDefault(order, movable)) return Array.from({ length: plan.n }, (_, i) => i);
    const out = plan.lead.slice(), done = new Set();
    for (const k of order) if (plan.blocks[k] && !done.has(k)) { out.push(...plan.blocks[k]); done.add(k); }
    for (const k of plan.keyOrder) if (!done.has(k)) out.push(...plan.blocks[k]);
    out.push(...plan.headings);
    return out;
  }

  function parse(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
      const o = JSON.parse(raw);
      return o && o.schema === SCHEMA && Array.isArray(o.order) ? o.order.filter((k) => typeof k === 'string') : null;
    } catch (e) { return null; }
  }
  const serialize = (order, now) => JSON.stringify({ schema: SCHEMA, order: order.slice(), savedAt: now || new Date().toISOString() });

  /* ---------------- the page ---------------- */

  const STR = {
    he: {
      title: 'התאמת הניווט',
      hint: 'גררו פריט כדי לשנות את מקומו, או השתמשו בחצים. במקלדת: חץ למעלה / למטה על הידית. הסדר נשמר אוטומטית בדפדפן הזה, וסעיפי העמוד עוברים לאותו סדר.',
      fixed: 'קבוע', why: { overview: 'ראש העמוד', other: 'אפליקציה נפרדת' },
      grip: (n, p, c) => `שינוי מיקום: ${n}, מקום ${p} מתוך ${c}. חץ למעלה או למטה מזיז`,
      up: (n) => `הזזת ${n} למעלה`, down: (n) => `הזזת ${n} למטה`,
      done: 'סיום', reset: 'איפוס לברירת המחדל',
      moved: (n, p, c) => `${n}: מקום ${p} מתוך ${c}`, resetDone: 'הסדר חזר לברירת המחדל',
      groups: 'בסדר מותאם אישית כותרות הקבוצות בעמוד וקווי ההפרדה בסרגל מוסתרים — הם חוזרים באיפוס.',
      notSaved: 'האחסון בדפדפן חסום: הסדר יחול רק עד רענון הדף.',
    },
    en: {
      title: 'Customize navigation',
      hint: 'Drag an item to move it, or use the arrows. Keyboard: Up / Down arrow on the handle. The order is saved automatically in this browser, and the page sections follow it.',
      fixed: 'Fixed', why: { overview: 'top of the page', other: 'separate application' },
      grip: (n, p, c) => `Reorder ${n}, position ${p} of ${c}. Up or Down arrow moves it`,
      up: (n) => `Move ${n} up`, down: (n) => `Move ${n} down`,
      done: 'Done', reset: 'Reset to default',
      moved: (n, p, c) => `${n}: position ${p} of ${c}`, resetDone: 'Order reset to default',
      groups: 'While a custom order is in use, the page\'s group headings and the rail\'s dividers are hidden — Reset brings them back.',
      notSaved: 'Browser storage is blocked: the order applies only until the page is reloaded.',
    },
  };
  const ICON = {
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };
  const CSS = `
.nv-custom main>.secgrp,.nv-custom .rail>.rail-div{display:none}
.ri.nv-btn{position:relative}
.ri.nv-btn.nv-on::after{content:"";position:absolute;top:5px;inset-inline-end:13px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.nv-scrim{position:fixed;inset:0;z-index:94;background:rgba(8,14,28,.32)}
.nv-ed{position:fixed;z-index:95;top:0;bottom:0;right:72px;width:340px;max-width:calc(100vw - 96px);display:flex;flex-direction:column;
  background:var(--panel);color:var(--ink);border-inline:1px solid var(--edge);box-shadow:0 0 48px rgba(8,14,28,.22)}
.nv-scrim[hidden],.nv-ed[hidden]{display:none}
.nv-hd{padding:18px 18px 12px;border-bottom:1px solid var(--hairline)}
.nv-hd h2{margin:0 0 6px;font-size:16px;font-weight:800;color:var(--ink)}
.nv-hd p{margin:0;font-size:12.5px;line-height:1.55;color:var(--ink-2)}
.nv-list{list-style:none;margin:0;padding:10px 12px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;position:relative;display:flex;flex-direction:column;gap:4px}
.nv-it{display:flex;align-items:center;gap:6px;min-height:46px;padding:2px 4px;border:1px solid var(--hairline);border-radius:11px;background:var(--panel);font-size:13.5px;font-weight:700;color:var(--ink)}
.nv-it.nv-fx{background:var(--panel-2);color:var(--ink-2);border-style:dashed}
.nv-ic{display:inline-grid;place-items:center;width:22px;flex:none;color:var(--ink-3)}
.nv-ic svg{width:17px;height:17px;display:block}
.nv-lb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nv-fxl{font-size:11px;font-weight:600;color:var(--ink-3);padding-inline-end:8px;white-space:nowrap}
.nv-grip,.nv-mv button,.nv-lock{display:inline-grid;place-items:center;width:40px;height:40px;flex:none;border:0;border-radius:9px;background:transparent;color:var(--ink-3)}
.nv-grip{cursor:grab;touch-action:none}
.nv-mv{display:flex;gap:2px;flex:none}
.nv-mv button{cursor:pointer}
.nv-grip:hover,.nv-mv button:hover:not(:disabled){background:var(--panel-2);color:var(--ink)}
.nv-mv button:disabled{opacity:.28;cursor:default}
.nv-ed button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.nv-grip svg,.nv-mv svg,.nv-lock svg{width:16px;height:16px}
.nv-it.nv-dragging{opacity:.35}
.nv-ghost{position:fixed;z-index:96;pointer-events:none;margin:0;list-style:none;opacity:.9;border-color:var(--accent);box-shadow:0 14px 32px rgba(8,14,28,.28)}
.nv-drop{position:absolute;z-index:97;inset-inline:16px;height:3px;margin:0;padding:0;border-radius:2px;background:var(--accent);pointer-events:none;list-style:none}
.nv-drop::before{content:"";position:absolute;inset-inline-start:-5px;top:-3px;width:9px;height:9px;border-radius:50%;background:var(--accent)}
.nv-note{margin:0;padding:6px 18px 4px;font-size:11.5px;line-height:1.5;color:var(--ink-3)}
.nv-note:empty{display:none}
.nv-ft{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--hairline)}
.nv-ft button{min-height:40px;padding:0 16px;border-radius:10px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.nv-reset{background:transparent;color:var(--ink-2);border:1px solid var(--baseline)}
.nv-reset:hover{color:var(--ink);border-color:var(--ink-3)}
.nv-done{background:#2563eb;color:#fff;border:1px solid #2563eb}
.nv-sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
html.nv-drag-doc,html.nv-drag-doc *{user-select:none;-webkit-user-select:none;cursor:grabbing!important}
@media (max-width:979px){
  .nv-ed{top:auto;left:0;right:0;bottom:0;width:auto;max-width:none;max-height:min(82vh,680px);border-inline:0;border-top:1px solid var(--edge);border-radius:16px 16px 0 0}
}
@media (min-width:980px){.nv-scrim{right:72px}}
@media (prefers-reduced-motion:no-preference){.nv-it{transition:background .15s,border-color .15s}}`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* one helper: children of `parent` in the order of `els`, moving only what is out of place */
  function arrange(parent, els) {
    let prev = null;
    for (const e of els) {
      const want = prev ? prev.nextElementSibling : parent.firstElementChild;
      if (want !== e) parent.insertBefore(e, want);
      prev = e;
    }
  }

  function mount(doc) {
    const win = doc.defaultView || {};
    const rail = doc.getElementById('rail'), main = doc.querySelector('main');
    if (!rail || !main || rail.dataset.nvMounted) return null;
    rail.dataset.nvMounted = '1';
    if (!doc.getElementById('nvStyle')) { const st = doc.createElement('style'); st.id = 'nvStyle'; st.textContent = CSS; doc.head.appendChild(st); }

    /* the default sequences, read once from index.html as parsed */
    const railEls = [...rail.children];
    const items = railEls.filter((e) => e.matches('.ri') && !e.matches('.rt'));
    const seq = items.map((e) => {
      const key = e.dataset.sec || (e.id === 'railAltaris' ? 'altaris' : (e.id || e.getAttribute('href') || ''));
      return { key, fixed: !e.dataset.sec || FIXED.includes(e.dataset.sec), el: e };
    });
    const byKey = new Map(seq.map((s) => [s.key, s]));
    const movable = seq.filter((s) => !s.fixed).map((s) => s.key);
    const dividers = railEls.filter((e) => e.matches('.rail-div'));
    const utility = railEls.filter((e) => !items.includes(e) && !dividers.includes(e));
    const mainEls = [...main.children];
    const plan = mainPlan(mainEls.map((e) => ({ id: e.id || null, heading: e.matches('.secgrp') })), movable);
    const btn = doc.getElementById('navEditBtn');

    let order = movable.slice(), canStore = true;
    const read = () => { try { return win.localStorage.getItem(KEY); } catch (e) { canStore = false; return null; } };
    const write = (o) => {
      try { if (isDefault(o, movable)) win.localStorage.removeItem(KEY); else win.localStorage.setItem(KEY, serialize(o)); canStore = true; } catch (e) { canStore = false; }
    };
    const shown = (s) => { if (s.el.hidden) return false; try { return win.getComputedStyle(s.el).display !== 'none'; } catch (e) { return true; } };
    const visible = () => new Set(seq.filter((s) => !s.fixed && shown(s)).map((s) => s.key));
    const labelOf = (s) => { const sp = s.el.querySelector('span'); return ((sp && sp.textContent) || s.el.getAttribute('aria-label') || s.key).trim(); };

    function apply(o) {
      const def = isDefault(o, movable);
      if (def) { arrange(rail, railEls); arrange(main, mainEls); }
      else {
        arrange(rail, [...layout(seq, o).map((k) => byKey.get(k).el), ...dividers, ...utility]);
        arrange(main, mainSequence(plan, o).map((i) => mainEls[i]));
      }
      order = o.slice();
      doc.documentElement.classList.toggle('nv-custom', !def);
      if (btn) btn.classList.toggle('nv-on', !def);
      try { doc.dispatchEvent(new win.CustomEvent('propx:navorder', { detail: { order: order.slice(), custom: !def } })); } catch (e) { /* no listeners needed */ }
    }

    /* a stored order is applied before the main script renders anything */
    const stored = normalize(parse(read()), movable);
    if (!isDefault(stored, movable)) apply(stored);

    /* ---------------- the editor ---------------- */
    let ed = null, scrim = null, list = null, live = null, drag = null, inerted = [];
    const T = () => STR[doc.documentElement.lang === 'en' ? 'en' : 'he'];
    const announce = (msg) => { if (!live) return; live.textContent = ''; win.setTimeout(() => { live.textContent = msg; }, 30); };

    function build() {
      if (ed) return;
      scrim = doc.createElement('div'); scrim.className = 'nv-scrim'; scrim.hidden = true;
      ed = doc.createElement('section');
      ed.id = 'nvEd'; ed.className = 'nv-ed'; ed.hidden = true;
      ed.setAttribute('role', 'dialog'); ed.setAttribute('aria-modal', 'true'); ed.setAttribute('aria-labelledby', 'nvT'); ed.setAttribute('aria-describedby', 'nvH');
      ed.innerHTML = '<header class="nv-hd"><h2 id="nvT"></h2><p id="nvH"></p></header><ol class="nv-list" id="nvList"></ol><p class="nv-note" id="nvNote"></p>'
        + '<footer class="nv-ft"><button type="button" class="nv-reset" id="nvReset"></button><button type="button" class="nv-done" id="nvDone"></button></footer>'
        + '<div class="nv-sr" id="nvLive" role="status" aria-live="polite"></div>';
      doc.body.append(scrim, ed);
      if (btn) btn.setAttribute('aria-controls', 'nvEd');
      list = ed.querySelector('#nvList'); live = ed.querySelector('#nvLive');
      scrim.addEventListener('click', close);
      ed.querySelector('#nvDone').addEventListener('click', close);
      ed.querySelector('#nvReset').addEventListener('click', () => {
        const was = !isDefault(order, movable);
        change(movable.slice(), null);
        if (was) announce(T().resetDone);
        ed.querySelector('#nvDone').focus();   /* Reset is disabled on the default order */
      });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('.nv-up,.nv-dn'); if (!b || b.disabled) return;
        const key = b.closest('li').dataset.key, up = b.classList.contains('nv-up');
        change(move(order, key, up ? -1 : 1, visible()), key, up ? 'nv-up' : 'nv-dn');
      });
      list.addEventListener('keydown', (e) => {
        const g = e.target.closest('.nv-grip'); if (!g) return;
        const key = g.closest('li').dataset.key, vis = visible(), n = order.filter((k) => vis.has(k)).length;
        let next = null;
        if (e.key === 'ArrowUp') next = move(order, key, -1, vis);
        else if (e.key === 'ArrowDown') next = move(order, key, 1, vis);
        else if (e.key === 'Home') next = dropAt(order, key, 0, vis);
        else if (e.key === 'End') next = dropAt(order, key, n, vis);
        if (!next) return;
        e.preventDefault();
        change(next, key, 'nv-grip');
      });
      list.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        const li = e.target.closest('li.nv-it'); if (!li || li.classList.contains('nv-fx')) return;
        const onGrip = !!e.target.closest('.nv-grip');
        if (!onGrip && (e.pointerType !== 'mouse' || e.target.closest('button'))) return;   /* touch drags from the handle; the row scrolls */
        startDrag(e, li);
      });
      ed.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); if (drag) endDrag(); else close(); return; }
        if (e.key !== 'Tab') return;
        const f = [...ed.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      doc.addEventListener('propx:lang', () => { if (ed && !ed.hidden) win.setTimeout(() => render(null), 0); });
    }

    function rowHTML(s, mv) {
      const t = T(), name = labelOf(s), ic = (s.el.querySelector('svg') || {}).outerHTML || '';
      if (s.fixed) {
        return `<li class="nv-it nv-fx" data-key="${esc(s.key)}"><span class="nv-lock" aria-hidden="true">${ICON.lock}</span><span class="nv-ic" aria-hidden="true">${ic}</span>`
          + `<span class="nv-lb">${esc(name)}</span><span class="nv-fxl">${esc(t.fixed)} · ${esc(t.why[s.key] || t.why.other)}</span></li>`;
      }
      const i = mv.indexOf(s.key), n = mv.length;
      return `<li class="nv-it" data-key="${esc(s.key)}"><button type="button" class="nv-grip" aria-label="${esc(t.grip(name, i + 1, n))}">${ICON.grip}</button>`
        + `<span class="nv-ic" aria-hidden="true">${ic}</span><span class="nv-lb">${esc(name)}</span>`
        + `<span class="nv-mv"><button type="button" class="nv-up" aria-label="${esc(t.up(name))}"${i <= 0 ? ' disabled' : ''}>${ICON.up}</button>`
        + `<button type="button" class="nv-dn" aria-label="${esc(t.down(name))}"${i >= n - 1 ? ' disabled' : ''}>${ICON.down}</button></span></li>`;
    }
    function render(focus) {
      const t = T(), vis = visible();
      ed.querySelector('#nvT').textContent = t.title;
      ed.querySelector('#nvH').textContent = t.hint;
      ed.querySelector('#nvReset').textContent = t.reset;
      ed.querySelector('#nvDone').textContent = t.done;
      const mv = order.filter((k) => vis.has(k));
      list.innerHTML = layout(seq, order).map((k) => byKey.get(k)).filter((s) => shown(s)).map((s) => rowHTML(s, mv)).join('');
      ed.querySelector('#nvNote').textContent = [isDefault(order, movable) ? '' : t.groups, canStore ? '' : t.notSaved].filter(Boolean).join(' ');
      ed.querySelector('#nvReset').disabled = isDefault(order, movable);
      if (focus) {
        const row = list.querySelector(`li[data-key="${focus.key}"]`);
        const pick = row && ([`.${focus.cls}`, focus.cls === 'nv-up' ? '.nv-dn' : '.nv-up', '.nv-grip'].map((c) => row.querySelector(c)).find((b) => b && !b.disabled));
        if (pick) pick.focus({ preventScroll: false });
      }
    }
    function change(next, key, cls) {
      if (next.join('\u0001') !== order.join('\u0001')) { apply(next); write(next); }
      render(key ? { key, cls: cls || 'nv-grip' } : null);
      if (key) {
        const vis = visible(), mv = order.filter((k) => vis.has(k));
        announce(T().moved(labelOf(byKey.get(key)), mv.indexOf(key) + 1, mv.length));
      }
    }

    /* drag: a ghost follows the pointer, the indicator sits where the item will land (the row it will precede in the new rail) */
    function startDrag(e, li) {
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const ghost = li.cloneNode(true);
      ghost.classList.add('nv-ghost'); ghost.removeAttribute('data-key'); ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('button').forEach((b) => { b.tabIndex = -1; });
      Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
      ed.appendChild(ghost);
      const ind = doc.createElement('li'); ind.className = 'nv-drop'; ind.setAttribute('role', 'presentation'); ind.setAttribute('aria-hidden', 'true');
      list.appendChild(ind);
      li.classList.add('nv-dragging');
      doc.documentElement.classList.add('nv-drag-doc');
      drag = { key: li.dataset.key, li, ghost, ind, dy: e.clientY - r.top, y: e.clientY, next: null, raf: 0, src: e.target, pid: e.pointerId };
      try { e.target.setPointerCapture(e.pointerId); } catch (x) { /* capture is a nicety */ }
      doc.addEventListener('pointermove', onMove);
      doc.addEventListener('pointerup', onUp);
      doc.addEventListener('pointercancel', onCancel);
      track();
      drag.raf = win.requestAnimationFrame(autoScroll);
    }
    function track() {
      const d = drag; if (!d) return;
      d.ghost.style.top = (d.y - d.dy) + 'px';
      const vis = visible();
      const cands = [...list.querySelectorAll('li.nv-it:not(.nv-fx)')].filter((x) => x !== d.li && vis.has(x.dataset.key));
      let idx = 0;
      for (const c of cands) { const cr = c.getBoundingClientRect(); if (cr.top + cr.height / 2 < d.y) idx++; }
      d.next = dropAt(order, d.key, idx, vis);
      const rows = layout(seq, d.next).filter((k) => shown(byKey.get(k)));
      const p = rows.indexOf(d.key), after = rows[p + 1], before = rows[p - 1];
      const lr = list.getBoundingClientRect(), rowOf = (k) => list.querySelector(`li.nv-it[data-key="${k}"]`);
      let top = 0;
      if (after && rowOf(after)) top = rowOf(after).getBoundingClientRect().top - lr.top + list.scrollTop - 4;
      else if (before && rowOf(before)) top = rowOf(before).getBoundingClientRect().bottom - lr.top + list.scrollTop + 1;
      d.ind.style.top = Math.max(0, top) + 'px';
    }
    function autoScroll() {
      const d = drag; if (!d) return;
      const lr = list.getBoundingClientRect(), edge = 44;
      let v = 0;
      if (d.y < lr.top + edge) v = -Math.ceil((lr.top + edge - d.y) / 4);
      else if (d.y > lr.bottom - edge) v = Math.ceil((d.y - (lr.bottom - edge)) / 4);
      if (v) { const before = list.scrollTop; list.scrollTop += v; if (list.scrollTop !== before) track(); }
      d.raf = win.requestAnimationFrame(autoScroll);
    }
    function onMove(e) { if (!drag || (drag.pid != null && e.pointerId !== drag.pid)) return; drag.y = e.clientY; track(); }
    function onUp(e) {
      if (!drag || (drag.pid != null && e.pointerId !== drag.pid)) return;
      const { key, next } = drag;
      endDrag();
      if (next) change(next, key, 'nv-grip');
    }
    function onCancel() { endDrag(); }
    function endDrag() {
      const d = drag; if (!d) return;
      drag = null;
      win.cancelAnimationFrame(d.raf);
      try { d.src.releasePointerCapture(d.pid); } catch (x) { /* already released */ }
      d.ghost.remove(); d.ind.remove(); d.li.classList.remove('nv-dragging');
      doc.documentElement.classList.remove('nv-drag-doc');
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onCancel);
    }

    function open() {
      build();
      if (!ed.hidden) return;
      render(null);
      inerted = [...doc.body.children].filter((c) => c !== ed && c !== scrim && !c.inert && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE');
      inerted.forEach((c) => { c.inert = true; });
      scrim.hidden = false; ed.hidden = false;
      doc.documentElement.classList.add('nv-editing');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      const first = list.querySelector('.nv-grip') || ed.querySelector('#nvDone');
      if (first) first.focus();
    }
    function close() {
      if (!ed || ed.hidden) return;
      endDrag();
      ed.hidden = true; scrim.hidden = true;
      inerted.forEach((c) => { c.inert = false; }); inerted = [];
      doc.documentElement.classList.remove('nv-editing');
      if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    }
    if (btn) btn.addEventListener('click', open);

    const ui = {
      open, close,
      order: () => order.slice(), defaultOrder: () => movable.slice(), custom: () => !isDefault(order, movable),
      set: (o) => { const n = normalize(o, movable); apply(n); write(n); if (ed && !ed.hidden) render(null); return n.slice(); },
      reset: () => { apply(movable.slice()); write(movable.slice()); if (ed && !ed.hidden) render(null); },
    };
    return ui;
  }

  const api = { KEY, SCHEMA, FIXED: FIXED.slice(), normalize, isDefault, layout, place, move, dropAt, mainPlan, mainSequence, parse, serialize, STR };
  api.mount = (doc) => { const ui = mount(doc); if (ui) api.ui = ui; return ui; };
  return api;
}));
