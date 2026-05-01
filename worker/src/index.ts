// SplitStupid backend Worker.
// =========================================================================
// One Cloudflare Worker + one D1 database. Replaces the previous "store
// every group as a public gist" scheme — gists' API surface had too many
// quirks (secret-gist 404s for non-owners, comments-as-events glue, no
// concurrent-write story) for what's fundamentally a tiny CRUD app.
//
// Auth model: clients send `Authorization: Bearer <gh_oauth_token>` on
// every request. The Worker resolves the token to a GH login by calling
// GitHub's /user endpoint once per request. We *do not* validate scope —
// even a no-scope OAuth token can call /user. That means the only thing
// the Worker trusts the token for is "this caller is the GH user with
// login X." Everything downstream (membership, ownership) is checked
// against the DB using that login.
//
// Routing is hand-rolled (no router framework) since there are only 8
// endpoints. URL.pathname + method.

interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
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

  // Everything else needs an authenticated GH login.
  const me = await authenticate(request)
  if (typeof me !== 'string') return me  // Response (401)

  // GET    /groups
  // POST   /groups
  if (path === '/groups') {
    if (method === 'GET') return await listGroups(env, me)
    if (method === 'POST') return await createGroup(env, me, await request.json())
    return new Response('method not allowed', { status: 405 })
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
    if (rest === 'leave' && method === 'POST') return await leaveGroup(env, me, groupId)

    if (rest === 'events' && method === 'POST') {
      return await postEvent(env, me, groupId, await request.json())
    }
  }

  return new Response('not found', { status: 404 })
}

// ---------------------------------------------------------------------------
// Auth: resolve a Bearer GH token to a login.
// Caching by token is omitted in v1 — at low traffic the extra GH /user
// call per request is fine. If we hit GH rate limits we'll add a KV
// cache keyed by SHA-256(token).

async function authenticate(request: Request): Promise<string | Response> {
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

  let resp: Response
  try {
    resp = await fetch('https://api.github.com/user', {
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

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'github rejected token' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })
  }
  const data = await resp.json() as { login?: string }
  if (!data.login) {
    return new Response(JSON.stringify({ error: 'github returned no login' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    })
  }
  return data.login
}

// ---------------------------------------------------------------------------
// Handlers

interface GroupRow {
  id: string
  name: string
  currency: string
  owner_login: string
  created_at: number
}

interface EventRow {
  id: string
  group_id: string
  type: 'expense' | 'void'
  payload: string
  author_login: string
  ts: number
}

// GET /groups — owned + joined, deduped (a user joining a group they
// own is not actually possible since owner is auto-added, but the SQL
// UNION naturally dedupes).
async function listGroups(env: Env, me: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.name, g.currency, g.owner_login, g.created_at,
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

  return json((rows.results || []).map(r => ({
    id: r.id,
    name: r.name,
    currency: r.currency,
    owner: r.owner_login,
    role: r.role,
    members: membersByGroup.get(r.id) || [r.owner_login],
    eventCount: countsByGroup.get(r.id) || 0,
    createdAt: r.created_at,
  })))
}

// GET /groups/:id — full detail.
async function readGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT id, name, currency, owner_login, created_at FROM groups WHERE id = ?1`,
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
    events: eventsHydrated,
    createdAt: group.created_at,
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
    id, name, currency, owner: me, members: [me], events: [], createdAt: now,
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

// POST /groups/:id/leave — owner can't leave (would orphan the group);
// they must DELETE instead.
async function leaveGroup(env: Env, me: string, id: string): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string }>()
  if (!group) return json({ error: 'group not found' }, 404)
  if (group.owner_login === me) {
    return json({ error: 'owner cannot leave; delete the group instead' }, 400)
  }

  await env.DB.prepare(
    `DELETE FROM members WHERE group_id = ? AND login = ?`,
  ).bind(id, me).run()

  return json({ ok: true })
}

// POST /groups/:id/events — body is the event sans id/ts/author. Must be
// a member of the group. Voids are gated on (owner OR original author).
async function postEvent(env: Env, me: string, id: string, body: any): Promise<Response> {
  const group = await env.DB.prepare(
    `SELECT owner_login FROM groups WHERE id = ?`,
  ).bind(id).first<{ owner_login: string }>()
  if (!group) return json({ error: 'group not found' }, 404)

  // Membership gate. Owner is implicitly a member.
  if (group.owner_login !== me) {
    const isMember = await env.DB.prepare(
      `SELECT 1 FROM members WHERE group_id = ? AND login = ?`,
    ).bind(id, me).first<{ 1: number }>()
    if (!isMember) return json({ error: 'not a member of this group' }, 403)
  }

  const type = body?.type
  if (type !== 'expense' && type !== 'void') {
    return json({ error: 'type must be "expense" or "void"' }, 400)
  }

  let payload: Record<string, unknown>
  if (type === 'expense') {
    const payer = body.payer
    const amount = body.amount
    const participants = body.participants
    const split = body.split
    const note = body.note
    if (typeof payer !== 'string') return json({ error: 'payer required' }, 400)
    // You can only record an expense YOU paid. Otherwise alice could
    // post "bob paid 10000" on bob's behalf, corrupting the
    // GH-signed authorship guarantee. The owner gets no exception —
    // if they want to record someone else's spend, that someone has
    // to record it themselves.
    if (payer !== me) {
      return json({ error: 'you can only record expenses you paid' }, 403)
    }
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      return json({ error: 'amount must be a positive integer (minor units)' }, 400)
    }
    if (!Array.isArray(participants) || participants.length === 0) {
      return json({ error: 'participants must be a non-empty array' }, 400)
    }
    if (split !== 'equal' && (typeof split !== 'object' || split === null)) {
      return json({ error: 'split must be "equal" or {login: amount} map' }, 400)
    }
    payload = { payer, amount, participants, split }
    if (typeof note === 'string' && note.trim()) payload.note = note.trim()
  } else {
    const targetId = body.targetId
    if (typeof targetId !== 'string') return json({ error: 'targetId required' }, 400)
    // Void is gated on (owner OR original event author).
    const target = await env.DB.prepare(
      `SELECT author_login FROM events WHERE id = ? AND group_id = ?`,
    ).bind(targetId, id).first<{ author_login: string }>()
    if (!target) return json({ error: 'targetId not found in this group' }, 404)
    if (group.owner_login !== me && target.author_login !== me) {
      return json({ error: 'can only void events you authored (or be the group owner)' }, 403)
    }
    payload = { targetId }
    if (typeof body.reason === 'string' && body.reason.trim()) {
      payload.reason = body.reason.trim()
    }
  }

  const eventId = randomId(12)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO events (id, group_id, type, payload, author_login, ts) VALUES (?,?,?,?,?,?)`,
  ).bind(eventId, id, type, JSON.stringify(payload), me, now).run()

  return json({
    id: eventId,
    type,
    ts: new Date(now).toISOString(),
    author: me,
    ...payload,
  }, 201)
}

// ---------------------------------------------------------------------------
// Helpers

function stringField(v: unknown, name: string, min: number, max: number): string | Response {
  if (typeof v !== 'string') return json({ error: `${name} must be a string` }, 400)
  const trimmed = v.trim()
  if (trimmed.length < min || trimmed.length > max) {
    return json({ error: `${name} length must be ${min}..${max}` }, 400)
  }
  return trimmed
}

function randomId(hexChars: number): string {
  const bytes = new Uint8Array(Math.ceil(hexChars / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, hexChars)
}
