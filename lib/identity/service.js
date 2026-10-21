// PROPX · private workspace identity — the flows behind /api/identity (STEP 2A).
//
// Named, invite-only users on top of the site's perimeter gate. Every request answers WHO (the user from a LIVE server
// session), WHICH organizations and WHAT role (read from the private store on every request — never from the cookie),
// and IS THE SESSION VALID (cookie signature + perimeter binding + the store's session check). Nothing here touches the
// public PROPX data, its read models or its syncs, and no browser-local state is read, copied or synced (section 18).
//
// `db` is a store adapter { rpc(fn, args, claims) } — lib/identity/rest.js in Production, a local psql adapter in tests.

'use strict';

const { randomBytes } = require('node:crypto');
const C = require('./cookie');
const PW = require('./password');

const AUTH = Object.freeze({ role: 'propx_auth' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/* the store's own refusal words, passed on as-is (anything else is "store") */
const CODES = new Set(['invalid_role', 'invalid_email', 'invalid_name', 'invalid_token', 'invalid_credential', 'invalid_status', 'last_owner',
  'sole_owner', 'personal_org', 'archived', 'already_member', 'not_found', 'too_many_teams', 'self', 'pending_approval']);

const out = (status, body, setCookie) => ({ status, body, setCookie });
const fail = (status, error, setCookie) => out(status, { ok: false, error }, setCookie);
function fromStore(r) {
  if (r.code === '42501') return fail(403, 'denied');
  if (r.code === 'P0001' && CODES.has(r.message)) return fail(400, r.message);
  return fail(502, 'store');
}
const newSecret = () => randomBytes(32).toString('base64url');

/** the live session behind this request: { session } | { session: null } | { storeError } */
async function currentSession(db, cfg, cookieHeader) {
  const c = C.parse(cookieHeader, cfg.cookieSecret);
  if (!c) return { session: null, hadCookie: Boolean(C.readCookie(cookieHeader, C.NAME)) };
  const ph = C.perimeterHash(cookieHeader);
  if (!ph || ph !== c.ph) return { session: null, hadCookie: true };
  const r = await db.rpc('auth_session_check', { p_session_id: c.sid, p_token_hash: C.sha256hex(c.secret) }, AUTH);
  if (!r.ok) return { storeError: true };
  const v = r.value;
  if (!v || v.user_id !== c.uid || v.session_version !== c.sv || v.perimeter_hash !== c.ph) return { session: null, hadCookie: true };
  return { session: { userId: v.user_id, sid: c.sid, secret: c.secret, issuedAt: v.issued_at, expiresAt: v.expires_at,
    claims: { role: 'authenticated', sub: v.user_id, sid: c.sid, sv: v.session_version } } };
}

/** end the session named by this browser's identity cookie (only its holder can: the store needs the secret) */
async function revokeFromCookie(db, cfg, cookieHeader) {
  const c = C.parse(cookieHeader, cfg.cookieSecret);
  if (!c) return false;
  const r = await db.rpc('auth_session_revoke', { p_session_id: c.sid, p_token_hash: C.sha256hex(c.secret) }, AUTH);
  return Boolean(r.ok && r.value && r.value.revoked);
}

/** a fresh session (new id, new secret — never one the browser brought: no fixation), bound to the perimeter session */
async function openSession(db, cfg, userId, ph) {
  const secret = newSecret();
  const r = await db.rpc('auth_session_open', { p_user_id: userId, p_token_hash: C.sha256hex(secret), p_perimeter_hash: ph, p_ttl_seconds: C.TTL_S }, AUTH);
  if (!r.ok) return r.code === '42501' ? fail(401, 'signin_failed') : fromStore(r);
  const v = r.value, exp = Math.floor(Date.parse(v.expires_at) / 1000);
  const { value } = C.issue({ sid: v.session_id, uid: v.user_id, sv: v.session_version, iat: Math.floor(Date.parse(v.issued_at) / 1000), exp, ph }, cfg.cookieSecret, secret);
  return out(200, { ok: true, expiresAt: v.expires_at }, C.serialize(value, exp - Date.now() / 1000));
}

async function signin(ctx) {
  const { db, cfg, cookieHeader, body } = ctx;
  const ph = C.perimeterHash(cookieHeader);
  if (!ph) return fail(401, 'perimeter');
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(body.password == null ? '' : body.password);
  await PW.dummyHash();   // built before the first lookup, so a cold instance costs the same for a known and an unknown address
  const look = await db.rpc('auth_signin_lookup', { p_email: email }, AUTH);
  if (!look.ok) return fromStore(look);
  const L = look.value;
  const good = await PW.verify(password, L && L.password_hash);   // an unknown / locked account is verified against a dummy hash
  if (!L || L.locked || !L.password_hash || !good) {
    // the same store call on EVERY failure, keyed by the address as typed: the number of calls says nothing about the address
    await db.rpc('auth_signin_failed', { p_email: email }, AUTH);
    return fail(401, 'signin_failed');   // one answer for unknown email · wrong password · locked · inactive
  }
  await revokeFromCookie(db, cfg, cookieHeader);
  return openSession(db, cfg, L.user_id, ph);
}

async function activate(ctx) {
  const { db, cfg, cookieHeader, body } = ctx;
  const ph = C.perimeterHash(cookieHeader);
  if (!ph) return fail(401, 'perimeter');
  if (!TOKEN.test(String(body.token || ''))) return fail(400, 'invite_invalid');
  const why = PW.policy(body.password);
  if (why) return fail(400, why);
  const name = String(body.displayName || '').trim();
  if (!name || name.length > 120) return fail(400, 'invalid_name');
  // the link is checked (cheaply) before the password is hashed: a made-up token never costs a 32 MiB scrypt
  const peek = await db.rpc('auth_invite_peek', { p_token_hash: C.sha256hex(body.token) }, AUTH);
  if (!peek.ok) return fromStore(peek);
  if (!peek.value || !peek.value.needs_activation) return fail(403, 'invite_invalid');
  if (peek.value.pending_approval) return fail(400, 'pending_approval');
  const r = await db.rpc('auth_activate', { p_token_hash: C.sha256hex(body.token), p_password_hash: await PW.hash(body.password), p_display_name: name }, AUTH);
  if (!r.ok) return r.code === '42501' ? fail(403, 'invite_invalid') : fromStore(r);
  await revokeFromCookie(db, cfg, cookieHeader);
  return openSession(db, cfg, r.value.user_id, ph);
}

async function inviteInfo({ db, body }) {
  if (!TOKEN.test(String(body.token || ''))) return fail(404, 'invite_invalid');
  const r = await db.rpc('auth_invite_peek', { p_token_hash: C.sha256hex(body.token) }, AUTH);
  if (!r.ok) return fromStore(r);
  if (!r.value) return fail(404, 'invite_invalid');
  const v = r.value;
  return out(200, { ok: true, invite: { orgName: v.org_name, role: v.role, email: v.email, needsActivation: v.needs_activation, pendingApproval: Boolean(v.pending_approval), expiresAt: v.expires_at } });
}

/* ── password reset (Enterprise pilot, 21.10.2026): a one-time link the platform administrator issues; its holder chooses the
   new password; every session of the user ends; this browser gets one new session ── */
async function resetInfo({ db, body }) {
  if (!TOKEN.test(String(body.token || ''))) return fail(404, 'reset_invalid');
  const r = await db.rpc('auth_reset_peek', { p_token_hash: C.sha256hex(body.token) }, AUTH);
  if (!r.ok) return fromStore(r);
  if (!r.value) return fail(404, 'reset_invalid');
  return out(200, { ok: true, reset: { email: r.value.email, expiresAt: r.value.expires_at } });
}

async function reset(ctx) {
  const { db, cfg, cookieHeader, body } = ctx;
  const ph = C.perimeterHash(cookieHeader);
  if (!ph) return fail(401, 'perimeter');
  if (!TOKEN.test(String(body.token || ''))) return fail(400, 'reset_invalid');
  const why = PW.policy(body.password);
  if (why) return fail(400, why);
  // the link is checked (cheaply) before the password is hashed: a made-up token never costs a scrypt
  const peek = await db.rpc('auth_reset_peek', { p_token_hash: C.sha256hex(body.token) }, AUTH);
  if (!peek.ok) return fromStore(peek);
  if (!peek.value) return fail(403, 'reset_invalid');
  const r = await db.rpc('auth_reset_complete', { p_token_hash: C.sha256hex(body.token), p_password_hash: await PW.hash(body.password) }, AUTH);
  if (!r.ok) return r.code === '42501' ? fail(403, 'reset_invalid') : fromStore(r);
  await revokeFromCookie(db, cfg, cookieHeader);
  return openSession(db, cfg, r.value.user_id, ph);
}

async function status(ctx) {
  const { db, cfg, cookieHeader } = ctx;
  const s = await currentSession(db, cfg, cookieHeader);
  if (s.storeError) return out(503, { enabled: true, error: 'store' });
  if (!s.session) return out(200, { enabled: true, signedIn: false }, s.hadCookie ? C.clear() : undefined);
  const me = await db.rpc('me', {}, s.session.claims);
  if (!me.ok) return me.code === '42501' ? out(200, { enabled: true, signedIn: false }, C.clear()) : out(503, { enabled: true, error: 'store' });
  const u = me.value.user;
  return out(200, {
    enabled: true, signedIn: true,
    user: { id: u.id, email: u.email, displayName: u.display_name, platformAdmin: Boolean(u.is_platform_admin) },
    organizations: me.value.organizations.map((o) => ({ id: o.id, name: o.name, kind: o.kind, role: o.role, archived: Boolean(o.archived) })),
    session: { issuedAt: s.session.issuedAt, expiresAt: s.session.expiresAt },
  });
}

/* ── signed-in operations: the store decides every permission; the server passes only targets, never an actor ── */
const uuid = (v) => (UUID.test(String(v || '')) ? String(v).toLowerCase() : null);
const MEMBER_OPS = {
  members: (q) => uuid(q.org) && ['org_members', { p_org: uuid(q.org) }],
  'revoke-invite': (b) => uuid(b.org) && uuid(b.user) && ['revoke_invitation', { p_org: uuid(b.org), p_user: uuid(b.user) }],
  'set-role': (b) => uuid(b.org) && uuid(b.user) && ['set_member_role', { p_org: uuid(b.org), p_user: uuid(b.user), p_role: String(b.role || '') }],
  'revoke-member': (b) => uuid(b.org) && uuid(b.user) && ['revoke_member', { p_org: uuid(b.org), p_user: uuid(b.user) }],
  'create-team': (b) => ['create_team', { p_name: String(b.name || '').slice(0, 200) }],
  archive: (b) => uuid(b.org) && typeof b.archived === 'boolean' && ['set_org_archived', { p_org: uuid(b.org), p_archived: b.archived }],
  'admin-users': () => ['admin_users', {}],
  'admin-user-status': (b) => uuid(b.user) && ['admin_set_user_status', { p_user: uuid(b.user), p_status: String(b.status || '') }],
  'admin-revoke-sessions': (b) => uuid(b.user) && ['admin_revoke_sessions', { p_user: uuid(b.user) }],
  'admin-approve-user': (b) => uuid(b.user) && ['admin_approve_user', { p_user: uuid(b.user) }],
};

async function signedIn(ctx, fn) {
  const s = await currentSession(ctx.db, ctx.cfg, ctx.cookieHeader);
  if (s.storeError) return fail(503, 'store');
  if (!s.session) return fail(401, 'signed_out', s.hadCookie ? C.clear() : undefined);
  return fn(s.session);
}

async function memberOp(ctx, op) {
  const call = MEMBER_OPS[op](ctx.method === 'GET' ? ctx.query : ctx.body);
  if (!call) return fail(400, 'invalid_input');
  return signedIn(ctx, async (s) => {
    const r = await ctx.db.rpc(call[0], call[1], s.claims);
    return r.ok ? out(200, { ok: true, result: r.value }) : fromStore(r);
  });
}

async function invite(ctx) {
  const b = ctx.body;
  if (!uuid(b.org)) return fail(400, 'invalid_input');
  return signedIn(ctx, async (s) => {
    const token = newSecret();
    const r = await ctx.db.rpc('invite_member', { p_org: uuid(b.org), p_email: String(b.email || '').slice(0, 300), p_role: String(b.role || ''), p_token_hash: C.sha256hex(token) }, s.claims);
    if (!r.ok) return fromStore(r);
    // the link is shown ONCE, to the inviter, who delivers it; the token travels in the URL fragment (never sent to a server)
    return out(200, { ok: true, invite: { email: r.value.email, role: r.value.role, expiresAt: r.value.expires_at, link: `${ctx.origin}/#invite=${token}` } });
  });
}

async function accept(ctx) {
  if (!TOKEN.test(String(ctx.body.token || ''))) return fail(403, 'invite_invalid');
  return signedIn(ctx, async (s) => {
    const r = await ctx.db.rpc('accept_invitation', { p_token_hash: C.sha256hex(ctx.body.token) }, s.claims);
    if (!r.ok) return r.code === '42501' ? fail(403, 'invite_invalid') : fromStore(r);
    return out(200, { ok: true, result: { orgId: r.value.org_id, role: r.value.role } });
  });
}

/* change my password: the CURRENT password is verified here exactly like a sign-in (scrypt, failures counted toward the
   account lock); the store then replaces the hash and ends EVERY session of the user; this browser gets a new one */
async function changePassword(ctx) {
  const { db, cfg, cookieHeader, body } = ctx;
  const why = PW.policy(body.password);
  if (why) return fail(400, why);
  if (String(body.current == null ? '' : body.current) === String(body.password)) return fail(400, 'password_unchanged');
  return signedIn(ctx, async (s) => {
    const me = await db.rpc('me', {}, s.claims);
    if (!me.ok) return fromStore(me);
    const email = me.value.user.email;
    const look = await db.rpc('auth_signin_lookup', { p_email: email }, AUTH);
    if (!look.ok) return fromStore(look);
    const good = await PW.verify(String(body.current == null ? '' : body.current), look.value && look.value.password_hash);
    if (!look.value || look.value.locked || !good) {
      await db.rpc('auth_signin_failed', { p_email: email }, AUTH);
      return fail(401, 'current_password_wrong');
    }
    const r = await db.rpc('change_password', { p_password_hash: await PW.hash(body.password) }, s.claims);
    if (!r.ok) return fromStore(r);
    return openSession(db, cfg, s.userId, C.perimeterHash(cookieHeader));
  });
}

async function setName(ctx) {
  const name = String(ctx.body.displayName || '').trim();
  if (!name || name.length > 120) return fail(400, 'invalid_name');
  return signedIn(ctx, async (s) => {
    const r = await ctx.db.rpc('set_display_name', { p_display_name: name }, s.claims);
    return r.ok ? out(200, { ok: true, result: { displayName: r.value.display_name } }) : fromStore(r);
  });
}

/* a password-reset link for a user (platform administrator only — the store decides): shown ONCE, to the administrator,
   who delivers it; the token travels in the URL fragment of the sign-in page (never sent to a server by the browser) */
async function adminResetLink(ctx) {
  const user = uuid(ctx.body.user);
  if (!user) return fail(400, 'invalid_input');
  return signedIn(ctx, async (s) => {
    const token = newSecret();
    const r = await ctx.db.rpc('admin_reset_link', { p_user: user, p_token_hash: C.sha256hex(token) }, s.claims);
    if (!r.ok) return fromStore(r);
    return out(200, { ok: true, reset: { email: r.value.email, expiresAt: r.value.expires_at, link: `${ctx.origin}/login.html#reset=${token}` } });
  });
}

async function signout(ctx) {
  await revokeFromCookie(ctx.db, ctx.cfg, ctx.cookieHeader);
  return out(200, { ok: true }, C.clear());
}

async function signoutAll(ctx) {
  return signedIn(ctx, async (s) => {
    const r = await ctx.db.rpc('signout_all', {}, s.claims);
    return r.ok ? out(200, { ok: true, sessionsRevoked: r.value.sessions_revoked }, C.clear()) : fromStore(r);
  });
}

const GET_OPS = new Set(['status', 'members', 'admin-users']);
const POST_OPS = {
  signin, activate, 'invite-info': inviteInfo, signout, 'signout-all': signoutAll, invite, accept,
  'reset-info': resetInfo, reset, 'change-password': changePassword, 'set-name': setName, 'admin-reset-link': adminResetLink,
  'revoke-invite': 1, 'set-role': 1, 'revoke-member': 1, 'create-team': 1, archive: 1, 'admin-user-status': 1, 'admin-revoke-sessions': 1,
  'admin-approve-user': 1,
};

/** ctx = { db, cfg, method, op, query, body, cookieHeader, origin } → { status, body, setCookie? } */
async function dispatch(ctx) {
  const { method, op } = ctx;
  if (method === 'GET') {
    if (!GET_OPS.has(op)) return fail(404, 'no-such-operation');
    return op === 'status' ? status(ctx) : memberOp(ctx, op);
  }
  const f = Object.hasOwn(POST_OPS, op) ? POST_OPS[op] : null;   // own names only: ?op=constructor / __proto__ are not operations
  if (!f) return fail(404, 'no-such-operation');
  return typeof f === 'function' ? f(ctx) : memberOp(ctx, op);
}

module.exports = { dispatch, currentSession, revokeFromCookie, GET_OPS, POST_OPS, AUTH };
