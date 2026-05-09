// Identity introspection. Whatever bearer token the frontend is holding
// — a GitHub OAuth token or a magic-link session — gets resolved to a
// unified `Me` shape by the Worker's /auth/me endpoint. Previously we
// called GitHub /user directly, but that only worked for one of the two
// auth schemes; routing through our own Worker keeps the frontend
// agnostic about which kind of token it has.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

export interface Me {
  /** The opaque identifier stored in groups.owner_login / members.login /
   *  events.author_login. A GitHub username for GH users; an email
   *  address for magic-link users. */
  login: string
  /** Which auth scheme issued the bearer token. */
  kind: 'github' | 'email'
  /** What to show in the header pill — for emails this is the local-part. */
  displayName: string
  /** Only set for github-kind. Magic-link users get a Monogram fallback. */
  avatarUrl?: string
}

export async function fetchMe(token: string): Promise<Me> {
  if (!API_URL) throw new Error('VITE_API_URL is not configured')
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { 'authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`auth/me returned ${res.status}`)
  return res.json() as Promise<Me>
}
