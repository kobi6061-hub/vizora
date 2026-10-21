// PROPX · a plan's TOPIC — read from the plan's OWN name and type (Xplan pl_name · entity_subtype_desc) only: a label of the plan's text,
// never a join and never a statement about what was built. Used by the national plan-boundaries sync and the street report.
//
//   RAIL_TRANSIT             light rail · metro · railway · BRT / mass transit (the words name the line, not a place called after it)
//   ROAD                     roads, interchanges ("תכנית דרך")
//   RENEWAL                  urban renewal (פינוי-בינוי · התחדשות עירונית · תמ"א 38)
//   NATIONAL_INFRASTRUCTURE  any other national infrastructure plan (תת"ל)
//   PREFERRED_HOUSING        preferred / national housing plans (ותמ"ל)
//   OTHER                    everything else

'use strict';

/* a Hebrew word: up to two prefix letters (ו ב ה ל מ ש כ), then the word, then no further Hebrew letter ("מטרו" ≠ "מטרופוליני") */
const W = (s) => new RegExp('(^|[^א-ת])[ובהלמשכ]{0,2}(' + s + ')($|[^א-ת])');
const RAIL = [W('רכבת ה?קלה'), W('רק"ל'), W('רק״ל'), W('רקל'), W('קו מטרו'), W('מטרו'), /\bM\d[NS]?\b/, W('מסילת'), W('מסילה'), W('מסילות'), W('מטרונית'), /\bBRT\b/, W('הסעת המונים'), W('תחנת רכבת'), W('קו רכבת')];
/* a place named after the line, or a land-use plan along / near it — not the line itself */
const RAIL_NOT = [W('מתחם הרכבת'), W('מתחם התחנה'), W('פארק המסילה'), W('רחוב הרכבת'), W('רח\' הרכבת'), W('לאורך ציר'), W('בקרבת'), W('עיבוי'), W('מגורים')];
const ROAD = [W('כביש'), W('מחלף'), W('דרך מס\''), W('דרך מהירה'), W('דרך ארצית')];
const RENEWAL = [W('התחדשות עירונית'), W('התחדשות בניינית'), W('פינוי[ -]בינוי'), W('פינוי ובינוי'), W('תמ"א 38'), W('תמא 38'), W('הריסה ובנייה'), W('הריסה ובניה')];

/** the topic of one plan record { name, kind, planNumber } */
function topicOf(p) {
  const name = String((p && p.name) || '');
  const kind = (p && p.kind) || '';
  const rail = RAIL.some((re) => re.test(name)) && !RAIL_NOT.some((re) => re.test(name));
  if (rail) return 'RAIL_TRANSIT';
  if (kind === 'תכנית דרך' || ROAD.some((re) => re.test(name))) return 'ROAD';
  if (RENEWAL.some((re) => re.test(name))) return 'RENEWAL';
  if (kind === 'תכנית לתשתית לאומית') return 'NATIONAL_INFRASTRUCTURE';
  if (kind === 'תכנית מועדפת לדיור' || kind === 'תכנית לדיור לאומי' || /^תמל/.test(String((p && p.planNumber) || '').replace(/\s+/g, ''))) return 'PREFERRED_HOUSING';
  return 'OTHER';
}

module.exports = { topicOf };
