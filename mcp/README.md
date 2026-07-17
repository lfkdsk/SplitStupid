# SplitStupid ChatGPT Connector

This Worker is the first ChatGPT Connector / MCP facade for SplitStupid. It
exposes a Streamable-HTTP-style MCP endpoint at `/mcp`, OAuth metadata for
ChatGPT linking, and three tools:

- `list_groups`
- `get_group`
- `record_expense`

The connector does not replace the main SplitStupid API. It authenticates the
ChatGPT connector session, then calls `api.splitstupid.lfkdsk.org` with a
regular SplitStupid app-session token. Business rules stay enforced by the
existing Worker.

## Local Development

```sh
cd mcp
npm install
npm run dev
```

Set these secrets before a real ChatGPT connection:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put TOKEN_SECRET
```

Set `GITHUB_CLIENT_ID` and `CONNECTOR_ORIGIN` in `wrangler.toml`. The GitHub
OAuth app callback URL must be:

```text
https://mcp.splitstupid.lfkdsk.org/oauth/github/callback
```

For tunnel-based development, change `CONNECTOR_ORIGIN` to the tunnel origin
and use that same callback URL in a temporary GitHub OAuth app.

## ChatGPT Setup

In ChatGPT Web:

```text
Settings -> Apps & Connectors -> Advanced settings -> Developer mode -> Create
```

Use:

```text
Connector URL: https://mcp.splitstupid.lfkdsk.org/mcp
```

ChatGPT discovers OAuth metadata from:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
```

## Auth Model

The OAuth authorization flow redirects to GitHub, exchanges the GitHub code for
a GitHub access token, then exchanges that token with the existing SplitStupid
`/auth/github` endpoint. The connector mints encrypted access and refresh
tokens for ChatGPT. These tokens contain the SplitStupid app-session token but
are encrypted with `TOKEN_SECRET`.

Token defaults:

- access token: 30 minutes
- refresh token: 90 days

`/oauth/revoke` currently acknowledges revocation for connector compatibility;
stateless tokens remain invalidated by expiry or by rotating `TOKEN_SECRET`.
Add KV/D1-backed token identifiers before exposing this as a broad public
connector.

## Tool Behavior

`record_expense` records equal-split expenses only:

```json
{
  "groupId": "abc123",
  "amount": 12800,
  "participants": ["github:123", "github:456"],
  "note": "sushi dinner",
  "date": 1783180800000
}
```

`amount` is in minor units. `date` is optional unix milliseconds and is sent as
the existing expense `ts` backdate field.
