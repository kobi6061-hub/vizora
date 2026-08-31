// PROPX · property-type classification for government deal records.
//
// The live GovMap deals layer returns EVERY reported transaction in the
// area — apartments, but also land (קרקע), commercial units, storage and
// agricultural structures. PROPX is a RESIDENTIAL product, so a land sale
// must never enter an apartment median. The source's free-text
// propertyTypeDescription is classified here and stored on the record;
// nothing is dropped — non-residential rows stay retrievable and counted,
// they are simply kept out of residential statistics by default.

'use strict';

const RESIDENTIAL = [
  /דירה/, /דירת/, /פנטהאוז/, /דופלקס/, /קוטג/, /בית\s*בודד/, /דו[\s-]*משפחתי/,
  /טוריי?ם?/, /בית\s*מגורים/, /מגורים/, /וילה/, /יחידת\s*דיור/, /גג/,
];
const LAND = [/קרקע/, /מגרש/, /נחלה/, /משק/, /חלקה\s*חקלאית/, /אדמה/];
const COMMERCIAL = [
  /חנות/, /משרד/, /מסחר/, /תעשי/, /מלאכה/, /מחסן/, /חני[יה]ה/, /מבנה\s*חקלאי/,
  /מלון/, /אולם/, /תחנת/, /בית\s*מלאכה/,
];

/**
 * @param {string} desc  the source's property/deal nature text
 * @returns {{propertyClass:'residential'|'land'|'commercial'|'unknown',
 *            residential:boolean, evidence:string}}
 */
function classifyPropertyType(desc) {
  const d = String(desc || '').trim();
  if (!d) return { propertyClass: 'unknown', residential: false, evidence: 'source published no property type' };
  const hit = (list) => list.find((re) => re.test(d));
  let m = hit(LAND);
  if (m) return { propertyClass: 'land', residential: false, evidence: `"${d}" matches land ${m}` };
  m = hit(COMMERCIAL);
  if (m) return { propertyClass: 'commercial', residential: false, evidence: `"${d}" matches non-residential ${m}` };
  m = hit(RESIDENTIAL);
  if (m) return { propertyClass: 'residential', residential: true, evidence: `"${d}" matches residential ${m}` };
  return { propertyClass: 'unknown', residential: false, evidence: `"${d}" not recognised as a residential type` };
}

module.exports = { classifyPropertyType };
