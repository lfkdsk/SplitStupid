interface Env {
  CONNECTOR_ORIGIN?: string
  SPLITSTUPID_API_URL?: string
  ALLOWED_ORIGINS?: string
  ACCESS_TOKEN_TTL_SECONDS?: string
  REFRESH_TOKEN_TTL_SECONDS?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  TOKEN_SECRET?: string
}

interface AuthSession {
  token: string
  me: AuthMe
}

interface AuthMe {
  key: string
  displayName: string
  avatarUrl?: string
  email?: string
}

interface GroupSummary {
  id: string
  name: string
  currency: string
  owner: string
  role: "owner" | "member"
  members: string[]
  profiles?: Record<string, UserProfile>
  eventCount: number
  createdAt: number
  finalizedAt?: number
}

interface Group extends Omit<GroupSummary, "role" | "eventCount"> {
  events: unknown[]
}

interface UserProfile {
  key: string
  kind?: "account" | "offline"
  displayName: string
  avatarUrl?: string
  email?: string
  provider?: "github" | "apple"
  providerLogin?: string
}

interface AccessPayload {
  typ: "access"
  exp: number
  accountKey: string
  scopes: string[]
  splitstupidSession: string
}

interface RefreshPayload {
  typ: "refresh"
  exp: number
  accountKey: string
  scopes: string[]
  splitstupidSession: string
}

interface AuthCodePayload {
  typ: "code"
  exp: number
  clientId: string
  redirectUri: string
  codeChallenge: string
  accountKey: string
  scopes: string[]
  splitstupidSession: string
}

interface AuthorizeState {
  exp: number
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  userState?: string
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: any
}

const MCP_PROTOCOL_VERSION = "2025-06-18"
const SUPPORTED_SCOPES = ["groups.read", "expenses.write"] as const
const DEFAULT_SCOPES = ["groups.read", "expenses.write"]
const GITHUB_SCOPE = "read:user user:email"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = connectorOrigin(request, env)
    const allowedOrigin = pickAllowedOrigin(request.headers.get("origin"), env)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) })
    }

    try {
      const response = await route(request, env, origin)
      return withCors(response, allowedOrigin)
    } catch (err: any) {
      return withCors(json({ error: err?.message || "internal error" }, 500), allowedOrigin)
    }
  },
}

async function route(request: Request, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if ((path === "/" || path === "/healthz") && request.method === "GET") {
    return text("splitstupid-mcp ok\n")
  }

  if (path === "/.well-known/oauth-protected-resource" && request.method === "GET") {
    return json(protectedResourceMetadata(origin))
  }
  if (path === "/.well-known/oauth-protected-resource/mcp" && request.method === "GET") {
    return json(protectedResourceMetadata(origin))
  }
  if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") {
    return json(authorizationServerMetadata(origin))
  }

  if (path === "/oauth/authorize" && request.method === "GET") {
    return authorize(request, env, origin)
  }
  if (path === "/oauth/github/callback" && request.method === "GET") {
    return githubCallback(request, env, origin)
  }
  if (path === "/oauth/token" && request.method === "POST") {
    return token(request, env, origin)
  }
  if (path === "/oauth/revoke" && request.method === "POST") {
    return new Response(null, { status: 200 })
  }

  if (path === "/mcp" && request.method === "GET") {
    return json({ name: "SplitStupid MCP", endpoint: `${origin}/mcp` })
  }
  if (path === "/mcp" && request.method === "POST") {
    return mcp(request, env, origin)
  }

  return json({ error: "not found" }, 404)
}

function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: SUPPORTED_SCOPES,
    resource_documentation: "https://github.com/lfkdsk/SplitStupid",
  }
}

function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SUPPORTED_SCOPES,
  }
}

