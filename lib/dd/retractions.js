// PROPX · due-diligence history retractions (18.10.2026). data/dd/history.jsonl is append-only and is never edited; an event
// a PROPX defect produced is RETRACTED here — kept in the ledger, skipped by every read (the bundled window, the watch).
// Each retraction names the run (`at`), the lanes, the reason and the fix. Nothing else is retracted.
'use strict';
const bi = (he, en) => ({ he, en });
const RETRACTED = Object.freeze([
  { at: '2026-10-18T10:24:33.459Z', lanes: ['filings', 'insolvency'], reason: bi('הרחבת סט החברות הנשמרות (וריאנטי כתיב, צדדים במחרוזות משותפות): קריאה ראשונה של חברות שנשמרו לראשונה סומנה כשינוי — 2,011 אירועים', 'the kept-company set widened (spelling variants, joint-string parties): the first read of newly kept companies was marked as a change — 2,011 events'), fix: 'lib/dd/sync.js diffFilings / diffInsolvency: only companies kept in the previous read can produce an event' },
  { at: '2026-10-18T10:24:33.459Z', lanes: ['tlv'], reason: bi('שורות כפולות לאותה בקשה הושוו זו לזו — 213 "שינויי שלב" שלא קרו', 'duplicate rows of one request were compared with each other — 213 "stage changes" that did not happen'), fix: 'lib/dd/sync.js diffTlv: rows grouped per request / supervision file before comparing' },
]);
const isRetracted = (e) => !!e && RETRACTED.some((r) => r.at === e.at && r.lanes.includes(e.lane));
module.exports = { RETRACTED, isRetracted };
