# PROPX Enterprise pilot: release and rollback runbook

Release candidate: the head of `claude/street-report-preview` that the founder approves. The release report records the SHA
that was tested. Production is `claude/vizora-project-isolation-6lbq3g` and serves `propx.live` and `kobix.online`.

**Nothing in this runbook runs without the founder's explicit approval.** No step buys a service.

The release is staged so that each stage can be undone on its own:

1. Ship the code with identity off. Access is unchanged: the shared password.
2. Activate the private Supabase project. The site does not change.
3. Turn identity on for the Preview deployment only.
4. Turn identity on for Production.

## Before anything

- [ ] The founder approves the candidate SHA.
- [ ] Record the current Production deployment in Vercel: Project → Deployments → the one marked **Production** (its URL and
      id). This is the rollback target.
- [ ] Record the current head of the production branch.
- [ ] Check the Vercel deployment allowance for the day. Every bot data commit also builds a deployment, so a release day
      should start with room for several more.

## Stage 1: the code, identity off

1. **Merge** `claude/street-report-preview` into `claude/vizora-project-isolation-6lbq3g`.
   - Use a merge commit. Never force-push the production branch.
   - Conflicts can only be bot-written data files, because the preview lane already contains every production commit up to
     the release check. Resolve them as follows:

     | File | Resolution |
     |---|---|
     | `*runs.jsonl`, `sync-runs.jsonl` and other run logs | keep both lanes' lines, in start order |
     | `latest.json` / `latest.js` snapshots | take the newer read, or the read whose code requests more series |
     | `data/radar/*` | rebuild with `node scripts/radar-build.js` |

2. **Wait** for Vercel to report the Production deployment as successful.
3. **Probe.** Run "Production smoke (read-only)" for `https://propx.live` and then for `https://kobix.online`, and
   "Release readiness (read-only)". Expected results:
   - the sign-in mode is `perimeter`;
   - `/login.html` and `/robots.txt` answer 200;
   - every page, API path and data file answers 302 to `/login.html`.
4. **Check in a browser** with the shared password, in Hebrew and English, on desktop and phone:
   - the launchpad under the search;
   - a street report, for example הרצל, פתח תקווה: investment summary → latest transactions → valuation → planning →
     risks;
   - the transactions freshness line;
   - the Trust Center.
5. **Watch the new scheduled workflows.** The default branch now carries these, and they start on their schedules:

   | Workflow | Schedule (UTC) |
   |---|---|
   | `finance-sync` | 05:41, Sunday–Thursday |
   | `reference-sync` | Monday 04:23 |
   | `transport-sync` | Tuesday 04:37 |
   | `surroundings-sync` | Tuesday 05:17 |
   | `vatmal-sync` | Tuesday 05:47 |

   Check each one's first run.

## Stage 2: the private Supabase project (the site does not change)

6. **GitHub Actions secrets.** Add them in Settings → Secrets and variables → Actions. Never paste them in chat.

   | Secret | Notes |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | create it for this activation only; it is revoked in step 8 |
   | `PROPX_WS_URL` | `https://<ref>.supabase.co` of the project `propx-private` (eu-central-1) |
   | `PROPX_WS_APIKEY` | |
   | `PROPX_WS_JWT_SECRET` | |
   | `SUPABASE_URL` | optional: the public project, so the preflight can prove it is a different one |

7. **Activate.** Run "Private identity — real-project activation" four times, in this order:
   - `preflight`;
   - `apply`, with `confirm_ref` set to the fingerprint the preflight printed;
   - `audit`;
   - `probe`.

   Then run "Private identity — activation check". All 7 checks must pass.
8. **Revoke** `SUPABASE_ACCESS_TOKEN` in Supabase, and delete the GitHub secret.
9. **Bootstrap the founder** in the Supabase SQL editor:

   ```sql
   select private.bootstrap('<founder email>', '<name>', '<team>');
   ```

   It returns a one-time token that is valid for 72 hours. Keep it out of chat and email.

## Stage 3: identity on the Preview deployment first

10. **Vercel environment, Preview scope only, server-side.** Never use a `NEXT_PUBLIC_` prefix.

    | Variable | Value |
    |---|---|
    | `PROPX_WS_URL` | as in step 6 |
    | `PROPX_WS_APIKEY` | as in step 6 |
    | `PROPX_WS_JWT_SECRET` | as in step 6 |
    | `PROPX_ID_SECRET` | 48 or more random characters, different from `SESSION_SECRET` |
    | `PROPX_IDENTITY` | `on` |

    Redeploy the Preview deployment.
11. **Test on the Preview deployment.** Preview and Production share the one private store, so the accounts made here are
    the pilot accounts.
    1. Open `<preview>/login.html#invite=<token>` and activate the founder.
    2. Invite a test analyst and activate that account from another browser. Then check:
       - the analyst cannot invite;
       - a reset link works, and ends the analyst's sessions;
       - a password change ends the founder's other sessions;
       - sign-out returns to the sign-in page.
    3. "Release readiness" must report `identity` for the preview origin, with every path answering 302.

## Stage 4: identity on Production

12. **Turn it on.** Set the same five variables in the Production scope, then redeploy Production. This uses one deployment.
13. **Probe.** "Release readiness" must report `identity` for both domains, with every path answering 302. The shared
    password must answer `individual_login_required`.
14. **Bring in the pilot users.**
    - The founder signs in at `https://propx.live/login.html` and invites each pilot user.
    - Each link is delivered out of band and works once.
    - Identities that another admin creates wait for the founder's approval.
15. **Rotate** `SITE_PASSWORD`. It opens nothing in identity mode, but rotating it is good hygiene.

## Rollback

| Situation | Action | Effect |
|---|---|---|
| The release misbehaves (Stage 1) | Vercel → Deployments → the recorded deployment → **Instant Rollback**. Then `git revert -m 1 <merge>` on the production branch, so the next bot-triggered build does not bring the release back. | Seconds, no rebuild. Vercel stops auto-promoting new Production builds until the rollback is undone; undo it only after the revert. |
| Identity misbehaves (Stage 3 or 4) | Remove `PROPX_IDENTITY`, or set it to anything but `on`, in that scope. Redeploy. | The site returns to the shared-password gate. Accounts and sessions stay in the private store, untouched. |
| Identity is on but misconfigured | Every gated path answers 503 (closed, never open). Fix the variable or apply the row above. | — |
| The private store does not answer | A session the gate saw live in the last 10 minutes keeps working. After that the site answers 503. Apply the identity row above if the outage lasts. | — |
| Data | Nothing to undo. The release changes no stored data format, and the bot ledgers are append-only. | — |