async function authorize(request: Request, env: Env, origin: string): Promise<Response> {
  requireEnv(env.GITHUB_CLIENT_ID, "GITHUB_CLIENT_ID")
  requireEnv(env.GITHUB_CLIENT_SECRET, "GITHUB_CLIENT_SECRET")
  requireEnv(env.TOKEN_SECRET, "TOKEN_SECRET")

  const url = new URL(request.url)
  const responseType = requiredParam(url, "response_type")
  if (responseType !== "code") return oauthRedirectError(url, "unsupported_response_type")

  const clientId = requiredParam(url, "client_id")
  const redirectUri = requiredParam(url, "redirect_uri")
  const codeChallenge = requiredParam(url, "code_challenge")
  const method = url.searchParams.get("code_challenge_method")
  if (method !== "S256") return oauthRedirectError(url, "invalid_request", "code_challenge_method must be S256")

  const scopes = parseScopes(url.searchParams.get("scope"))
  const userState = url.searchParams.get("state") || undefined
  const state: AuthorizeState = {
    exp: nowSeconds() + 600,
    clientId,
    redirectUri,
    codeChallenge,
    scope: scopes.join(" "),
    userState,
  }

  const signedState = await signState(env, state)
  const github = new URL("https://github.com/login/oauth/authorize")
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID!)
  github.searchParams.set("redirect_uri", `${origin}/oauth/github/callback`)
  github.searchParams.set("scope", GITHUB_SCOPE)
  github.searchParams.set("state", signedState)
  return redirect(github.toString())
}

async function githubCallback(request: Request, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url)
  const rawState = requiredParam(url, "state")
  const state = await verifyState<AuthorizeState>(env, rawState)
  if (state.exp < nowSeconds()) return redirectOAuthError(state, "expired_state")

  const githubError = url.searchParams.get("error")
  if (githubError) return redirectOAuthError(state, githubError)

  const code = requiredParam(url, "code")
  const githubToken = await exchangeGitHubCode(env, origin, code)
  const session = await exchangeSplitStupidSession(env, githubToken)

  const authCode: AuthCodePayload = {
    typ: "code",
    exp: nowSeconds() + 300,
    clientId: state.clientId,
    redirectUri: state.redirectUri,
    codeChallenge: state.codeChallenge,
    accountKey: session.me.key,
    scopes: state.scope.split(/\s+/).filter(Boolean),
    splitstupidSession: session.token,
  }
  const sealedCode = await sealJson(env, authCode)
  const callback = new URL(state.redirectUri)
  callback.searchParams.set("code", sealedCode)
  if (state.userState) callback.searchParams.set("state", state.userState)
  return redirect(callback.toString())
}

async function token(request: Request, env: Env, _origin: string): Promise<Response> {
  requireEnv(env.TOKEN_SECRET, "TOKEN_SECRET")
  const body = await readFormish(request)
  const grantType = requiredBody(body, "grant_type")

  if (grantType === "authorization_code") {
    const code = requiredBody(body, "code")
    const verifier = requiredBody(body, "code_verifier")
    const redirectUri = requiredBody(body, "redirect_uri")
    const payload = await unsealJson<AuthCodePayload>(env, code)
    if (payload.typ !== "code" || payload.exp < nowSeconds()) {
      return oauthTokenError("invalid_grant", "authorization code expired")
    }
    if (payload.redirectUri !== redirectUri) {
      return oauthTokenError("invalid_grant", "redirect_uri mismatch")
    }
    const challenge = await pkceChallenge(verifier)
    if (challenge !== payload.codeChallenge) {
      return oauthTokenError("invalid_grant", "code_verifier mismatch")
    }
    return json(await mintTokenResponse(env, payload.accountKey, payload.scopes, payload.splitstupidSession))
  }

  if (grantType === "refresh_token") {
    const refreshToken = requiredBody(body, "refresh_token")
    const payload = await unsealJson<RefreshPayload>(env, refreshToken)
    if (payload.typ !== "refresh" || payload.exp < nowSeconds()) {
      return oauthTokenError("invalid_grant", "refresh token expired")
    }
    return json(await mintTokenResponse(env, payload.accountKey, payload.scopes, payload.splitstupidSession))
  }

  return oauthTokenError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token")
}

async function mintTokenResponse(env: Env, accountKey: string, scopes: string[], splitstupidSession: string) {
  const now = nowSeconds()
  const accessExp = now + parsePositiveInt(env.ACCESS_TOKEN_TTL_SECONDS, 1800)
  const refreshExp = now + parsePositiveInt(env.REFRESH_TOKEN_TTL_SECONDS, 90 * 24 * 60 * 60)
  const access: AccessPayload = {
    typ: "access",
    exp: accessExp,
    accountKey,
    scopes,
    splitstupidSession,
  }
  const refresh: RefreshPayload = {
    typ: "refresh",
    exp: refreshExp,
    accountKey,
    scopes,
    splitstupidSession,
  }
  return {
    access_token: await sealJson(env, access),
    token_type: "Bearer",
    expires_in: accessExp - now,
    refresh_token: await sealJson(env, refresh),
    scope: scopes.join(" "),
  }
}

