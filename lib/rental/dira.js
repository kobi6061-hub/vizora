// PROPX · long-term rental — Dira Lehaskir, the government rental company (audit 14.10.2026).
//
// "דירה להשכיר – החברה הממשלתית לדיור ולהשכרה בע"מ" publishes its developer tenders, planning sites and project
// pages on its official website, www.renten.co.il (aprent.co.il redirects there; Wikidata Q55648329 lists aprent.co.il
// as the official website). The site is WordPress; its public REST API (wp-json/wp/v2) is open to every client and
// robots.txt allows every path (verified on a GitHub runner, scripts/rental-discover.js --site / --wp, 13.10.2026):
//
//   michraz   "מכרזי יזמים" — the company's tender notices: developer (land) tenders, and also its services
//             procurement (engineering control, consulting …) under the same type. 230 items, 3 pages.
//             A developer tender's notice text states, in the company's own words, the total units, the units for
//             long-term rental, the units for sale and the rental period ("…הכולל 234 יח"ד לבניה רוויה, מתוכן 67
//             יח"ד למטרת השכרה לטווח ארוך למשך 25 שנים, ו-167 יח"ד למכירה מיידית…"). Status: taxonomy tax_status_et.
//   planning  "קידום תכנון" — sites the company is promoting in planning (before a tender). 45 items. Status: taxonomy
//             statuss. No plan number is published → never joined to XPlan.
//   project   "פרויקטים" — operating / marketed projects. NOT exposed by the REST API (not in /types): public pages
//             only (project-sitemap.xml). Their statuses are a public taxonomy (tax_status) with counts.
//
// Classification: michraz + planning + the taxonomies = CMS_PUBLIC_API (structured, unauthenticated, robots-allowed);
// projects = OFFICIAL_PAGE_ONLY (a sitemap of pages, no fields). GET only, one request at a time, honest User-Agent.
//
// Parsing is EXPLICIT ONLY: a number enters a field only when the notice states it in one of the patterns below; the
// matched sentence is kept as evidence and the notice text is kept raw (raw snapshot). Nothing is inferred from a
// title, a city, an average or another tender. Not stated → null (the page shows "—").

'use strict';

const BASE = process.env.DIRA_BASE || 'https://www.renten.co.il';
const UA = 'PROPX-rental-sync/1.0 (+https://github.com/kobi6061-hub/vizora; read-only, official public data)';

const SOURCE = Object.freeze({
  id: 'dira-lehaskir:wp',
  owner: 'דירה להשכיר – החברה הממשלתית לדיור ולהשכרה בע"מ',
  ownerEn: 'Dira Lehaskir — the Government Company for Housing and Rental',
  site: BASE,
  api: BASE + '/wp-json/wp/v2',
  classification: 'CMS_PUBLIC_API',
  robots: 'User-agent: * · Disallow: (empty) — every path allowed (read 13.10.2026)',
  verified: { at: '2026-10-13', michraz: 230, planning: 45, runs: { site: '38473430920', restApi: '38474108973' } },
});

const URLS = {
  michraz: (page) => `${BASE}/wp-json/wp/v2/michraz?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,date,modified,link,title,content,tax_status_et`,
  planning: (page) => `${BASE}/wp-json/wp/v2/planning?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,date,modified,link,title,statuss`,
  terms: (tax) => `${BASE}/wp-json/wp/v2/${tax}?per_page=100&_fields=id,name,slug,count`,
  projectsSitemap: `${BASE}/project-sitemap.xml`,
};
const TAXONOMIES = ['tax_status_et', 'statuss', 'tax_status'];

