#!/usr/bin/env node
// PROPX · SOURCE UNIVERSE CATALOGUE (21.10.2026, the master data directive M2 / M3) — one auditable file over every source PROPX has
// examined: the WHOLE data.gov.il catalogue (1,203 packages, read in full on a runner 21.10.2026), the earlier discovery ledgers
// (17.10 · 18.10 · 18.10-premium · 19.10-transactions · 20.10-transaction-sources — 95 entries), and the 21.10 runner probes of every
// other channel (gov.il · GovMap · Tax Authority · CBS · Bank of Israel SDMX · Planning Administration ArcGIS · Ministry of Transport ·
// municipal CKAN / GIS portals · IMS · others). Nothing is fetched here: the builder only reads the stored evidence and the repository.
//
// Every source carries the directive's 20 fields and ONE of its 11 states. CONNECTED_VERIFIED only for a source integrated in THIS
// mission whose stored sync proves retrieval + validation (records > 0, a SUCCESS run) and whose read model is named; EXISTING_VERIFIED for
// a source PROPX already read before it (with the Trust Center's latest check). A state is never inferred from a name: each comes from the
// evidence, the triage's hand classification, a ledger verdict, or a rule written below with its reason.
//
//   node scripts/source-universe-build.js            → lib/trust/discovery/2026-10-21-source-universe.json (+ findings-2026-10-21.md)
//   node scripts/source-universe-build.js --check    → exit 1 when the stored file differs from a rebuild (the test runs this)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const DISC = path.join(ROOT, 'lib', 'trust', 'discovery');
const UNI = path.join(DISC, '2026-10-21-universe');
const OUT = path.join(DISC, '2026-10-21-source-universe.json');
const MD = path.join(DISC, 'findings-2026-10-21.md');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(UNI, f))).toString('utf8'));

const STATES = Object.freeze({
  CONNECTED_VERIFIED: 'integrated in this mission: retrieved on a runner, validated (schema guard, complete read), stored, and read by a named PROPX read model',
  EXISTING_VERIFIED: 'already read by PROPX before this mission; its sync and read model exist (latest check from the Trust Center)',
  ACCESSIBLE_NOT_YET_INTEGRATED: 'answered on the runner with usable, licensed data; not yet read by PROPX',
  REDUNDANT_PROVEN: 'answered, but what it holds PROPX already reads from the primary source (the evidence names it)',
  BLOCKED_AUTH: 'needs a key, an account or identification PROPX does not hold',
  BLOCKED_TECHNICAL: 'refused or unreachable from the runner (403 / bot screen / CAPTCHA / connection failure / server error) — never bypassed',
  LICENSE_REVIEW_REQUIRED: 'answered with usable data, but the licence is not stated or restricts reuse — needs the founder\'s licence decision',
  PAID_APPROVAL_REQUIRED: 'a paid or contracted product — needs the founder\'s approval before any call',
  UNSUITABLE_DATA: 'answered (or the catalogue was searched), but the content is not material, is stale, is unjoinable or does not exist',
  NOT_ACTUALLY_AN_API: 'a web page, a PDF / spreadsheet release, a viewer or a missing host — no machine interface to read',
  PENDING_VERIFICATION: 'listed and plausible, but its rows / schema / licence were not read in this pass — named with what would verify it',
});
const FIELDS = ['publisher', 'documentation', 'dataset', 'endpoint', 'requestedAt', 'http', 'schema', 'fields', 'pagination', 'rateLimit', 'rows', 'geography',
  'history', 'newest', 'freshness', 'licence', 'access', 'fit', 'integration', 'evidence'];

