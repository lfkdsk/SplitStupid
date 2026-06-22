import { useEffect, useState } from 'react'
import { fetchMe, setApiToken } from '@splitstupid/core'
import { clearToken, consumeOAuthCallback, loadToken, saveToken } from './lib/oauth'
import { isAdmin } from './lib/admin'
import Setup from './pages/Setup'
import Invite from './pages/Invite'
import Groups from './pages/Groups'
import Group from './pages/Group'
import Admin from './pages/Admin'
import AdminGroup from './pages/AdminGroup'
import { UserMenu } from './components/UserMenu'

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
  // fall back to a stashed token from localStorage. Validate by calling
  // GitHub /user — if that succeeds, we know the token still works.
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
      setApiToken(t)
      try {
        const user = await fetchMe(t)
        if (cancelled) return
        setToken(t)
        setMe({ login: user.login, avatar: user.avatar_url })
      } catch {
        clearToken()
        setApiToken(null)
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
    setApiToken(null)
    setToken(null)
    setMe(null)
    window.location.hash = '#/'
  }

  if (booting) return <div className="app"><p className="muted">Loading…</p></div>

  const groupMatch = hash.match(/^#\/g\/([A-Za-z0-9]+)$/)
  // Admin routes (#/admin, #/admin/g/<id>) are only honoured for admin logins;
  // a non-admin who types the URL just falls through to their own dashboard.
  // The server is the real gate — these checks only keep the UI tidy.
  const adminGroupMatch = hash.match(/^#\/admin\/g\/([A-Za-z0-9]+)$/)

  if (!token || !me) {
    // A share link (#/g/<id>) opened by someone signed-out gets a
    // dedicated invite page that names the inviter — only fall back
    // to the generic landing for plain visits.
    if (groupMatch) {
      return (
        <Invite
          groupId={groupMatch[1]}
          authError={authError}
          onDismissError={() => setAuthError(null)}
        />
      )
    }
    return <Setup authError={authError} onDismissError={() => setAuthError(null)} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <a href="#/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          SplitStupid
        </a>
        <UserMenu login={me.login} avatar={me.avatar} onSignOut={signOut} />
      </header>
      {isAdmin(me.login) && adminGroupMatch
        ? <AdminGroup groupId={adminGroupMatch[1]} me={me.login} />
        : isAdmin(me.login) && hash === '#/admin'
          ? <Admin />
          : groupMatch
            ? <Group groupId={groupMatch[1]} me={me.login} />
            : <Groups me={me.login} />}
    </div>
  )
}
