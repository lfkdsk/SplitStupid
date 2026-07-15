// SplitStupid backend Worker.
// =========================================================================
// One Cloudflare Worker + one D1 database. Replaces the previous "store
// every group as a public gist" scheme — gists' API surface had too many
// quirks (secret-gist 404s for non-owners, comments-as-events glue, no
// concurrent-write story) for what's fundamentally a tiny CRUD app.
//
// Auth model: clients exchange provider credentials (GitHub OAuth token or
// Apple identity token) for a SplitStupid app-session token at /auth/*.
// Business routes trust only that app session. GitHub's verified primary
// email and Apple's verified non-relay email are used to merge identities.
//
// Routing is hand-rolled (no router framework) since there are only 8
// endpoints. URL.pathname + method.

interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  // HMAC secret for SplitStupid app-session tokens. Set with
  // `wrangler secret put SESSION_SECRET` in production.
  SESSION_SECRET: string
  // Defaults to the iOS bundle id. Kept configurable for local tests.
  APPLE_AUDIENCE?: string
  // Comma-separated account keys, emails, or GH logins allowed to hit admin.
  // The real access boundary lives here on the server — the frontend only
  // uses its own copy to decide whether to show the Admin link.
  ADMIN_LOGINS: string
}

// ---------------------------------------------------------------------------
// Entry point + CORS shell

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('origin')
    const allowedOrigin = pickAllowedOrigin(origin, env)

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) })
    }

    try {
      const res = await route(request, env, ctx)
      // Patch CORS headers onto whatever the route returned.
      const merged = new Headers(res.headers)
      for (const [k, v] of Object.entries(corsHeaders(allowedOrigin))) merged.set(k, v)
      return new Response(res.body, { status: res.status, headers: merged })
    } catch (err: any) {
      return jsonError(500, err?.message || 'internal error', allowedOrigin)
    }
  },
}

function pickAllowedOrigin(origin: string | null, env: Env): string {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (origin && allowed.includes(origin)) return origin
  // Fall back to the first allowed origin for non-browser clients (curl,
  // healthchecks). Browsers never send a non-allowed Origin and pass.
  return allowed[0] || '*'
}

function corsHeaders(origin: string): HeadersInit {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    'vary': 'origin',
  }
}

function jsonError(status: number, message: string, origin: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Router

async function route(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // Health check, no auth.
  if (path === '/' || path === '/healthz') {
    return new Response('splitstupid-data — ok\n', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  if (path === '/auth/github' && method === 'POST') {
    return await authGitHub(env, await request.json())
  }
  if (path === '/auth/apple' && method === 'POST') {
    return await authApple(env, await request.json())
  }

  // Public invite preview, no auth — used by the share-link landing
  // page to render "<owner> invited you to join <group>" before the
  // visitor signs in. Only exposes name / owner / currency / member
  // count / finalized — no member list, no events.
  const inviteMatch = path.match(/^\/groups\/([A-Za-z0-9]+)\/invite$/)
  if (inviteMatch && method === 'GET') {
    return await readInvite(env, inviteMatch[1])
  }

  // Everything else needs an authenticated SplitStupid account.
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const me = auth.accountKey

  if (path === '/me') {
    if (method === 'GET') return json(mePayload(auth, isAdmin(auth, env)))
    if (method === 'DELETE') return await deleteAccount(env, me)
    return new Response('method not allowed', { status: 405 })
  }

  // GET    /groups
  // POST   /groups
  if (path === '/groups') {
    if (method === 'GET') return await listGroups(env, me)
    if (method === 'POST') return await createGroup(env, me, await request.json())
    return new Response('method not allowed', { status: 405 })
  }

  // GET /friends — logins you've shared at least one group with.
  if (path === '/friends') {
    if (method === 'GET') return await listFriends(env, me)
    return new Response('method not allowed', { status: 405 })
  }

  // Read-only admin surface. Gated on ADMIN_LOGINS — a non-admin gets a 403
  // (not a 404) so the route's existence isn't a secret; only its data is.
  if (path === '/admin/groups') {
    if (method !== 'GET') return new Response('method not allowed', { status: 405 })
    if (!isAdmin(auth, env)) return json({ error: 'admin only' }, 403)
    return await listAllGroups(env)
  }

  // Read-only admin roster: every distinct login in the system with light
  // per-user stats. Same ADMIN_LOGINS gate as /admin/groups.
  if (path === '/admin/users') {
    if (method !== 'GET') return new Response('method not allowed', { status: 405 })
    if (!isAdmin(auth, env)) return json({ error: 'admin only' }, 403)
    return await listAllUsers(env)
  }

  // /groups/:id ...
  const groupMatch = path.match(/^\/groups\/([A-Za-z0-9]+)(?:\/(.*))?$/)
  if (groupMatch) {
    const groupId = groupMatch[1]
    const rest = groupMatch[2] || ''

    if (rest === '') {
      if (method === 'GET') return await readGroup(env, me, groupId)
      if (method === 'DELETE') return await deleteGroup(env, me, groupId)
      return new Response('method not allowed', { status: 405 })
    }

    if (rest === 'join' && method === 'POST') return await joinGroup(env, me, groupId)

    if (rest === 'finalize') {
      if (method === 'POST') return await finalizeGroup(env, me, groupId)
      if (method === 'DELETE') return await reopenGroup(env, me, groupId)
      return new Response('method not allowed', { status: 405 })
    }

    if (rest === 'events' && method === 'POST') {
      return await postEvent(env, me, groupId, await request.json())
    }

    // POST /groups/:id/members — owner pulls in a past split-mate.
    if (rest === 'members' && method === 'POST') {
      return await addMember(env, me, groupId, await request.json())
    }

    // /groups/:id/members/:login
    const memberMatch = rest.match(/^members\/([^/]+)$/)
    if (memberMatch && method === 'DELETE') {
      return await removeMember(env, me, groupId, decodeURIComponent(memberMatch[1]))
    }
  }

  return new Response('not found', { status: 404 })
}

// ---------------------------------------------------------------------------
// Auth

interface AuthAccount {
  accountKey: string
  displayName: string
  avatarUrl?: string
  email?: string
  provider?: 'github' | 'apple'
  providerLogin?: string
}

interface GitHubIdentity {
  provider: 'github'
  providerUserId: string
  login: string
  email: string
  displayName: string
  avatarUrl?: string
}

interface GitHubUserIdentity {
  provider: 'github'
  providerUserId: string
  login: string
  displayName: string
  avatarUrl?: string
}

interface AppleIdentity {
  provider: 'apple'
  providerUserId: string
  email?: string
  isPrivateRelay: boolean
  displayName?: string
}

async function authGitHub(env: Env, body: any): Promise<Response> {
  const rawToken = stringField(body?.token, 'token', 1, 5000)
  if (typeof rawToken !== 'string') return rawToken
  const identity = await resolveGitHubIdentity(rawToken)
  if (identity instanceof Response) return identity
  const account = await provisionGitHubAccount(env, identity)
  const token = await signSession(env, account.accountKey)
  return json({ token, me: mePayload(account, isAdmin(account, env)) })
}

async function authApple(env: Env, body: any): Promise<Response> {
  const identityToken = stringField(body?.identityToken, 'identityToken', 1, 10000)
  if (typeof identityToken !== 'string') return identityToken
  const fullName = typeof body?.fullName === 'string' && body.fullName.trim()
    ? body.fullName.trim()
    : undefined
  const identity = await verifyAppleIdentityToken(env, identityToken, fullName)
  if (identity instanceof Response) return identity
  const account = await provisionAppleAccount(env, identity)
  const token = await signSession(env, account.accountKey)
  return json({ token, me: mePayload(account, isAdmin(account, env)) })
}

async function authenticate(request: Request, env: Env): Promise<AuthAccount | Response> {
  const auth = request.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing bearer token' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })
  }
  const token = auth.slice('Bearer '.length).trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'empty bearer token' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })
  }

  const session = await verifySession(env, token)
  if (!(session instanceof Response)) return session

  // Compatibility path for old clients that still send a raw GitHub token
  // directly to business routes. Old OAuth tokens may not have user:email, so
  // keep them working by resolving only /user and defer email merge until the
  // user signs in through /auth/github with the new scope.
  const identity = await resolveGitHubUser(token)
  if (identity instanceof Response) return session
  return await provisionLegacyGitHubAccount(env, identity)
}

