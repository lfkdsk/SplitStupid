// Public config + the @splitstupid/core API wiring. These are all public
// values (the client_id travels in every authorize URL; the Worker URLs are
// public), so they live here as plain JS constants rather than app.json's
// `extra` block — a dev client bakes `Constants.expoConfig.extra` at BUILD
// time, so changing it there needs a native rebuild, whereas editing this
// file just needs a Metro reload. The web app's equivalents live in its .env.
import { configureApi } from '@splitstupid/core'

export const API_URL = 'https://api.splitstupid.lfkdsk.org'

export const OAUTH_CLIENT_ID = 'Ov23liCg29llKxJ7b0jv'

// Native OAuth uses the broker's dedicated `splitstupid-mobile` project key,
// which is mapped to splitstupid://callback in lfkdsk-auth's PROJECT_ORIGINS.
// (The web app uses the plain `splitstupid` key → the web origin.)
export const OAUTH_WORKER_URL = 'https://auth.lfkdsk.org/splitstupid-mobile'

// The custom URL scheme the broker redirects the token back to. Must match
// `scheme` in app.json and the OAUTH_WORKER_URL key's mapping in the broker.
export const APP_SCHEME = 'splitstupid'

// Call once at startup (App.tsx) before any API request.
export function bootstrapApi(): void {
  configureApi({ baseUrl: API_URL })
}