/* ------------------------------------------------------------ text */
const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(ENT, n.toLowerCase()) ? ENT[n.toLowerCase()] : m));
}
const plain = (html) => decode(String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[‎‏]/g, '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const num = (s) => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };

/* the tender number as the company prints it: "מר/161/2026", "ים/137/2026", "חי/122/2026" (prefix = the ILA region) */
const TENDER_RE = /(?:^|[^\d/])([א-ת]{1,3})\s*\/\s*(\d{1,4})\s*\/\s*(\d{4})(?![\d/])/;
function tenderNumberOf(text) {
  const m = String(text || '').match(TENDER_RE);
  if (!m) return null;
  const number = Number(m[2]), year = Number(m[3]);
  if (!(year >= 2000 && year <= 2100) || !(number >= 1)) return null;
  /* the Israel Land Authority's MichrazID is year × 10000 + number (e.g. 161/2026 → 20260161) — the exact join key */
  return { raw: `${m[1]}/${m[2]}/${m[3]}`, prefix: m[1], number, year, michrazId: year * 10000 + number };
}

/**
 * The explicit rental terms of one notice. Each field is set only when the notice states it; `evidence` keeps the words
 * each value came from. The company's notices use a handful of phrasings (13.10.2026 read, 141 developer notices):
 *   total        "הכולל 234 יח"ד" · "(סה"כ 246 דירות)" · "(180 יח"ד)" · "של 176 יח"ד סה"כ" · "(כ-135 יח"ד*)" (approximate → approx)
 *   rental part  "מתוכן / מתוכם 67 יח"ד למטרת השכרה…" · "למטרת השכרה לטווח ארוך (186 יח"ד) ולמכירה (62 יח"ד)" ·
 *                "338 יח"ד להשכרה למשך 20 שנים ו–112 יח"ד למכירה"
 *   all rental   "הכולל 96 יח"ד…, למטרת השכרה לטווח ארוך" · "140 יח"ד סה"כ למטרת השכרה לטווח ארוך" · "דיור להשכרה לטווח ארוך (כ-50 יח"ד*)"
 *   units only   "…ובכלל זה 400 יח"ד לבניה רוויה למטרת השכרה לטווח ארוך…" (no total stated) → basis "stated-units"
 *   project      a stated total + the whole project described as rental ("…כפרויקט מגורים להשכרה למשך 20 שנים") and no
 *                units for sale stated → basis "project-rental" (the notice's own description, not a unit split)
 *   sale         "ו-167 יח"ד למכירה" · "ולמכירה (62 יח"ד)"
 *   period       "להשכרה למשך 20 שנים" · "…לתקופה של 15 שנים" near the rental words — never the lease term ("חוזה חכירה …
 *                לתקופה של 98 שנים"); "השכרה לצמיתות" → permanent
 *   discounted   a sentence stating a reduced / regulated rent or affordable share ("בהנחה", "מופחת", "מפוקח", "בהישג יד") —
 *                kept as text; a percentage only when written as "N% מ(ה)דירות" (or "%N מהדירות")
 *   special      "600 יח"ד להשכרה לסגל רפואי" — a rental reserved for a population: specialRental, apart from the general figure
 *   several      different general rental figures in one notice (one per compound) → no single number (rentalStatements kept)
 * Contradictions (part + sale above the total; an "all rental" phrase beside units for sale) leave the rental field null
 * and mark the notice — never a guess.
 */
const U = 'יח\\s?["״\'׳]?\\s?ד\\*?';
function rentalTerms(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = { totalUnits: null, totalApprox: false, rentalUnits: null, rentalBasis: null, saleUnits: null, rentalYears: null, rentalPermanent: false,
    discountedShare: null, discountedText: null, evidence: {} };
  const at = (i) => t.slice(Math.max(0, i - 40), i + 200).trim();     /* the words around the match, as published */
  const first = (res) => { for (const re of res) { const m = t.match(re); if (m) return m; } return null; };
  const R = (src, flags) => new RegExp(src.replace(/U/g, U), flags);
  /* total */
  let m = first([R('(?:הכולל(?:ים|ות)?|של)\\s+(?:סה["״]כ\\s+)?(כ-?\\s*)?([\\d,]+)\\s*U'), R('\\(\\s*(?:סה["״]כ\\s+)?(כ-?\\s*)?([\\d,]+)\\s*(?:U|דירות)\\s*\\)'), R('סה["״]כ\\s+(כ-?\\s*)?([\\d,]+)\\s*(?:U|דירות)')]);
  if (m) { out.totalUnits = num(m[2]); out.totalApprox = !!m[1]; out.evidence.totalUnits = at(m.index); }
  /* sale */
  m = first([R('([\\d,]+)\\s*U\\s+(?:ל|המיועדות\\s+ל)?מכירה'), R('ולמכירה\\s*\\(\\s*([\\d,]+)\\s*U\\s*\\)')]);
  if (m) { out.saleUnits = num(m[1]); out.evidence.saleUnits = at(m.index); }
  /* rental: an explicit part first, then an explicit "all", then the project-level description */
  m = first([R('מתוכ[ןם]\\s+([\\d,]+)\\s*U\\s+(?:ל|למטרת\\s+)?(?:השכרה|דיור\\s+להשכרה)'), R('השכרה\\s+לטווח\\s+ארוך\\s*\\(\\s*([\\d,]+)\\s*U\\s*\\)'), R('([\\d,]+)\\s*U\\s+להשכרה\\s+(?:למשך|לטווח|ארוכת)')]);
  if (m) { out.rentalUnits = num(m[1]); out.rentalBasis = 'stated-part'; out.evidence.rentalUnits = at(m.index); }
  else {
    /* a number stated for rental without "of which": equal to the total → all rental; no total → the rental units alone */
    m = first([R('([\\d,]+)\\s*U[^.;\\d]{0,40}?(?:ל|למטרת\\s+)(?:השכרה|דיור\\s+להשכרה)\\s+(?:לטווח\\s+ארוך|לצמיתות)'), R('([\\d,]+)\\s*U\\s+ל\\s?השכרה')]);
    if (m) {
      const x = num(m[1]);
      out.rentalUnits = x; out.evidence.rentalUnits = at(m.index);
      out.rentalBasis = out.totalUnits == null ? 'stated-units' : x === out.totalUnits ? 'stated-all' : 'stated-part';
    } else if (out.totalUnits != null) {
      m = first([/(?:דיור|מתחם\s+דיור)\s+להשכרה\s+לטווח\s+ארוך\s*\(\s*כ?-?\s*[\d,]+/]);
      if (m) { out.rentalUnits = out.totalUnits; out.rentalBasis = 'stated-all'; out.evidence.rentalUnits = at(m.index); }
      else {
        m = t.match(/(?:פרויקט|מתחם)\s+מגורים\s+ל\s?השכרה|ל\s?השכרה\s+(?:למשך|לתקופה\s+של)\s+\d{1,3}\s+שנ/);
        if (m) { out.rentalUnits = out.totalUnits; out.rentalBasis = 'project-rental'; out.evidence.rentalUnits = at(m.index); }
      }
    }
    if (out.rentalBasis && out.rentalBasis !== 'stated-part' && out.saleUnits != null) { out.rentalUnits = null; out.rentalBasis = null; out.ambiguous = true; }
  }
  /* several different general rental figures (e.g. one per compound) → no single number is picked; a rental reserved for a
     population (medical staff, students) is its own category, kept apart */
  const general = new Set(), special = [];
  for (const x of t.matchAll(R('(?:ש?מתוכ[ןם]\\s+)?([\\d,]+)\\s*U\\s+(?:ל|למטרת\\s+)?(?:השכרה|דיור\\s+להשכרה)(\\s+(?:לסגל|לסטודנט|למעונות|לעובדי)[^,.;]*)?', 'g'))) {
    if (x[2]) special.push({ units: num(x[1]), text: at(x.index) }); else general.add(num(x[1]));
  }
  if (special.length) out.specialRental = special;
  if (general.size > 1 && out.rentalBasis === 'stated-part') { out.rentalStatements = [...general]; out.rentalUnits = null; out.rentalBasis = null; out.ambiguous = 'multiple-statements'; }
  /* period: near the rental words, never the lease term */
  if (/השכרה\s+לצמיתות/.test(t)) { out.rentalPermanent = true; const i = t.search(/השכרה\s+לצמיתות/); out.evidence.rentalYears = at(i); }
  for (const x of t.matchAll(/(?:למשך|לתקופה\s+של)\s+(\d{1,3})\s+שנ(?:ים|ה)/g)) {
    const before = t.slice(Math.max(0, x.index - 160), x.index), r = before.lastIndexOf('השכר'), l = Math.max(before.lastIndexOf('חכירה'), before.lastIndexOf('חוזה'));
    if (r < 0 || l > r || Number(x[1]) >= 90) continue;
    out.rentalYears = Number(x[1]); out.evidence.rentalYears = at(x.index); break;
  }
  m = t.match(/[^.]{0,200}(?:בהנחה|מופחת|מפוקח|בהישג\s+יד)[^.]{0,200}\./);
  if (m) {
    out.discountedText = m[0].trim().slice(0, 400);
    /* "50% מהדירות" — written either way round in right-to-left text ("%50 מהדירות") */
    const p = m[0].match(/(?:(\d{1,3})\s*%|%\s*(\d{1,3}))\s*מ(?:ה)?(?:דירות|יחידות|יח["״'׳]?ד)/);
    if (p) out.discountedShare = Number(p[1] || p[2]);
  }
  /* internal consistency: a stated part + sale must not exceed the stated total — otherwise the parse is not trusted */
  if (out.totalUnits != null && out.rentalUnits != null && out.saleUnits != null && out.rentalUnits + out.saleUnits > out.totalUnits) out.inconsistent = true;
  return out;
}

/* a developer (land) tender notice vs the company's services procurement under the same content type */
const isDeveloperTender = (title, text) => !!tenderNumberOf(title) || /במכרז\s+פומבי\s+לרכישת\s+זכויות\s+(?:חכירה|בעלות)/.test(text) || /דירה\s+להשכיר\s+במתחם/.test(title);

/** one michraz item → the normalized record (raw text kept separately, in the raw snapshot) */
function normalizeMichraz(item, terms = {}) {
  const title = plain(item.title && item.title.rendered);
  const text = plain(item.content && item.content.rendered);
  const tn = tenderNumberOf(title) || tenderNumberOf(text.slice(0, 600));
  const statusIds = Array.isArray(item.tax_status_et) ? item.tax_status_et : [];
  const st = statusIds.map((id) => terms[id]).filter(Boolean);
  const dev = isDeveloperTender(title, text);
  return {
    id: 'dira:michraz:' + item.id, wpId: item.id, kind: dev ? 'developer-tender' : 'procurement',
    title, link: item.link || null, published: (item.date || '').slice(0, 10) || null, modified: (item.modified || '').slice(0, 10) || null,
    tender: tn, placeText: dev ? (title.split(/[,،]/).slice(1).join(',').trim() || null) : null,
    status: st.length ? { slug: st[0].slug, name: st[0].name } : null, statusIds,
    terms: dev ? rentalTerms(text) : null,
    textChars: text.length,
  };
}
function normalizePlanning(item, terms = {}) {
  const title = plain(item.title && item.title.rendered);
  const ids = Array.isArray(item.statuss) ? item.statuss : [];
  const st = ids.map((id) => terms[id]).filter(Boolean);
  const parts = title.split(/[,،]/);
  return { id: 'dira:planning:' + item.id, wpId: item.id, title, site: parts[0].trim(), placeText: parts.length > 1 ? parts.slice(1).join(',').trim() : null,
    link: item.link || null, published: (item.date || '').slice(0, 10) || null, modified: (item.modified || '').slice(0, 10) || null,
    status: st.length ? { slug: st[0].slug, name: st[0].name } : null, statusIds: ids, planNumber: null };
}
/** project-sitemap.xml → the public project pages (OFFICIAL_PAGE_ONLY: a URL and its lastmod, no fields) */
function parseSitemap(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1];
    if (!loc) continue;
    const lastmod = ((m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || '').slice(0, 10) || null;
    let slug = null; try { slug = decodeURIComponent(new URL(loc).pathname.replace(/^\/|\/$/g, '').split('/').pop()).replace(/-/g, ' '); } catch { /* keep null */ }
    out.push({ url: loc, lastmod, slug });
  }
  return out;
}

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${url}`); e.status = r.status; throw e; }
  let json; try { json = JSON.parse(text); } catch { throw new Error(`not JSON from ${url}`); }
  return { json, text, total: Number(r.headers.get('x-wp-total')) || null, pages: Number(r.headers.get('x-wp-totalpages')) || null };
}
async function getText(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/xml, text/xml' }, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${url}`); e.status = r.status; throw e; }
  return text;
}
/** every page of one content type; a failed page fails the type (never a partial list presented as complete) */
async function allPages(urlOf, fetchImpl, pause) {
  const first = await getJson(urlOf(1), fetchImpl);
  const items = [...first.json], raw = [{ url: urlOf(1), body: first.text }];
  for (let p = 2; p <= (first.pages || 1); p++) { await pause(); const r = await getJson(urlOf(p), fetchImpl); items.push(...r.json); raw.push({ url: urlOf(p), body: r.text }); }
  if (first.total != null && items.length !== first.total) throw new Error(`expected ${first.total} items, read ${items.length}`);
  return { items, raw, total: first.total };
}

/** read everything (GET only). Never throws: each part is { ok, … } or { ok:false, error }. */
async function fetchAll({ fetchImpl = fetch, pauseMs = 600 } = {}) {
  const pause = () => new Promise((r) => setTimeout(r, pauseMs));
  const out = { at: new Date().toISOString(), terms: {}, parts: {} };
  for (const tax of TAXONOMIES) {
    try { const r = await getJson(URLS.terms(tax), fetchImpl); out.terms[tax] = { ok: true, terms: r.json.map((x) => ({ id: x.id, name: decode(x.name), slug: x.slug, count: x.count })), raw: [{ url: URLS.terms(tax), body: r.text }] }; }
    catch (e) { out.terms[tax] = { ok: false, error: e.message }; }
    await pause();
  }
  for (const [k, urlOf] of [['michraz', URLS.michraz], ['planning', URLS.planning]]) {
    try { out.parts[k] = { ok: true, ...(await allPages(urlOf, fetchImpl, pause)) }; } catch (e) { out.parts[k] = { ok: false, error: e.message }; }
    await pause();
  }
  try { const xml = await getText(URLS.projectsSitemap, fetchImpl); out.parts.projects = { ok: true, pages: parseSitemap(xml), raw: [{ url: URLS.projectsSitemap, body: xml }] }; }
  catch (e) { out.parts.projects = { ok: false, error: e.message }; }
  return out;
}

module.exports = { SOURCE, URLS, TAXONOMIES, UA, decode, plain, tenderNumberOf, rentalTerms, isDeveloperTender, normalizeMichraz, normalizePlanning, parseSitemap, fetchAll };