async function resolveGitHubIdentity(token: string): Promise<GitHubIdentity | Response> {
  const user = await resolveGitHubUser(token)
  if (user instanceof Response) return user

  const emailResp = await fetch('https://api.github.com/user/emails', {
    headers: {
      'authorization': `Bearer ${token}`,
      'accept': 'application/vnd.github+json',
      'user-agent': 'splitstupid-data',
    },
  })
  if (emailResp.status === 403 || emailResp.status === 404) {
    return json({ error: 'GitHub email permission missing. Sign in again and grant email access.' }, 401)
  }
  if (!emailResp.ok) {
    return json({ error: 'GitHub email lookup failed' }, 502)
  }
  const emails = await emailResp.json() as Array<{ email?: string; primary?: boolean; verified?: boolean }>
  const primary = emails.find(e => e.primary && e.verified && e.email)
  if (!primary?.email) {
    return json({ error: 'GitHub account needs a verified primary email to sign in.' }, 403)
  }
  return {
    ...user,
    email: normalizeEmail(primary.email),
  }
}

async function resolveGitHubUser(token: string): Promise<GitHubUserIdentity | Response> {
  let userResp: Response
  try {
    userResp = await fetch('https://api.github.com/user', {
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'user-agent': 'splitstupid-data',
      },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'github unreachable: ' + (e?.message || e) }), {
      status: 502, headers: { 'content-type': 'application/json' },
    })
  }

  if (!userResp.ok) {
    return new Response(JSON.stringify({ error: 'github rejected token' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })
  }
  const user = await userResp.json() as { id?: number; login?: string; avatar_url?: string; name?: string | null }
  if (!user.id || !user.login) {
    return new Response(JSON.stringify({ error: 'github returned no login' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    })
  }
  return {
    provider: 'github',
    providerUserId: String(user.id),
    login: user.login,
    displayName: user.login,
    avatarUrl: user.avatar_url,
  }
}

async function provisionLegacyGitHubAccount(env: Env, identity: GitHubUserIdentity): Promise<AuthAccount> {
  const accountKey = identity.login
  await upsertAccount(env, {
    accountKey,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    provider: 'github',
    providerLogin: identity.login,
  })
  await upsertIdentity(env, {
    provider: 'github',
    providerUserId: identity.providerUserId,
    accountKey,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    providerLogin: identity.login,
  })
  return {
    accountKey,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    provider: 'github',
    providerLogin: identity.login,
  }
}

async function provisionGitHubAccount(env: Env, identity: GitHubIdentity): Promise<AuthAccount> {
  const existingByEmail = await accountByEmail(env, identity.email)
  const accountKey = identity.login
  if (existingByEmail && existingByEmail.accountKey !== accountKey) {
    await upsertAccount(env, {
      accountKey,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      provider: 'github',
      providerLogin: identity.login,
    })
    await mergeAccountKeys(env, existingByEmail.accountKey, accountKey)
  }
  await upsertAccount(env, {
    accountKey,
    email: identity.email,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    provider: 'github',
    providerLogin: identity.login,
  })
  await upsertIdentity(env, {
    provider: 'github',
    providerUserId: identity.providerUserId,
    accountKey,
    email: identity.email,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    providerLogin: identity.login,
  })
  return {
    accountKey,
    email: identity.email,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    provider: 'github',
    providerLogin: identity.login,
  }
}

async function provisionAppleAccount(env: Env, identity: AppleIdentity): Promise<AuthAccount> {
  const emailForMerge = identity.email && !identity.isPrivateRelay ? identity.email : undefined
  const existingByIdentity = await accountByIdentity(env, 'apple', identity.providerUserId)
  const existingByEmail = emailForMerge ? await accountByEmail(env, emailForMerge) : null
  const fallbackKey = `apple:${await shortHash(identity.providerUserId)}`
  let accountKey = existingByIdentity?.accountKey || existingByEmail?.accountKey || fallbackKey

  if (existingByIdentity && existingByEmail && existingByIdentity.accountKey !== existingByEmail.accountKey) {
    await mergeAccountKeys(env, existingByIdentity.accountKey, existingByEmail.accountKey)
    accountKey = existingByEmail.accountKey
  }

  const displayName = identity.displayName || existingByEmail?.displayName || existingByIdentity?.displayName || 'Apple User'
  await upsertAccount(env, {
    accountKey,
    email: emailForMerge ?? existingByEmail?.email,
    displayName,
    avatarUrl: existingByEmail?.avatarUrl || existingByIdentity?.avatarUrl,
    provider: existingByEmail?.provider || 'apple',
    providerLogin: existingByEmail?.providerLogin,
  })
  await upsertIdentity(env, {
    provider: 'apple',
    providerUserId: identity.providerUserId,
    accountKey,
    email: identity.email,
    displayName,
  })
  return {
    accountKey,
    email: emailForMerge ?? existingByEmail?.email,
    displayName,
    avatarUrl: existingByEmail?.avatarUrl || existingByIdentity?.avatarUrl,
    provider: existingByEmail?.provider || 'apple',
    providerLogin: existingByEmail?.providerLogin,
  }
}

async function accountByEmail(env: Env, email: string): Promise<AuthAccount | null> {
  const row = await env.DB.prepare(
    `SELECT account_key, email, display_name, avatar_url, primary_provider, provider_login
     FROM accounts WHERE email = ? LIMIT 1`,
  ).bind(normalizeEmail(email)).first<AccountRow>()
  return row ? accountFromRow(row) : null
}

async function accountByIdentity(env: Env, provider: string, providerUserId: string): Promise<AuthAccount | null> {
  const row = await env.DB.prepare(
    `SELECT a.account_key, a.email, a.display_name, a.avatar_url, a.primary_provider, a.provider_login
     FROM identities i JOIN accounts a ON a.account_key = i.account_key
     WHERE i.provider = ? AND i.provider_user_id = ? LIMIT 1`,
  ).bind(provider, providerUserId).first<AccountRow>()
  return row ? accountFromRow(row) : null
}

async function upsertAccount(env: Env, account: AuthAccount): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO accounts (account_key, email, display_name, avatar_url, primary_provider, provider_login, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(account_key) DO UPDATE SET
       email = COALESCE(excluded.email, accounts.email),
       display_name = excluded.display_name,
       avatar_url = COALESCE(excluded.avatar_url, accounts.avatar_url),
       primary_provider = COALESCE(excluded.primary_provider, accounts.primary_provider),
       provider_login = COALESCE(excluded.provider_login, accounts.provider_login),
       updated_at = excluded.updated_at`,
  ).bind(
    account.accountKey,
    account.email ? normalizeEmail(account.email) : null,
    account.displayName,
    account.avatarUrl ?? null,
    account.provider ?? null,
    account.providerLogin ?? null,
    now,
  ).run()
}

async function upsertIdentity(env: Env, input: {
  provider: 'github' | 'apple'
  providerUserId: string
  accountKey: string
  email?: string
  displayName?: string
  avatarUrl?: string
  providerLogin?: string
}): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO identities (provider, provider_user_id, account_key, email, display_name, avatar_url, provider_login, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       account_key = excluded.account_key,
       email = excluded.email,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       provider_login = excluded.provider_login,
       updated_at = excluded.updated_at`,
  ).bind(
    input.provider,
    input.providerUserId,
    input.accountKey,
    input.email ? normalizeEmail(input.email) : null,
    input.displayName ?? null,
    input.avatarUrl ?? null,
    input.providerLogin ?? null,
    now,
  ).run()
}

