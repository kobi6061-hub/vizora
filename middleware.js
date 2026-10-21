// KobiX RealEstate / PROPX — Vercel Edge Middleware access gate.
// Every request (except the exact public paths and the one machine path) must carry a valid session; otherwise it is
// redirected to /login.html. The decision itself lives in ONE module, lib/identity/gate.mjs, which the local dev server
// (scripts/kobix-dev-server.mjs) imports too — so the two can never drift (test/security-gate.test.js, test/pilot-access.test.js).
//
// Two modes (lib/identity/gate.mjs):
//   PERIMETER (PROPX_IDENTITY unset)  the shared site password's signed cookie, checked here; the password itself lives only in
//                                     the SITE_PASSWORD environment variable and is compared only in /api/login.
//   IDENTITY  (PROPX_IDENTITY=on)     the shared password opens nothing: every gated path needs an individual, live session
//                                     (perimeter cookie minted at that user's sign-in + the identity cookie bound to it + the
//                                     private store's session check). A partial configuration CLOSES the site (503) — it never
//                                     falls back to the shared password.
//
// The matcher sends EVERY path here and the exclusions are decided on the parsed pathname by EXACT comparison (19.10.2026 —
// before, the matcher excluded by prefix, so a future /api/login-anything or /login.html.bak would have passed ungated).
// One machine-only path passes without a cookie: exactly /api/jobs/tx-refresh, because that function authenticates the
// caller itself with a bearer token from server-side env and fails closed (api/jobs/tx-refresh.js).
//
// The evidence request (POST /api/intel, view=dd — the user's documents in the body) is refused here, before the function
// runs, when its declared length is over 256 KB. A request without a Content-Length (chunked) is checked again by the function
// after the platform has read it (the platform's own ceiling is 4.5 MB); the function also caps the normalized evidence.

import { decide, respond, accessMode, restSessionCheck } from './lib/identity/gate.mjs';

const EVIDENCE_PATH = '/api/intel';
const MAX_EVIDENCE_BODY = 256 * 1024;

export const config = {
  matcher: ['/(.*)'],
};

export default async function middleware(req) {
  const M = accessMode(process.env);
  const d = await decide(req, process.env, { checkSession: M.mode === 'identity' ? restSessionCheck(M) : null });
  if (d.action !== 'pass') return respond(d, req);
  if (d.why !== 'public' && d.why !== 'machine' && req.method === 'POST' && new URL(req.url).pathname === EVIDENCE_PATH) {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BODY) {
      return new Response(JSON.stringify({ error: 'body too large', limitBytes: MAX_EVIDENCE_BODY }), { status: 413, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
  }
  return; // a valid session — continue to the static asset / function
}
