# PROPX private workspace: identity foundation (STEP 2A)

This directory holds the schema of the **private** Supabase project: named users, organizations, members and server
sessions. It is a different project from the one the public `market` schema (`supabase/migrations/`) is designed for
(decision D1). Nothing public reads it, and nothing in it is public data.

| | |
|---|---|
| **Migration** | `migrations/20261019120000_identity_foundation.sql` (schemas `ws` + `private`, role `propx_auth`) |
| **Test harness** | `test/supabase-roles-shim.sql`. TEST ONLY: the Supabase roles on a throwaway PostgreSQL 16, with deliberately permissive defaults. |
| **Isolation gate** | `test/private-identity.test.js` (28 gates, the HARD BLOCKER) and `test/identity.test.js` (server flows), both run by `.github/workflows/private-identity.yml` on a `postgres:16` service |
| **Server** | `lib/identity/*`, `api/identity.js`, `api/logout.js` |
| **Activation check** | `scripts/identity-verify.js`, also run by `.github/workflows/identity-verify.yml`. Read-only. |
| **Status** | NOT ACTIVATED. Production runs with `PROPX_IDENTITY` unset, so the feature is off. |

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
- **Platform administrator** (the bootstrap user) can list users, disable or re-enable a user, and end all of a user's
  sessions. It refuses to disable the sole active owner of a team that still has other members.

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
| password guessing | 5 failures in a row lock the account for 15 minutes; one answer for unknown email, wrong password and locked account; an unknown email is checked against a dummy scrypt hash |

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
`request.jwt.claims`. That is exactly how the isolation gate exercises the schema. The SQL rules do not move.

`PROPX_WS_JWT_SECRET` is master-equivalent for this project. It lives only in the Vercel server environment, and the
code mints only the two roles above. A unit gate checks this: `service_role`, `anon`, `postgres` and the rest are
refused.

## Activation (owner, by hand — not done yet)

1. **Create a NEW Supabase project.** It must not be the public one. Choose the region closest to the PROPX functions
   (D7). Vercel functions currently run in the default region, because `vercel.json` sets no `regions`.
   - Verify the plan supports a function region.
   - Then set Frankfurt (`fra1`) and the project in `eu-central-1` *together*.
   - Never change the Production region blindly.
2. **Data API.** Set the exposed schemas to `ws` only. Do **not** expose `private`.
3. **Authentication.** Turn off "Allow new users to sign up". PROPX does not use Supabase Auth users.
4. **Apply the migration.** Use the SQL editor, or
   `psql "$PRIVATE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/private/migrations/20261019120000_identity_foundation.sql`.
5. **Bootstrap, once,** in the SQL editor:
   `select private.bootstrap('<your email>', '<your name>', '<first team name>');`
   It returns a one-time activation token. Keep it out of chat and email history.
6. **Set the Vercel environment.** Use the Production scope and server-side variables only; never use a
   `NEXT_PUBLIC_` prefix.

   | Variable | Value |
   |---|---|
   | `PROPX_WS_URL` | the private project URL |
   | `PROPX_WS_APIKEY` | its anon / publishable key |
   | `PROPX_WS_JWT_SECRET` | its JWT secret |
   | `PROPX_ID_SECRET` | 48+ random characters, different from `SESSION_SECRET` |

   Put the first three in GitHub Actions secrets too, for the activation check. Do not set `PROPX_IDENTITY` yet.
7. **Run the activation check.** Run "Private identity — activation check" (`identity-verify.yml`). All 7 checks must
   pass. The isolation workflow must be green on the same commit.
8. **Turn on the switch.** Set `PROPX_IDENTITY=on` and redeploy.
9. **Activate the first account.** Open `https://<site>/#invite=<token>`. The site password comes first, as always.
   Set your name and a password (12+ characters), and you are the OWNER of the first team. Invite others from the
   workspace panel. Each link is shown once, to you, and you deliver it.

**Kill switch.** Remove `PROPX_IDENTITY`, or set it to anything other than `on`, then redeploy.

- The page hides the workspace.
- `/api/identity` answers `{enabled:false}`.
- The private project is not contacted.
- No browser-local state is touched.
- Logout keeps working.

## Not in this step

- Evidence, files, ALTARIS, Live Thesis and fund settings.
- Password reset. Planned: the platform administrator re-issues an activation link.
- Email delivery.
- SSO.
- Per-IP rate limits. The perimeter password already stands in front of every attempt.
- Account self-deletion. Removal is a revocation or a disabled user, never a delete.
