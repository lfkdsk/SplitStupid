// Tiny GitHub /user lookup. Replaces what we previously did via Octokit;
// this is the only direct GitHub API call the frontend still makes.
// Everything else (groups, events) goes to our own Worker.

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
