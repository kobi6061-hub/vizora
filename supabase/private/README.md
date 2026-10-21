# PROPX private workspace: identity foundation (STEP 2A)

This directory holds the schema of the **private** Supabase project: named users, organizations, members and server
sessions. It is a different project from the one the public `market` schema (`supabase/migrations/`) is designed for
(decision D1). Nothing public reads it, and nothing in it is public data.

| | |
|---|---|
| **Migration** | `migrations/20261019120000_identity_foundation.sql` (schemas `ws` + `private`, role `propx_auth`) |
| **Test harness** | `test/supabase-roles-shim.sql`. TEST ONLY: the Supabase roles on a throwaway PostgreSQL 16, with deliberately permissive defaults. |
| **Isolation gate** | `test/private-identity.test.js` (41 gates, the HARD BLOCKER), `test/identity.test.js` (server flows, 18) and `test/pilot-access.test.js` (the site gate in identity mode end to end, 19), all run by `.github/workflows/private-identity.yml` on a `postgres:16` service |
| **Real-project activation** | `.github/workflows/identity-activate.yml` + `scripts/identity-activate.js` (modes preflight · apply · audit · probe, run by hand) and `test/real-project-probe.sql` (the two-organization probe that always rolls back). `test/management-api-mock.js` is a TEST HARNESS stand-in for the Management API so the gate can run the same sequence locally |
| **Server** | `lib/identity/*` (incl. `gate.mjs`, the ONE access decision the Edge middleware and the dev server share), `middleware.js`, `api/login.js`, `api/identity.js`, `api/logout.js`, `login.html` |
| **Activation check** | `scripts/identity-verify.js`, also run by `.github/workflows/identity-verify.yml`. Read-only. |
| **Status** | NOT ACTIVATED. Production runs with `PROPX_IDENTITY` unset, so the site keeps its shared-password gate. |

## Enterprise pilot (21.10.2026): individual access replaces the shared password

`PROPX_IDENTITY=on` no longer adds a workspace ON TOP of the shared password — it **replaces** it as the way in
(`lib/identity/gate.mjs`, used by `middleware.js` and `scripts/kobix-dev-server.mjs`):

| Mode | When | Who gets in |
|---|---|---|
| **PERIMETER** | `PROPX_IDENTITY` is not `on` | the shared password's signed cookie (as before; nothing reaches a store) |
| **IDENTITY** | `on` + `SESSION_SECRET`, `PROPX_ID_SECRET` (≥ 32, ≠ `SESSION_SECRET`), `PROPX_WS_URL` (https, not the public project), `PROPX_WS_APIKEY`, `PROPX_WS_JWT_SECRET` (≥ 32) | only a browser holding an INDIVIDUAL live session: the perimeter cookie minted at that user's sign-in + the identity cookie bound to it + the store's `ws.auth_session_check` (as `propx_auth`, a 60-s token) |
| **CLOSED** | `on` but any of the above missing or wrong | nobody: every gated path answers 503 — never a fallback to the shared password |

- **Every path** except the exact public ones (`/api/login`, `/login.html`, `/robots.txt`, `/favicon.ico`) and the one
  machine path (`/api/jobs/tx-refresh`, which checks its own bearer token) needs the session: every page, every
  `api/**` endpoint, every data file. `test/pilot-access.test.js` walks all of them.
- **One sign-in page** (`login.html`, Hebrew / English). It asks `/api/login?op=mode` which form to show: the shared
  password (PERIMETER) or email + password (IDENTITY). The invitation link (`#invite=`) and the password-reset link
  (`#reset=`) open there; the fragment is never sent to a server and is removed from the address bar at once. In
  IDENTITY mode the shared password answers `individual_login_required`.
- **Sign-in mints both cookies.** `/api/login` creates a perimeter cookie for THIS sign-in only (`SameSite=Lax`, as long
  as the identity session) and the identity cookie bound to it (`SameSite=Strict`); the browser's previous session is
  ended (no fixation).
- **Revocation reaches the gate within a minute.** The Edge caches a live answer for 60 s per isolate. Sign out
  everywhere, an administrator's revocation, a disabled user, a password change or reset all end access on the next
  check. If the store does not answer, a session seen live in the last 10 minutes keeps working; any other request
  gets 503 — never "open".
