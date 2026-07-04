const GROUP_ID = '([A-Za-z0-9]+)'

function fromGroupPath(path: string): string | null {
  const match = path.match(new RegExp(`^/?g/${GROUP_ID}(?:/?|[?#].*)$`))
  return match?.[1] ?? null
}

function fromSplitStupidUrl(url: URL): string | null {
  if (url.hostname === 'g') {
    const match = url.pathname.match(new RegExp(`^/${GROUP_ID}/?$`))
    return match?.[1] ?? null
  }
  return fromGroupPath(url.pathname)
}

export function extractInviteGroupId(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  const hashMatch = raw.match(new RegExp(`^#?/g/${GROUP_ID}/?$`))
  if (hashMatch) return hashMatch[1]

  const pathMatch = fromGroupPath(raw)
  if (pathMatch) return pathMatch

  try {
    const url = new URL(raw)
    if (url.protocol === 'splitstupid:') return fromSplitStupidUrl(url)

    const hashId = url.hash.startsWith('#') ? fromGroupPath(url.hash.slice(1)) : null
    if (hashId) return hashId

    return fromGroupPath(url.pathname)
  } catch {
    return null
  }
}
