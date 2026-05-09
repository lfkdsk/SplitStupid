import { useEffect, useState } from 'react'
import { fetchMe, type Me } from './lib/me'
import { setApiToken } from './lib/api'
import { clearToken, consumeOAuthCallback, loadToken, saveToken } from './lib/oauth'
import { consumeMagicCallback, revokeSession } from './lib/magic'
import { avatarUrl } from './lib/avatar'
import Setup from './pages/Setup'
import Groups from './pages/Groups'
import Group from './pages/Group'

// Bare-bones hash router: #/ → list, #/g/<id> → detail. Splitting this
// into react-router for three views would be over-engineering.
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const hash = useHashRoute()

  // One-shot boot: handle whichever sign-in callback fragment is on the
  // URL (GitHub OAuth or magic-link), otherwise fall back to a stashed
  // token from localStorage. Either way we validate by calling /auth/me
  // — if that succeeds, we know the token still works.
  useEffect(() => {
    let cancelled = false
    async function boot() {
      // Magic-link callback first: it does its own network round-trip
      // (POST /auth/magic/verify) so we await before checking OAuth.
      const magic = await consumeMagicCallback()
      if (magic) {
        if (!magic.ok) {
          setAuthError(magic.error || 'Magic-link sign-in failed.')
          setBooting(false)
          return
        }
        if (magic.token) saveToken(magic.token)
      } else {
        const cb = consumeOAuthCallback()
        if (cb) {
          if (!cb.ok) {
            setAuthError(cb.error)
            setBooting(false)
            return
          }
          if (cb.token) saveToken(cb.token)
        }
      }
      const t = loadToken()
      if (!t) { setBooting(false); return }
      setApiToken(t)
      try {
        const user = await fetchMe(t)
        if (cancelled) return
        setToken(t)
        setMe(user)
      } catch {
        clearToken()
        setApiToken(null)
        setAuthError('Stored token rejected. Sign in again.')
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  function signOut() {
    // For magic-link sessions, ask the Worker to revoke the row too.
    // Fire-and-forget — the local clearToken below is what unblocks the
    // UI, and the Worker call has no UX-visible effect.
    const t = loadToken()
    if (t && t.startsWith('mls_')) revokeSession(t)
    clearToken()
    setApiToken(null)
    setToken(null)
    setMe(null)
    window.location.hash = '#/'
  }

  if (booting) return <div className="app"><p className="muted">Loading…</p></div>

  if (!token || !me) {
    return <Setup authError={authError} onDismissError={() => setAuthError(null)} />
  }

  const groupMatch = hash.match(/^#\/g\/([A-Za-z0-9]+)$/)
  const avatar = me.avatarUrl || avatarUrl(me.login, 40)

  return (
    <div className="app">
      <header className="app-header">
        <a href="#/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          SplitStupid
        </a>
        <div className="user-pill">
          <img src={avatar} alt="" />
          <span className="user-pill-name">{me.displayName}</span>
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      {groupMatch
        ? <Group groupId={groupMatch[1]} me={me.login} />
        : <Groups me={me.login} />}
    </div>
  )
}