- **Arriving from another site.** The `SameSite=Strict` identity cookie is not sent on a cross-site navigation, so a
  document request carrying only the perimeter cookie is bounced once to the same address (then it is same-site).
- **Rate limit per client.** 20 sign-ins and 20 link operations per 15 minutes per client address (`private.auth_rate`,
  keyed by an HMAC of the address — the store never sees an address) → 429 with `Retry-After`. The per-account lock
  (5 failures → 15 minutes) stays.
- **Profile.** In the workspace drawer: the display name (`ws.set_display_name`), and a password change that needs the
  current password (verified like a sign-in) and ends every OTHER session (`ws.change_password`).
- **Password reset.** The platform administrator creates a one-time link in the users list (`ws.admin_reset_link`, shown
  once, 72 h, cancels earlier links); its holder sets a new password on the sign-in page (`ws.auth_reset_complete`),
  which also clears an account lock and ends every session of the user. PROPX sends no email.
- **Sign-out** in the drawer ends the named session and leaves through `/api/logout` (both cookies cleared).


## What it holds and what it does not

It holds:

- Users: named and invite-only.
- Organizations: one personal workspace per user, plus team workspaces.
- Memberships, each with a role: OWNER, ADMIN, ANALYST or VIEWER.
- Server sessions.
- An append-only identity event log.

It does not hold evidence, uploaded files, ALTARIS deals, Live Thesis records or fund settings. It has no storage
bucket and does no machine extraction (D3, D5, D6). No browser-local state is imported, copied or synced. That
includes `propx:dd:docs:v1`, `altaris:*` and the watchlists.

**Nothing is deleted (D4).** Each kind of record ends in its own way, and triggers refuse every DELETE and TRUNCATE,
even from the owner role:

- a membership is revoked;
- an invitation expires or is revoked;
- a workspace is archived (and can be restored);
- a session is revoked or expires.

## Roles

| | VIEWER | ANALYST | ADMIN | OWNER |
|---|---|---|---|---|
| read the workspace and its members | ✓ | ✓ | ✓ | ✓ |
| add evidence / submit facts *(future, Phase 1)* | — | ✓ | ✓ | ✓ |
| invite, change role, revoke **analysts and viewers** | — | — | ✓ | ✓ |
| invite, grant, revoke **admin / owner** | — | — | — | ✓ |
| archive / restore the workspace, *future purge* | — | — | — | ✓ |
| leave the workspace | ✓ | ✓ | ✓ | ✓ unless last owner |

Additional rules:

- **ADMIN** never grants or removes OWNER, and never grants or removes ADMIN. It manages ordinary members only.
- Every workspace with an active member keeps **at least one active OWNER**. This is checked in the functions, and
  checked again at commit by a deferred constraint trigger.
- A **revocation takes effect on the next request**. Every read checks the membership again in the database.
- **Platform administrator** (the bootstrap user) can list users, approve a new identity, disable or re-enable a user,
  and end all of a user's sessions. It refuses to disable the sole active owner of a team that still has other members.
- An owner who is a **disabled user** does not count as an owner: the last usable owner cannot step down.

## Invitations and new identities

- **An invitation is only as good as its inviter's standing.** A link activates, or is accepted, only while the inviter
  is still an active member, an active user, and senior enough for the role it grants (admin for analyst / viewer, owner
  for admin / owner). Revoking, demoting or disabling the inviter also revokes the links they had sent, and re-enabling
  them does not bring those links back. The member list shows who sent each pending invitation.
- **A new identity belongs to the workspace that created it.** Inviting an address with no account creates the identity
  in that workspace (`origin_org`). Only that workspace's link can activate it: another workspace's invitation of the
  same address waits until the person has activated and signed in, and is then accepted like any other.
- **New identities need the platform administrator's approval.** One the platform administrator invites is approved at
  creation. One any other member creates waits: the link says so, and activation answers `pending_approval` until the
  platform administrator approves it in the users list. That list shows the address, the workspace that created it and
  who invited it. So no member can claim an address for someone else.
