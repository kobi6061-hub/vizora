// PROPX · long-term rental — offline tests (audit 14.10.2026).
// `node test/rental.test.js`
//
// Dira Lehaskir notice texts below are TEST FIXTURES written in the company's own phrasing (tender numbers 9xx/2099,
// places "TEST FIXTURE"); nothing here reaches the network. The page gates run over index.html.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../lib/rental/dira');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };
const PART = 'הזמנה לקבלת הצעות במכרז פומבי לרכישת זכויות חכירה להקמת מתחם מגורים הכולל 234 יח&quot;ד לבניה רוויה, מתוכן 67 יח&quot;ד למטרת השכרה לטווח ארוך למשך 25 שנים, ו-167 יח&quot;ד למכירה מיידית, בתוספת שטחי מסחר';
const ALL = 'הזמנה לקבלת הצעות במכרז פומבי לרכישת זכויות חכירה להקמת מתחם מגורים הכוללים 96 יח&quot;ד לבניה רוויה, למטרת השכרה לטווח ארוך למשך 10 שנים, בתוספת שטחי מסחר';
const item = (id, title, content, status = [20]) => ({ id, date: '2099-06-03T14:35:11', modified: '2099-08-19T07:29:13', link: 'https://example.invalid/m/' + id,
  title: { rendered: title }, content: { rendered: '<p>' + content + '</p>' }, tax_status_et: status });
const TERMS = { 20: { id: 20, name: 'פתוח', slug: 'open' } };

