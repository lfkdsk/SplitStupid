// Shared Octokit client. SplitStupid only touches the gists API; everything
// else (repos, users, etc.) we don't need.

import { Octokit } from '@octokit/rest'

let _client: Octokit | null = null

// GitHub serves `Cache-Control: private, max-age=60` on contents responses.
// Force revalidation so a save→reload round-trip never serves a stale body.
function noCacheFetch(url: RequestInfo | URL, init?: RequestInit) {
  return fetch(url, { ...(init || {}), cache: 'no-cache' })
}

export function initClient(token: string | null): Octokit {
  _client = new Octokit({
    auth: token || undefined,
    request: { fetch: noCacheFetch },
  })
  return _client
}

export function getClient(): Octokit {
  if (!_client) _client = initClient(null)
  return _client
}

export async function getAuthenticatedUser() {
  const { data } = await getClient().users.getAuthenticated()
  return data
}
