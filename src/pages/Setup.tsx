import { isOAuthConfigured, startOAuthFlow } from '../lib/oauth'

export default function Setup({
  authError,
  onDismissError,
}: {
  authError: string | null
  onDismissError: () => void
}) {
  return (
    <div className="app">
      <div className="card" style={{ marginTop: 80 }}>
        <h1 style={{ marginTop: 0 }}>SplitStupid</h1>
        <p className="muted">A Splitwise-shaped ledger that lives in a GitHub Gist.</p>
        {authError && (
          <div className="error">
            Sign-in failed: {authError}
            <button
              className="secondary"
              style={{ marginLeft: 8, padding: '2px 6px', fontSize: 12 }}
              onClick={onDismissError}
            >
              ×
            </button>
          </div>
        )}
        {isOAuthConfigured()
          ? (
            <button onClick={() => startOAuthFlow()}>Sign in with GitHub</button>
          )
          : (
            <p className="error">
              OAuth isn't configured. Set <code>VITE_OAUTH_CLIENT_ID</code> and{' '}
              <code>VITE_OAUTH_WORKER_URL</code> in <code>.env</code>.
            </p>
          )
        }
      </div>
    </div>
  )
}