interface AccountRow {
  account_key: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  primary_provider: string | null
  provider_login: string | null
}

function accountFromRow(row: AccountRow): AuthAccount {
  return {
    accountKey: row.account_key,
    email: row.email ?? undefined,
    displayName: row.display_name || row.provider_login || row.account_key,
    avatarUrl: row.avatar_url ?? undefined,
    provider: row.primary_provider === 'github' || row.primary_provider === 'apple' ? row.primary_provider : undefined,
    providerLogin: row.provider_login ?? undefined,
  }
}

function mePayload(account: AuthAccount, isAdminUser?: boolean) {
  return {
    key: account.accountKey,
    login: account.accountKey,
    kind: 'account',
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    avatar: account.avatarUrl,
    email: account.email,
    provider: account.provider,
    providerLogin: account.providerLogin,
    isAdmin: isAdminUser || undefined,
  }
}

async function signSession(env: Env, accountKey: string): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured')
  const header = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT' })
  const payload = base64UrlEncodeJson({
    sub: accountKey,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })
  const data = `${header}.${payload}`
  const sig = await hmacSha256(env.SESSION_SECRET, data)
  return `${data}.${base64UrlEncode(sig)}`
}

async function verifySession(env: Env, token: string): Promise<AuthAccount | Response> {
  if (!env.SESSION_SECRET) {
    return json({ error: 'SESSION_SECRET is not configured' }, 500)
  }
  const clean = token.startsWith('ss1:') ? token.slice('ss1:'.length) : token
  const parts = clean.split('.')
  if (parts.length !== 3) return json({ error: 'invalid session token' }, 401)
  const [header, payload, sig] = parts
  const expected = base64UrlEncode(await hmacSha256(env.SESSION_SECRET, `${header}.${payload}`))
  if (!constantTimeEqual(sig, expected)) return json({ error: 'invalid session token' }, 401)

  let body: { sub?: string; exp?: number }
  try {
    body = JSON.parse(utf8Decode(base64UrlDecode(payload)))
  } catch {
    return json({ error: 'invalid session token' }, 401)
  }
  if (!body.sub || !body.exp || body.exp < Math.floor(Date.now() / 1000)) {
    return json({ error: 'session expired' }, 401)
  }

  const row = await env.DB.prepare(
    `SELECT account_key, email, display_name, avatar_url, primary_provider, provider_login
     FROM accounts WHERE account_key = ? LIMIT 1`,
  ).bind(body.sub).first<AccountRow>()
  if (row) return accountFromRow(row)

  return json({ error: 'session account no longer exists' }, 401)
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8Encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8Encode(data)))
}

async function verifyAppleIdentityToken(env: Env, token: string, fullName?: string): Promise<AppleIdentity | Response> {
  const parts = token.split('.')
  if (parts.length !== 3) return json({ error: 'invalid Apple identity token' }, 401)
  let header: { kid?: string; alg?: string }
  let claims: {
    iss?: string
    aud?: string
    exp?: number
    sub?: string
    email?: string
    email_verified?: string | boolean
    is_private_email?: string | boolean
  }
  try {
    header = JSON.parse(utf8Decode(base64UrlDecode(parts[0])))
    claims = JSON.parse(utf8Decode(base64UrlDecode(parts[1])))
  } catch {
    return json({ error: 'invalid Apple identity token' }, 401)
  }

  if (header.alg !== 'RS256' || !header.kid) return json({ error: 'invalid Apple token header' }, 401)
  if (claims.iss !== 'https://appleid.apple.com') return json({ error: 'invalid Apple token issuer' }, 401)
  const expectedAudience = env.APPLE_AUDIENCE || 'org.lfkdsk.splitstupid'
  if (claims.aud !== expectedAudience) return json({ error: 'invalid Apple token audience' }, 401)
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return json({ error: 'Apple token expired' }, 401)
  if (!claims.sub) return json({ error: 'Apple token missing subject' }, 401)

  const key = await fetchAppleJwk(header.kid)
  if (key instanceof Response) return key
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key as unknown as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    base64UrlDecode(parts[2]),
    utf8Encode(`${parts[0]}.${parts[1]}`),
  )
  if (!ok) return json({ error: 'Apple token signature invalid' }, 401)

  const verified = claims.email_verified === true || claims.email_verified === 'true'
  const email = verified && claims.email ? normalizeEmail(claims.email) : undefined
  const isPrivateRelay = !!email && (
    email.endsWith('@privaterelay.appleid.com') ||
    claims.is_private_email === true ||
    claims.is_private_email === 'true'
  )
  return {
    provider: 'apple',
    providerUserId: claims.sub,
    email,
    isPrivateRelay,
    displayName: fullName,
  }
}

async function fetchAppleJwk(kid: string): Promise<Record<string, unknown> | Response> {
  const resp = await fetch('https://appleid.apple.com/auth/keys')
  if (!resp.ok) return json({ error: 'Apple public keys unavailable' }, 502)
  const data = await resp.json() as { keys?: Array<Record<string, unknown> & { kid?: string }> }
  const key = data.keys?.find(k => k.kid === kid)
  if (!key) return json({ error: 'Apple public key not found' }, 401)
  return key
}

async function mergeAccountKeys(env: Env, fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return

  const memberRows = await env.DB.prepare(
    `SELECT group_id, joined_at FROM members WHERE login = ?`,
  ).bind(fromKey).all<{ group_id: string; joined_at: number }>()
  for (const row of memberRows.results || []) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO members (group_id, login, joined_at) VALUES (?, ?, ?)`,
    ).bind(row.group_id, toKey, row.joined_at).run()
  }
  await env.DB.prepare(`DELETE FROM members WHERE login = ?`).bind(fromKey).run()
  await env.DB.prepare(`UPDATE groups SET owner_login = ? WHERE owner_login = ?`).bind(toKey, fromKey).run()
  await env.DB.prepare(`UPDATE events SET author_login = ? WHERE author_login = ?`).bind(toKey, fromKey).run()
  await rewriteEventPayloadMember(env, fromKey, toKey)
  await env.DB.prepare(`UPDATE identities SET account_key = ? WHERE account_key = ?`).bind(toKey, fromKey).run()
  await env.DB.prepare(`DELETE FROM accounts WHERE account_key = ?`).bind(fromKey).run()
}

async function rewriteEventPayloadMember(env: Env, fromKey: string, toKey: string): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, payload FROM events WHERE payload LIKE ?`,
  ).bind(`%${fromKey}%`).all<{ id: string; payload: string }>()

  for (const row of rows.results || []) {
    let payload: any
    try { payload = JSON.parse(row.payload) } catch { continue }
    const next = replaceMemberInPayload(payload, fromKey, toKey)
    if (next.changed) {
      await env.DB.prepare(`UPDATE events SET payload = ? WHERE id = ?`)
        .bind(JSON.stringify(next.payload), row.id)
        .run()
    }
  }
}

