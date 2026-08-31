// PROPX · deterministic search aliases for Israeli street and locality names.
//
// Hebrew addresses are typed a dozen ways. Rather than guess at query time,
// every canonical name is expanded ONCE into a small set of normalized
// search keys. The canonical display name is never altered — these keys
// exist only to make a query find the right record.
//
// Variants generated (all mechanical, none invented):
//   · street-type prefixes stripped   רחוב/רח׳/שד׳/שדרות/דרך/סמטת/משעול/כיכר/נתיב
//   · geresh & gershayim removed      ז'בוטינסקי → זבוטינסקי
//   · final letters normalized        אבשלום → אבשלומ   (typing tolerance)
//   · doubled yud/vav collapsed       קריית → קרית, זאב → זאב
//   · hyphen ↔ space equivalence      אבן-גבירול → אבן גבירול
//   · honorific/abbreviation forms    ע״ש, ד״ר, הרב, רבי, האלוף, פרופ׳
//   · optional leading ה              הזית → זית
//
// A variant is only ever ADDED to the index; two different official streets
// never merge, because every index entry keeps its own canonical id.

'use strict';

const STREET_PREFIX = /^(רחוב|רח|שדרות|שד|דרך|סמטת|סמטה|סמ|משעול|כיכר|ככר|נתיב|שביל|מעלה|טיילת)\s+/;
const HONORIFIC = /^(הרב|רבי|ר|ד"ר|דר|פרופ|האלוף|אלוף|הנשיא|השופט|עש|ע"ש|מרן|האדמור)\s+/;

const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };

/** Base normalization shared with the registry (quotes, dashes, dots, spaces). */
function baseNorm(s) {
  if (!s) return '';
  let t = String(s).normalize('NFKC');
  t = t.replace(/[׳'`’‘]/g, '').replace(/[״"“”]/g, '');
  t = t.replace(/[־–—]/g, '-').replace(/\./g, ' ');
  t = t.replace(/\s*-\s*/g, '-').replace(/[()]/g, ' ');
  t = t.replace(/יי/g, 'י');
  return t.replace(/\s+/g, ' ').trim();
}

const foldFinals = (s) => s.replace(/[םןץףך]/g, (c) => FINALS[c]);

/**
 * All normalized search keys for one name.
 * @returns {string[]} unique, non-empty keys — the first is the primary key
 */
function aliasKeys(name) {
  const out = new Set();
  const add = (v) => { const k = baseNorm(v); if (k.length >= 2) out.add(k); };

  const base = baseNorm(name);
  if (!base) return [];
  add(base);

  // prefix / honorific stripping (repeat once: "רחוב הרב קוק")
  let stripped = base.replace(STREET_PREFIX, '').replace(HONORIFIC, '');
  stripped = stripped.replace(STREET_PREFIX, '').replace(HONORIFIC, '');
  add(stripped);

  for (const v of [...out]) {
    add(foldFinals(v));                      // typing tolerance on final letters
    add(v.replace(/-/g, ' '));               // hyphen → space
    add(v.replace(/ /g, '-'));               // space → hyphen
    add(v.replace(/וו/g, 'ו'));              // doubled vav
    if (/^ה/.test(v)) add(v.slice(1));       // optional leading ה
  }
  return [...out];
}

/** Query-side normalization: same pipeline, so a typed query meets the keys. */
function queryKeys(q) {
  const keys = aliasKeys(q);
  return keys.length ? keys : [baseNorm(q)].filter(Boolean);
}

module.exports = { aliasKeys, queryKeys, baseNorm, foldFinals, STREET_PREFIX };
