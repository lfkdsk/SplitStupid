# SplitStupid

A Splitwise-shaped expense ledger for friend groups, gated on GitHub
sign-in. Owners create groups, share a QR code, anyone who scans + signs
in joins themselves and starts logging shared expenses; settlement runs
the classic min-cashflow greedy client-side.

## Repo layout

This is a monorepo. Frontend lives at the root, backend Worker in
`worker/`:

```
SplitStupid/
├── src/                  ← React + Vite frontend (splitstupid.lfkdsk.org)
├── public/CNAME
├── .github/workflows/    ← GH Pages deploy on push to master
├── package.json          ← frontend deps
└── worker/               ← Cloudflare Worker + D1 (api.splitstupid.lfkdsk.org)
    ├── src/index.ts
    ├── migrations/0001_init.sql
    ├── wrangler.toml
    └── README.md         ← deploy steps, route table, schema notes
```

The two halves are versioned together — a commit that adds an API route
also adds the UI that uses it. CF Workers Builds (configured to a
`worker/` root directory) and GH Pages run in parallel on each push to
`master`.

## How it works

```
                         splitstupid.lfkdsk.org   (GH Pages, this repo's root)
                                  │
              ┌───────────────────┼─────────────────────┐
              ▼                   ▼                     ▼
  auth.lfkdsk.org/             api.github.com/      api.splitstupid.lfkdsk.org/
  splitstupid/callback         user                 groups, events, members
       │                             ↑                       │
       │ OAuth token exchange         only used to look up   │ D1 (groups,
       │ (no scope requested)         the auth'd login       │  members,
       ▼                                                     ▼  events)
  lfkdsk-auth Worker            (each request hits /user once)
  (separate repo, multi-tenant)
```

- **Frontend** (this repo's root): Vite + React, hash-routed (`#/g/<id>`),
  signs in with GitHub via the `lfkdsk-auth` broker, then talks to the
  backend Worker for everything ledger-related. Settlement is a pure
  function over `(events, members)`, recomputed every render.

- **`worker/`**: Cloudflare Worker fronting a D1 database. Authenticates
  each request by calling GitHub `/user` to resolve the token to a
  login, then enforces ownership / membership against the DB. See
  [`worker/README.md`](worker/README.md) for the route table and
  deploy steps.

- **`lfkdsk-auth`**: a separate, multi-tenant Worker that handles the
  OAuth code → access-token exchange for every `*.lfkdsk.org` project.
  Lives at <https://github.com/lfkdsk/lfkdsk-auth>; SplitStupid is
  registered there as the `splitstupid` project key.

## Data model (D1)

Three tables, see [`worker/migrations/0001_init.sql`](worker/migrations/0001_init.sql):

- `groups (id, name, currency, owner_login, created_at)`
- `members (group_id, login, joined_at)` — PK on `(group_id, login)`,
  indexed by `login` so a joiner can find every group they're in with
  one query.
- `events (id, group_id, type, payload, author_login, ts)` —
  append-only; edits and deletes are `type='void'` rows referencing
  `targetId` in the payload.

Roles are just data (`groups.owner_login`, `members.login`); the
Worker enforces them on writes. Identity comes from the OAuth token
that the Worker resolves via `/user`, so author fields are
trustworthy.

## Develop

Frontend:

```sh
npm install
npm run dev                 # http://localhost:5180
```

Backend (in another terminal, optional — `.env.production` already
points at the deployed Worker, so this is only needed if you're
changing the API):

```sh
cd worker
npm install
npm run dev                 # wrangler dev — local SQLite, http://localhost:8787
```

To make the local frontend talk to your local Worker, drop a
`.env.local` next to `package.json`:

```
VITE_API_URL=http://localhost:8787
```

## Deploy

Two pipelines, both triggered on push to `master`:

1. **GH Pages** for the frontend (this repo's root). Workflow at
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Builds
   with `vite build`, copies `public/CNAME` so Pages serves under
   `splitstupid.lfkdsk.org`.

2. **CF Workers Builds** for the Worker (`worker/` subdir). Configured
   in the Cloudflare dashboard, root_directory = `worker`, deploy
   command = `npx wrangler deploy`. First-time D1 setup is described
   in [`worker/README.md`](worker/README.md).

One-time DNS:

- `splitstupid.lfkdsk.org` → CNAME `lfkdsk.github.io` (DNS-only, no
  proxy — Pages issues its own Let's Encrypt cert).
- `api.splitstupid.lfkdsk.org` → bound to the Worker as a custom
  domain in the CF dashboard (proxy on; CF terminates TLS).

And one-time auth-broker registration:

- In [`lfkdsk-auth`](https://github.com/lfkdsk/lfkdsk-auth)'s
  `wrangler.toml`, `PROJECT_ORIGINS` must contain
  `"splitstupid": "https://splitstupid.lfkdsk.org"` (already there).

## Privacy

The D1 database is single-tenant and not exposed publicly — only the
Worker reads it, and the Worker only returns rows to authenticated
callers. There's no equivalent of "anyone with the gist URL can read"
that bit us in the previous architecture; the share URL is still the
discovery path, but reading the group always goes through the Worker
which checks the bearer token.

If you want a stronger guarantee than "trust the Worker's auth check"
— e.g., zero-knowledge against the Worker operator — bolt on
client-side encryption: encrypt event payloads with a key kept in the
URL fragment, and never send the key to the server. The schema and
flow don't have to change; only `events.payload` becomes ciphertext.

## Why GitHub identity

- No new account, no new password — your friends already have GitHub.
- The Worker doesn't need its own user table; `/user` is the source
  of truth for "who is this token-holder".
- Caveat: your friends need GitHub accounts. If they don't, use
  Splitwise.
