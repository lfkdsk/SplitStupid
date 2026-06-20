// GitHub OAuth for native — the RN counterpart of the web's src/lib/oauth.ts.
//
// The web flow redirects the whole page to GitHub; the lfkdsk-auth broker
// exchanges code→token and bounces back to the web origin with the token in
// the URL fragment. Native can't use a page redirect, so we drive an
// ASWebAuthenticationSession (via expo-web-browser) and let the broker bounce
// the token to our custom scheme instead.
//
// The broker picks the redirect target by *project key*, not a runtime param
// (GitHub only echoes `state` back, nothing else). Its PROJECT_ORIGINS map can
// point a key at a custom scheme — exactly how the picg desktop client works
// ("picg-desktop": "picg://oauth"). So this app uses the `splitstupid-mobile`
// key: redirect_uri = .../splitstupid-mobile/callback, target = the scheme.
//
//   app → GitHub authorize (redirect_uri = .../splitstupid-mobile/callback)
//        → broker exchanges code→token
//        → splitstupid://callback/#oauth_token=…&state=…
//
// So OAUTH_WORKER_URL must point at the `-mobile` key (see config.ts/app.json),
// which must exist in lfkdsk-auth's PROJECT_ORIGINS mapped to splitstupid://callback.
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import * as Crypto from 'expo-crypto'
import { OAUTH_CLIENT_ID, OAUTH_WORKER_URL, APP_SCHEME } from '../config'

WebBrowser.maybeCompleteAuthSession()

export interface OAuthResult {
  ok: boolean
  token: string | null
  error: string | null
}

export function isOAuthConfigured(): boolean {
  return !!OAUTH_CLIENT_ID && !!OAUTH_WORKER_URL
}

export async function signInWithGitHub(): Promise<OAuthResult> {
  if (!isOAuthConfigured()) {
    return { ok: false, token: null, error: 'OAuth not configured (set oauthClientId / oauthWorkerUrl)' }
  }

  // splitstupid://callback — where the broker bounces the token back to.
  const redirectUri = AuthSession.makeRedirectUri({ scheme: APP_SCHEME, path: 'callback' })
  const state = Crypto.randomUUID()

  // redirect_uri is the broker's /callback for the `-mobile` project key; the
  // broker maps that key to splitstupid://callback and 302s the token there.
  // No scope requested — the backend only calls GitHub /user.
  const authUrl =
    'https://github.com/login/oauth/authorize?' +
    new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: `${OAUTH_WORKER_URL.replace(/\/$/, '')}/callback`,
      state,
    }).toString()

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri)

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { ok: false, token: null, error: 'cancelled' }
  }
  if (result.type !== 'success' || !result.url) {
    return { ok: false, token: null, error: 'sign-in failed' }
  }

  const cb = parseCallback(result.url)
  if (!cb.state || cb.state !== state) {
    return { ok: false, token: null, error: 'OAuth state mismatch — try again' }
  }
  if (cb.error) return { ok: false, token: null, error: cb.error }
  if (!cb.token) return { ok: false, token: null, error: 'broker returned no token' }
  return { ok: true, token: cb.token, error: null }
}

interface Callback {
  token: string | null
  state: string | null
  error: string | null
}

// The broker may put params in the fragment (#oauth_token=…, matching web)
// or the query (?oauth_token=…). Accept either.
function parseCallback(url: string): Callback {
  const hashIdx = url.indexOf('#')
  const qIdx = url.indexOf('?')
  const frag = hashIdx >= 0 ? url.slice(hashIdx + 1) : ''
  const query = qIdx >= 0 ? url.slice(qIdx + 1, hashIdx >= 0 ? hashIdx : undefined) : ''
  const p = new URLSearchParams(frag || query)
  return {
    token: p.get('oauth_token'),
    state: p.get('state'),
    error: p.get('oauth_error'),
  }
}