/* ── repository state: what the code reads (resource ids), the lanes new in this mission, the Trust Center's latest checks ── */
const NEW_LANES = Object.freeze({ 'lib/reference/index.js': 'data/reference', 'lib/transport/index.js': 'data/transport', 'lib/finance/series.js': 'data/finance', 'lib/surroundings/index.js': 'data/surroundings' });
function codeRefs() {
  const out = new Map();   // resource id / quoted package name → file
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d + '/' + e.name;
    if (e.isDirectory()) { if (p === 'lib/trust') continue; walk(p); } else if (e.name.endsWith('.js') && !/discover|source-universe-build/.test(e.name)) {
      const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
      for (const m of s.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) if (!out.has(m[0])) out.set(m[0], p);
      for (const m of s.matchAll(/package(?:Id|Name)?\s*:\s*'([^']+)'/g)) if (!out.has('pkg:' + m[1])) out.set('pkg:' + m[1], p);
    } } };
  for (const d of ['lib', 'api', 'scripts']) walk(d);
  return out;
}
function laneProof(file, pkgResource) {
  // a NEW lane's stored sync for this resource: data/<lane>/<id>/meta.json with records > 0 and a SUCCESS / UNCHANGED run
  const dir = NEW_LANES[file]; if (!dir || !fs.existsSync(path.join(ROOT, dir))) return null;
  for (const id of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const mp = path.join(ROOT, dir, id, 'meta.json'); if (!fs.existsSync(mp)) continue;
    const m = JSON.parse(fs.readFileSync(mp, 'utf8')); if (m.resourceId !== pkgResource) continue;
    const runs = fs.existsSync(path.join(ROOT, dir, id, 'runs.jsonl')) ? fs.readFileSync(path.join(ROOT, dir, id, 'runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const ok = runs.filter((r) => /success|unchanged|changed/i.test(String(r.status || r.state || '')));
    return { store: `${dir}/${id}/`, records: m.records, sourceRows: m.sourceRows, rejected: m.rejected, contentHash: m.contentHash, readAt: m.readAt, checkedAt: m.checkedAt, sourceUpdatedAt: m.sourceUpdatedAt, runs: runs.length, okRuns: ok.length, trustId: m.trustId || null };
  }
  return null;
}
const TRUST = (() => { const C = require('../lib/trust/catalog').catalog(); const by = new Map(); for (const s of C.sources) by.set(s.id, s); return { by, integrates: new Map(C.sources.filter((s) => s.discovery && s.discovery.integrates).map((s) => [s.discovery.integrates, s])) }; })();
const trustCheck = (s) => (s ? { trustId: s.id, inProduct: !!s.inProduct, state: s.sync ? s.sync.state : null, lastCheckAt: s.sync ? s.sync.lastCheckAt : null, lastGoodAt: s.sync ? s.sync.lastGoodAt : null } : null);
// the read model that consumes each new lane (the integration's downstream evidence)
const READERS = Object.freeze({
  'lib/reference/index.js': 'lib/dossier/query.js (sections.context) · lib/streets/report.js (locality context) · api/intel.js view=localityContext',
  'lib/transport/index.js': 'lib/streets/report.js (transport) · index.html street report "Public-transport access"',
  'lib/finance/series.js': 'lib/dossier/query.js (sections.finance) · api/intel.js view=finance · index.html dossier "Housing finance"',
  'lib/surroundings/index.js': 'lib/streets/report.js (surroundings) · index.html street report "Street surroundings"',
});

/* ── evidence files ── */
const EV = Object.fromEntries(['ckan', 'gov', 'other', 'mot', 'mot2', 'cbs', 'cbs2', 'boi', 'boi2', 'iplan', 'muni', 'verify'].map((k) => [k, gz(k + '.json.gz')]));
const VERIFY = new Map(EV.verify.datagov.map((p) => [p.pkg, p]));
const LICENCE_OK = (l) => !!l && !/לא צוין|not stated|^null$/i.test(String(l));
const TRIAGE = gz('ckan-triage.json.gz');
const evPath = (k) => rel(path.join(UNI, k + '.json.gz'));
function probeOf(k, pred) {
  const E = EV[k]; const pools = [E.pages, E.probes, E.samples, E.portals, E.ckan, E.packages, E.subjects, E.flows].filter(Array.isArray);
  for (const pool of pools) { const hit = pool.find(pred); if (hit) return hit; }
  throw new Error(`evidence ${k}: no probe matches ${pred}`);
}
const httpOf = (p) => (p ? { status: p.status ?? null, type: p.type || null, bytes: p.bytes ?? null, error: p.error || null, challenge: p.challenge || null, url: p.url || null } : null);

/* ── 1. the data.gov.il catalogue (every package; the 221 relevant ones in full) ── */
const CK = EV.ckan.datagov;
const pkgByName = new Map(CK.packages.map((p) => [p.name, p]));
const probesByPkg = new Map(); for (const p of CK.probes) { const a = probesByPkg.get(p.pkg); if (a) a.push(p); else probesByPkg.set(p.pkg, [p]); }
const REFS = codeRefs();
const motDownloads = new Map(); for (const p of EV.mot2.packages || []) for (const r of p.resources || []) if (r.download) motDownloads.set(r.id, r.download);

function geographyOf(fields, org) {
  const f = (fields || []).map((x) => String(x).split(':')[0]);
  const keys = [];
  if (f.some((x) => /gush|helka|parcel|chelka/i.test(x))) keys.push('block / parcel');
  if (f.some((x) => /^(x|y|lat|lon|long|longitude|latitude|itm_x|itm_y|coord)/i.test(x))) keys.push('point coordinates');
  if (f.some((x) => /city|semel|yishuv|settlement|locality|municipal|CityCode/i.test(x))) keys.push('locality code / name');
  if (f.some((x) => /street|rechov|רחוב/i.test(x))) keys.push('street');
  if (f.some((x) => /district|mahoz|machoz/i.test(x))) keys.push('district');
  return { scope: /^עיריית|^מועצה/.test(org || '') ? 'one municipality (the publisher)' : 'the publisher\'s national remit — completeness not measured in this pass', keys: keys.length ? keys : ['not visible in the fields read'] };
}

function ckanSource(r) {
  const P = pkgByName.get(r.name); if (!P) throw new Error('triage package not in the catalogue read: ' + r.name);
  const probes = probesByPkg.get(r.name) || [];
  const pr = r.probe && r.probe.resource ? probes.find((x) => x.resource === r.probe.resource) || null : probes[0] || null;
  const resIds = P.resources.map((x) => x.id);
  const ref = resIds.map((id) => [id, REFS.get(id)]).find((x) => x[1]) || (REFS.get('pkg:' + r.name) ? [null, REFS.get('pkg:' + r.name)] : null);
  const dl = P.resources.map((x) => motDownloads.get(x.id)).find(Boolean) || null;
  let state = r.proposedState, why = r.reason, integration = { integrated: false, by: null };
  if (ref) {
    const proof = laneProof(ref[1], ref[0]);
    if (proof) {
      if (!(proof.records > 0 && proof.okRuns > 0)) throw new Error(`${r.name}: a new lane without a successful stored read — never CONNECTED_VERIFIED`);
      state = 'CONNECTED_VERIFIED'; why = `read whole on the runner (${proof.runs} run(s), ${proof.okRuns} successful), ${proof.records} records stored at ${proof.store} (content ${String(proof.contentHash).slice(0, 12)}…), read by ${READERS[ref[1]]}`;
      integration = { integrated: true, by: ref[1], thisMission: true, proof, readBy: READERS[ref[1]], trust: trustCheck(TRUST.by.get(proof.trustId)) };
    } else if (NEW_LANES[ref[1]]) {
      /* code written in this mission but no stored successful read yet — never CONNECTED, never EXISTING */
      integration = { integrated: false, by: null, pendingLane: ref[1], note: 'read by a lane added in this mission — awaiting its first successful runner sync' };
      why = `a lane added in this mission (${ref[1]}) reads it — no stored successful read yet, so it is not CONNECTED; ` + (r.reason || '');
    } else {
      state = 'EXISTING_VERIFIED'; why = `read by ${ref[1]} before this mission` + (r.reason ? ' — ' + r.reason : '');
      const tr = [...TRUST.by.values()].find((s) => s.url && P.resources.some((x) => String(s.url).includes(x.id) || String(s.url).includes('/dataset/' + r.name)));
      integration = { integrated: true, by: ref[1], thisMission: false, trust: trustCheck(tr) };
    }
  } else if (state === 'CONNECTED_VERIFIED' || state === 'EXISTING_VERIFIED') throw new Error(`${r.name}: classified ${state} but no resource of it is read by the code`);
  /* the verify pass (21.10.2026): every resource of the package read — datastore tables counted, files by two ranged GETs */
  const V = VERIFY.get(r.name);
  let verified = null;
  if (V) {
    const ds = V.resources.filter((x) => x.table && x.table.status === 200 && x.table.total != null);
    const files = V.resources.filter((x) => x.file && x.file.first);
    const refused = files.filter((x) => x.file.first.status === 403);
    verified = { packageShow: V.status, licence: V.license || null, modified: V.modified || null, tables: ds.map((x) => ({ id: x.id, rows: x.table.total, fields: (x.table.fields || []).map((f) => String(f).split(':')[0]) })),
      files: files.map((x) => ({ id: x.id, format: x.format, status: x.file.first.status, host: x.file.first.host || null, size: x.file.first.contentRange ? Number(String(x.file.first.contentRange).split('/')[1]) || null : null, zipEntries: x.file.zip && x.file.zip.entries ? x.file.zip.entries.map((e) => e.name).slice(0, 12) : null })) };
    if (!integration.integrated && (state === 'PENDING_VERIFICATION' || state === 'ACCESSIBLE_NOT_YET_INTEGRATED')) {
      if (ds.length) { const ok = LICENCE_OK(V.license || r.licence); state = ok ? 'ACCESSIBLE_NOT_YET_INTEGRATED' : 'LICENSE_REVIEW_REQUIRED'; why = `verified 21.10.2026: ${ds.length} datastore table(s) answered (${ds.map((x) => x.table.total).join(' · ')} rows)` + (refused.length ? `; ${refused.length} file download(s) refused (403)` : '') + (ok ? '' : `; licence "${V.license || 'none'}" — not an open licence statement`); }
      else if (files.length && refused.length === files.length) { state = 'BLOCKED_TECHNICAL'; why = `verified 21.10.2026: every file of the package (${files.length}) answered HTTP 403 on the data.gov.il file host and it has no datastore table — not bypassed`; }
      else if (files.some((x) => x.file.first.status === 206 || x.file.first.status === 200)) { state = 'ACCESSIBLE_NOT_YET_INTEGRATED'; why = `verified 21.10.2026: the package\'s link answers (${files.filter((x) => x.file.first.status === 206 || x.file.first.status === 200).map((x) => x.file.first.host).join(', ')}) — ` + (r.reason || ''); }
    }
  }
  const vRows = verified && verified.tables.length ? Math.max(...verified.tables.map((x) => x.rows)) : null;
  const fields = pr && pr.fields ? pr.fields.map((x) => String(x).split(':')[0]) : verified && verified.tables[0] ? verified.tables[0].fields : null;
  return {
    id: 'datagov:pkg:' + r.name, origin: 'data.gov.il catalogue', name: r.title, domain: r.domain, value: r.value,
    publisher: r.org, documentation: 'https://data.gov.il/dataset/' + r.name,
    dataset: { package: r.name, packageId: P.id, resources: P.resources.map((x) => ({ id: x.id, name: x.name, format: x.format, datastore: !!x.datastore, modified: x.modified, size: x.size ?? null })) },
    endpoint: pr ? `https://data.gov.il/api/3/action/datastore_search?resource_id=${pr.resource}` : 'https://data.gov.il/api/3/action/package_search?rows=1000&start=0&sort=name+asc (catalogue entry)',
    requestedAt: EV.ckan.at,
    http: pr ? { status: pr.status, type: 'application/json (CKAN action API)' } : { status: 200, type: 'application/json (catalogue page)', note: 'the package was read from the catalogue; no datastore resource was probed' + (dl ? ` — its file download answered ${dl.status}` : '') },
    schema: pr ? pr.fields : P.resources.map((x) => `${x.format || '?'} file${x.datastore ? ' (datastore)' : ''}`),
    fields: fields || null,
    pagination: P.resources.some((x) => x.datastore) ? 'CKAN datastore_search: limit / offset, the total in every response (PROPX reads whole: complete or fail)' : 'file download — no paging',
    rateLimit: 'none published; PROPX reads at ≤ 1 request / second',
    rows: pr && pr.total != null ? pr.total : vRows, rowsNote: pr || vRows != null ? null : 'not counted — no datastore table answered',
    verified,
    geography: geographyOf(pr && pr.fields, r.org),
    history: { resourcesModified: [P.resources.map((x) => x.modified).filter(Boolean).sort()[0] || null, P.resources.map((x) => x.modified).filter(Boolean).sort().slice(-1)[0] || null], created: P.created || null },
    newest: pr && pr.newest ? { field: pr.newest.field, value: pr.newest.value, note: 'a sort of the field as stored (a dd/mm/yyyy text sorts as text)' } : null,
    freshness: { packageModified: P.modified, frequency: r.frequency || P.frequency || null },
    licence: r.licence || P.licenseTitle || 'not stated in the catalogue',
    access: 'keyless public CKAN API (data.gov.il)' + (dl ? `; the file download answered HTTP ${dl.status} to the runner (not bypassed)` : ''),
    fit: { why: r.valueWhy, joinKey: r.joinKey || null },
    integration,
    evidence: { files: [evPath('ckan') + ' → datagov.packages[name=' + r.name + ']' + (pr ? ' + datagov.probes[pkg=' + r.name + ']' : ''), rel(path.join(UNI, 'ckan-triage.json.gz')) + ' → relevant[name=' + r.name + ']'].concat(dl ? [evPath('mot2') + ' → packages[pkg=' + r.name + ']'] : []).concat(V ? [evPath('verify') + ' → datagov[pkg=' + r.name + ']'] : []), note: r.reason },
    state, stateWhy: why,
  };
}

/* ── 2. the earlier ledgers (95 entries): one state each — the default from classification × verdict, overrides with their reason ── */
const LEDGERS = ['2026-10-17.json', '2026-10-18.json', '2026-10-18-premium.json', '2026-10-19-transactions.json'];
const OVERRIDE = Object.freeze({
  // INTEGRATE verdicts not yet read
  'cbs:series:second-hand-sales-by-district': (() => { let L = null; try { L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cbs-sales', 'latest.json'), 'utf8')); } catch { /* not synced */ }
    const runs = fs.existsSync(path.join(ROOT, 'data', 'cbs-sales', 'runs.jsonl')) ? fs.readFileSync(path.join(ROOT, 'data', 'cbs-sales', 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    const ok = L && L.market && L.market.il && L.market.il.second_hand_sold && runs.some((r) => r.state === 'SUCCESS' && r.requests >= 68);
    return ok ? ['CONNECTED_VERIFIED', `integrated 21.10.2026 into lib/cbs-sales (44,10,6 total · 44,10,7 second-hand · 44,10,2,2 subsidized by district; every 7047–7053 code resolved by the NAME the API returns): a ${runs.filter((r) => r.requests >= 68).length}-run record, ${Object.keys(L.market).length} geographies stored in data/cbs-sales/latest.json → market, read by lib/dossier/query.js (sections.market) and the page's dossier tiles`]
      : ['ACCESSIBLE_NOT_YET_INTEGRATED', 'the same CBS time-series API PROPX reads for new-home sales; not synced yet']; })(),
  'iplan:vatmal-mitchamim-muchrazim': ['ACCESSIBLE_NOT_YET_INTEGRATED', 're-confirmed 21.10.2026: layer 0 answers with 203 declared complexes (iplan.json.gz) — not read yet'],
  'tlv:gis:iview2-permits-sites-plans': ['EXISTING_VERIFIED', 'integrated as tlv:iview2:permits-772 + tlv:iview2:sites-499 (lib/dd/sync.js)'],
  'datagov:labor:closed-construction-sites': ['EXISTING_VERIFIED', 'read by lib/dd/sync.js (sitesClosed, resource b9257d8f…)'],
  'tlv:iview2:sites-499': ['EXISTING_VERIFIED', 'read by lib/dd/sync.js (tlvSites, layer 499)'],
  'datagov:moch:construction-progress': ['EXISTING_VERIFIED', 'read by lib/land/planning.js (exact block + parcel); the source itself is STALE (last modified 2024-03)'],
  'datagov:mot:lrt-metro-netivei': ['CONNECTED_VERIFIED', 'integrated 21.10.2026 as lib/transport (lrt_stat · metro_stat · rail_stat tables + the stop registry); the line shapefiles stay BLOCKED_TECHNICAL (403)'],
  // pages, releases, missing hosts
  'cbs:average-rent-shekel': ['NOT_ACTUALLY_AN_API', 'published only inside releases / tables; the CPI rent component is the machine-readable rent signal PROPX reads'],
  'datagov:beer-sheva:buildings': ['ACCESSIBLE_NOT_YET_INTEGRATED', 'official and structured; one city with a coordinate key — documented, not read'],
  'datagov:moch:gis-files': ['BLOCKED_TECHNICAL', 'the file host refuses the runner (HTTP 403) — not bypassed'],
  'datagov:moch:unused-datasets': ['UNSUITABLE_DATA', 'catalogue completeness only; the one housing-relevant resource is assessed separately (no rows)'],
  'haifa:opendata:ckan': ['UNSUITABLE_DATA', 'its housing-relevant content is a cut of national datasets PROPX reads; re-listed 21.10.2026 (81 packages) — see muni:haifa:planning-preservation for the planning / preservation subset'],
  'iplan:arcgis-services-directory': ['REDUNDANT_PROVEN', 'the directory itself — every material service in it is a separate entry (Xplan EXISTING, vatmal / Shimour / land use / boundaries ACCESSIBLE)'],
  'datagov:digital:socio-economic-cluster-2019': ['UNSUITABLE_DATA', 'a 2019 edition; the census 2022 lane (CONNECTED_VERIFIED) is the locality context PROPX reads'],
  'iplan:plan-index-tma-tmm-ttl': ['UNSUITABLE_DATA', 'statutory national / district plan outlines dated 2016 — never attributable to one street (the directive\'s rule)'],
  'jerusalem:opendata:data-city': ['LICENSE_REVIEW_REQUIRED', 're-checked 21.10.2026: the portal answers (114 packages); the packages read in the verify pass are ODbL (share-alike) — see muni:jerusalem:* entries'],
  'datagov:rmi:organization': ['REDUNDANT_PROVEN', 'nothing beyond the planning inventory PROPX already reads (lib/land/planning.js)'],
  'muni:gis-roots:haifa-beersheva-rishon-netanya-petahtikva': ['NOT_ACTUALLY_AN_API', 'no endpoint under the probed names (re-confirmed 21.10.2026: ENOTFOUND for Petah Tikva / Rishon / Netanya / Ramat Gan / Herzliya GIS hosts)'],
  'datagov:moj:official-receiver:debt-claims': ['UNSUITABLE_DATA', 'a case key with an undocumented relation to the company file; mostly personal bankruptcy'],
  'tlv:iview2:parcels-524': ['REDUNDANT_PROVEN', 'cadastre geometry only; the parcel key PROPX needs is already on the sites layer (499) it reads'],
  'datagov:moj:amutot': ['ACCESSIBLE_NOT_YET_INTEGRATED', 'relevant only to nonprofit-kind developers; not read'],
  'tase:maya:static-reports': ['BLOCKED_TECHNICAL', 'a report opens only with a known number; the index is the refused API (403 anti-bot)'],
  'tase:datahub': ['PAID_APPROVAL_REQUIRED', 'a keyed, licensed TASE data product'],
  'ratings:midroog': ['LICENSE_REVIEW_REQUIRED', 'the site answers, but ratings are the agency\'s copyrighted product'],
  'ica:company-extract': ['PAID_APPROVAL_REQUIRED', 'sold per extract behind identification'],
  'courts:class-actions-registry': ['NOT_ACTUALLY_AN_API', 'a public HTML search form; PROPX does not drive search forms'],
  'muni:permits:haifa': ['UNSUITABLE_DATA', 'the portal answers; no permit dataset'],
  'muni:permits:petah-tikva': ['UNSUITABLE_DATA', 'the municipality\'s 4 data.gov.il datasets hold no permits'],
  'muni:permits:beer-sheva': ['UNSUITABLE_DATA', 'its 44 datasets hold no building permits'],
  'muni:permits:ashdod': ['UNSUITABLE_DATA', 'the ArcGIS server answers; no permit layer'],
  'muni:permits:kfar-saba': ['UNSUITABLE_DATA', 'only a third-party 2021 ArcGIS Online snapshot (70 / 58 rows)'],
  'arcgis-online:public-permit-items': ['UNSUITABLE_DATA', 'owners are unverified accounts, not municipal publishers'],
  'sales:project-level': ['UNSUITABLE_DATA', 'no project-level sales dataset exists in any open channel searched'],
  'datagov:tax-deals': ['UNSUITABLE_DATA', 'no transaction dataset exists on data.gov.il (re-confirmed by the 21.10.2026 full catalogue read)'],
  'over:govmap-layer': ['EXISTING_VERIFIED', 'read since 20.10.2026 as the separate RECENT layer (lib/recent) and the whole published file (lib/txevents)'],
  'propx:sandbox-egress-policy': ['EXCLUDED', 'an access-path note, not a data source'],
});
function ledgerDefault(c) {
  const k = c.classification, v = c.verdict;
  if (k === 'RESTRICTED' && /BLOCKED|BROWSER/.test(v)) return ['BLOCKED_TECHNICAL', 'refused to the runner (403 / bot screen / connection failure) — not bypassed'];
  if (k === 'RESTRICTED') return ['BLOCKED_TECHNICAL', 'refused to the runner — not bypassed'];
  if (k === 'OFFICIAL_PAGE_ONLY') return ['NOT_ACTUALLY_AN_API', 'a page / release without a machine interface'];
  if (k === 'UNUSABLE' && v === 'BLOCKED') return ['BLOCKED_TECHNICAL', 'refused to the runner — not bypassed'];
  if (k === 'UNUSABLE' && /no open-data portal|no .*found at the probed hosts/i.test(c.why || '')) return ['NOT_ACTUALLY_AN_API', 'no portal or service at the probed hosts'];
  if (k === 'UNUSABLE') return ['UNSUITABLE_DATA', 'no usable rows for PROPX'];
  if (k === 'STALE') return ['UNSUITABLE_DATA', 'stale'];
  if (/CONFIRMED/.test(k) && v === 'REJECT') return ['UNSUITABLE_DATA', 'answers, but not material / unjoinable'];
  if (/CONFIRMED/.test(k) && v === 'DOCUMENT-ONLY') return ['UNSUITABLE_DATA', 'answers; documented only — not material to the current product'];
  if (/CONFIRMED/.test(k) && v === 'INTEGRATE') return ['ACCESSIBLE_NOT_YET_INTEGRATED', 'an INTEGRATE verdict not yet read'];
  if (k === 'PARTIAL') return ['PENDING_VERIFICATION', 'partial evidence'];
  return ['PENDING_VERIFICATION', 'no rule'];
}
// a ledger entry about a data.gov.il package folds into that package's catalogue row (one source, one state)
function ckanPackageOf(c) {
  const u = String(c.url || '') + ' ' + String(c.catalogue || '') + ' ' + (Array.isArray(c.evidence) ? c.evidence.join(' ') : String(c.evidence || ''));
  const m = u.match(/data\.gov\.il\/dataset\/([A-Za-z0-9_\-]+)/); if (m && pkgByName.has(m[1])) return m[1];
  const r = u.match(/resource_id=([0-9a-f-]{36})/); if (r) for (const p of CK.packages) if (p.resources.some((x) => x.id === r[1])) return p.name;
  return null;
}
function ledgerSource(c, file) {
  const ov = OVERRIDE[c.id];
  const integratedBy = TRUST.integrates.get('discovery:' + c.id) || TRUST.by.get(c.id) || null;
  let [state, why] = ov || (integratedBy ? ['EXISTING_VERIFIED', `integrated as ${integratedBy.id}`] : ledgerDefault(c));
  if (!ov && integratedBy && ['datagov:cbs:census-2022-localities-statareas', 'datagov:piba:residents-by-locality'].includes(c.id)) { state = 'CONNECTED_VERIFIED'; why = `integrated 21.10.2026 as ${integratedBy.id} (lib/reference)`; }
  const ev = Array.isArray(c.evidence) ? c.evidence : c.evidence ? [c.evidence] : [];
  const st = (ev.join(' ').match(/\b(200|204|301|302|401|403|404|429|500|502|503)\b/) || [])[1];
  return {
    id: 'ledger:' + c.id, origin: 'discovery ledger ' + file, name: c.name, domain: c.vertical || null, value: c.priority != null ? 'PRIORITY ' + c.priority : null,
    publisher: c.ownerEn ? `${c.owner || ''} (${c.ownerEn})` : c.owner || null, documentation: c.catalogue || c.url || null,
    dataset: { identifiers: c.identifiers || null, contains: c.contains || null },
    endpoint: c.url || null, requestedAt: c.auditedAt || null,
    http: { status: st ? Number(st) : null, note: st ? 'the first status the ledger evidence records' : 'see the ledger evidence text' },
    schema: c.contains || null, fields: c.identifiers || null,
    pagination: c.accessMethod || null, rateLimit: Array.isArray(c.requests) || c.requests ? `the audit made ${Array.isArray(c.requests) ? c.requests.length : c.requests} request(s)` : 'not stated',
    rows: null, rowsNote: 'see the ledger sample / evidence',
    geography: c.geography || null, history: c.period || null, newest: c.freshness || null, freshness: c.cadence || c.freshness || null,
    licence: c.licence || 'not stated in the ledger', access: c.accessMethod || null,
    fit: { why: c.why || null, joinKey: c.joinKey || null, limitations: c.limitations || null },
    integration: integratedBy ? { integrated: true, by: integratedBy.id, trust: trustCheck(integratedBy) } : { integrated: state === 'EXISTING_VERIFIED' || state === 'CONNECTED_VERIFIED', by: state === 'EXISTING_VERIFIED' || state === 'CONNECTED_VERIFIED' ? why : null },
    evidence: { files: [rel(path.join(DISC, file)) + ' → [id=' + c.id + ']'], note: ev.slice(0, 6) },
    priorAudit: { classification: c.classification, verdict: c.verdict, auditedAt: c.auditedAt || null },
    state, stateWhy: why,
  };
}
// the 20.10 transaction-source inventory (its own shape)
const TX_STATE = Object.freeze({
  'official:nadlan.taxes.gov.il': ['BLOCKED_TECHNICAL', 'an identification screen against automated reading — not bypassed'],
  'official:nadlan.gov.il': ['BLOCKED_TECHNICAL', 'reCAPTCHA Enterprise on every data call — not bypassed'],
  'official:gov.il-service': ['BLOCKED_TECHNICAL', 'bot screen (re-confirmed 21.10.2026: HTTP 403 challenge, gov.json.gz)'],
  'official:govmap-layer16': ['BLOCKED_TECHNICAL', 'the edge refuses (re-confirmed 21.10.2026: GovMap 403 / ECONNREFUSED, gov.json.gz)'],
  'official:data.gov.il': ['UNSUITABLE_DATA', 'no deal-level transaction dataset is published (re-confirmed by the 21.10.2026 full catalogue read)'],
  'over:deals-register': ['EXISTING_VERIFIED', 'the register copy PROPX reads (republished — never labelled official); a snapshot that stopped on 19.09.2026'],
  'over:govmap-layer': ['EXISTING_VERIFIED', 'the RECENT layer (lib/recent); no share field — prices never used in statistics'],
  'over:govmap-layer:file': ['EXISTING_VERIFIED', 'the whole published file (lib/txevents national detector + history)'],
  'over:register:files': ['REDUNDANT_PROVEN', 'adds nothing the API sweep does not hold for the window; older history comes through the live search'],
  'over:nadlan-crosswalk': ['EXISTING_VERIFIED', 'the parcel crosswalk PROPX reads to place register deals on streets'],
  'odata:nadlan': ['REDUNDANT_PROVEN', 'a mirror that adds no recent deal'],
  'odata:register-versions': ['NOT_ACTUALLY_AN_API', 'a pointer page only'],
  'municipal:gis': ['UNSUITABLE_DATA', 'no municipal transaction layer found'],
  'commercial:apify-govmap': ['PAID_APPROVAL_REQUIRED', 'a paid third party reading GovMap / nadlan.gov.il — would route around the refusals PROPX receives; not used'],
  'commercial:byndbiz': ['PAID_APPROVAL_REQUIRED', 'no public API or terms for machine use'],
  'listings:madlan-yad2': ['UNSUITABLE_DATA', 'competitors\' listing ASKING prices — never transaction evidence; the directive forbids their APIs, endpoints and data'],
  'user:document': ['EXISTING_VERIFIED', 'the USER DOCUMENT channel (lib/dd/userdocs.js) — due diligence only, not a transaction source'],
});
function txSource(x) {
  const [state, why] = TX_STATE[x.id] || (() => { throw new Error('20.10 transaction source without a state: ' + x.id); })();
  return {
    id: 'ledger:' + x.id, origin: 'discovery ledger 2026-10-20-transaction-sources.json', name: x.name, domain: 'transactions', value: null,
    publisher: x.operator || null, documentation: x.url || null, dataset: { class: x.class, official: x.official }, endpoint: x.url || null, requestedAt: '2026-10-20',
    http: { status: null, reachable: x.reachable, note: x.reachableEvidence || null }, schema: x.fields || null, fields: x.fields || null, pagination: x.readAs || null, rateLimit: 'not stated',
    rows: null, rowsNote: x.coverage || null, geography: x.coverage || null, history: x.latestTransactionDate || null, newest: x.latestTransactionDate || null, freshness: x.refresh || x.latestUpdate || null,
    licence: x.official ? 'official publication — terms of the publisher' : 'third-party terms', access: x.authentication || null,
    fit: { why: x.limitation || null, defects: x.defects || null }, integration: { integrated: !!x.readByPropx, by: x.readAs || null },
    evidence: { files: ['lib/trust/discovery/2026-10-20-transaction-sources.json → sources[id=' + x.id + ']'], note: x.reachableEvidence || null },
    priorAudit: { classification: x.class, verdict: x.readByPropx ? 'READ' : 'NOT READ', auditedAt: '2026-10-20' },
    state, stateWhy: why,
  };
}

/* ── 3. the 21.10 runner probes of every other channel (curated: each entry cites the probe it stands on) ── */
const P = (k, pred) => ({ k, p: probeOf(k, pred) });
const CUR = [];
function cur(o) {
  const ps = (o.probes || []).map((x) => ({ file: evPath(x.k), url: x.p.url || x.p.root || null, label: x.p.label || x.p.flow || x.p.name || x.p.city || null, http: httpOf(x.p) }));
  CUR.push({ id: o.id, origin: '21.10.2026 runner probe (source-universe-discover.js)', name: o.name, domain: o.domain || null, value: o.value || null,
    publisher: o.publisher, documentation: o.documentation || (ps[0] && ps[0].url) || null, dataset: o.dataset || null, endpoint: o.endpoint || (ps[0] && ps[0].url) || null,
    requestedAt: o.at || (o.probes && o.probes[0] ? EV[o.probes[0].k].at : null), http: ps.length ? ps.map((x) => x.http) : null,
    schema: o.schema || null, fields: o.fields || null, pagination: o.pagination || null, rateLimit: o.rateLimit || 'none published; the runner made ≤ 1 request / second',
    rows: o.rows ?? null, rowsNote: o.rowsNote || null, geography: o.geography || null, history: o.history || null, newest: o.newest || null, freshness: o.freshness || null,
    licence: o.licence || 'not stated', access: o.access, fit: { why: o.fit, joinKey: o.joinKey || null }, integration: o.integration || { integrated: false, by: null },
    evidence: { files: ps.map((x) => `${x.file} → ${x.label || x.url}`), note: o.note || null }, state: o.state, stateWhy: o.why });
}
const g = (label) => P('gov', (p) => p.label === label), o = (label) => P('other', (p) => p.label === label);
const fl = (id) => P('boi', (p) => p.flow === id && p.url && /\/data\//.test(p.url));
const svc = (name) => ({ k: 'iplan', p: (() => { const v = EV.iplan.iplan.services.find((x) => x.name === name); if (!v) throw new Error('iplan service ' + name); return { ...v, label: name }; })() });
const lay = (service, id) => ({ k: 'iplan', p: (() => { const l = EV.iplan.iplan.layers.find((x) => x.service === service && x.id === id); if (!l) throw new Error('iplan layer ' + service + '/' + id); return { ...l, url: `${EV.iplan.iplan.root}/${service}/MapServer/${id}/query?where=1%3D1&returnCountOnly=true&f=json`, label: `${service}/${id} ${l.name}` }; })() });
const portal = (label) => P('muni', (p) => p.label === label), dc = (city) => P('muni', (p) => p.city === city && Array.isArray(p.names));
const pkgsOf = (city, re) => (EV.muni.ckan.find((c) => c.city === city).names || []).filter((n) => re.test(n));

// gov.il · GovMap · Tax Authority · Survey of Israel
cur({ id: 'govil:api-reference', name: 'gov.il API reference (apinew)', publisher: 'מערך הדיגיטל הלאומי (gov.il)', probes: [g('gov.il API reference')], access: 'web page behind a Cloudflare bot challenge', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 with a bot challenge to the runner — not bypassed', fit: 'documentation of gov.il APIs; the government data catalogue itself (data.gov.il) answers and was read whole' });
cur({ id: 'govmap:api', name: 'GovMap API — documentation, JS API, layers catalogue, search, geocode', publisher: 'המרכז למיפוי ישראל · GovMap', probes: [g('GovMap API documentation'), g('GovMap API (EN)'), g('GovMap API JS'), g('GovMap layers catalog'), g('GovMap search'), g('GovMap geocode'), o('Survey of Israel · GovMap ArcGIS root')],
  access: 'the edge refuses every path (403) and the ArcGIS / search hosts refuse the connection; the documented API also requires a registered token', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 / ECONNREFUSED on every GovMap host from the runner (as to Vercel since 09.2026) — not bypassed; a token would also need registration (founder approval)', fit: 'the official deals layer, address search and parcel lookups — PROPX reads the deals through the republished copies instead (labelled)', domain: 'transactions · geography', value: 'HIGH' });
cur({ id: 'govil:tax-authority-real-estate-service', name: 'Tax Authority real-estate information service (gov.il service page)', publisher: 'רשות המסים', probes: [g('Tax Authority real-estate information service')], access: 'gov.il service page behind a bot challenge', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 challenge — not bypassed (the 20.10 ledger\'s official:gov.il-service, re-checked)', fit: 'the official entry to the deal register', domain: 'transactions', value: 'HIGH' });
cur({ id: 'misim:svinfonadlan', name: 'Tax Authority real-estate information site (misim.gov.il/svinfonadlan2010)', publisher: 'רשות המסים', probes: [g('Tax Authority real-estate info site')], access: 'host does not answer the runner', state: 'BLOCKED_TECHNICAL', why: 'connection timeout from the runner — not bypassed', fit: 'the legacy official deal search', domain: 'transactions', value: 'HIGH' });
cur({ id: 'nadlan.gov.il:site', name: 'nadlan.gov.il — the government real-estate site', publisher: 'רשות המסים / מערך הדיגיטל', probes: [g('nadlan.gov.il')], access: 'a single-page app; its data calls carry reCAPTCHA Enterprise', state: 'BLOCKED_TECHNICAL', why: 'the shell answers (200) but every data call is CAPTCHA-protected (19.10 ledger) — never bypassed', fit: 'official deals by address', domain: 'transactions', value: 'HIGH' });
cur({ id: 'mapi:open-data', name: 'Survey of Israel open data (gov.il topic page + open-data host)', publisher: 'המרכז למיפוי ישראל', probes: [g('Survey of Israel open data'), o('Survey of Israel · open GIS')], access: 'gov.il page behind a bot challenge; the open-data host does not resolve', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 challenge / ENOTFOUND — the Survey\'s datasets that ARE on data.gov.il (parcels, blocks, cadastre notices) are separate catalogue entries', fit: 'cadastre / parcel geometry', domain: 'cadastre', value: 'MEDIUM' });
cur({ id: 'govil:urban-renewal-authority', name: 'Government Authority for Urban Renewal (gov.il landing page)', publisher: 'הרשות הממשלתית להתחדשות עירונית', probes: [g('Government Authority for Urban Renewal')], access: 'gov.il page behind a bot challenge', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 challenge — the declared complexes are read from MoCH\'s data.gov.il dataset (urban_renewal, EXISTING)', fit: 'renewal programme pages', domain: 'renewal', value: 'LOW' });
cur({ id: 'govil:mot-open-data', name: 'Ministry of Transport open-data / GTFS landing pages (gov.il)', publisher: 'משרד התחבורה והבטיחות בדרכים', probes: [g('MoT open data'), P('mot', (p) => p.label === 'MoT SIRI / open data landing')], access: 'gov.il pages behind a bot challenge; SIRI real-time needs a registered key', state: 'BLOCKED_AUTH', why: 'the landing pages answer 403 (challenge); the SIRI real-time feed is issued per registered user — the static GTFS and the data.gov.il tables are separate entries', fit: 'real-time arrivals — not needed for street context', domain: 'transport', value: 'LOW' });
cur({ id: 'ila:michrazim', name: 'Israel Land Authority tender site (apps.land.gov.il/MichrazimSite)', publisher: 'רשות מקרקעי ישראל', probes: [g('Israel Land Authority tenders'), o('ILA GIS (govmap layers)')], access: 'the site\'s own JSON API (list + per-tender detail), keyless', state: 'EXISTING_VERIFIED', why: 'read daily by lib/land (land-sync.yml); the guessed SearchApi path answers 404 — not the channel PROPX uses', fit: 'land tenders, lots, winners', domain: 'land', value: 'HIGH', integration: { integrated: true, by: 'lib/land (scripts/land-sync.js)', trust: trustCheck(TRUST.by.get('ila:michrazim') || [...TRUST.by.values()].find((s) => /michrazim|land\.gov\.il/i.test(String(s.url || '')))) } });
// CBS
cur({ id: 'cbs:series-api', name: 'CBS time-series API (apis.cbs.gov.il/series) — catalogue + data', publisher: 'הלשכה המרכזית לסטטיסטיקה', probes: [P('cbs', (p) => p.label === 'series catalogue · subjects'), P('cbs', (p) => /subject 44/.test(p.label))], access: 'keyless JSON (User-Agent required)', state: 'EXISTING_VERIFIED', why: 'read by lib/cbs-sales (new-home sales, inventory) and lib/construction (permits · starts · completions · active)', fit: 'official national / district series', domain: 'market · supply', value: 'HIGH', pagination: 'one request per series path; startperiod / endperiod', integration: { integrated: true, by: 'lib/cbs-sales · lib/construction', trust: trustCheck(TRUST.by.get('cbs:new-home-sales')) } });
cur({ id: 'cbs:price-index-api', name: 'CBS price-index API (api.cbs.gov.il/index) — housing chapter: dwelling prices 40010, district indices 60000–60500, new dwellings 70000', publisher: 'הלשכה המרכזית לסטטיסטיקה', probes: [P('cbs', (p) => p.label === 'price index · chapters'), P('cbs2', (p) => /id=40010/.test(p.url || '')), P('cbs2', (p) => /id=60400/.test(p.url || '')), P('cbs2', (p) => /id=70000/.test(p.url || ''))], access: 'keyless JSON', state: 'EXISTING_VERIFIED', why: 'read daily by lib/market (market-sync.yml: new-homes index 70000; CPI / construction inputs / rent by name) and the price-history card (dwelling-price and district indices)', fit: 'official price indices', domain: 'market', value: 'HIGH', integration: { integrated: true, by: 'lib/market (scripts/market-sync.js)', trust: trustCheck(TRUST.by.get('cbs:new-homes-index') || null) } });
cur({ id: 'cbs:dictionary-geography', name: 'CBS dictionary API — geography (localities, statistical areas)', publisher: 'הלשכה המרכזית לסטטיסטיקה', probes: [P('cbs', (p) => /localities \(he\)/.test(p.label)), P('cbs', (p) => /statistical areas/.test(p.label)), P('cbs', (p) => /geography \(en\)/.test(p.label))], access: 'keyless JSON', state: 'BLOCKED_TECHNICAL', why: 'every geography endpoint answered HTTP 500 (server error) to the runner; the locality registry PROPX reads (data.gov.il citiesandsettelments) and the census 2022 lane cover the codes', fit: 'locality / statistical-area dictionary', domain: 'geography', value: 'LOW' });
cur({ id: 'cbs:average-prices-table-2-2', name: 'CBS "Average Prices of Dwellings" (Table 2.2, Price Statistics Monthly)', publisher: 'הלשכה המרכזית לסטטיסטיקה', probes: [g('CBS API page')], access: 'published as a release table (PDF / spreadsheet); no API series', state: 'NOT_ACTUALLY_AN_API', why: 'no series in either CBS API carries the average price in ₪ by district / city — PROPX keeps its labelled TRANSCRIPTION (PRICE_SRC, 19.10.2026)', fit: 'the board\'s official price card', domain: 'market', value: 'HIGH', integration: { integrated: true, by: 'index.html PRICE_SRC (TRANSCRIBED, cbs:average-dwelling-price)' } });
cur({ id: 'cbs:new-home-sales-by-city', name: 'CBS new-home sales by city (media release "לוח ב")', publisher: 'הלשכה המרכזית לסטטיסטיקה', probes: [g('CBS API page')], access: 'media-release PDF only', state: 'NOT_ACTUALLY_AN_API', why: 'no machine-readable city series exists (13.10.2026 audit); the Tel Aviv-Yafo figure is a labelled transcription', fit: 'city sales pace', domain: 'market', value: 'MEDIUM' });
// Bank of Israel
const boiFlows = EV.boi.flows.map((f) => f.id);
cur({ id: 'boi:sdmx:catalogue', name: `Bank of Israel SDMX — dataflow catalogue (${boiFlows.length} flows)`, publisher: 'בנק ישראל', probes: [P('boi', (p) => p.label === 'dataflows'), P('boi', (p) => /alternative path/.test(p.label || ''))], access: 'keyless SDMX REST (edge.boi.gov.il)', state: 'REDUNDANT_PROVEN', why: 'the catalogue itself — each material flow is its own entry below; the alternative structure path timed out (the primary path answered)', fit: 'the index of BOI statistics', domain: 'finance', value: 'MEDIUM', pagination: 'SDMX data queries by dimension key + startperiod', schema: 'SDMX-JSON structure; CSV data', fields: boiFlows });
cur({ id: 'boi:sdmx:BIR_MRTG_99', name: 'BOI SDMX BIR_MRTG_99 — interest rates and business volume, housing loans', publisher: 'בנק ישראל', probes: [fl('BIR_MRTG_99')], access: 'keyless SDMX REST', state: 'CONNECTED_VERIFIED', why: 'integrated 21.10.2026 as lib/finance (finance-sync.yml): one series per measure, each dimension code verified against its codelist name; read by ' + READERS['lib/finance/series.js'], fit: 'new-mortgage rates and volumes by indexation track', domain: 'finance', value: 'HIGH', rows: probeOf('boi', (p) => p.flow === 'BIR_MRTG_99' && /\/data\//.test(p.url || '')).rows, rowsNote: 'rows from 2026-01 in the probe', newest: '2026-06 (probe)', integration: { integrated: true, by: 'lib/finance/series.js', thisMission: true, readBy: READERS['lib/finance/series.js'], trust: trustCheck(TRUST.by.get('boi:housing-finance')) } });
cur({ id: 'boi:sdmx:BMB_99', name: 'BOI SDMX BMB_99 — balances for housing (outstanding mortgage balances)', publisher: 'בנק ישראל', probes: [fl('BMB_99')], access: 'keyless SDMX REST', state: 'CONNECTED_VERIFIED', why: 'integrated 21.10.2026 as lib/finance (the same lane and checks)', fit: 'outstanding housing credit', domain: 'finance', value: 'HIGH', rows: probeOf('boi', (p) => p.flow === 'BMB_99' && /\/data\//.test(p.url || '')).rows, newest: '2026-06 (probe)', integration: { integrated: true, by: 'lib/finance/series.js', thisMission: true, readBy: READERS['lib/finance/series.js'], trust: trustCheck(TRUST.by.get('boi:housing-finance')) } });
cur({ id: 'boi:sdmx:BR', name: 'BOI SDMX BR — the Bank of Israel interest rate (daily)', publisher: 'בנק ישראל', probes: [fl('BR')], access: 'keyless SDMX REST', state: 'REDUNDANT_PROVEN', why: 'the same rate PROPX reads daily (lib/market boi rate): 3.25 on 2026-10-21 in both', fit: 'policy rate', domain: 'finance', value: 'MEDIUM' });
cur({ id: 'boi:sdmx:REAL_ES_DF', name: 'BOI SDMX REAL_ES_DF — real estate (CBS price indices republished)', publisher: 'בנק ישראל', probes: [fl('REAL_ES_DF')], access: 'keyless SDMX REST', state: 'REDUNDANT_PROVEN', why: 'the series carry DATA_SOURCE = CBS (the new-homes hedonic index and the dwelling-price indices) — PROPX reads them from the CBS index API directly', fit: 'price indices', domain: 'market', value: 'LOW' });
cur({ id: 'boi:sdmx:CONS', name: 'BOI SDMX CONS — construction (CBS-sourced indicators)', publisher: 'בנק ישראל', probes: [fl('CONS')], access: 'keyless SDMX REST', state: 'REDUNDANT_PROVEN', why: '19 rows with DATA_SOURCE = CBS — PROPX reads CBS construction series directly (lib/construction)', fit: 'construction activity', domain: 'supply', value: 'LOW' });
cur({ id: 'boi:sdmx:DEBT_AGG', name: 'BOI SDMX DEBT_AGG — debt and credit aggregates (incl. household unindexed debt, quarterly)', publisher: 'בנק ישראל', probes: [fl('DEBT_AGG')], access: 'keyless SDMX REST', state: 'ACCESSIBLE_NOT_YET_INTEGRATED', why: 'answers (300 rows from 2026, latest 2026-Q2); national macro context only — lower value than the housing-loan flows PROPX now reads', fit: 'household leverage context', domain: 'finance', value: 'LOW', newest: '2026-Q2 (probe)' });
cur({ id: 'boi:sdmx:other-flows', name: `BOI SDMX — the other ${boiFlows.length - 6} flows (exchange rates, payments, cards, banking, trade, labour …)`, publisher: 'בנק ישראל', probes: [fl('EXR'), fl('CCP'), fl('BIR'), fl('CCIR'), fl('TLB')], access: 'keyless SDMX REST (CCIR / TLB data paths answered 404)', state: 'UNSUITABLE_DATA', why: 'not real-estate data; listed for completeness of the catalogue', fit: 'none for the residential product', domain: 'finance', value: 'LOW', fields: boiFlows.filter((f) => !['BIR_MRTG_99', 'BMB_99', 'BR', 'REAL_ES_DF', 'CONS', 'DEBT_AGG'].includes(f)) });
cur({ id: 'boi:web', name: 'Bank of Israel web site (statistics pages, API guide)', publisher: 'בנק ישראל', probes: [g('BOI statistics'), g('BOI API guide')], access: 'a Radware bot-verification page in front of the site', state: 'BLOCKED_TECHNICAL', why: 'every page returned the Radware "verifying your browser" screen — not bypassed; the SDMX host (edge.boi.gov.il) answers and is the channel PROPX uses', fit: 'documentation', domain: 'finance', value: 'LOW' });
// Planning Administration ArcGIS (ags.iplan.gov.il)
cur({ id: 'iplan:xplan', name: 'Planning Administration — Xplan online plans (PlanningPublic/Xplan, 5 layers)', publisher: 'מינהל התכנון', probes: [svc('PlanningPublic/Xplan')], access: 'keyless ArcGIS REST', state: 'EXISTING_VERIFIED', why: 'read by lib/renewal/planning (exact joins) and scripts/street-planning-sync.js (every plan boundary, 37,701)', fit: 'statutory plans, units, stages', domain: 'planning', value: 'HIGH', integration: { integrated: true, by: 'lib/renewal/planning*.js · scripts/street-planning-sync.js' } });
cur({ id: 'iplan:vatmal', name: 'Planning Administration — VATMAL declared preferred-housing complexes (vatmal_mitchamim_muchrazim/0)', publisher: 'מינהל התכנון', probes: [lay('PlanningPublic/vatmal_mitchamim_muchrazim', 0)], access: 'keyless ArcGIS REST', state: 'ACCESSIBLE_NOT_YET_INTEGRATED', why: 'answers with 203 declared complexes (polygons); not read yet', fit: 'a national housing-supply pipeline universe (declared units, declaration date)', domain: 'planning', value: 'HIGH', rows: 203 });
cur({ id: 'iplan:shimour', name: 'Planning Administration — conservation (Shimour: points 8,301 · polygons 25,266)', publisher: 'מינהל התכנון', probes: [lay('PlanningPublic/Shimour', 1), lay('PlanningPublic/Shimour', 2)], access: 'keyless ArcGIS REST', state: 'ACCESSIBLE_NOT_YET_INTEGRATED', why: 'answers; conservation designations are a redevelopment constraint — not read yet', fit: 'conservation constraint on or near a street / parcel', domain: 'planning', value: 'MEDIUM', rows: 8301 + 25266 });
cur({ id: 'iplan:land-use', name: 'Planning Administration — land designations from approved plans (xplan_background/1, 564,018 polygons)', publisher: 'מינהל התכנון', probes: [lay('PlanningPublic/xplan_background', 1), lay('PlanningPublic/xplan_background_without_77_78', 1)], access: 'keyless ArcGIS REST', state: 'ACCESSIBLE_NOT_YET_INTEGRATED', why: 'answers (564,018 polygons) — the national land-use layer the catalogue lacks; large, not read yet', fit: 'what a parcel is zoned for', domain: 'planning', value: 'HIGH', rows: 564018 });
cur({ id: 'iplan:boundaries', name: 'Planning Administration — administrative boundaries (gvulot_retzef: districts 6 · jurisdictions 411 · local committees 1,785 · planning areas 310 · sub-districts 15)', publisher: 'מינהל התכנון', probes: [lay('PlanningPublic/gvulot_retzef', 1), lay('PlanningPublic/gvulot_retzef', 3)], access: 'keyless ArcGIS REST', state: 'ACCESSIBLE_NOT_YET_INTEGRATED', why: 'answers; municipal jurisdiction / planning-area polygons — not read (PROPX keys geography by CBS codes)', fit: 'which planning committee governs a street', domain: 'geography', value: 'MEDIUM', rows: 6 + 411 + 1785 + 310 + 15 });
cur({ id: 'iplan:plan-entities', name: 'Planning Administration — plan entities (entities: points 1,086,353 · polygons 202,809; lines timed out)', publisher: 'מינהל התכנון', probes: [lay('PlanningPublic/entities', 1), lay('PlanningPublic/entities', 3), lay('PlanningPublic/entities', 2)], access: 'keyless ArcGIS REST', state: 'PENDING_VERIFICATION', why: 'counts answered; the meaning of an "entity" and its join to a plan were not read — verify with a field read of layer 3', fit: 'plan-level designations', domain: 'planning', value: 'MEDIUM' });
cur({ id: 'iplan:statutory-transport', name: 'Planning Administration — statutory rail / road compilations (train_compilation 231 · ttl_all_blue_lines 269 · road_compilation 725 / 4,537 / 3,686)', publisher: 'מינהל התכנון', probes: [lay('PlanningPublic/train_compilation', 0), lay('PlanningPublic/ttl_all_blue_lines', 0), lay('PlanningPublic/road_compilation', 2)], access: 'keyless ArcGIS REST', state: 'REDUNDANT_PROVEN', why: 'statutory transport plans already reach the street report through every Xplan plan boundary (transit plans at 1,000 m, never an operating line) — the compilations add regional outlines that may not be attributed to one street', fit: 'statutory transport context', domain: 'planning · transport', value: 'LOW' });
cur({ id: 'iplan:national-district-plans', name: `Planning Administration — national / district outline-plan services (TAMA 1 · 35 · 70 · TMM compilations … ${EV.iplan.iplan.services.filter((s) => /tma|tmm|TAMA|Tama|compilation_tmm|Tochnit_sharon|plan_index/.test(s.name)).length} services)`, publisher: 'מינהל התכנון', probes: [svc('PlanningPublic/TAMA_1'), svc('PlanningPublic/compilation_tmm_merkaz'), lay('PlanningPublic/plan_index', 1)], access: 'keyless ArcGIS REST', state: 'UNSUITABLE_DATA', why: 'regional / national designations at outline-plan scale — the directive forbids attributing a city-level (or wider) plan to one street; the 2016 plan index is stale', fit: 'macro planning context', domain: 'planning', value: 'LOW' });
cur({ id: 'iplan:esri-sample', name: 'ags.iplan.gov.il — SampleWorldCities (Esri sample) + Utilities', publisher: 'מינהל התכנון', probes: [svc('SampleWorldCities')], access: 'keyless ArcGIS REST', state: 'UNSUITABLE_DATA', why: 'an Esri demo service and geometry utilities — no Israeli data', fit: 'none', domain: 'other', value: 'LOW' });
// Ministry of Transport (outside the catalogue)
cur({ id: 'mot:gtfs', name: 'Ministry of Transport GTFS (gtfs.mot.gov.il/gtfsfiles — israel-public-transportation.zip ≈ 184 MB, Gtfs_10_days.zip ≈ 273 MB, daily)', publisher: 'משרד התחבורה והבטיחות בדרכים', probes: [P('mot', (p) => p.label === 'GTFS directory'), P('mot', (p) => p.label === 'GTFS file (HEAD)')], access: 'keyless HTTPS file directory (IIS listing)', state: 'ACCESSIBLE_NOT_YET_INTEGRATED', why: 'the directory answers with files dated 20–21.10.2026; the stop ids match the stop registry PROPX reads — service frequency per stop is not computed yet (a large daily download)', fit: 'departures per stop → service intensity beside the stop counts', domain: 'transport', value: 'MEDIUM', freshness: 'daily (file dates 2026-10-20 / 2026-10-21 in the listing)', licence: 'MoT open data terms (not restated in the listing)' });
cur({ id: 'mot:shapefile-host', name: 'Ministry of Transport station / line SHAPEFILES on the data.gov.il file host (aws-e.data.gov.il)', publisher: 'משרד התחבורה והבטיחות בדרכים', probes: [P('mot2', (p) => p.pkg === 'rail_stat'), P('mot2', (p) => p.pkg === 'lrt_line'), P('mot2', (p) => p.pkg === 'metro_line')], access: 'file download', state: 'BLOCKED_TECHNICAL', why: 'every ZIP download answered HTTP 403 to the runner — not bypassed; the stations\' datastore TABLES were integrated instead (lib/transport), the line geometries remain unread', fit: 'rail / light-rail / metro line geometry and rail / metro station points', domain: 'transport', value: 'MEDIUM' });
// other national hosts
cur({ id: 'ims:api', name: 'Israel Meteorological Service API (api.ims.gov.il)', publisher: 'השירות המטאורולוגי', probes: [o('IMS API (documentation)'), o('IMS API endpoint (keyed)')], access: 'a per-user API token', state: 'BLOCKED_AUTH', why: 'HTTP 401 without a token; registration would need the founder\'s approval — and weather is not material to street intelligence', fit: 'climate context', domain: 'environment', value: 'LOW' });
cur({ id: 'moep:gis', name: 'Ministry of Environmental Protection GIS (gis.sviva.gov.il)', publisher: 'המשרד להגנת הסביבה', probes: [o('Environment (MoEP) GIS root')], access: 'host does not resolve', state: 'BLOCKED_TECHNICAL', why: 'ENOTFOUND from the runner — the Ministry\'s datasets on data.gov.il (contaminated land, antennas, noise) are separate catalogue entries', fit: 'environmental constraints', domain: 'environment', value: 'LOW' });
cur({ id: 'gsi:web', name: 'Geological Survey of Israel', publisher: 'המכון הגיאולוגי', probes: [o('GSI (geology) GIS')], access: 'bot challenge', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 challenge — not bypassed', fit: 'seismic / geology context', domain: 'environment', value: 'LOW' });
cur({ id: 'water-authority:web', name: 'Water Authority (gov.il landing page)', publisher: 'רשות המים', probes: [o('Water Authority')], access: 'bot challenge', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 challenge — not bypassed', fit: 'none material', domain: 'environment', value: 'LOW' });
cur({ id: 'moe:mosdot-app', name: 'Ministry of Education institutions application (apps.education.gov.il/mosdotnew)', publisher: 'משרד החינוך', probes: [o('Ministry of Education institutions (GIS)')], access: 'host does not answer', state: 'BLOCKED_TECHNICAL', why: 'connection timeout from the runner — the Ministry\'s institution datasets on data.gov.il (mosdot, mosdot_edu, coordinates) are separate catalogue entries', fit: 'schools near a street', domain: 'education', value: 'MEDIUM' });
cur({ id: 'transport-operators:web', name: 'Netivei Israel · Israel Railways · NTA (metro / light rail) web sites', publisher: 'נתיבי ישראל · רכבת ישראל · נת"ע', probes: [o('Netivei Israel open data'), o('Israel Railways'), o('NTA (metro / light rail)')], access: 'bot challenges', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 challenge pages — not bypassed; the Ministry of Transport\'s own tables are the channel PROPX reads', fit: 'operator project pages', domain: 'transport', value: 'LOW' });
// municipal portals
const jer = dc('jerusalem');
cur({ id: 'muni:jerusalem:light-rail', name: 'Jerusalem municipality CKAN — light-rail stations / lines / future stations & lines', publisher: 'עיריית ירושלים', probes: [jer], dataset: { packages: pkgsOf('jerusalem', /light-rail/) }, access: 'keyless CKAN (jerusalem.datacity.org.il)', state: 'PENDING_VERIFICATION', why: 'the package list answers (114 packages); the packages\' rows, schema and licence were not read — verify with package_show + one datastore page', fit: 'municipal light-rail detail beside the Ministry\'s layer', domain: 'transport', value: 'MEDIUM' });
cur({ id: 'muni:jerusalem:urban-renewal', name: 'Jerusalem municipality CKAN — urban renewal (TAMA 38 · renewal areas · evacuation-construction)', publisher: 'עיריית ירושלים', probes: [jer], dataset: { packages: pkgsOf('jerusalem', /urban-renewal/) }, access: 'keyless CKAN', state: 'PENDING_VERIFICATION', why: 'listed; rows / schema / licence not read — municipal renewal layers PROPX does not have', fit: 'renewal activity by address in Jerusalem', domain: 'renewal', value: 'MEDIUM' });
cur({ id: 'muni:jerusalem:cadastre-buildings', name: 'Jerusalem municipality CKAN — plots, blocks, city buildings', publisher: 'עיריית ירושלים', probes: [jer], dataset: { packages: pkgsOf('jerusalem', /^(plots|blocks-key|border-of-a-block|city-buildings)$/) }, access: 'keyless CKAN', state: 'PENDING_VERIFICATION', why: 'listed; contents not read', fit: 'parcel / building attributes for one city', domain: 'cadastre', value: 'LOW' });
cur({ id: 'muni:jerusalem:other', name: `Jerusalem municipality CKAN — the other ${(jer.p.names || []).length - pkgsOf('jerusalem', /light-rail|urban-renewal|^(plots|blocks-key|border-of-a-block|city-buildings)$/).length} packages (services, culture, recycling, parking …)`, publisher: 'עיריית ירושלים', probes: [jer], access: 'keyless CKAN', state: 'UNSUITABLE_DATA', why: 'municipal services and amenities lists — not material to residential market intelligence at the depth of this pass', fit: 'amenity context', domain: 'local-authority', value: 'LOW' });
cur({ id: 'muni:haifa:planning-preservation', name: 'Haifa municipality CKAN — planning / preservation / land use (yeudei_karka · blg_shimur · shimurpreservationareas · gvul_tichnun · buildingsites · neighborhood · stat_construction)', publisher: 'עיריית חיפה', probes: [portal('Haifa CKAN')], dataset: { packages: ['yeudei_karka', 'blg_shimur', 'shimurpreservationareas', 'sekreishimurcompleted', 'sikreishimurinexecution', 'gvul_tichnun', 'buildingsites', 'neighborhood', 'stat_construction'] }, access: 'keyless CKAN (opendata.haifa.muni.il, ODbL per the 17.10 ledger)', state: 'PENDING_VERIFICATION', why: 'the package list answers (81); rows / schema not read in this pass', fit: 'municipal land use, conservation and neighbourhood boundaries for one city', domain: 'planning', value: 'MEDIUM', licence: 'ODbL (17.10.2026 ledger)' });
cur({ id: 'muni:datacity:small-portals', name: 'Netanya (28) · Kfar Saba (33) · Rishon LeZion (8) · Rehovot (9) datacity CKAN portals', publisher: 'עיריות נתניה · כפר סבא · ראשון לציון · רחובות', probes: [dc('netanya'), dc('kfar-saba'), dc('rishonlezion'), dc('rehovot')], access: 'keyless CKAN', state: 'UNSUITABLE_DATA', why: 'mostly municipal copies of national lists (antennas, kindergartens, schools, fire stations, corona) and municipal service files; Kfar Saba\'s green-buildings / tochniot_avoda and Netanya\'s neighbourhoods are single-city — not read', fit: 'local context', domain: 'local-authority', value: 'LOW' });
cur({ id: 'muni:datacity:absent', name: `datacity CKAN subdomains that do not exist (${EV.muni.ckan.filter((c) => c.status !== 200).length} probed names: Tel Aviv, Petah Tikva, Ramat Gan, Beer Sheva, Ashdod, Holon, Bat Yam …)`, publisher: 'municipalities', probes: [P('muni', (p) => p.city === 'tel-aviv'), P('muni', (p) => p.city === 'petah-tikva')], access: 'host does not resolve', state: 'NOT_ACTUALLY_AN_API', why: 'ENOTFOUND — no such portal', fit: 'none', domain: 'local-authority', value: 'LOW' });
cur({ id: 'muni:tel-aviv:gis', name: 'Tel Aviv-Yafo ArcGIS (gisn.tel-aviv.gov.il) — IView2 (256 layers) + OpenData traffic speeds + orthophotos', publisher: 'עיריית תל אביב-יפו', probes: [portal('TLV ArcGIS root')], access: 'keyless ArcGIS REST', state: 'EXISTING_VERIFIED', why: 'IView2 permits (772) and sites (499) are read by lib/dd/sync.js; the OpenData folder holds only monthly traffic-speed segments and orthophotos (not material)', fit: 'municipal permits and sites', domain: 'permits', value: 'HIGH', integration: { integrated: true, by: 'lib/dd/sync.js (tlv:iview2:permits-772 · tlv:iview2:sites-499)', trust: trustCheck(TRUST.by.get('tlv:iview2:permits-772')) } });
cur({ id: 'muni:tel-aviv:portal', name: 'Tel Aviv-Yafo open-data portal (opendata.tel-aviv.gov.il)', publisher: 'עיריית תל אביב-יפו', probes: [portal('TLV open data portal')], access: 'a script shell (1 KB HTML)', state: 'NOT_ACTUALLY_AN_API', why: 'the portal page is a client-side shell; the city\'s data reaches PROPX through its ArcGIS server', fit: 'none beyond the GIS', domain: 'local-authority', value: 'LOW' });
cur({ id: 'muni:jerusalem:gis', name: 'Jerusalem municipality ArcGIS (gisviewer.jerusalem.muni.il)', publisher: 'עיריית ירושלים', probes: [portal('Jerusalem ArcGIS')], access: 'refused', state: 'BLOCKED_TECHNICAL', why: 'HTTP 403 — not bypassed', fit: 'municipal GIS layers', domain: 'local-authority', value: 'MEDIUM' });
cur({ id: 'muni:beer-sheva:portals', name: 'Beer Sheva municipal CKAN (opendata.br7.org.il) and GIS (gis.br7.org.il)', publisher: 'עיריית באר שבע', probes: [portal('Beer Sheva CKAN'), portal('Beer Sheva GIS')], access: 'timeout / connection refused', state: 'BLOCKED_TECHNICAL', why: 'the hosts do not answer the runner; the city publishes 44 datasets on data.gov.il, which are catalogue entries (buildings-br7, city-plans-br7, addresses-br7 …)', fit: 'one city', domain: 'local-authority', value: 'LOW' });
cur({ id: 'muni:ashdod:gis', name: 'Ashdod municipality ArcGIS — blocks and parcels (גושים_וחלקות), borders, education buildings, orthophotos', publisher: 'עיריית אשדוד', probes: [portal('Ashdod GIS')], access: 'keyless ArcGIS REST', state: 'PENDING_VERIFICATION', why: 'the server lists the services; no layer was read — one city\'s cadastre, below the national parcel layer in priority', fit: 'one city\'s parcels', domain: 'cadastre', value: 'LOW' });
cur({ id: 'muni:gis:absent', name: 'Municipal GIS hosts that do not resolve (Petah Tikva · Rishon LeZion · Netanya · Ramat Gan · Herzliya)', publisher: 'municipalities', probes: [portal('Petah Tikva GIS'), portal('Rishon LeZion GIS'), portal('Netanya GIS'), portal('Ramat Gan GIS'), portal('Herzliya GIS')], access: 'host does not resolve', state: 'NOT_ACTUALLY_AN_API', why: 'ENOTFOUND under the probed names', fit: 'none', domain: 'local-authority', value: 'LOW' });

/* the verify pass's municipal / ArcGIS / GTFS evidence (21.10.2026) */
const VM = (city, pkg) => { const x = (EV.verify[city] || []).find((p) => p.pkg === pkg); if (!x) throw new Error(`verify ${city}/${pkg} missing`); return x; };
const vmRows = (x) => Math.max(0, ...x.resources.filter((r) => r.table && r.table.total != null).map((r) => r.table.total));
const vmProbe = (city, pkg) => ({ k: 'verify', p: { ...VM(city, pkg), url: `${city === 'haifa' ? 'https://opendata.haifa.muni.il' : 'https://jerusalem.datacity.org.il'}/api/3/action/package_show?id=${pkg}`, label: `${city}/${pkg}` } });
const VA = (label) => ({ k: 'verify', p: (() => { const a = EV.verify.arcgis.find((x) => x.label === label); if (!a) throw new Error('verify arcgis ' + label); return a; })() });
for (const c of CUR) {
  if (c.id === 'muni:jerusalem:light-rail') Object.assign(c, { state: 'LICENSE_REVIEW_REQUIRED', stateWhy: 'verified 21.10.2026: 46 stations · 150 future stations · 2 / 17 lines answer as datastore tables (x / y), modified 2023-10 — under ODbL (share-alike on a derived database): needs the founder\'s licence decision; the Ministry of Transport layer PROPX reads covers the same stations', licence: 'Open Data Commons ODbL', rows: 46 + 150, http: [...c.http, httpOf(vmProbe('jerusalem', 'light-rail-stations').p)], evidence: { files: c.evidence.files.concat([evPath('verify') + ' → jerusalem[light-rail-*]']), note: c.evidence.note } });
  if (c.id === 'muni:jerusalem:urban-renewal') Object.assign(c, { state: 'LICENSE_REVIEW_REQUIRED', stateWhy: 'verified 21.10.2026: TAMA 38 files (878 rows: file number, address, neighbourhood, existing / added units) and 21 renewal areas answer; modified 2023-10; ODbL share-alike — licence decision needed', licence: 'Open Data Commons ODbL', rows: vmRows(VM('jerusalem', 'urban-renewal-38')), evidence: { files: c.evidence.files.concat([evPath('verify') + ' → jerusalem[urban-renewal-*]']), note: c.evidence.note } });
  if (c.id === 'muni:jerusalem:cadastre-buildings') Object.assign(c, { state: 'LICENSE_REVIEW_REQUIRED', stateWhy: 'verified 21.10.2026: plots (block / parcel / registered area / shape, ≥ 1,000 rows) and 655 blocks answer, modified 2022 — ODbL share-alike; one city, older than the national cadastre', licence: 'Open Data Commons ODbL', rows: vmRows(VM('jerusalem', 'plots')) });
  if (c.id === 'muni:haifa:planning-preservation') Object.assign(c, { state: 'LICENSE_REVIEW_REQUIRED', stateWhy: 'verified 21.10.2026: land use, conservation buildings / areas / surveys, planning boundary, 76 neighbourhoods (with the CBS locality code), 442 building sites answer (files on storage.googleapis.com + tables) — ODbL share-alike: licence decision needed; one city', licence: 'Open Data Commons ODbL', rows: vmRows(VM('haifa', 'buildingsites')), evidence: { files: c.evidence.files.concat([evPath('verify') + ' → haifa[…]']), note: c.evidence.note } });
  if (c.id === 'iplan:plan-entities') Object.assign(c, { state: 'ACCESSIBLE_NOT_YET_INTEGRATED', stateWhy: 'verified 21.10.2026: the entities are a plan\'s drawn features — each keyed by plan number (pl_number), plan id (mp_id) and a Mavat entity code / name; counts answer (points 1,086,353 · polygons 202,809) — not read', fields: (VA('iplan entities layer 3 (polygons)').p.fields || []).map((f) => f.split(':')[0]), http: [...c.http, httpOf(VA('iplan entities layer 3 (polygons)').p)] });
  if (c.id === 'iplan:vatmal') Object.assign(c, { fields: (VA('iplan vatmal layer 0').p.fields || []).map((f) => f.split(':')[0]), http: [...c.http, httpOf(VA('iplan vatmal sample').p)], schema: 'polygons: tamal number · complex name · locality NAME (text, sometimes several) · district · submitter · declared area · units (יח"ד) · declaration date · update dates' });
  if (c.id === 'iplan:land-use') Object.assign(c, { fields: (VA('iplan land use layer 1').p.fields || []).map((f) => f.split(':')[0]), http: [...c.http, httpOf(VA('iplan land use layer 1').p)], schema: 'polygons: Mavat designation code / name · lot id · plan number / id · registered area · update date' });
  if (c.id === 'muni:ashdod:gis') Object.assign(c, { state: 'ACCESSIBLE_NOT_YET_INTEGRATED', stateWhy: 'verified 21.10.2026: the parcels service lists two layers (block boundaries · parcels of registration plans) — one city\'s cadastre; the national parcel files are refused (403)', http: [...c.http, httpOf(VA('Ashdod parcels service').p)] });
  if (c.id === 'mot:gtfs') Object.assign(c, { stateWhy: 'verified 21.10.2026: the archive answers ranged reads (206, application/x-zip-compressed, 184,442,071 bytes) and its directory lists agency · calendar · routes · trips · stop_times · stops · shapes · fares · translations; the stop ids match the stop registry PROPX reads — service frequency per stop is not computed yet (a 184 MB daily download)', http: [...c.http, httpOf({ ...EV.verify.gtfs.first, url: EV.verify.gtfs.url })], fields: EV.verify.gtfs.zip.entries.map((e) => e.name), evidence: { files: c.evidence.files.concat([evPath('verify') + ' → gtfs']), note: c.evidence.note } });
}
{ // the systemic refusal of the data.gov.il file hosts
  const tested = []; for (const p of EV.verify.datagov) for (const r of p.resources) if (r.file && /data\.gov\.il/.test(r.file.first.host || '')) tested.push({ pkg: p.pkg, id: r.id, format: r.format, host: r.file.first.host, status: r.file.first.status });
  for (const p of EV.mot2.packages) for (const r of p.resources || []) if (r.download) tested.push({ pkg: p.pkg, id: r.id, format: r.format, host: 'aws-e.data.gov.il', status: r.download.status });
  const refused = tested.filter((x) => x.status === 403).length;
  CUR.push({ id: 'datagov:file-hosts', origin: '21.10.2026 runner probe (source-universe-discover.js --verify / --mot2)', name: `data.gov.il FILE downloads (aws-e.data.gov.il · e.data.gov.il) — ZIP / SHP / XLSX / DOCX resources`, domain: 'all', value: 'HIGH',
    publisher: 'מערך הדיגיטל הלאומי (data.gov.il)', documentation: 'https://data.gov.il', dataset: { tested: tested.length, refused, packages: [...new Set(tested.map((x) => x.pkg))] }, endpoint: 'https://aws-e.data.gov.il/dataset/<package>/resource/<resource>/download/<file>',
    requestedAt: EV.verify.at, http: [{ status: 403, note: `${refused} of ${tested.length} file downloads answered 403` }], schema: null, fields: null, pagination: 'file download', rateLimit: 'two ranged GETs per file, 1 request / second',
    rows: null, rowsNote: null, geography: null, history: null, newest: null, freshness: null, licence: 'per package', access: 'the file hosts refuse the runner; the CKAN API and its datastore tables answer',
    fit: { why: 'every national geometry PROPX lacks is published only as files here: cadastral parcels / blocks, renewal complex boundaries, MoCH programme layers, rail / metro / light-rail lines, coastline / noise layers', joinKey: null },
    integration: { integrated: false, by: null }, evidence: { files: [evPath('verify') + ' → datagov[*].resources[*].file', evPath('mot2') + ' → packages[*].resources[*].download'], note: tested.slice(0, 80) },
    state: refused === tested.length ? 'BLOCKED_TECHNICAL' : 'PENDING_VERIFICATION', stateWhy: `${refused} of ${tested.length} file downloads across ${new Set(tested.map((x) => x.pkg)).size} packages answered HTTP 403 to the runner (the datastore API of the same packages answered) — not bypassed; the route to these files is the publisher (a datastore copy, or an allow-listed channel)` });
}

/* ── assemble ── */
function build() {
  const sources = [];
  const folded = new Map();   // ckan package → the ledger entries folded into it
  for (const f of LEDGERS) for (const c of JSON.parse(fs.readFileSync(path.join(DISC, f), 'utf8'))) {
    if (sources.some((s) => s.id === 'ledger:' + c.id)) { const s = sources.find((x) => x.id === 'ledger:' + c.id); s.alsoAudited = (s.alsoAudited || []).concat([{ ledger: f, classification: c.classification, verdict: c.verdict }]); continue; }
    const pk = ckanPackageOf(c);
    const L = ledgerSource(c, f);
    if (L.state === 'EXCLUDED') continue;
    if (pk && TRIAGE.relevant.some((r) => r.name === pk)) { const a = folded.get(pk) || []; a.push({ ledger: f, id: c.id, classification: c.classification, verdict: c.verdict, state: L.state, why: L.stateWhy }); folded.set(pk, a); continue; }
    sources.push(L);
  }
  for (const x of JSON.parse(fs.readFileSync(path.join(DISC, '2026-10-20-transaction-sources.json'), 'utf8')).sources) {
    const prev = sources.find((s) => s.id === 'ledger:' + x.id);
    if (prev) { prev.alsoAudited = (prev.alsoAudited || []).concat([{ ledger: '2026-10-20-transaction-sources.json', class: x.class, readByPropx: x.readByPropx, limitation: x.limitation || null }]); continue; }
    sources.push(txSource(x));
  }
  for (const r of TRIAGE.relevant) { const s = ckanSource(r); if (folded.has(r.name)) s.priorAudits = folded.get(r.name); sources.push(s); }
  for (const c of CUR) sources.push(c);
  const ids = new Set(); for (const s of sources) { if (ids.has(s.id)) throw new Error('duplicate id ' + s.id); ids.add(s.id); if (!STATES[s.state]) throw new Error(`${s.id}: unknown state ${s.state}`); for (const k of FIELDS) if (!(k in s)) throw new Error(`${s.id}: missing field ${k}`); if (!s.stateWhy) throw new Error(`${s.id}: a state without a reason`); }
  // CONNECTED_VERIFIED needs retrieval + validation + a downstream reader (the directive's rule)
  for (const s of sources.filter((x) => x.state === 'CONNECTED_VERIFIED')) if (!(s.integration && s.integration.integrated && (s.integration.readBy || s.integration.trust || /lib\//.test(s.stateWhy)))) throw new Error(`${s.id}: CONNECTED_VERIFIED without integration evidence`);
  const byState = Object.fromEntries(Object.keys(STATES).map((k) => [k, sources.filter((s) => s.state === k).length]));
  const notRelevant = CK.packages.filter((p) => !TRIAGE.relevant.some((r) => r.name === p.name));
  const nrByOrg = {}; for (const p of notRelevant) { const k = p.orgTitle || p.org || '—'; (nrByOrg[k] = nrByOrg[k] || []).push(p.name); }
  const verified = sources.filter((s) => (Array.isArray(s.http) ? s.http.some((h) => h && h.status) : s.http && s.http.status)).length;
  return {
    schema: 'propx-source-universe-1', builtAt: '2026-10-21', builtBy: 'scripts/source-universe-build.js (reads stored evidence only — no network call)',
    directive: 'PROPX ULTIMATE MASTER EXECUTION DIRECTIVE — M2 exhaustive official source discovery · M3 API access verification',
    method: 'Runner probes (GitHub Actions, read-only, GET / HEAD, ≤ 1 request per second, no authentication, CAPTCHA, bot screen or rate limit bypassed — scripts/source-universe-discover.js, modes ckan · gov · other · mot · mot2 · cbs · cbs2 · boi · boi2 · iplan · muni) + the four earlier discovery ledgers + the 20.10 transaction-source inventory. Every data.gov.il package was hand-triaged (ckan-triage.json.gz); a package\'s integration is recomputed here from the code (a resource id read by lib/ · api/ · scripts/ outside discovery tooling).',
    catalogues: [
      { id: 'data.gov.il', examined: 'whole catalogue', packages: CK.count, fetched: CK.fetched, relevant: TRIAGE.relevant.length, notRelevant: notRelevant.length, datastoreProbes: CK.probes.length, probedPackages: probesByPkg.size, evidence: evPath('ckan') },
      { id: 'ags.iplan.gov.il (Planning Administration ArcGIS)', examined: 'every service and layer', services: EV.iplan.iplan.services.length, layers: EV.iplan.iplan.layers.length, evidence: evPath('iplan') },
      { id: 'edge.boi.gov.il (Bank of Israel SDMX)', examined: 'the dataflow catalogue + 11 data samples + 5 full structures', flows: EV.boi.flows.length, evidence: evPath('boi') + ' · ' + evPath('boi2') },
      { id: 'apis.cbs.gov.il / api.cbs.gov.il (CBS series, price index, dictionary)', examined: 'subjects, subject 44, subject 40, index chapters, the housing chapter (3 subjects, 9 series), dictionary', evidence: evPath('cbs') + ' · ' + evPath('cbs2') },
      { id: 'gov.il / GovMap / Tax Authority / nadlan.gov.il', examined: '18 pages and API paths', evidence: evPath('gov') },
      { id: 'Ministry of Transport (GTFS host, station / line packages)', examined: 'GTFS directory + 6 packages\' files', evidence: evPath('mot') + ' · ' + evPath('mot2') },
      { id: 'municipal portals', examined: `${EV.muni.ckan.length} datacity CKAN names + ${EV.muni.portals.length} municipal CKAN / GIS hosts + the Tel Aviv ArcGIS server (${EV.muni.tlv.services.length} services, ${EV.muni.tlv.layers.length} layers)`, evidence: evPath('muni') },
      { id: 'other national hosts', examined: 'Survey of Israel, MoEP, IMS, GSI, Water Authority, Ministry of Education, ILA, Netivei Israel, Israel Railways, NTA', evidence: evPath('other') },
    ],
    states: STATES, fields: FIELDS,
    summary: {
      cataloguesExamined: 8, candidates: sources.length, endpointsVerified: verified,
      integratedThisMission: byState.CONNECTED_VERIFIED, alreadyIntegrated: byState.EXISTING_VERIFIED, accessibleNotYetIntegrated: byState.ACCESSIBLE_NOT_YET_INTEGRATED,
      redundant: byState.REDUNDANT_PROVEN, technicallyBlocked: byState.BLOCKED_TECHNICAL, authBlocked: byState.BLOCKED_AUTH, legallyRestricted: byState.LICENSE_REVIEW_REQUIRED,
      paymentOrApproval: byState.PAID_APPROVAL_REQUIRED, unsuitable: byState.UNSUITABLE_DATA, notAnApi: byState.NOT_ACTUALLY_AN_API, pending: byState.PENDING_VERIFICATION,
      byState, dataGovIlPackagesNotRelevant: notRelevant.length,
      notCompleteness: 'The universe is what was examined: every data.gov.il package, every Planning Administration service, the BOI and CBS catalogues, 31 municipal portal names and the national hosts listed. Sources outside these catalogues may exist; this file never claims universal completeness.',
    },
    sources,
    notRelevant: { count: notRelevant.length, rule: 'hand-triaged from title / notes / tags / resources: not material to Israeli residential real-estate intelligence', byOrg: nrByOrg },
    notFoundInCatalogue: TRIAGE.notFoundInCatalogue,
    fieldMatrix: fieldMatrix(sources),
    improvements: improvements(),
  };
}

/* ── M4: the source-to-field matrix (scripts/source-field-matrix.js), checked against this universe and the repository ── */
function fieldMatrix(sources) {
  const { CLASSES, MATRIX } = require('./source-field-matrix');
  const ids = new Set(sources.map((s) => s.id));
  for (const r of MATRIX) {
    if (!CLASSES[r.class]) throw new Error(`matrix ${r.field}: unknown class ${r.class}`);
    for (const id of r.sources) if (!ids.has(id)) throw new Error(`matrix ${r.field}: source ${id} is not in the universe`);
    if (r.propx.stored && !fs.existsSync(path.join(ROOT, r.propx.stored))) throw new Error(`matrix ${r.field}: stored path ${r.propx.stored} does not exist`);
    if (/^STORED/.test(r.class) && !r.propx.stored && !r.propx.shown) throw new Error(`matrix ${r.field}: STORED without where`);
  }
  const byClass = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, MATRIX.filter((r) => r.class === k).length]));
  return { classes: CLASSES, byClass, rows: MATRIX.map((r) => ({ ...r, sourceStates: r.sources.map((id) => ({ id, state: sources.find((s) => s.id === id).state })) })) };
}

/* ── the MEASURED improvements of this mission (from the stored data — never from source-row counts alone) ── */
function improvements() {
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
  const out = {};
  const A = rd('data/geo/streets/search-audit.json');
  if (A) out.search = { what: 'registry-wide discoverability of every searchable directory row (street · address area · site), each searched in its own locality, by name + locality, and plainly', universe: A.universe, forms: A.forms, plainAmbiguous: A.plainAmbiguous ? A.plainAmbiguous.count : null, failures: A.failures && typeof A.failures === 'object' ? (A.failures.total ?? A.failures.length ?? null) : A.failures, builtAt: A.builtAt || null };
  const C = rd('data/cbs-sales/latest.json');
  if (C && C.market) { const il = C.market.il; out.wholeMarketSales = { what: 'official monthly dwellings sold — ALL and SECOND-HAND (+ subsidized new by district) for Israel and 7 districts, 2016 →', geographies: Object.keys(C.market).length,
    latest: il.total_sold.metrics.latest, t12: { from: il.total_sold.metrics.t12.from, to: il.total_sold.metrics.t12.to, all: il.total_sold.metrics.t12.value, secondHand: il.second_hand_sold.metrics.t12.value, secondHandSharePct: il.secondHandShare && il.secondHandShare.pct } }; }
  const Fi = rd('data/finance/latest.json');
  if (Fi) out.housingFinance = { what: 'Bank of Israel housing-finance measures (new mortgages by track, LTV / PTI bands, balances, arrears)', measures: Object.keys(Fi.measures || {}).length, latestPeriods: [...new Set(Object.values(Fi.measures || {}).map((m) => m && m.latest && m.latest.period).filter(Boolean))].sort().slice(-2) };
  const Ce = rd('data/reference/census-2022/meta.json'), Re = rd('data/reference/residents/meta.json');
  if (Ce || Re) out.localityContext = { what: 'official locality context (census 2022 + weekly registered residents) in the dossier and the street report', census: Ce ? Ce.byLevel : null, residents: Re ? Re.records : null };
  try {
    const TR = require('../lib/transport'); const G = path.join(ROOT, 'data', 'geo', 'street-geo', 'loc');
    let streets = 0, withStop = 0, withLrtExisting = 0, withLrtPlannedOnly = 0, withRegistryLr = 0, withRail = 0;
    for (const f of fs.readdirSync(G)) { const L = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(G, f))).toString('utf8'));
      for (const st of Object.values(L.streets || {})) { if (!st.pts || !st.pts.length) continue; streets++; const X = TR.access(st.pts.map((p) => ({ lng: p[0], lat: p[1] })));
        if (!X.available) continue; if (X.busStops.count) withStop++; if (X.lrt.existingNearestM != null) withLrtExisting++; else if (X.lrt.plannedNearestM != null) withLrtPlannedOnly++; if (X.lrt.registry && X.lrt.registry.count) withRegistryLr++; if (X.rail.stops.length) withRail++; } }
    out.transportAccess = { what: 'located official streets with a public-transport reading in the street report (new in this mission)', locatedStreets: streets, withStopWithin300m: withStop, withExistingLightRailWithin1km: withLrtExisting, withOnlyPlannedLightRailWithin1km: withLrtPlannedOnly, withRegistryLightRailStopWithin1km: withRegistryLr, withRailStopWithin1500m: withRail };
  } catch (e) { out.transportAccess = { error: String(e.message).slice(0, 200) }; }
  const T = rd('data/txevents/latest.json');
  out.transactions = { what: 'the freshest transactions PROPX can lawfully read — re-checked: no new legitimate channel exists (the official channels are refused / CAPTCHA-protected, data.gov.il publishes no deal dataset)', latestKnown: T && T.national ? T.national.latest : null, countedEvents: T && T.national ? T.national.events : null, builtAt: T ? T.builtAt : null, newEventsFromNewSources: 0 };
  return out;
}

function markdown(U) {
  const S = U.summary, L = [];
  L.push('# Source universe — findings 21.10.2026', '', `Built by \`${U.builtBy.split(' ')[0]}\` from stored runner evidence (no network call). File: \`lib/trust/discovery/2026-10-21-source-universe.json\`.`, '');
  L.push('## Totals', '', '| | |', '|---|---|');
  for (const [k, v] of [['catalogues examined', S.cataloguesExamined], ['candidate sources', S.candidates], ['endpoints with a recorded HTTP answer', S.endpointsVerified], ['integrated in this mission (CONNECTED_VERIFIED)', S.integratedThisMission], ['already integrated (EXISTING_VERIFIED)', S.alreadyIntegrated], ['accessible, not yet integrated', S.accessibleNotYetIntegrated], ['redundant (proven)', S.redundant], ['technically blocked', S.technicallyBlocked], ['blocked — authentication', S.authBlocked], ['licence review required', S.legallyRestricted], ['payment / approval required', S.paymentOrApproval], ['unsuitable data', S.unsuitable], ['not actually an API', S.notAnApi], ['pending verification', S.pending], ['data.gov.il packages not relevant (listed by publisher)', S.dataGovIlPackagesNotRelevant]]) L.push(`| ${k} | ${v} |`);
  L.push('', S.notCompleteness, '', '## Catalogues examined', '');
  for (const c of U.catalogues) L.push(`- **${c.id}** — ${c.examined}${c.packages ? ` (${c.packages} packages, ${c.relevant} relevant)` : ''}${c.services ? ` (${c.services} services, ${c.layers} layers)` : ''}${c.flows ? ` (${c.flows} flows)` : ''} — \`${c.evidence}\``);
  for (const st of Object.keys(U.states)) {
    const rows = U.sources.filter((s) => s.state === st); if (!rows.length) continue;
    L.push('', `## ${st} (${rows.length})`, '', `_${U.states[st]}_`, '', '| Source | Publisher | Endpoint | Latest | Licence | Why |', '|---|---|---|---|---|---|');
    for (const s of rows) {
      const latest = s.newest && typeof s.newest === 'object' ? `${s.newest.field}: ${s.newest.value}` : s.newest || (s.freshness && s.freshness.packageModified ? 'modified ' + String(s.freshness.packageModified).slice(0, 10) : '—');
      const cell = (x) => String(x == null ? '—' : x).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 220);
      L.push(`| ${cell(s.name)} \`${s.id}\` | ${cell(s.publisher)} | ${cell(s.endpoint)} | ${cell(latest)} | ${cell(s.licence)} | ${cell(s.stateWhy)} |`);
    }
  }
  L.push('', '## Source-to-field coverage matrix (M4)', '', '| Domain | Field | Class | Sources (state) | PROPX stores · shows | Note |', '|---|---|---|---|---|---|');
  const cl = (x) => String(x == null ? '—' : x).replace(/\|/g, '/').replace(/\s+/g, ' ');
  for (const r of U.fieldMatrix.rows) L.push(`| ${cl(r.domain)} | ${cl(r.field)} | ${U.fieldMatrix.classes[r.class]} | ${r.sourceStates.map((x) => `\`${x.id}\` ${x.state}`).join('<br>') || '—'} | ${cl(r.propx.stored)} · ${cl(r.propx.shown)} | ${cl(r.note)} |`);
  L.push('', 'By class: ' + Object.entries(U.fieldMatrix.byClass).map(([k, v]) => `${U.fieldMatrix.classes[k]} ${v}`).join(' · '));
  L.push('', '## Measured improvements', '', '```json', JSON.stringify(U.improvements, null, 1), '```');
  L.push('', '## Searched for and not found in the data.gov.il catalogue', '');
  for (const [k, v] of Object.entries(U.notFoundInCatalogue || {})) L.push(`- **${k}** — ${v}`);
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const U = build();
  const json = JSON.stringify(U, null, 1) + '\n', md = markdown(U);
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === json && fs.existsSync(MD) && fs.readFileSync(MD, 'utf8') === md;
    if (!same) { console.error('the stored source universe differs from a rebuild — run node scripts/source-universe-build.js'); process.exit(1); }
    console.log('source universe: up to date'); return;
  }
  fs.writeFileSync(OUT, json); fs.writeFileSync(MD, md);
  console.log(JSON.stringify(U.summary, null, 1));
}
module.exports = { build, STATES, FIELDS };