function replaceMemberInPayload(payload: any, fromKey: string, toKey: string): { payload: any; changed: boolean } {
  let changed = false
  const next = { ...payload }
  if (next.payer === fromKey) {
    next.payer = toKey
    changed = true
  }
  if (Array.isArray(next.participants)) {
    const participants = Array.from(new Set(next.participants.map((p: unknown) => p === fromKey ? toKey : p)))
    if (JSON.stringify(participants) !== JSON.stringify(next.participants)) {
      next.participants = participants
      changed = true
    }
  }
  if (next.split && typeof next.split === 'object' && !Array.isArray(next.split)) {
    const split: Record<string, number> = {}
    for (const [k, v] of Object.entries(next.split)) {
      const key = k === fromKey ? toKey : k
      split[key] = (split[key] || 0) + Number(v)
    }
    if (JSON.stringify(split) !== JSON.stringify(next.split)) {
      next.split = split
      changed = true
    }
  }
  return { payload: next, changed }
}

interface StoredEventRow {
  id: string
  group_id: string
  type: string
  payload: string
  author_login: string
}

interface ParsedStoredEventRow extends Omit<StoredEventRow, 'payload'> {
  payload: Record<string, unknown>
}

function parseStoredEventForDeletion(row: StoredEventRow): ParsedStoredEventRow | null {
  try {
    const payload = JSON.parse(row.payload)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    return { ...row, payload }
  } catch {
    return null
  }
}

// DELETE /me — permanently removes the authenticated account and the data it
// created. Owned groups disappear in full. In groups owned by someone else,
// events authored by the account (plus void/edit rows that only amend those
// events) are deleted; references in other people's events are rewritten to a
// random group-scoped offline profile named "Deleted account" so the remaining
// ledger can still be computed without retaining an account identifier.
//
// All relevant payloads are parsed before any write is issued. The writes then
// run in one D1 batch, which prevents a malformed historical row or a failed
// statement from leaving a half-deleted account.
async function deleteAccount(env: Env, me: string): Promise<Response> {
  const candidateRows = await env.DB.prepare(
    `SELECT e.id, e.group_id, e.type, e.payload, e.author_login
     FROM events e
     JOIN groups g ON g.id = e.group_id
     WHERE g.owner_login <> ?1
       AND (e.author_login = ?1 OR e.payload LIKE ?2)`,
  ).bind(me, `%${me}%`).all<StoredEventRow>()

  const candidates: ParsedStoredEventRow[] = []
  for (const row of candidateRows.results || []) {
    const parsed = parseStoredEventForDeletion(row)
    if (!parsed) return json({ error: 'account deletion blocked by invalid ledger data' }, 500)
    candidates.push(parsed)
  }

  const authoredIds = new Set(candidates.filter(row => row.author_login === me).map(row => row.id))
  const authoredGroupIds = Array.from(new Set(
    candidates.filter(row => row.author_login === me).map(row => row.group_id),
  ))

  // A void/edit payload contains only targetId, not the target author's key,
  // so it cannot be found by the account-key LIKE query above. Inspect all
  // mutation rows in groups where the account authored an event and remove
  // only those whose target is being deleted.
  const dependentIds = new Set<string>()
  for (let offset = 0; offset < authoredGroupIds.length; offset += 80) {
    const groupIds = authoredGroupIds.slice(offset, offset + 80)
    const placeholders = groupIds.map(() => '?').join(',')
    const rows = await env.DB.prepare(
      `SELECT id, group_id, type, payload, author_login
       FROM events
       WHERE group_id IN (${placeholders})
         AND type IN ('void', 'edit')
         AND author_login <> ?`,
    ).bind(...groupIds, me).all<StoredEventRow>()

    for (const row of rows.results || []) {
      const parsed = parseStoredEventForDeletion(row)
      if (!parsed) return json({ error: 'account deletion blocked by invalid ledger data' }, 500)
      if (typeof parsed.payload.targetId === 'string' && authoredIds.has(parsed.payload.targetId)) {
        dependentIds.add(parsed.id)
      }
    }
  }

  const placeholdersByGroup = new Map<string, string>()
  const rewrittenPayloads: Array<{ id: string; payload: string }> = []
  for (const row of candidates) {
    if (row.author_login === me || dependentIds.has(row.id)) continue
    let deletedMember = placeholdersByGroup.get(row.group_id)
    if (!deletedMember) deletedMember = `guest:${row.group_id}:${randomId(12)}`
    const next = replaceMemberInPayload(row.payload, me, deletedMember)
    if (!next.changed) continue
    placeholdersByGroup.set(row.group_id, deletedMember)
    rewrittenPayloads.push({ id: row.id, payload: JSON.stringify(next.payload) })
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM groups WHERE owner_login = ?`).bind(me),
    env.DB.prepare(`DELETE FROM events WHERE author_login = ?`).bind(me),
  ]

  const dependentIdList = Array.from(dependentIds)
  for (let offset = 0; offset < dependentIdList.length; offset += 80) {
    const ids = dependentIdList.slice(offset, offset + 80)
    statements.push(env.DB.prepare(
      `DELETE FROM events WHERE id IN (${ids.map(() => '?').join(',')})`,
    ).bind(...ids))
  }

  const now = Date.now()
  for (const [groupId, memberKey] of placeholdersByGroup) {
    statements.push(env.DB.prepare(
      `INSERT INTO offline_members (member_key, group_id, display_name, created_by, created_at)
       VALUES (?, ?, 'Deleted account', 'deleted', ?)`,
    ).bind(memberKey, groupId, now))
  }
  for (const row of rewrittenPayloads) {
    statements.push(env.DB.prepare(`UPDATE events SET payload = ? WHERE id = ?`).bind(row.payload, row.id))
  }

  statements.push(
    env.DB.prepare(`DELETE FROM members WHERE login = ?`).bind(me),
    env.DB.prepare(`UPDATE offline_members SET created_by = 'deleted' WHERE created_by = ?`).bind(me),
    env.DB.prepare(`DELETE FROM identities WHERE account_key = ?`).bind(me),
    env.DB.prepare(`DELETE FROM accounts WHERE account_key = ?`).bind(me),
  )

  await env.DB.batch(statements)
  return new Response(null, { status: 204 })
}

// ---------------------------------------------------------------------------
// Handlers

interface GroupRow {
  id: string
  name: string
  currency: string
  owner_login: string
  created_at: number
  finalized_at: number | null
}

interface EventRow {
  id: string
  group_id: string
  type: 'expense' | 'void' | 'edit' | 'settle'
  payload: string
  author_login: string
  ts: number
}

// GET /groups — owned + joined, deduped (a user joining a group they
// own is not actually possible since owner is auto-added, but the SQL
// UNION naturally dedupes).
async function listGroups(env: Env, me: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.name, g.currency, g.owner_login, g.created_at, g.finalized_at,
            CASE WHEN g.owner_login = ?1 THEN 'owner' ELSE 'member' END AS role
     FROM groups g
     WHERE g.owner_login = ?1
        OR g.id IN (SELECT group_id FROM members WHERE login = ?1)
     ORDER BY g.created_at DESC`,
  ).bind(me).all<GroupRow & { role: 'owner' | 'member' }>()

  // Pull rosters and counts in one extra trip to keep the list view
  // useful (avatar stack, member count, event count). Two queries
  // total — fine at this scale.
  const ids = (rows.results || []).map(r => r.id)
  if (ids.length === 0) return json([])

  const placeholders = ids.map(() => '?').join(',')
  const memberRows = await env.DB.prepare(
    `SELECT group_id, login FROM members WHERE group_id IN (${placeholders}) ORDER BY joined_at ASC`,
  ).bind(...ids).all<{ group_id: string; login: string }>()

  const eventCounts = await env.DB.prepare(
    `SELECT group_id, COUNT(*) AS n FROM events
     WHERE group_id IN (${placeholders}) AND type = 'expense'
       AND id NOT IN (SELECT json_extract(payload,'$.targetId') FROM events
                      WHERE group_id IN (${placeholders}) AND type = 'void')
     GROUP BY group_id`,
  ).bind(...ids, ...ids).all<{ group_id: string; n: number }>()

  const membersByGroup = new Map<string, string[]>()
  for (const m of memberRows.results || []) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, [])
    membersByGroup.get(m.group_id)!.push(m.login)
  }
  const countsByGroup = new Map<string, number>()
  for (const c of eventCounts.results || []) countsByGroup.set(c.group_id, c.n)
  const profileKeys = new Set<string>()
  for (const r of rows.results || []) profileKeys.add(r.owner_login)
  for (const m of memberRows.results || []) profileKeys.add(m.login)
  const allProfiles = await profilesFor(env, Array.from(profileKeys))

  return json((rows.results || []).map(r => ({
    id: r.id,
    name: r.name,
    currency: r.currency,
    owner: r.owner_login,
    role: r.role,
    members: membersByGroup.get(r.id) || [r.owner_login],
    profiles: pickProfiles(allProfiles, [r.owner_login, ...(membersByGroup.get(r.id) || [])]),
    eventCount: countsByGroup.get(r.id) || 0,
    createdAt: r.created_at,
    finalizedAt: r.finalized_at ?? undefined,
  })))
}

