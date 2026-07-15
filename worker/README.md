# worker — splitstupid-data

Cloudflare Worker + D1 backing the SplitStupid frontend
(`splitstupid.lfkdsk.org`). Lives as a subdirectory of the SplitStupid
monorepo so frontend + backend ship from the same commit history.
Replaces the previous "every group is a gist" architecture, which kept
hitting GitHub's gist-API quirks (secret-gist 404s for non-owners, no
concurrent-write story, comments-as-events glue).

All commands below assume you've `cd worker/` first.

```
splitstupid.lfkdsk.org (frontend)
        │
        ▼ POST /auth/github or /auth/apple
api.splitstupid.lfkdsk.org (this worker)
        │  ├─ ─▶ GitHub /user + /user/emails
        │  └─ ─▶ Apple JWKS token verification
        │
        ▼ Authorization: Bearer <splitstupid_session>
api.splitstupid.lfkdsk.org (business routes)
        │
        ▼ SQL
   D1: splitstupid (accounts, identities, groups, members, events)
```

## Routes

Business routes require `Authorization: Bearer <splitstupid_session>`.
Clients receive that app session by exchanging a provider credential through
`/auth/github` or `/auth/apple`; raw GitHub and Apple credentials are not used
as long-lived business API tokens. For rollout safety, legacy clients that
still send a raw GitHub OAuth token to business routes are accepted via
GitHub `/user` only; those requests keep working but do not record email or
participate in Apple email merging until the user signs in through
`/auth/github`.

| Method | Path                       | Body                               | Notes                                            |
|--------|----------------------------|------------------------------------|--------------------------------------------------|
| GET    | `/healthz`                 |                                    | No auth.                                         |
| POST   | `/auth/github`             | `{token}`                          | Exchanges a GitHub OAuth token. Requires verified primary email. |
| POST   | `/auth/apple`              | `{identityToken, fullName?}`       | Verifies the Apple identity token and returns an app session. |
| GET    | `/me`                      |                                    | Current account profile and admin flag.          |
| DELETE | `/me`                      |                                    | Permanently deletes the account, owned groups, authored events, and anonymizes surviving references. |
| GET    | `/groups`                  |                                    | Owned ∪ joined for the auth'd user.              |
| POST   | `/groups`                  | `{name, currency}`                 | Creator becomes owner + sole member.             |
| GET    | `/friends`                 |                                    | Logins you've shared ≥1 group with.              |
| GET    | `/groups/:id`              |                                    | Full group (meta, members, events).              |
| DELETE | `/groups/:id`              |                                    | Owner only. Cascades to members + events.        |
| POST   | `/groups/:id/join`         |                                    | Idempotent self-add to members.                  |
| POST   | `/groups/:id/members`      | `{login}` or `{offlineName}`       | Owner only. `login` must be a prior split-mate; `offlineName` creates/restores a no-login member. |
| DELETE | `/groups/:id/members/:login` |                                  | Owner kicks, or member self-leaves.              |
| POST   | `/groups/:id/events`       | `{type, ...}`                      | Member only. Voids: owner ∨ author. Edits: author only. |
| GET    | `/admin/groups`            |                                    | **Admin only** (`ADMIN_LOGINS`). Every group; 403 otherwise. |
| GET    | `/admin/users`             |                                    | **Admin only** (`ADMIN_LOGINS`). Every login + stats; 403 otherwise. |

`/admin/groups` is a read-only operator overview — every group in the system
with its roster, active-expense count, and finalized state. It's gated on the
`ADMIN_LOGINS` var (comma-separated account keys, emails, or GitHub logins,
compared case-insensitively); a non-admin caller gets a 403. There's no admin
*detail* endpoint: `GET
/groups/:id` already returns full detail for any id regardless of membership,
so the admin UI reuses it.

`/admin/users` is the matching user roster, same `ADMIN_LOGINS` gate. There's
an accounts table for provider identities, but legacy group data is still keyed
by `login`/`account_key`, so the endpoint returns all active account keys with
per-user aggregates: `{ login, owned, memberships, expenseCount, lastActiveAt?,
profile? }`. Group-scoped offline members use `guest:<groupId>:<id>` keys and
are intentionally excluded from `/friends` and `/admin/users`; their display
profiles are returned on group reads through `profiles`.

Event payloads:
```jsonc
// type: "expense"
{
  "type": "expense",
  "payer": "lfkdsk",                    // owner may use a group offline member key
  "amount": 12000,                       // minor units (cents / yen)
  "participants": ["lfkdsk", "alice"],
  "split": "equal",                       // or {alice: 6000, lfkdsk: 6000}
  "note": "dinner"                        // optional
}

// type: "void"
{ "type": "void", "targetId": "<event_id>", "reason": "..." }

// type: "edit" — amend an expense in place (author only). `amount` is the
// new minor-units total, `date` the new effective instant (unix ms).
{ "type": "edit", "targetId": "<expense_id>", "amount": 9000, "date": 1718000000000 }
```

## One-time setup

Same Cloudflare account as `lfkdsk-auth`.

```sh
npm install
npx wrangler login

# Create the D1 database. The output prints a database_id — paste it
# into the [[d1_databases]] block in wrangler.toml.
npx wrangler d1 create splitstupid

# Apply all pending migrations to the live (remote) D1. Wrangler applies the
# migrations/*.sql files in order and records what's done in a d1_migrations
# table, so this same command also ships every later schema change.
npm run db:migrate
# Or for the local dev SQLite copy:
npm run db:migrate:local

# Required before provider login can mint app sessions.
npx wrangler secret put SESSION_SECRET

# Deploy.
npm run deploy
```

## Adding a migration

Drop a new `NNNN_description.sql` into `migrations/` (next number in the
sequence) and run `npm run db:migrate`. Wrangler applies only the files not yet
recorded in `d1_migrations`, in order — nothing to hand-run, nothing to forget.

In the Cloudflare dashboard, add a custom domain route:
`api.splitstupid.lfkdsk.org/*` → this worker. DNS inside the
`lfkdsk.org` zone gets a proxied CNAME automatically.

Verify:
```sh
curl https://api.splitstupid.lfkdsk.org/healthz   # → "splitstupid-data — ok"
```

## Local dev

```sh
npm run dev          # wrangler dev — runs against local SQLite by default
```

Once running, point the frontend at it by overriding `VITE_API_URL`
in `../.env.local` (sibling of this directory, gitignored):

```
VITE_API_URL=http://localhost:8787
```

## Why this exists separately from lfkdsk-auth

`lfkdsk-auth` is a pure stateless OAuth callback shared across every
`*.lfkdsk.org` project — it has no business storing app data. This
worker owns one product's data and one D1 binding, kept apart so the
auth broker stays minimal and reusable.

## Cost

Free-tier Cloudflare Workers + D1 has 100 k req/day, 5 M D1 row
reads/day, 100 k writes/day, and 5 GB storage. SplitStupid's traffic
profile (a few groups, dozens of events per group, a handful of
active users) sits at roughly 0.0001 % of those limits — meaningful
spend would require approximately a million users.
