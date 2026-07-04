// `https://github.com/<login>.png` is a public redirect to the user's
// avatar at the requested size. No auth, no API quota, and it works for
// any real GH login. Non-GitHub account keys get a local deterministic
// monogram so Apple-only accounts do not render as broken images.
export function avatarUrl(login: string, size = 40): string {
  if (!isLikelyGitHubLogin(login)) return monogramAvatarUrl(login, size)
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`
}

function isLikelyGitHubLogin(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)
}

function monogramAvatarUrl(login: string, size: number): string {
  const safeSize = Math.max(1, Math.round(size))
  const colors = [
    ['#0f766e', '#ecfeff'],
    ['#7c2d12', '#fff7ed'],
    ['#1d4ed8', '#eff6ff'],
    ['#166534', '#f0fdf4'],
    ['#6d28d9', '#f5f3ff'],
    ['#be123c', '#fff1f2'],
  ]
  const [background, foreground] = colors[hash(login) % colors.length]
  const label = initial(login)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${safeSize}" height="${safeSize}" viewBox="0 0 ${safeSize} ${safeSize}"><rect width="${safeSize}" height="${safeSize}" rx="${Math.round(safeSize * 0.22)}" fill="${background}"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(safeSize * 0.42)}" font-weight="700" fill="${foreground}">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function initial(login: string): string {
  const cleaned = login.replace(/^apple:/i, '').trim()
  const char = cleaned.match(/[A-Za-z0-9]/)?.[0] || '?'
  return escapeXml(char.toUpperCase())
}

function hash(input: string): number {
  let value = 0
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) >>> 0
  }
  return value
}

function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&apos;'
    }
  })
}
