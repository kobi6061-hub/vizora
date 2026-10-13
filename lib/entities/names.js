// PROPX · entity names — deterministic identity rules for the developer registry.
//
// A developer entity is keyed by its CANONICAL NAME: the source's own string
// with typographic variants removed — Unicode NFC, the Hebrew gershayim /
// geresh and curly quotes written as ASCII quotes, a doubled apostrophe as a
// quote, whitespace collapsed. Nothing else: no suffix stripping, no
// abbreviation expansion, no similarity. Two strings that differ after this
// step are two entities, however alike they look ("בע"מ" vs "בעמ" stay
// apart). A strict-prefix relation between a name and exactly one other name
// is reported as a POSSIBLE same entity, never merged.
//
// Why an exact legal name may join two official sources: Israel's Registrar
// of Companies does not register a company under a name identical to an
// existing one, so an identical name WITH a legal-form marker (בע"מ, Ltd, …)
// names one company. A string without a legal-form marker carries no such
// guarantee (it is usually a private person) and is never listed as a
// developer from the tender winners.

'use strict';

const { createHash } = require('node:crypto');

/** the source string, typographic variants removed — the identity key */
function canonicalName(s) {
  return String(s ?? '').normalize('NFC')
    .replace(/[\u05F4\u201C\u201D\u201E\u201F]/g, '"')       // gershayim, curly double quotes
    .replace(/[\u05F3\u2018\u2019\u201B`]/g, "'")            // geresh, curly single quotes, backtick
    .replace(/''/g, '"')                                      // בע''מ → בע"מ
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')              // bidi marks
    .replace(/\s+/g, ' ').trim();
}

/** stable entity id from the canonical name */
const devId = (canonical) => 'dev-' + createHash('sha1').update(canonical, 'utf8').digest('hex').slice(0, 12);

/* the legal form, from markers in the name itself (first match wins). JS \b is ASCII-only, so Hebrew markers
   use explicit edges: start of string / space / comma / bracket before, end / space / punctuation after */
const B = '(?:^|[\\s,(\\-])', E = '(?=$|[\\s,.;)\\-])';
const he = (src) => new RegExp(B + '(?:' + src + ')' + E);
const KINDS = [
  ['company', [he('בע"מ|בעמ|ב\\.ע\\.מ|בע"ם|חברה בהקמה|\\(בהקמה\\)|בהקמה'), /\b(ltd|limited|inc)\b\.?/i]],
  ['partnership', [he('שותפות|ש\\.מ\\.?|ש"מ')]],
  ['cooperative', [he('אגודה שיתופית|אגש"ח|אגודה'), /^(קיבוץ|מושב) /]],
  ['nonprofit', [he('עמותה|\\(ע"ר\\)|ע"ר|חל"צ')]],
  ['public-body', [/^(עיריית|עירית|המועצה|מועצה|רשות|משרד|מדינת ישראל|החברה הכלכלית)[\s"]/]],
];
function kindOf(canonical) {
  for (const [k, res] of KINDS) if (res.some((re) => re.test(canonical))) return k;
  return 'unmarked';
}
const LISTED_KINDS = new Set(['company', 'partnership', 'cooperative', 'nonprofit', 'public-body']);

/** a string naming more than one party ("א בע"מ, ב בע"מ" / "… ו…") — kept as the source wrote it, flagged */
const isJoint = (canonical) => /,|\s\+\s|\sו?יחד עם\s/.test(canonical);

/** a name that looks cut by its source: ends without a legal-form marker and mid-word ("…והשקעות ב") */
const looksCut = (canonical) => kindOf(canonical) === 'unmarked' && /\s\S{1,2}$/.test(canonical);

/** the letters and digits of a name, in order — punctuation, quotes and spacing dropped. Two listed names with the same
    letters are shown as POSSIBLE same entity ("י.ח. דמרי …" / "י.ח.דמרי …"), never merged: the Registrar's name rules
    are not public data PROPX can check */
const lettersKey = (canonical) => String(canonical).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

/** normalized text for search (never for identity) */
const searchKey = (s) => canonicalName(s).replace(/["'`.,\-()]/g, '').replace(/\s+/g, ' ').toLowerCase();

module.exports = { canonicalName, devId, kindOf, LISTED_KINDS, isJoint, looksCut, lettersKey, searchKey };
