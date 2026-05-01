import { useEffect, useState } from 'react'
import { initClient, getAuthenticatedUser } from './lib/github'
import { clearToken, consumeOAuthCallback, loadToken, saveToken } from './lib/oauth'
import Setup from './pages/Setup'
import Groups from './pages/Groups'
import Group from './pages/Group'

interface Me {
  login: string
  avatar: string
}

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

  // One-shot boot: consume an OAuth callback fragment if present, then
  // fall back to a stashed token from localStorage.
  useEffect(() => {
    let cancelled = false
    async function boot() {
      const cb = consumeOAuthCallback()
      if (cb) {
        if (!cb.ok) {
          setAuthError(cb.error)
          setBooting(false)
          return
        }
        if (cb.token) saveToken(cb.token)
      }
      const t = loadToken()
      if (!t) { setBooting(false); return }
      initClient(t)
      try {
        const user = await getAuthenticatedUser()
        if (cancelled) return
        setToken(t)
        setMe({ login: user.login, avatar: user.avatar_url })
      } catch {
        clearToken()
        setAuthError('Stored token rejected by GitHub. Sign in again.')
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  function signOut() {
    clearToken()
    setToken(null)
    setMe(null)
    window.location.hash = '#/'
  }

  if (booting) return <div className="app"><p className="muted">Loading…</p></div>

  if (!token || !me) {
    return <Setup authError={authError} onDismissError={() => setAuthError(null)} />
  }

  const groupMatch = hash.match(/^#\/g\/([A-Za-z0-9]+)$/)

  return (
    <div className="app">
      <header className="app-header">
        <a href="#/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          SplitStupid
        </a>
        <div className="user-pill">
          <img src={me.avatar} alt="" />
          <span className="user-pill-name">{me.login}</span>
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      {groupMatch
        ? <Group gistId={groupMatch[1]} me={me.login} />
        : <Groups me={me.login} />}
    </div>
  )
}