console.log('rental: Dira Lehaskir notices — explicit terms only');
t('a mixed notice: total, rental-designated and sale units and the rental period, each from its own words', () => {
  const r = D.normalizeMichraz(item(1, 'מכרז מספר ים/937/2099 &#8211; דירה להשכיר במתחם TEST FIXTURE, אשדוד', PART), TERMS);
  assert.equal(r.kind, 'developer-tender');
  assert.deepStrictEqual([r.terms.totalUnits, r.terms.rentalUnits, r.terms.saleUnits, r.terms.rentalYears], [234, 67, 167, 25]);
  assert.equal(r.terms.rentalBasis, 'stated-part');
  assert.match(r.terms.evidence.rentalUnits, /מתוכן 67/);
  assert.equal(r.tender.michrazId, 20990937); assert.equal(r.tender.raw, 'ים/937/2099');
  assert.equal(r.status.slug, 'open'); assert.equal(r.title.includes('&#8211;'), false);
});
t('an all-rental notice: rental units = the stated total only because the sentence says so ("stated-all")', () => {
  const r = D.normalizeMichraz(item(2, 'מכרז מספר מר/961/2099 &#8211; במתחם TEST FIXTURE, ג\'לג\'וליה', ALL), TERMS);
  assert.equal(r.terms.totalUnits, 96); assert.equal(r.terms.rentalUnits, 96); assert.equal(r.terms.rentalBasis, 'stated-all');
  assert.equal(r.terms.saleUnits, null); assert.equal(r.terms.rentalYears, 10);
});
t('nothing is inferred: no rental sentence → rental units, sale units and period stay null (never the total, never 0)', () => {
  const r = D.normalizeMichraz(item(3, 'מכרז מספר חי/922/2099 &#8211; TEST FIXTURE', 'הזמנה לקבלת הצעות במכרז פומבי לרכישת זכויות חכירה להקמת מתחם מגורים הכולל 128 יח"ד'), TERMS);
  assert.equal(r.terms.totalUnits, 128);
  assert.equal(r.terms.rentalUnits, null); assert.equal(r.terms.saleUnits, null); assert.equal(r.terms.rentalYears, null); assert.equal(r.terms.discountedShare, null);
});
t('a services procurement notice under the same content type is not a developer tender (no terms parsed)', () => {
  const r = D.normalizeMichraz(item(4, 'שירותי בקרה הנדסית', 'הזמנה להציע הצעות למתן שירותי בקרה הנדסית'), TERMS);
  assert.equal(r.kind, 'procurement'); assert.equal(r.terms, null); assert.equal(r.tender, null);
});
t('a stated part + sale above the stated total marks the parse inconsistent (shown, never trusted silently)', () => {
  const r = D.rentalTerms('הכולל 100 יח"ד לבניה רוויה, מתוכן 67 יח"ד למטרת השכרה לטווח ארוך למשך 25 שנים, ו-167 יח"ד למכירה');
  assert.equal(r.inconsistent, true);
});
t('the other explicit phrasings: parentheses, "מתוכם", units-then-sale, approximate totals, permanent rental', () => {
  const a = D.rentalTerms('הכולל סה"כ 248 יח"ד למטרת השכרה לטווח ארוך (186 יח"ד) ולמכירה (62 יח"ד)');
  assert.deepStrictEqual([a.totalUnits, a.rentalUnits, a.saleUnits, a.rentalBasis], [248, 186, 62, 'stated-part']);
  const b = D.rentalTerms('הכולל סה"כ 315 יח"ד מתוכם 210 יח"ד למטרת השכרה לטווח ארוך ו-105 יח"ד למכירה');
  assert.deepStrictEqual([b.totalUnits, b.rentalUnits, b.saleUnits], [315, 210, 105]);
  const c = D.rentalTerms('הכולל 450 יח"ד – 338 יח"ד להשכרה למשך 20 שנים ו – 112 יח"ד למכירה מיידית');
  assert.deepStrictEqual([c.rentalUnits, c.saleUnits, c.rentalYears], [338, 112, 20]);
  const d = D.rentalTerms('מתחם מגורים לדיור להשכרה לטווח ארוך (כ-50 יח"ד*) במתחם TEST FIXTURE');
  assert.equal(d.totalUnits, 50); assert.equal(d.totalApprox, true); assert.equal(d.rentalBasis, 'stated-all');
  const e = D.rentalTerms('הכולל 234 יח"ד לבניה רוויה, מתוכן 117 יח"ד למטרת השכרה לצמיתות, ו-117 יח"ד למכירה מיידית');
  assert.equal(e.rentalPermanent, true); assert.equal(e.rentalYears, null); assert.equal(e.rentalUnits, 117);
});
t('the rental period is never the lease term (חוזה חכירה … 98 שנים); a whole-project description is its own basis', () => {
  const r = D.rentalTerms('הכולל 300 יח"ד ולניהול והפעלה של פרויקט "דירה להשכיר במתחם TEST FIXTURE" להשכרה למשך 15 שנים. מזמינות הצעות לחתימה על חוזה חכירה ישירה מהוון לתקופה של 98 שנים');
  assert.equal(r.rentalYears, 15); assert.equal(r.rentalBasis, 'project-rental'); assert.equal(r.rentalUnits, 300);
  const l = D.rentalTerms('הכולל 120 יח"ד. חוזה חכירה לתקופה של 98 שנים');
  assert.equal(l.rentalYears, null); assert.equal(l.rentalUnits, null);
});
t('an "all rental" phrase beside units for sale is ambiguous → rental units stay null', () => {
  const r = D.rentalTerms('(סה"כ 200 דירות) כפרויקט מגורים להשכרה למשך 20 שנים, 40 יח"ד למכירה');
  assert.equal(r.rentalUnits, null); assert.equal(r.ambiguous, true); assert.equal(r.saleUnits, 40);
});
t('a population-reserved rental is kept apart; several per-compound figures are never collapsed into one', () => {
  const a = D.rentalTerms('הכולל 1,189 יח"ד לבניה רוויה, מתוכן 399 יח"ד למטרת השכרה לטווח ארוך למשך 20 שנה, 600 יח"ד להשכרה לסגל רפואי ו-190 יח"ד למכירה מיידית. 600 יח"ד במגרשים TEST תיועדנה להשכרה לסגל רפואי, בהנחה של 30% בשכה"ד.');
  assert.deepStrictEqual([a.totalUnits, a.rentalUnits, a.saleUnits], [1189, 399, 190]);
  assert.equal(a.specialRental[0].units, 600); assert.match(a.discountedText, /בהנחה של 30%/);
  const b = D.rentalTerms('הכוללים 484 יח"ד. מתחם א\' יכלול 352 יח"ד, שמתוכן 286 יח"ד להשכרה ארוכת טווח לתקופה של 15 שנה, ומתחם ב\' יכלול 132 יח"ד להשכרה ארוכת טווח לתקופה של 15 שנה. %50 מהדירות להשכרה בכל מתחם תיועדנה לדיור בשכר דירה מפוקח לזכאים.');
  assert.equal(b.rentalUnits, null); assert.equal(b.ambiguous, 'multiple-statements'); assert.deepStrictEqual(b.rentalStatements, [286, 132]);
  assert.equal(b.discountedShare, 50); assert.equal(b.rentalYears, 15);
});
t('the tender number join key is the Authority\'s own: year × 10000 + number; malformed numbers are refused', () => {
  assert.equal(D.tenderNumberOf('מכרז מספר מר/161/2026').michrazId, 20260161);
  assert.equal(D.tenderNumberOf('מכרז 161/2026'), null);              /* no region prefix → not the printed tender number */
  assert.equal(D.tenderNumberOf('מר/161/1899'), null);
});
t('planning sites carry no plan number → never an XPlan join', () => {
  const p = D.normalizePlanning({ id: 9, date: '2099-01-01T00:00:00', modified: '2099-01-02T00:00:00', link: 'x', title: { rendered: 'TEST FIXTURE מתחם, חולון' }, statuss: [38] }, { 38: { id: 38, name: 'בתכנון', slug: 'x' } });
  assert.equal(p.planNumber, null); assert.equal(p.site, 'TEST FIXTURE מתחם'); assert.equal(p.placeText, 'חולון'); assert.equal(p.status.name, 'בתכנון');
});
t('project pages are page-only: URL + lastmod, no fields', () => {
  const pages = D.parseSitemap('<urlset><url><loc>https://example.invalid/project/%D7%90-%D7%91/</loc><lastmod>2099-09-14T08:25:15+00:00</lastmod></url></urlset>');
  assert.deepStrictEqual(pages, [{ url: 'https://example.invalid/project/%D7%90-%D7%91/', lastmod: '2099-09-14', slug: 'א ב' }]);
  assert.equal(D.SOURCE.classification, 'CMS_PUBLIC_API');
});
t('read-only: the module only ever issues GET requests with its own User-Agent', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/rental/dira.js'), 'utf8');
  assert.doesNotMatch(src, /method:\s*['"](POST|PUT|PATCH|DELETE)/i);
  assert.match(D.UA, /^PROPX-rental-sync\//);
});

console.log(`\nrental: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