// GET /admin/groups — every group in the database, no owner/member filter.
// Read-only overview for an operator. Shares listGroups' two-extra-queries
// shape (rosters + active-expense counts) but drops the per-caller `role`
// (an admin is usually neither owner nor member of what they're inspecting)
// in favour of a plain memberCount. Caller is already admin-gated in route().
async function listAllGroups(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, name, currency, owner_login, created_at, finalized_at
     FROM groups ORDER BY created_at DESC`,
  ).all<GroupRow>()

  const ids = (rows.results || []).map(r => r.id)
  if (ids.length === 0) return json([])

  const placeholders = ids.map(() => '?').join(',')
  const memberRows = await env.DB.prepare(
    `SELECT group_id, login FROM members WHERE group_id IN (${placeholders}) ORDER BY joined_at ASC`,
  ).bind(...ids).all<{ group_id: string; login: string }>()

  const eventCounts = await env.DB.prepare(
    `SELECT group_id, COUNT(*) AS n FROM events
     WHERE group_id IN (${placeholders}) AND type = 'expense'
       AND id NOT IN (SELECT json_extract(payload,'$.targetId') FROM events
                      WHERE group_id IN (${placeholders}) AND type = 'void')
     GROUP BY group_id`,
  ).bind(...ids, ...ids).all<{ group_id: string; n: number }>()

  const membersByGroup = new Map<string, string[]>()
  for (const m of memberRows.results || []) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, [])
    membersByGroup.get(m.group_id)!.push(m.login)
  }
  const countsByGroup = new Map<string, number>()
  for (const c of eventCounts.results || []) countsByGroup.set(c.group_id, c.n)
  const profileKeys = new Set<string>()
  for (const r of rows.results || []) profileKeys.add(r.owner_login)
  for (const m of memberRows.results || []) profileKeys.add(m.login)
  const allProfiles = await profilesFor(env, Array.from(profileKeys))

  return json((rows.results || []).map(r => {
    const members = membersByGroup.get(r.id) || [r.owner_login]
    return {
      id: r.id,
      name: r.name,
      currency: r.currency,
      owner: r.owner_login,
      members,
      profiles: pickProfiles(allProfiles, [r.owner_login, ...members]),
      memberCount: members.length,
      eventCount: countsByGroup.get(r.id) || 0,
      createdAt: r.created_at,
      finalizedAt: r.finalized_at ?? undefined,
    }
  }))
}

// GET /admin/users — every distinct login in the system, with light stats.
// There's no users table: an identity is just a GH login that turns up as a
// group owner, a member, and/or an event author. So the roster is the UNION
// of those three columns, and each user's numbers are aggregates back over
// them. Unlike listAllGroups (which fans out and merges arrays per group),
// every user here is a flat row of scalars, so one query with correlated
// sub-selects is the simpler shape. Caller is already admin-gated in route().
//
//   owned       — groups they own
//   memberships — groups they currently belong to (owner is auto-added, so
//                 this includes owned ones)
//   expenses    — active (non-voided) expenses they recorded
//   last_active — max ts of anything they authored; NULL if they joined but
//                 never recorded an event
interface AdminUserRow {
  login: string
  owned: number
  memberships: number
  expenses: number
  last_active: number | null
}

async function listAllUsers(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `WITH logins AS (
       SELECT login FROM members WHERE login NOT LIKE 'guest:%'
       UNION SELECT owner_login FROM groups
       UNION SELECT author_login FROM events
     )
     SELECT
       u.login AS login,
       (SELECT COUNT(*) FROM groups g WHERE g.owner_login = u.login) AS owned,
       (SELECT COUNT(*) FROM members m WHERE m.login = u.login) AS memberships,
       (SELECT COUNT(*) FROM events e
          WHERE e.author_login = u.login AND e.type = 'expense'
            AND e.id NOT IN (SELECT json_extract(payload,'$.targetId')
                             FROM events WHERE type = 'void')) AS expenses,
       (SELECT MAX(ts) FROM events e WHERE e.author_login = u.login) AS last_active
     FROM logins u
     ORDER BY memberships DESC, login COLLATE NOCASE`,
  ).all<AdminUserRow>()

  const profiles = await profilesFor(env, (rows.results || []).map(r => r.login), { includeEmail: true })
  return json((rows.results || []).map(r => ({
    login: r.login,
    profile: profiles[r.login],
    owned: r.owned,
    memberships: r.memberships,
    expenseCount: r.expenses,
    lastActiveAt: r.last_active ?? undefined,
  })))
}

// GET /groups/:id/invite — public, no auth. Minimal preview so a
// share-link recipient sees who invited them and what they're joining
// before going through the OAuth dance.
async function readInvite(env: Env, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT id, name, currency, owner_login, finalized_at FROM groups WHERE id = ?1`,
  ).bind(id).first<GroupRow>()
  if (!group) return json({ error: 'group not found' }, 404)

  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM members WHERE group_id = ?1`,
  ).bind(id).first<{ n: number }>()

  return json({
    id: group.id,
    name: group.name,
    currency: group.currency,
    owner: group.owner_login,
    profiles: await profilesFor(env, [group.owner_login]),
    memberCount: row?.n ?? 1,
    finalized: group.finalized_at != null,
  })
}

// GET /groups/:id — full detail.
async function readGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT id, name, currency, owner_login, created_at, finalized_at FROM groups WHERE id = ?1`,
  ).bind(id).first<GroupRow>()
  if (!group) return json({ error: 'group not found' }, 404)

  const members = await env.DB.prepare(
    `SELECT login FROM members WHERE group_id = ?1 ORDER BY joined_at ASC`,
  ).bind(id).all<{ login: string }>()
  const memberLogins = (members.results || []).map(m => m.login)

  const events = await env.DB.prepare(
    `SELECT id, type, payload, author_login, ts FROM events
     WHERE group_id = ?1 ORDER BY ts ASC`,
  ).bind(id).all<Omit<EventRow, 'group_id'>>()

  const eventsHydrated = (events.results || []).map(e => ({
    id: e.id,
    type: e.type,
    ts: new Date(e.ts).toISOString(),
    author: e.author_login,
    ...JSON.parse(e.payload),
  }))
  const profileKeys = new Set<string>([group.owner_login, ...memberLogins])
  for (const e of eventsHydrated) {
    profileKeys.add(e.author)
    for (const m of membersFromEventPayload(e)) profileKeys.add(m)
  }

  // We don't gate read access here — anyone with the URL (and any
  // signed-in GH user) can read. Matches the share-by-link UX. If
  // you need acl, gate on `me === group.owner_login || memberLogins.includes(me)`.
  void me

  return json({
    id: group.id,
    name: group.name,
    currency: group.currency,
    owner: group.owner_login,
    members: memberLogins,
    profiles: await profilesFor(env, Array.from(profileKeys)),
    events: eventsHydrated,
    createdAt: group.created_at,
    finalizedAt: group.finalized_at ?? undefined,
  })
}