- **Addresses are printable ASCII only**, so a zero-width character or a look-alike letter cannot create a second
  identity for the "same" address.
- **The member list never shows the account behind an invited address.** A row that never joined shows only what the
  workspace wrote: email, role, status, dates and who invited. It never shows the name, the account state, or whether
  the address already had an account.

## Trust boundary

**Writes.** Every write is a `SECURITY DEFINER` function in schema `ws` with `search_path = ''`. No API role has
INSERT, UPDATE or DELETE on any table.

**The acting user.** The acting user always comes from the session: claims `sub`, `sid` and `sv`, checked against a
**live** session row by `private.current_user_id()`. No function takes an actor or `created_by` argument, and an
organization id is only ever a target that gets checked.

**Errors leak nothing.** Every authorization failure raises the same error: SQLSTATE `42501`, message `denied`, no
detail, no hint. It is raised before any other validation. As a result:

- a hidden organization and a missing one look identical;
- counts through direct reads are identical;
- an invitation answers the same way whether or not the email is known.

**Direct reads (RLS).** A user can read:

- their own user row;
- the organizations they actively belong to;
- the membership rows of those organizations.

Column grants leave out the invitation token hash. No API role can read sessions, credentials or the event log.

**API roles:**

- `anon` and `service_role` hold nothing in `ws` or `private`. The private project is never reached with its
  service key: that key is not a PROPX setting.
- `propx_auth`, the sign-in plane, can only EXECUTE the `ws.auth_*` functions.
- `authenticated` can only use the member plane.

**Cross-organization attribution is impossible.** Composite keys tie `(org_id, invited_by | updated_by | revoked_by)`
to the same organization's members.

**Privileges are audited.** The catalogue audit gate lists every privilege on every object in `ws` and `private`. Any
privilege that is not allow-listed fails the gate, including one granted by a platform default.

## Sessions and the cookie

The server-side session lives in `ws.sessions`. The cookie is set as:

```
__Host-propx_id = v1.<payload>.<secret>.<hmac>
Path=/; HttpOnly; Secure; SameSite=Strict
```

- **Payload:** `{ sid, uid, sv, iat, exp, ph }`.
- **`ph`:** the hash of the perimeter cookie (`kobix_session`) the identity cookie was issued with.
- **Database copy:** the database stores only the sha-256 of the secret.
- **Lifetime:** 8 hours at most. The database enforces this.
- **What the cookie never carries:** roles and organizations. These are read from the database on every request.

How each attack is refused:

| Attack | Refused by |
|---|---|
| forged user id | HMAC; and even with a valid signature, the stored session must name the same user (`sid` ↔ `sub`) |
| replay after sign-out | the session is revoked in the database (`ws.auth_session_revoke` needs the secret) |
| global revocation | `session_version` + 1 (sign out everywhere, admin revocation, disabled user) ends every session at once |
| fixation | every sign-in and activation mints a new session id and secret, and ends the one that browser held |
| stolen identity cookie alone | bound to the perimeter session it was issued with (`ph`) |
| login CSRF / cross-site writes | every POST needs `x-propx-intent: 1`, JSON and same origin (`Origin`, `Sec-Fetch-Site`); the cookie is `SameSite=Strict`; and the perimeter cookie (`SameSite=Lax`) is not sent on a cross-site POST, so the gate redirects first |
| password guessing | 5 failures in a row lock the account for 15 minutes; one answer for unknown email, wrong password and locked account; an unknown email is checked against a dummy scrypt hash, built before the first lookup; every failure makes the same store call (`auth_signin_failed`, keyed by the address as typed), so the number of calls says nothing about the address |
| sign-out through a cross-site link | the page ends the named session with a same-origin intent POST, then follows the logout link; the link alone revokes it only when the identity cookie arrives (never on a cross-site navigation, since the cookie is `SameSite=Strict`) |
| a made-up activation link | it is checked against the store before the password is hashed, so it never costs a scrypt |

## Two documented choices that differ from the STEP 1 audit proposal

**1. Credentials: PROPX-owned passwords instead of Supabase Auth.**

The audit proposed Supabase Auth with email OTP. This step uses scrypt password hashes owned by PROPX instead:

