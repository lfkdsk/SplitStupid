// Avatar URL for an arbitrary identifier. Two shapes:
//
//   - GitHub login (no "@"): `https://github.com/<login>.png` — public
//     redirect to the user's avatar at the requested size. No auth, no
//     API quota; 404s for typo'd / fake logins.
//   - Email address (contains "@"): no GitHub avatar to fetch, so we
//     synthesize a deterministic colored SVG with the local-part's first
//     letter as a data URI. Same look & palette as the in-page Monogram
//     component, just packaged as a URL so existing <img src=…> callsites
//     keep working without conditional rendering.

export function avatarUrl(login: string, size = 40): string {
  if (login.includes('@')) return monogramDataUri(login, size)
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`
}

// 5 palette slots, deterministically picked by FNV-1a hash of the input.
// Mirrors MONOGRAM_PAIRS in src/pages/Setup.tsx — kept in sync by hand
// since they're small and rarely change.
const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#f1c597', '#c2410c'],
  ['#d6c5a0', '#6f6356'],
  ['#e8b3b3', '#9f1239'],
  ['#b8d49a', '#3f6212'],
  ['#cab5e0', '#6b46c1'],
]

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function monogramDataUri(identifier: string, size: number): string {
  const ch = (identifier[0] || '?').toUpperCase()
  const [bg, fg] = PALETTE[hashString(identifier) % PALETTE.length]
  // Inline SVG, base64-free (URL-encode only what XML actually requires).
  // The gradient + letter mirrors the CSS Monogram so the two render
  // identically when seen side-by-side.
  const fontSize = Math.round(size * 0.55)
  const id = `g${hashString(identifier).toString(16).slice(0, 6)}`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0%" stop-color="${bg}"/>` +
        `<stop offset="100%" stop-color="${fg}"/>` +
      `</linearGradient></defs>` +
      `<rect width="${size}" height="${size}" fill="url(#${id})"/>` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="system-ui,-apple-system,Segoe UI,sans-serif" ` +
        `font-size="${fontSize}" font-weight="600" fill="#fff">${escapeXml(ch)}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!
  ))
}

/** Display-friendly name. For emails this is the local-part (before "@");
 *  for GitHub logins it's the login as-is. Useful in places where the
 *  full email would be too long for a header pill or member chip. */
export function displayName(identifier: string): string {
  const at = identifier.indexOf('@')
  return at > 0 ? identifier.slice(0, at) : identifier
}
