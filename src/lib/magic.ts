// Magic-link email auth — frontend half. Mirrors lib/oauth.ts in spirit:
// this module owns the "request a link" call, the post-click callback
// fragment parsing, and the resulting session token. The token is the
// same kind of thing as a GH OAuth token from the Worker's perspective
// (just a Bearer string) and rides through the same TOKEN_KEY in
// localStorage that lib/oauth.ts uses, so App.tsx doesn't need to know
// which scheme issued the token it's holding.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

// Stash the deep-link hash (e.g. "#/g/abc123") that the user landed on
// before kicking off email sign-in, so the post-callback URL can restore
// it instead of dropping the user on the home screen — same pattern as
// lib/oauth.ts but with a separate key so the two flows can't stomp on
// each other if a user juggles tabs.
const RETURN_TO_KEY = 'splitstupid_magic_return_to'

export function isMagicLinkConfigured(): boolean {
  // The Worker decides whether email auth is actually enabled (based on
  // RESEND_API_KEY); the frontend just needs an API URL to ask. We let
  // the Setup page do an optimistic render and surface a 503 from the
  // Worker if the deployment isn't email-ready.
  return !!API_URL
}

export interface RequestMagicLinkResult {
  ok: boolean
  /** When ok = false, a human-readable reason. */
  error?: string
}

/** POST /auth/magic/request — Worker emails the link. Returns ok:true even
 *  on "no such email registered" so we can't be used to enumerate users.
 *  Errors here are real ones (validation, 503 not configured, network). */
export async function requestMagicLink(email: string): Promise<RequestMagicLinkResult> {
  if (!API_URL) return { ok: false, error: 'VITE_API_URL is not configured' }
  // Stash any current deep link before navigating away to "check your
  // inbox" UI. The user might open the link in a different tab, but
  // honoring the original deep link if they DO click in this one is a
  // small nicety — same trick as lib/oauth.ts.
  const currentHash = window.location.hash
  if (currentHash.startsWith('#/') && currentHash !== '#/') {
    sessionStorage.setItem(RETURN_TO_KEY, currentHash)
  } else {
    sessionStorage.removeItem(RETURN_TO_KEY)
  }
  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/magic/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' }
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) msg = body.error
    } catch { /* not json */ }
    return { ok: false, error: msg }
  }
  return { ok: true }
}

export interface MagicCallback {
  ok: boolean
  token: string | null
  error: string | null
}

/** If the URL fragment carries a magic-link callback (`#magic_token=…`),
 *  trade it for a session token. Returns null when the fragment doesn't
 *  look like a magic-link callback at all. Clears the fragment + restores
 *  the pre-flow deep link, same as consumeOAuthCallback. */
export async function consumeMagicCallback(): Promise<MagicCallback | null> {
  if (!API_URL) return null
  const hash = window.location.hash
  if (!hash || hash.length < 2) return null
  // Hash-routing fragments (#/foo) are ours, not magic-link callbacks.
  if (hash.startsWith('#/')) return null
  const params = new URLSearchParams(hash.slice(1))
  const token = params.get('magic_token')
  if (!token) return null

  // Clear the fragment & restore deep link before the network call so a
  // refresh mid-verify doesn't double-consume the (one-time-use) token.
  const stashed = sessionStorage.getItem(RETURN_TO_KEY)
  sessionStorage.removeItem(RETURN_TO_KEY)
  const restored = stashed && stashed.startsWith('#/') && stashed !== '#/' ? stashed : ''
  history.replaceState(null, '', window.location.pathname + window.location.search + restored)
  if (restored) window.dispatchEvent(new Event('hashchange'))

  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/magic/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch (e: any) {
    return { ok: false, token: null, error: e?.message || 'network error' }
  }
  let body: { token?: string; error?: string } = {}
  try { body = await res.json() } catch { /* not json */ }
  if (!res.ok || !body.token) {
    return { ok: false, token: null, error: body.error || `HTTP ${res.status}` }
  }
  return { ok: true, token: body.token, error: null }
}

/** Best-effort: tell the Worker to revoke the session row. Failures are
 *  ignored — the local clearToken() is what actually matters. */
export async function revokeSession(token: string): Promise<void> {
  if (!API_URL) return
  try {
    await fetch(`${API_URL}/auth/signout`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}` },
    })
  } catch { /* ignore */ }
}
