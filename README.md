# SplitStupid

A Splitwise-shaped expense ledger that lives in a GitHub Gist. No
backend, no database — every group is one public gist owned by the
group's organiser, members are just GitHub logins, and the URL is the
share link.

## How it works

```
   ┌──────────────────────┐
   │ splitstupid.lfkdsk.. │
   └──────────────────────┘
              │
              ▼ Sign in with GitHub
       auth.lfkdsk.org/splitstupid/callback        ← lfkdsk-auth Worker
              │
              ▼ #oauth_token=…
       splitstupid.lfkdsk.org
              │
              ▼ user's token (gist scope)
        api.github.com/gists/…                     ← one gist per group
```

Each group is a single public Gist whose `ledger.json` looks like:

```json
{
  "version": 1,
  "kind": "splitstupid.ledger",
  "name": "Tokyo trip",
  "currency": "JPY",
  "owner": "lfkdsk",
  "members": ["lfkdsk", "alice", "bob"],
  "events": [
    { "id": "e_…", "type": "expense", "ts": "…",
      "author": "lfkdsk", "payer": "lfkdsk",
      "amount": 12000, "participants": ["lfkdsk","alice","bob"],
      "split": "equal", "note": "晚饭" }
  ]
}
```

Edits and deletes are recorded as `{ "type": "void", "targetId": "…" }`
events so the gist stays append-only and `git log` is the audit trail.

The settle view runs the classic min-cashflow greedy on the in-memory
event list every render — pure function, zero state.

## Roles

`role` is just data, not a GitHub permission:

- **Owner**: gist owner (member 0). Can write `ledger.json` directly.
- **Member**: anyone in `members[]`. In v1 the owner records on
  everyone's behalf. (The `comments.ts` extension point lets non-owners
  POST gist comments containing `splitstupid-event` JSON blocks; the
  owner periodically compacts those into `ledger.json`. Not wired into
  the UI yet.)
- **Viewer**: any signed-in GitHub user with the gist URL who isn't in
  the member list. Renders fine; can't mutate.

Identity comes from the OAuth token (`/user.login`), so authorship
inside the file is trustworthy as far as GitHub's account boundary goes.

## Privacy

We use **public** gists, not secret ones. Counterintuitive but
necessary: GitHub's REST API only lets the gist's owner read a secret
gist (`GET /gists/{id}` 404s for everyone else, even if they have the
id). For a friend who scans the share QR to actually load the ledger,
the gist has to be public.

The trade-off: public gists are listed on the owner's profile at
`gist.github.com/<owner>` — a casual visitor can see "this user has
expense groups". The contents of any specific group are still gated
on knowing the gist id (random, unguessable) — the share URL hash is
still the access capability for direct loads. Treat the discoverable
*existence* as the privacy cost.

Not for sensitive ledgers. Bolt on client-side encryption (key in URL
fragment) if you need real privacy — the structure stays the same;
only the `events` payload becomes ciphertext.

## Develop

```sh
npm install
npm run dev          # http://localhost:5180
```

Note: OAuth callback returns to `https://splitstupid.lfkdsk.org`
unconditionally (the broker's `PROJECT_ORIGINS` allowlist is by
project key, not by environment). Local dev can read existing gists
with a manually-stashed token, but the full sign-in round-trip only
works on the deployed origin.

## Deploy

GitHub Pages, custom domain, set up by `.github/workflows/deploy.yml`.
On push to `master`:

1. Workflow builds with Node 20 and `vite build`.
2. `public/CNAME` (containing `splitstupid.lfkdsk.org`) is copied into
   `dist/` so Pages serves under the custom domain.
3. `actions/deploy-pages@v4` publishes `dist/` to the `github-pages`
   environment.

One-time setup:

- **Repo settings** → Pages → Source: "GitHub Actions".
- **DNS** (in the lfkdsk.org zone): `splitstupid` CNAME →
  `lfkdsk.github.io`. DNS-only (no proxy) so Pages can issue a Let's
  Encrypt cert.
- **OAuth broker** ([lfkdsk-auth](https://github.com/lfkdsk/lfkdsk-auth)
  `wrangler.toml`): make sure `splitstupid` is in `PROJECT_ORIGINS`.

## Why GitHub instead of Splitwise

- The data is yours and lives in your GitHub.
- `git log` is a free audit trail; revert is a free undo.
- No new account, no new password — your friends already have GitHub.
- Caveat: your friends need GitHub. If they don't, use Splitwise.