// POST /groups — body: { name, currency }
async function createGroup(env: Env, me: string, body: any): Promise<Response> {
  const name = stringField(body?.name, 'name', 1, 100)
  if (typeof name !== 'string') return name
  const currency = stringField(body?.currency, 'currency', 1, 10)
  if (typeof currency !== 'string') return currency

  const id = randomId(12)
  const now = Date.now()

  // Two writes; D1 batch keeps them atomic so a partial creation can't
  // leave a group with no creator-as-member.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO groups (id, name, currency, owner_login, created_at) VALUES (?,?,?,?,?)`,
    ).bind(id, name, currency, me, now),
    env.DB.prepare(
      `INSERT INTO members (group_id, login, joined_at) VALUES (?,?,?)`,
    ).bind(id, me, now),
  ])

  return json({
    id, name, currency, owner: me, members: [me], profiles: await profilesFor(env, [me]), events: [], createdAt: now,
  }, 201)
}

// DELETE /groups/:id — owner only. ON DELETE CASCADE clears members + events.
async function deleteGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string }>()
  if (!group) return json({ error: 'group not found' }, 404)
  if (group.owner_login !== me) return json({ error: 'only owner can delete' }, 403)

  await env.DB.prepare(`DELETE FROM groups WHERE id = ?`).bind(id).run()
  return new Response(null, { status: 204 })
}

// POST /groups/:id/join — idempotent self-add to members.
async function joinGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string }>()
  if (!group) return json({ error: 'group not found' }, 404)

  // INSERT OR IGNORE handles re-joins (PK already exists → no-op).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO members (group_id, login, joined_at) VALUES (?,?,?)`,
  ).bind(id, me, Date.now()).run()

  return json({ ok: true })
}

// GET /friends — the set of logins `me` has shared at least one group with.
// Self-join on members: any other login that sits in a group I'm also in.
// This is the candidate list for "pull a past split-mate into a group".
async function listFriends(env: Env, me: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT m2.login AS login
     FROM members m1
     JOIN members m2 ON m1.group_id = m2.group_id
     WHERE m1.login = ?1 AND m2.login <> ?1 AND m2.login NOT LIKE 'guest:%'
     ORDER BY m2.login COLLATE NOCASE`,
  ).bind(me).all<{ login: string }>()
  return json((rows.results || []).map(r => r.login))
}

// POST /groups/:id/members — owner-only roster changes. `{ login }` pulls in
// a past split-mate account; `{ offlineName }` creates/restores a group-scoped
// guest member that can participate in splits without signing in.
async function addMember(env: Env, me: string, id: string, body: any): Promise<Response> {
  const hasLogin = body?.login !== undefined
  const hasOfflineName = body?.offlineName !== undefined
  if (hasLogin === hasOfflineName) {
    return json({ error: 'send exactly one of login or offlineName' }, 400)
  }

  const group = await env.DB.prepare(
    `SELECT owner_login, finalized_at FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string; finalized_at: number | null }>()
  if (!group) return json({ error: 'group not found' }, 404)
  if (group.owner_login !== me) {
    return json({ error: 'only the group owner can add members' }, 403)
  }
  if (group.finalized_at != null) {
    return json({ error: 'group is finalized; reopen it before changing membership' }, 409)
  }

  if (hasOfflineName) {
    const offlineName = stringField(body?.offlineName, 'offlineName', 1, 40)
    if (typeof offlineName !== 'string') return offlineName
    return await addOfflineMember(env, me, id, offlineName)
  }

  const login = stringField(body?.login, 'login', 1, 80)
  if (typeof login !== 'string') return login
  if (isGuestMemberKey(login)) {
    return json({ error: 'guest members must be added by offlineName' }, 400)
  }

  // Friendship gate: the login has to share some prior group with the owner.
  const friend = await env.DB.prepare(
    `SELECT 1 FROM members m1
     JOIN members m2 ON m1.group_id = m2.group_id
     WHERE m1.login = ?1 AND m2.login = ?2 AND m2.login NOT LIKE 'guest:%' LIMIT 1`,
  ).bind(me, login).first<{ 1: number }>()
  if (!friend) {
    return json({ error: 'you can only add people you\'ve split with before' }, 403)
  }

  // Idempotent: re-adding an existing member is a no-op.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO members (group_id, login, joined_at) VALUES (?,?,?)`,
  ).bind(id, login, Date.now()).run()

  return json({ ok: true })
}