async function mcp(request: Request, env: Env, origin: string): Promise<Response> {
  const rpc = await request.json() as JsonRpcRequest | JsonRpcRequest[]
  if (Array.isArray(rpc)) {
    const results = await Promise.all(rpc.map(item => handleRpc(item, request, env, origin)))
    return json(results.filter(Boolean))
  }
  const response = await handleRpc(rpc, request, env, origin)
  if (!response) return new Response(null, { status: 202 })
  return json(response)
}

async function handleRpc(rpc: JsonRpcRequest, request: Request, env: Env, origin: string) {
  if (!rpc.id && rpc.method?.startsWith("notifications/")) return null
  if (rpc.jsonrpc !== "2.0") return rpcError(rpc.id, -32600, "invalid JSON-RPC request")

  switch (rpc.method) {
    case "initialize":
      return rpcResult(rpc.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "splitstupid", version: "0.1.0" },
      })
    case "ping":
      return rpcResult(rpc.id, {})
    case "tools/list":
      return rpcResult(rpc.id, { tools: tools(origin) })
    case "tools/call":
      return callTool(rpc, request, env, origin)
    default:
      return rpcError(rpc.id, -32601, "method not found")
  }
}

async function callTool(rpc: JsonRpcRequest, request: Request, env: Env, origin: string) {
  const auth = await authenticateMcpRequest(request, env, origin)
  if (auth instanceof Response) {
    return rpcResult(rpc.id, {
      isError: true,
      content: [{ type: "text", text: "SplitStupid authorization is required." }],
      _meta: { "mcp/www_authenticate": auth.headers.get("www-authenticate") },
    })
  }

  const name = rpc.params?.name
  const args = rpc.params?.arguments || {}
  try {
    if (name === "list_groups") return toolResult(rpc.id, await listGroups(env, auth))
    if (name === "get_group") return toolResult(rpc.id, await getGroup(env, auth, requiredString(args.groupId, "groupId")))
    if (name === "record_expense") return toolResult(rpc.id, await recordExpense(env, auth, args))
    return rpcError(rpc.id, -32602, `unknown tool: ${String(name)}`)
  } catch (err: any) {
    return rpcResult(rpc.id, {
      isError: true,
      content: [{ type: "text", text: err?.message || "tool failed" }],
    })
  }
}

function tools(origin: string) {
  const readScheme = oauthScheme(["groups.read"])
  const writeScheme = oauthScheme(["groups.read", "expenses.write"])
  return [
    {
      name: "list_groups",
      title: "List SplitStupid groups",
      description: "List the SplitStupid groups available to the connected user.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      securitySchemes: [readScheme],
      _meta: { securitySchemes: [readScheme] },
    },
    {
      name: "get_group",
      title: "Get SplitStupid group",
      description: "Read one SplitStupid group with members, profiles, currency, and finalized state.",
      inputSchema: {
        type: "object",
        properties: { groupId: { type: "string", description: "SplitStupid group id." } },
        required: ["groupId"],
        additionalProperties: false,
      },
      securitySchemes: [readScheme],
      _meta: { securitySchemes: [readScheme] },
    },
    {
      name: "record_expense",
      title: "Record SplitStupid expense",
      description: "Record an equal-split expense in a SplitStupid group.",
      inputSchema: {
        type: "object",
        properties: {
          groupId: { type: "string" },
          amount: { type: "integer", minimum: 1, description: "Amount in minor units, e.g. cents or yen." },
          note: { type: "string" },
          payer: { type: "string", description: "Defaults to the connected SplitStupid account key." },
          participants: { type: "array", items: { type: "string" }, minItems: 1 },
          date: { type: "integer", description: "Optional unix milliseconds for backdating." },
        },
        required: ["groupId", "amount", "participants"],
        additionalProperties: false,
      },
      securitySchemes: [writeScheme],
      _meta: { securitySchemes: [writeScheme] },
    },
  ]
}

function oauthScheme(scopes: string[]) {
  return { type: "oauth2", scopes }
}

async function authenticateMcpRequest(request: Request, env: Env, origin: string): Promise<AccessPayload | Response> {
  const header = request.headers.get("authorization") || ""
  if (!header.startsWith("Bearer ")) return oauthChallenge(origin)
  try {
    const token = header.slice("Bearer ".length).trim()
    const payload = await unsealJson<AccessPayload>(env, token)
    if (payload.typ !== "access" || payload.exp < nowSeconds()) return oauthChallenge(origin)
    return payload
  } catch {
    return oauthChallenge(origin)
  }
}

