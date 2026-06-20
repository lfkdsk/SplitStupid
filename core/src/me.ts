// Tiny GitHub /user lookup — the only direct GitHub API call any client
// still makes. Everything else (groups, events) goes to our own Worker.
// Pure fetch, so it runs unchanged on web and React Native.

export interface GitHubUser {
  login: string
  avatar_url: string
}

export async function fetchMe(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'authorization': `Bearer ${token}`,
      'accept': 'application/vnd.github+json',
    },
  })
  if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`)
  return res.json() as Promise<GitHubUser>
}
