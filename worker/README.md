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
        ▼ Authorization: Bearer <gh_oauth_token>
api.splitstupid.lfkdsk.org (this worker)
        │  ├─ ─▶ GitHub /user (auth: token → login)
        │
        ▼ SQL
   D1: splitstupid (groups, members, events)
```

## Routes

All except `/healthz` and the two `/auth/magic/*` routes require
`Authorization: Bearer <token>`, where `<token>` is either:

- a GitHub OAuth token (any scope, even no scope — we resolve identity
  via GitHub's `/user` endpoint), or
- a magic-link session token of the form `mls_<48-hex>`, issued by
  `POST /auth/magic/verify`. Resolved against the local `sessions`
  table.

| Method | Path                       | Body                | Notes                                            |
|--------|----------------------------|---------------------|--------------------------------------------------|
| GET    | `/healthz`                 |                     | No auth.                                         |
| POST   | `/auth/magic/request`      | `{email}`           | No auth. Always 200, even on unknown email (no enumeration). Requires `RESEND_API_KEY`. |
| POST   | `/auth/magic/verify`       | `{token}`           | No auth. Trades a magic token for a session token. |
| GET    | `/auth/me`                 |                     | `{login, kind, displayName, avatarUrl?}` for the auth'd caller. |
| POST   | `/auth/signout`            |                     | No-op for GH tokens; revokes the row for `mls_…`. |
| GET    | `/groups`                  |                     | Owned ∪ joined for the auth'd user.              |
| POST   | `/groups`                  | `{name, currency}`  | Creator becomes owner + sole member.             |
| GET    | `/groups/:id`              |                     | Full group (meta, members, events).              |
| DELETE | `/groups/:id`              |                     | Owner only. Cascades to members + events.        |
| POST   | `/groups/:id/join`         |                     | Idempotent self-add to members.                  |
| POST   | `/groups/:id/finalize`     |                     | Owner only. Locks the ledger.                    |
| DELETE | `/groups/:id/finalize`     |                     | Owner only. Reopens a locked ledger.             |
| DELETE | `/groups/:id/members/:login` |                  | Owner kicks anyone, member self-leaves.          |
| POST   | `/groups/:id/events`       | `{type, ...}`       | Member only. Voids gated on (owner ∨ author).    |

Event payloads:
```jsonc
// type: "expense"
{
  "type": "expense",
  "payer": "lfkdsk",
  "amount": 12000,                       // minor units (cents / yen)
  "participants": ["lfkdsk", "alice"],
  "split": "equal",                       // or {alice: 6000, lfkdsk: 6000}
  "note": "dinner"                        // optional
}

// type: "void"
{ "type": "void", "targetId": "<event_id>", "reason": "..." }
```

## One-time setup

Same Cloudflare account as `lfkdsk-auth`.

```sh
npm install
npx wrangler login

# Create the D1 database. The output prints a database_id — paste it
# into the [[d1_databases]] block in wrangler.toml.
npx wrangler d1 create splitstupid

# Apply the schema to the live (remote) D1.
npm run db:init
# Or for local dev SQLite:
npm run db:init:local

# Apply the magic-link migration (sessions + magic_tokens tables).
npm run db:migrate:magic
# Local equivalent:
npm run db:migrate:magic:local

# Provision the Resend API key (required for /auth/magic/* — without
# it the endpoint returns 503 and the frontend hides the email form).
npx wrangler secret put RESEND_API_KEY

# Deploy.
npm run deploy
```

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
