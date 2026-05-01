// GitHub OAuth (web flow) — frontend half. The shared
// auth.lfkdsk.org/splitstupid/callback Worker (lfkdsk-auth repo) handles
// the token exchange; this module owns the kickoff redirect and the
// post-callback fragment parsing. Lifted near-verbatim from FlowType
// since the lfkdsk-auth Worker contract is the same for every project.

const STATE_KEY = 'splitstupid_oauth_state'

const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID as string | undefined
const WORKER_URL = import.meta.env.VITE_OAUTH_WORKER_URL as string | undefined

export function isOAuthConfigured(): boolean {
  return !!CLIENT_ID && !!WORKER_URL
}

function genState(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// scope=gist is the minimum needed: create/read/write the user's own gists
// (public + secret) plus comment on any gist. We do NOT request `repo` —
// SplitStupid never touches repos. Narrow scope = less alarming consent
// page + smaller blast radius if a token leaks.
export function startOAuthFlow(): void {
  if (!isOAuthConfigured()) {
    throw new Error('OAuth is not configured: set VITE_OAUTH_CLIENT_ID and VITE_OAUTH_WORKER_URL')
  }
  const state = genState()
  sessionStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: `${WORKER_URL!.replace(/\/$/, '')}/callback`,
    scope: 'gist',
    state,
  })
  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`
}

export interface OAuthCallback {
  ok: boolean
  token: string | null
  scope: string | null
  error: string | null
}

// If the URL fragment carries an OAuth callback, validate state, extract
// token, and clear the fragment so a refresh doesn't re-process. Returns
// null when the fragment doesn't look like a callback at all.
export function consumeOAuthCallback(): OAuthCallback | null {
  const hash = window.location.hash
  if (!hash || hash.length < 2) return null
  // Hash-routing fragments (#/foo) are ours, not GitHub's — leave them be.
  if (hash.startsWith('#/')) return null
  const params = new URLSearchParams(hash.slice(1))
  const token = params.get('oauth_token')
  const errorParam = params.get('oauth_error')
  const stateParam = params.get('state')
  if (!token && !errorParam) return null

  history.replaceState(null, '', window.location.pathname + window.location.search)

  const expected = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  if (!expected || !stateParam || expected !== stateParam) {
    return {
      ok: false,
      token: null,
      scope: null,
      error: 'OAuth state mismatch — please try signing in again.',
    }
  }

  if (errorParam) {
    return { ok: false, token: null, scope: null, error: errorParam }
  }
  return { ok: true, token, scope: params.get('oauth_scope'), error: null }
}

const TOKEN_KEY = 'splitstupid_token'

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function saveToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}