function oauthChallenge(origin: string): Response {
  return new Response(null, {
    status: 401,
    headers: {
      "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
    },
  })
}

async function listGroups(env: Env, auth: AccessPayload) {
  requireScope(auth, "groups.read")
  const groups = await api<GroupSummary[]>(env, auth, "/groups")
  return groups.map(groupSummaryForTool)
}

async function getGroup(env: Env, auth: AccessPayload, groupId: string) {
  requireScope(auth, "groups.read")
  const group = await api<Group>(env, auth, `/groups/${encodeURIComponent(groupId)}`)
  return groupForTool(group)
}

async function recordExpense(env: Env, auth: AccessPayload, args: any) {
  requireScope(auth, "expenses.write")
  const groupId = requiredString(args.groupId, "groupId")
  const amount = requiredPositiveInteger(args.amount, "amount")
  const participants = requiredStringArray(args.participants, "participants")
  const payer = args.payer === undefined ? auth.accountKey : requiredString(args.payer, "payer")
  const body: Record<string, unknown> = {
    type: "expense",
    payer,
    amount,
    participants,
    split: "equal",
  }
  if (args.note !== undefined && String(args.note).trim()) body.note = String(args.note).trim()
  if (args.date !== undefined) body.ts = requiredPositiveInteger(args.date, "date")
  const event = await api(env, auth, `/groups/${encodeURIComponent(groupId)}/events`, {
    method: "POST",
    body: JSON.stringify(body),
  })
  return { ok: true, event }
}

function groupSummaryForTool(g: GroupSummary) {
  return {
    id: g.id,
    name: g.name,
    currency: g.currency,
    role: g.role,
    finalized: !!g.finalizedAt,
    expenseCount: g.eventCount,
    members: membersForTool(g.members, g.profiles),
  }
}

function groupForTool(g: Group) {
  return {
    id: g.id,
    name: g.name,
    currency: g.currency,
    owner: g.owner,
    finalized: !!g.finalizedAt,
    members: membersForTool(g.members, g.profiles),
  }
}

function membersForTool(members: string[], profiles?: Record<string, UserProfile>) {
  return members.map(key => ({
    key,
    displayName: profiles?.[key]?.displayName || key,
    kind: profiles?.[key]?.kind || "account",
  }))
}