- **Storage.** The hashes live in `private.user_credentials`, which is not exposed through the API.
- **Setting the password.** It is set through a one-time invitation link (72 h) that the inviter delivers.

The reasons:

- **No email.** PROPX has no email infrastructure, so OTP and magic links cannot be delivered.
- **Invite-only.** Supabase Auth adds public sign-up and OTP endpoints to the project. Invite-only would then depend
  on dashboard settings rather than on the schema.
- **One trusted path.** The password never leaves the PROPX server function.

It stays SSO-compatible:

- `ws.users.idp` and `idp_subject` already exist;
- an SSO provider adds an `idp` value;
- sessions, roles and RLS do not change.

The trade-off: an email address is an identifier chosen by the inviter, not one PROPX has verified. For that reason
**accepting an invitation always requires the link**. An email address alone never joins an organization, and an
invitation can never set the password of a user who already exists.

**2. Token mechanism: a server-minted, short-lived HS256 JWT.**

For every call, the server mints a token that lives 120 seconds (`lib/identity/token.js`), with one of two roles:

- `authenticated`, carrying `sub`, `sid` and `sv`;
- `propx_auth`, a custom role granted to `authenticator`.

Two properties hold:

- **The database re-checks the session on every call.** A minted token for a revoked or expired session reads
  nothing.
- **The browser never sees a token.** It holds only the identity cookie.

This depends on the project's API accepting HS256 tokens signed with the project's JWT secret, and on PostgREST
switching to the custom role named in the token's `role` claim. It could not be verified from the development sandbox.
`scripts/identity-verify.js` checks it on the real project before the switch is turned on (check 4).

If the project's signing setup no longer accepts a server-minted HS256 token, the fallback changes **only the
adapter** (`lib/identity/rest.js`): a server-side Postgres connection that runs `SET LOCAL ROLE` plus
`request.jwt.claims`. That is exactly how the isolation gate exercises the schema. The SQL rules do not move. Such an
adapter **must bind every value as a parameter**, never put it in the statement text, so a failed call never writes a
password or token hash to the database log. The local test adapter (`scripts/identity-psql-adapter.js`) does this with
psql's `\getenv` + `\bind`.

`PROPX_WS_JWT_SECRET` is master-equivalent for this project. It lives only in the Vercel server environment, and the
code mints only the two roles above. A unit gate checks this: `service_role`, `anon`, `postgres` and the rest are
refused.

## Activation (STEP 2A.1 — through GitHub runners; the development sandbox cannot reach Supabase)

The project `propx-private` exists in `eu-central-1` (Frankfurt). The activation runs on GitHub runners and reports back through
workflow annotations. **The repository is public, so its run logs are too:** the scripts print the project ref masked
(`abcd…xy`) with a fingerprint, never the API host and never a secret.

1. **Add the GitHub Actions secrets** (Settings → Secrets and variables → Actions). Never paste them into chat.

   | Secret | Value | Used by |
   |---|---|---|
   | `SUPABASE_ACCESS_TOKEN` | a Supabase personal access token. It reaches every project of the account, so create it for this activation and revoke it afterwards | `identity-activate.yml`: verifies the target's name and region, applies the migration, reads the advisors |
   | `PROPX_WS_URL` | `https://<ref>.supabase.co` of `propx-private` | both workflows (must name the same project) |
   | `PROPX_WS_APIKEY` | its anon / publishable key | `identity-verify.yml` |
   | `PROPX_WS_JWT_SECRET` | its **legacy** JWT secret (HS256; Project Settings → JWT Keys). Master-equivalent: server only | `identity-verify.yml` (check 4 proves the project accepts the server-minted token) |
   | `SUPABASE_URL` | optional: the public project's URL, so the preflight can also prove the target is not that project | both |

2. **Preflight** (read-only): run "Private identity — real-project activation" with `mode = preflight`.
   - **What it checks:**
     - the token sees exactly one project named `propx-private`;
     - its region is `eu-central-1`;
     - it is `ACTIVE_HEALTHY`;
     - it is not the public project;
     - it is the project `PROPX_WS_URL` names.
   - **What it reads:** the executing role, and whether the database holds any PROPX object or business data.
   - **What it prints:** the target's fingerprint.