async function addOfflineMember(env: Env, me: string, groupId: string, displayName: string): Promise<Response> {
  const existing = await env.DB.prepare(
    `SELECT member_key FROM offline_members
     WHERE group_id = ?1 AND display_name = ?2 COLLATE NOCASE LIMIT 1`,
  ).bind(groupId, displayName).first<{ member_key: string }>()

  const memberKey = existing?.member_key || `guest:${groupId}:${randomId(10)}`
  const now = Date.now()

  const writes = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO members (group_id, login, joined_at) VALUES (?,?,?)`,
    ).bind(groupId, memberKey, now),
  ]

  if (existing) {
    writes.unshift(
      env.DB.prepare(
        `UPDATE offline_members SET display_name = ? WHERE member_key = ?`,
      ).bind(displayName, memberKey),
    )
  } else {
    writes.unshift(
      env.DB.prepare(
        `INSERT INTO offline_members (member_key, group_id, display_name, created_by, created_at)
         VALUES (?,?,?,?,?)`,
      ).bind(memberKey, groupId, displayName, me, now),
    )
  }

  await env.DB.batch(writes)

  return json({
    ok: true,
    member: memberKey,
    profile: { key: memberKey, displayName, kind: 'offline' },
  })
}

// POST /groups/:id/finalize — owner only. Locks the ledger; subsequent
// expense / void / member-change requests get a 409. Idempotent: stamping
// an already-finalized group is a no-op (we keep the original timestamp).
async function finalizeGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login, finalized_at FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string; finalized_at: number | null }>()
  if (!group) return json({ error: 'group not found' }, 404)
  if (group.owner_login !== me) return json({ error: 'only owner can finalize' }, 403)

  if (group.finalized_at == null) {
    await env.DB.prepare(
      `UPDATE groups SET finalized_at = ? WHERE id = ?`,
    ).bind(Date.now(), id).run()
  }
  const fresh = await env.DB.prepare(
    `SELECT finalized_at FROM groups WHERE id = ?`,
  ).bind(id).first<{ finalized_at: number | null }>()
  return json({ ok: true, finalizedAt: fresh?.finalized_at ?? undefined })
}

// DELETE /groups/:id/finalize — owner only. Reopens a finalized group so
// expenses / member changes can resume. Idempotent on an already-open group.
async function reopenGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string }>()
  if (!group) return json({ error: 'group not found' }, 404)
  if (group.owner_login !== me) return json({ error: 'only owner can reopen' }, 403)

  await env.DB.prepare(
    `UPDATE groups SET finalized_at = NULL WHERE id = ?`,
  ).bind(id).run()
  return json({ ok: true })
}

// DELETE /groups/:id/members/:login — both "owner kicks member" and
// "joiner self-leaves" funnel through here. Permission matrix:
//
//   target == owner          → 403 always (must DELETE the group)
//   target == me             → OK (self-leave; owner ruled out above)
//   target != me, me == owner → OK (kick)
//   target != me, me != owner → 403 (only owner can kick others)
//
// Past events authored by the removed login stay intact — settlement
// for them still reflects in the activity feed and balance map. The
// frontend's settlement view derives its roster from members ∪ event
// participants so kicked-but-historical members keep showing up.
async function removeMember(env: Env, me: string, id: string, target: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login, finalized_at FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string; finalized_at: number | null }>()
  if (!group) return json({ error: 'group not found' }, 404)

  if (group.finalized_at != null) {
    return json({ error: 'group is finalized; reopen it before changing membership' }, 409)
  }
  if (target === group.owner_login) {
    return json({ error: 'owner cannot be removed; delete the group instead' }, 400)
  }
  if (target !== me && me !== group.owner_login) {
    return json({ error: 'only the group owner can remove other members' }, 403)
  }

  const result = await env.DB.prepare(
    `DELETE FROM members WHERE group_id = ? AND login = ?`,
  ).bind(id, target).run()

  // D1 returns meta.changes for affected rows. If it's 0 the member
  // wasn't there to begin with — return idempotently rather than 404
  // so the UI's optimistic-remove flow doesn't have to special-case
  // double-clicks.
  void result

  return json({ ok: true })
}

interface RosterInfo {
  members: Set<string>
  offline: Set<string>
}

async function readRoster(env: Env, groupId: string): Promise<RosterInfo> {
  const rows = await env.DB.prepare(
    `SELECT m.login AS login, o.member_key AS offline_key
     FROM members m
     LEFT JOIN offline_members o ON o.member_key = m.login
     WHERE m.group_id = ?`,
  ).bind(groupId).all<{ login: string; offline_key: string | null }>()

  const members = new Set<string>()
  const offline = new Set<string>()
  for (const row of rows.results || []) {
    members.add(row.login)
    if (row.offline_key) offline.add(row.login)
  }
  return { members, offline }
}

// POST /groups/:id/events — body is the event sans id/ts/author. Must be
// a member of the group. Voids are gated on (owner OR original author).
async function postEvent(env: Env, me: string, id: string, body: any): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login, finalized_at FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string; finalized_at: number | null }>()
  if (!group) return json({ error: 'group not found' }, 404)

  if (group.finalized_at != null) {
    return json({ error: 'group is finalized; reopen it to record more events' }, 409)
  }

  // Membership gate. Owner is implicitly a member.
  if (group.owner_login !== me) {
    const isMember = await env.DB.prepare(
      `SELECT 1 FROM members WHERE group_id = ? AND login = ?`,
    ).bind(id, me).first<{ 1: number }>()
    if (!isMember) return json({ error: 'not a member of this group' }, 403)
  }

  const type = body?.type
  if (type !== 'expense' && type !== 'void' && type !== 'edit' && type !== 'settle') {
    return json({ error: 'type must be "expense", "void", "edit", or "settle"' }, 400)
  }

  // Event timestamp. Defaults to "now"; an expense may carry a caller-
  // supplied `ts` (unix ms) to backdate it — the add-expense date picker.
  // Voids and edits are always stamped now: their `ts` is the audit instant
  // (when the correction happened). An edit's *new effective expense date*
  // rides in its payload (`date`), not this column.
  let ts = Date.now()

  // The most recent settle checkpoint (if any) freezes everything up to it:
  // you can't backdate an expense to before it, nor void/edit anything it
  // already cleared. Null when the group has never been settled.
  const settleRow = await env.DB.prepare(
    `SELECT MAX(ts) AS ts FROM events WHERE group_id = ? AND type = 'settle'`,
  ).bind(id).first<{ ts: number | null }>()
  const latestSettleTs = settleRow?.ts ?? null

  let payload: Record<string, unknown>
  if (type === 'expense') {
    const payer = body.payer
    const amount = body.amount
    const participants = body.participants
    const split = body.split
    const note = body.note
    if (typeof payer !== 'string') return json({ error: 'payer required' }, 400)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      return json({ error: 'amount must be a positive integer (minor units)' }, 400)
    }
    if (!Array.isArray(participants) || participants.length === 0) {
      return json({ error: 'participants must be a non-empty array' }, 400)
    }
    if (split !== 'equal' && (typeof split !== 'object' || split === null)) {
      return json({ error: 'split must be "equal" or {login: amount} map' }, 400)
    }
    const roster = await readRoster(env, id)
    if (!roster.members.has(payer)) {
      return json({ error: 'payer must be a current member of this group' }, 400)
    }
    // You can only record an expense YOU paid, except the owner may record
    // expenses paid by group-scoped offline members. Authorship still records
    // the owner who entered it.
    if (payer !== me && (group.owner_login !== me || !roster.offline.has(payer))) {
      return json({ error: 'you can only record expenses you paid, except owner-recorded offline payments' }, 403)
    }
    const participantSet = new Set<string>()
    for (const p of participants) {
      if (typeof p !== 'string') return json({ error: 'participants must be strings' }, 400)
      if (!roster.members.has(p)) return json({ error: 'participants must be current members of this group' }, 400)
      if (participantSet.has(p)) return json({ error: 'participants must not contain duplicates' }, 400)
      participantSet.add(p)
    }
    if (split !== 'equal') {
      let explicitTotal = 0
      for (const [member, share] of Object.entries(split)) {
        if (!participantSet.has(member)) {
          return json({ error: 'split keys must match participants' }, 400)
        }
        if (typeof share !== 'number' || !Number.isFinite(share) || !Number.isInteger(share) || share < 0) {
          return json({ error: 'split amounts must be non-negative integers' }, 400)
        }
        explicitTotal += share
      }
      if (explicitTotal !== amount) {
        return json({ error: 'split amounts must sum to amount' }, 400)
      }
    }
    // Optional backdate. Must be a sane positive unix-ms integer. We don't
    // cap the future here: the client sends an absolute instant and a hard
    // "<= now" check would spuriously reject the default value under normal
    // client/server clock skew.
    if (body.ts !== undefined) {
      if (typeof body.ts !== 'number' || !Number.isInteger(body.ts) || body.ts <= 0) {
        return json({ error: 'ts must be a positive unix-ms integer' }, 400)
      }
      ts = body.ts
    }
    // Can't slip an expense into an already-settled period. (A non-backdated
    // expense is stamped "now", always after the last settle, so this only
    // ever bites a deliberate backdate.)
    if (latestSettleTs != null && ts <= latestSettleTs) {
      return json({ error: 'cannot backdate an expense to before the last settle' }, 409)
    }
    payload = { payer, amount, participants, split }
    if (typeof note === 'string' && note.trim()) payload.note = note.trim()
  } else if (type === 'void') {
    const targetId = body.targetId
    if (typeof targetId !== 'string') return json({ error: 'targetId required' }, 400)
    // Void is gated on (owner OR original event author).
    const target = await env.DB.prepare(
      `SELECT author_login, ts FROM events WHERE id = ? AND group_id = ?`,
    ).bind(targetId, id).first<{ author_login: string; ts: number }>()
    if (!target) return json({ error: 'targetId not found in this group' }, 404)
    if (latestSettleTs != null && target.ts <= latestSettleTs) {
      return json({ error: 'that expense was settled; it can no longer be voided' }, 409)
    }
    if (group.owner_login !== me && target.author_login !== me) {
      return json({ error: 'can only void events you authored (or be the group owner)' }, 403)
    }
    payload = { targetId }
    if (typeof body.reason === 'string' && body.reason.trim()) {
      payload.reason = body.reason.trim()
    }
  } else if (type === 'edit') {
    // type === 'edit' — amend an existing expense's amount / date (and
    // optionally note) in place. The original expense row stays put; settlement
    // and the receipt fold the latest edit over it. Edit is the author's alone
    // (matches the rule that you can only post an expense you paid — you correct
    // your own spend).
    const targetId = body.targetId
    const amount = body.amount
    const date = body.date
    const note = body.note
    if (typeof targetId !== 'string') return json({ error: 'targetId required' }, 400)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      return json({ error: 'amount must be a positive integer (minor units)' }, 400)
    }
    if (typeof date !== 'number' || !Number.isInteger(date) || date <= 0) {
      return json({ error: 'date must be a positive unix-ms integer' }, 400)
    }
    // Note is optional. Present (even empty) means "set the note to this" — an
    // empty string clears it; omitting the field leaves the original note alone.
    if (note !== undefined && typeof note !== 'string') {
      return json({ error: 'note must be a string' }, 400)
    }
    const target = await env.DB.prepare(
      `SELECT type, author_login, ts FROM events WHERE id = ? AND group_id = ?`,
    ).bind(targetId, id).first<{ type: string; author_login: string; ts: number }>()
    if (!target) return json({ error: 'targetId not found in this group' }, 404)
    if (target.type !== 'expense') return json({ error: 'can only edit an expense' }, 400)
    if (latestSettleTs != null && target.ts <= latestSettleTs) {
      return json({ error: 'that expense was settled; it can no longer be edited' }, 409)
    }
    if (target.author_login !== me) {
      return json({ error: 'can only edit expenses you authored' }, 403)
    }
    // Editing a struck expense makes no sense — it's already out of the
    // ledger. Reject rather than silently resurrect it.
    const struck = await env.DB.prepare(
      `SELECT 1 FROM events WHERE group_id = ? AND type = 'void'
         AND json_extract(payload,'$.targetId') = ? LIMIT 1`,
    ).bind(id, targetId).first<{ 1: number }>()
    if (struck) return json({ error: 'cannot edit a voided expense' }, 409)
    payload = { targetId, amount, date }
    if (typeof note === 'string') payload.note = note.trim()
  } else {
    // type === 'settle' — a clear-the-slate checkpoint. Any member may stamp
    // one (the membership gate above is all the permission it needs). Stamp ts
    // strictly after every prior event so the boundary is unambiguous even
    // against backdated expenses; balances reset from here for the next period.
    const note = body.note
    if (note !== undefined && typeof note !== 'string') {
      return json({ error: 'note must be a string' }, 400)
    }
    const maxRow = await env.DB.prepare(
      `SELECT MAX(ts) AS ts FROM events WHERE group_id = ?`,
    ).bind(id).first<{ ts: number | null }>()
    ts = Math.max(Date.now(), (maxRow?.ts ?? 0) + 1)
    payload = {}
    if (typeof note === 'string' && note.trim()) payload.note = note.trim()
  }

  const eventId = randomId(12)
  await env.DB.prepare(
    `INSERT INTO events (id, group_id, type, payload, author_login, ts) VALUES (?,?,?,?,?,?)`,
  ).bind(eventId, id, type, JSON.stringify(payload), me, ts).run()

  return json({
    id: eventId,
    type,
    ts: new Date(ts).toISOString(),
    author: me,
    ...payload,
  }, 201)
}

// ---------------------------------------------------------------------------
// Helpers

// Is this account allowed on the /admin/* routes? ADMIN_LOGINS accepts account
// keys, emails, or GitHub logins. Compared case-insensitively.
function isAdmin(me: AuthAccount, env: Env): boolean {
  const admins = (env.ADMIN_LOGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return [
    me.accountKey,
    me.email,
    me.providerLogin,
    me.displayName,
  ].filter(Boolean).some(v => admins.includes(String(v).toLowerCase()))
}

function stringField(v: unknown, name: string, min: number, max: number): string | Response {
  if (typeof v !== 'string') return json({ error: `${name} must be a string` }, 400)
  const trimmed = v.trim()
  if (trimmed.length < min || trimmed.length > max) {
    return json({ error: `${name} length must be ${min}..${max}` }, 400)
  }
  return trimmed
}

function isGuestMemberKey(key: string): boolean {
  return key.startsWith('guest:')
}

function randomId(hexChars: number): string {
  const bytes = new Uint8Array(Math.ceil(hexChars / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, hexChars)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8Encode(value))
  return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(utf8Encode(JSON.stringify(value)))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

async function profilesFor(
  env: Env,
  keys: string[],
  options: { includeEmail?: boolean } = {},
): Promise<Record<string, unknown>> {
  const uniq = Array.from(new Set(keys.filter(Boolean)))
  if (uniq.length === 0) return {}
  const placeholders = uniq.map(() => '?').join(',')
  const rows = await env.DB.prepare(
    `SELECT account_key, email, display_name, avatar_url, primary_provider, provider_login
     FROM accounts WHERE account_key IN (${placeholders})`,
  ).bind(...uniq).all<AccountRow>()
  const out: Record<string, unknown> = {}
  for (const key of uniq) {
    out[key] = { key, displayName: key, kind: isGuestMemberKey(key) ? 'offline' : 'account' }
  }
  for (const row of rows.results || []) {
    const account = accountFromRow(row)
    const profile: Record<string, unknown> = {
      key: account.accountKey,
      kind: 'account',
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      provider: account.provider,
      providerLogin: account.providerLogin,
    }
    if (options.includeEmail) profile.email = account.email
    out[account.accountKey] = profile
  }
  const offlineRows = await env.DB.prepare(
    `SELECT member_key, display_name
     FROM offline_members WHERE member_key IN (${placeholders})`,
  ).bind(...uniq).all<{ member_key: string; display_name: string }>()
  for (const row of offlineRows.results || []) {
    out[row.member_key] = {
      key: row.member_key,
      kind: 'offline',
      displayName: row.display_name,
    }
  }
  return out
}

function pickProfiles(all: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Array.from(new Set(keys.filter(Boolean)))) {
    if (all[key]) out[key] = all[key]
  }
  return out
}

function membersFromEventPayload(e: any): string[] {
  const out = new Set<string>()
  if (typeof e.payer === 'string') out.add(e.payer)
  if (Array.isArray(e.participants)) {
    for (const p of e.participants) if (typeof p === 'string') out.add(p)
  }
  if (e.split && typeof e.split === 'object' && !Array.isArray(e.split)) {
    for (const key of Object.keys(e.split)) out.add(key)
  }
  return Array.from(out)
}