async function api<T>(env: Env, auth: AccessPayload, path: string, init: RequestInit = {}): Promise<T> {
  const base = (env.SPLITSTUPID_API_URL || "https://api.splitstupid.lfkdsk.org").replace(/\/$/, "")
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${auth.splitstupidSession}`)
  if (init.body) headers.set("content-type", "application/json")
  const res = await fetch(base + path, { ...init, headers })
  const textBody = await res.text()
  if (!res.ok) {
    let message = textBody
    try {
      const parsed = JSON.parse(textBody)
      if (parsed?.error) message = parsed.error
    } catch {
      // keep raw text
    }
    throw new Error(message || `SplitStupid API HTTP ${res.status}`)
  }
  return textBody ? JSON.parse(textBody) as T : undefined as T
}

async function exchangeGitHubCode(env: Env, origin: string, code: string): Promise<string> {
  const body = new URLSearchParams()
  body.set("client_id", env.GITHUB_CLIENT_ID!)
  body.set("client_secret", env.GITHUB_CLIENT_SECRET!)
  body.set("code", code)
  body.set("redirect_uri", `${origin}/oauth/github/callback`)
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "accept": "application/json", "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  const jsonBody = await res.json<any>()
  if (!res.ok || !jsonBody.access_token) {
    throw new Error(jsonBody.error_description || jsonBody.error || "GitHub OAuth exchange failed")
  }
  return jsonBody.access_token
}

async function exchangeSplitStupidSession(env: Env, githubToken: string): Promise<AuthSession> {
  const base = (env.SPLITSTUPID_API_URL || "https://api.splitstupid.lfkdsk.org").replace(/\/$/, "")
  const res = await fetch(`${base}/auth/github`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: githubToken }),
  })
  const textBody = await res.text()
  if (!res.ok) {
    let message = textBody
    try {
      const parsed = JSON.parse(textBody)
      if (parsed?.error) message = parsed.error
    } catch {
      // keep raw text
    }
    throw new Error(message || "SplitStupid auth failed")
  }
  return JSON.parse(textBody) as AuthSession
}

async function sealJson(env: Env, value: unknown): Promise<string> {
  const secret = requireEnv(env.TOKEN_SECRET, "TOKEN_SECRET")
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(secret)
  const plaintext = utf8Encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(plaintext),
  ))
  return `sst1.${base64Url(iv)}.${base64Url(ciphertext)}`
}

async function unsealJson<T>(env: Env, sealed: string): Promise<T> {
  const secret = requireEnv(env.TOKEN_SECRET, "TOKEN_SECRET")
  const [prefix, rawIv, rawCiphertext] = sealed.split(".")
  if (prefix !== "sst1" || !rawIv || !rawCiphertext) throw new Error("invalid token")
  const key = await aesKey(secret)
  const iv = base64UrlDecode(rawIv)
  const ciphertext = base64UrlDecode(rawCiphertext)
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(ciphertext),
  )
  return JSON.parse(utf8Decode(new Uint8Array(plaintext))) as T
}

async function signState(env: Env, value: AuthorizeState): Promise<string> {
  const payload = base64Url(utf8Encode(JSON.stringify(value)))
  const sig = await hmac(env, payload)
  return `ssj.${payload}.${base64Url(sig)}`
}

async function verifyState<T extends { exp: number }>(env: Env, signed: string): Promise<T> {
  const [prefix, payload, sig] = signed.split(".")
  if (prefix !== "ssj" || !payload || !sig) throw new Error("invalid state")
  const expected = await hmac(env, payload)
  if (!constantTimeEqual(base64UrlDecode(sig), expected)) throw new Error("invalid state signature")
  return JSON.parse(utf8Decode(base64UrlDecode(payload))) as T
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", bufferSource(utf8Encode(secret)))
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

async function hmac(env: Env, message: string): Promise<Uint8Array> {
  const secret = requireEnv(env.TOKEN_SECRET, "TOKEN_SECRET")
  const key = await crypto.subtle.importKey(
    "raw",
    bufferSource(utf8Encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bufferSource(utf8Encode(message))))
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bufferSource(utf8Encode(verifier)))
  return base64Url(new Uint8Array(digest))
}

function parseScopes(scope: string | null): string[] {
  const requested = (scope || DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean)
  const unknown = requested.filter(s => !SUPPORTED_SCOPES.includes(s as any))
  if (unknown.length > 0) throw new Error(`unsupported scope: ${unknown.join(", ")}`)
  return requested.length > 0 ? requested : DEFAULT_SCOPES
}

function requireScope(auth: AccessPayload, scope: string): void {
  if (!auth.scopes.includes(scope)) throw new Error(`missing required scope: ${scope}`)
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (!value) throw new Error(`${name} required`)
  return value
}

function requiredBody(body: Record<string, string>, name: string): string {
  const value = body[name]
  if (!value) throw new Error(`${name} required`)
  return value
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a non-empty array`)
  return value.map((item, index) => requiredString(item, `${name}[${index}]`))
}

function requiredPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

async function readFormish(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || ""
  if (contentType.includes("application/json")) return await request.json()
  const form = await request.formData()
  const out: Record<string, string> = {}
  for (const [key, value] of form.entries()) out[key] = String(value)
  return out
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result }
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

function toolResult(id: JsonRpcRequest["id"], value: unknown) {
  return rpcResult(id, {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  })
}

function oauthTokenError(error: string, description: string): Response {
  return json({ error, error_description: description }, 400)
}

function oauthRedirectError(url: URL, error: string, description?: string): Response {
  const redirectUri = url.searchParams.get("redirect_uri")
  if (!redirectUri) return json({ error, error_description: description }, 400)
  const target = new URL(redirectUri)
  target.searchParams.set("error", error)
  if (description) target.searchParams.set("error_description", description)
  const state = url.searchParams.get("state")
  if (state) target.searchParams.set("state", state)
  return redirect(target.toString())
}

function redirectOAuthError(state: AuthorizeState, error: string): Response {
  const target = new URL(state.redirectUri)
  target.searchParams.set("error", error)
  if (state.userState) target.searchParams.set("state", state.userState)
  return redirect(target.toString())
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function text(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } })
}

function connectorOrigin(request: Request, env: Env): string {
  return (env.CONNECTOR_ORIGIN || new URL(request.url).origin).replace(/\/$/, "")
}

function pickAllowedOrigin(origin: string | null, env: Env): string {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
  if (origin && allowed.includes(origin)) return origin
  return allowed[0] || "*"
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
    "access-control-expose-headers": "www-authenticate",
    "access-control-max-age": "86400",
    "vary": "origin",
  }
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function utf8Decode(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function bufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function base64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
