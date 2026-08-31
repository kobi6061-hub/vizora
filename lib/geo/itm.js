// PROPX · ITM (Israel Transverse Mercator, EPSG:2039) ↔ WGS84.
// Deterministic datum/projection transform (standard inverse/forward
// Transverse Mercator on GRS80 with the published ITM grid constants) —
// an exact coordinate conversion, not an estimate. Used to place
// government deal records (served in ITM meters) on the WGS84 map.

'use strict';

// GRS80 ellipsoid + ITM projection constants (published grid definition)
const a = 6378137.0;
const f = 1 / 298.257222101;
const e2 = f * (2 - f);
const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
const k0 = 1.0000067;
const lat0 = (31 + 44 / 60 + 3.817 / 3600) * Math.PI / 180;  // 31°44′03.817″
const lon0 = (35 + 12 / 60 + 16.261 / 3600) * Math.PI / 180; // 35°12′16.261″
const FE = 219529.584;
const FN = 626907.390;

function arcLength(phi) {
  return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
}
const M0 = arcLength(lat0);

/** ITM easting/northing (meters) → {lat, lng} WGS84 degrees. */
function itmToWgs84(x, y) {
  const M = M0 + (y - FN) / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const ep2 = e2 / (1 - e2);
  const s1 = Math.sin(phi1), c1 = Math.cos(phi1), t1 = Math.tan(phi1);
  const C1 = ep2 * c1 * c1;
  const T1 = t1 * t1;
  const N1 = a / Math.sqrt(1 - e2 * s1 * s1);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * s1 * s1, 1.5);
  const D = (x - FE) / (N1 * k0);
  const lat = phi1 - (N1 * t1 / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lng = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c1;
  return { lat: lat * 180 / Math.PI, lng: lng * 180 / Math.PI };
}

/** WGS84 degrees → ITM {x, y} meters (forward TM; QA round-trips). */
function wgs84ToItm(lat, lng) {
  const phi = lat * Math.PI / 180, lam = lng * Math.PI / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const ep2 = e2 / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const T = t * t, C = ep2 * c * c;
  const A = (lam - lon0) * c;
  const M = arcLength(phi);
  const x = FE + k0 * N * (A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = FN + k0 * (M - M0 + N * t * (A * A / 2
    + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return { x, y };
}

module.exports = { itmToWgs84, wgs84ToItm };

/* ---------------------------------------------------------------------
   Web Mercator (EPSG:3857) — the CRS GovMap actually serves its
   real-estate geometry in (verified against live production records,
   31.08.2026: x≈3.87e6, y≈3.78e6 → Tel Aviv 32.09N 34.77E).
   --------------------------------------------------------------------- */
const R_MERC = 20037508.34;

function webMercatorToWgs84(x, y) {
  const lng = (x / R_MERC) * 180;
  let lat = (y / R_MERC) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lat, lng };
}

/** True ground distance in meters between two WGS84 points (haversine). */
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, d = Math.PI / 180;
  const dLat = (lat2 - lat1) * d, dLng = (lng2 - lng1) * d;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Israel bounding box sanity check — rejects a mis-projected point. */
function inIsrael(lat, lng) {
  return lat > 29.3 && lat < 33.4 && lng > 34.2 && lng < 35.95;
}

module.exports.webMercatorToWgs84 = webMercatorToWgs84;
module.exports.haversineM = haversineM;
module.exports.inIsrael = inIsrael;