3. **Apply.** Run the same workflow with `mode = apply` and `confirm_ref = <the fingerprint>`.
   - **The migration.** It applies `migrations/20261019120000_identity_foundation.sql` from the repository, unchanged, with its
     sha-256 printed. It runs as the project's non-superuser `postgres` role; a superuser API session switches to it. If
     `postgres` is a superuser here, the apply is refused.
   - **The record.** It records the migration in `supabase_migrations.schema_migrations`.
   - **Data API.** Only `ws` is exposed; `private` never is.
   - **Auth.** Public sign-up is turned off.
   - **The audit.** It then runs the catalogue audit and the advisors.
   - **Refusals.** It refuses if any PROPX object already exists.
4. **Verify the token mechanism.** Run "Private identity — activation check" (`identity-verify.yml`). All 7 checks must
   pass against the real project. If check 4 fails, the project does not accept the server-minted HS256 token. In that case
   **do not weaken anything**: the fallback is only the adapter (see "Two documented choices").
5. **Audit and probe.**
   - `mode = audit` lists, read-only:
     - the catalogue: tables, functions, RLS, every privilege against the allow-list, owners, default privileges;
     - row counts and business-data emptiness;
     - the Supabase security and performance advisors.
   - `mode = probe` runs the two-organization isolation scenario (18 cases) inside one statement that always ends in an
     exception, so nothing is kept. It then proves the tables are still empty.
6. **Revoke the access token.**
7. **Bootstrap, once,** in the SQL editor: `select private.bootstrap('<your email>', '<your name>', '<first team name>');`.
   It returns a one-time activation token (72 h); keep it out of chat and email history.
8. **Vercel environment.** Production scope, server-side only; never use a `NEXT_PUBLIC_` prefix. Set `PROPX_WS_URL`,
   `PROPX_WS_APIKEY`, `PROPX_WS_JWT_SECRET`, and `PROPX_ID_SECRET` (48+ random characters, different from `SESSION_SECRET`).
9. **Turn on the switch** only after the owner has reviewed the report: set `PROPX_IDENTITY=on`, redeploy, and open
   `https://<site>/login.html#invite=<token>`. From that deployment on, the shared password opens nothing: every pilot
   user needs an invitation. A misconfigured switch CLOSES the site (503) — rollback is removing the switch (below).

**Kill switch.** Remove `PROPX_IDENTITY`, or set it to anything other than `on`, then redeploy.

- The site returns to the shared-password gate (PERIMETER).
- The page hides the workspace.
- `/api/identity` answers `{enabled:false}`.
- The private project is not contacted.
- No browser-local state is touched.
- Logout keeps working.

**Future objects start closed.** The migration also revokes the role-wide default privileges of the role that applies it
(no `IN SCHEMA`, the only form that also takes back PostgreSQL's built-in EXECUTE for PUBLIC). Any function, table,
sequence or schema a later migration creates grants nothing until that migration grants it explicitly. A gate proves it
with a probe function, table and sequence.

## Known residuals (accepted for this step)

- **The link holder learns one thing.** It learns whether this invitation created the identity (`needs_activation`),
  and so whether the address already had an account before. The inviter holds the link too.
- **An identity can get stuck.** If the creating workspace revokes the invitation, or is archived, before activation,
  the identity can only be activated after that workspace re-invites it.
- **Anyone who knows an address can keep that account locked.** The lock is per account. In IDENTITY mode the sign-in
  page is public, so 5 failures every 15 minutes (well under the per-client limit) keep it locked. Mitigations: pilot
  addresses are not published, the answer never says whether an address exists, and the administrator's reset link
  clears the lock.
- **An unused invitation or reset link stays in browser history** for its 72 hours. The page strips it from the address
  bar. It is single-use.

## Not in this step

- Evidence, files, ALTARIS, Live Thesis and fund settings.
- Email delivery (invitation and reset links are delivered by the person who created them).
- SSO, multi-factor authentication.
- Self-service "forgot password" (the platform administrator issues the reset link).
- Account self-deletion. Removal is a revocation or a disabled user, never a delete.
