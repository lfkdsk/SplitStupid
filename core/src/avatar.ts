// `https://github.com/<login>.png` is a public redirect to the user's
// avatar at the requested size. No auth, no API quota — works for any
// real GH login. For typo'd / fake logins it 404s; callers fall back to
// a monogram (web <img> alt-text, RN onError).
export function avatarUrl(login: string, size = 40): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`
}
