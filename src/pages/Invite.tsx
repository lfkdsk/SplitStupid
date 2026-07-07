import { memberAvatarUrl, memberDisplayName } from '@splitstupid/core'
import { useInvite } from '@splitstupid/hooks'
import { isOAuthConfigured, startOAuthFlow } from '../lib/oauth'
import Setup from './Setup'

// Share-link landing for unauthenticated visitors. Replaces the generic
// product landing when the URL is `#/g/<id>` so the recipient sees who
// invited them and what they're being asked to join — before going
// through OAuth. The OAuth flow stashes the deep-link hash, so on return
// the user lands directly on the group page (where Group.tsx renders
// the join CTA).
export default function Invite({
  groupId,
  authError,
  onDismissError,
}: {
  groupId: string
  authError: string | null
  onDismissError: () => void
}) {
  const { invite, loading, error } = useInvite(groupId)

  // Bad/expired link → fall back to the regular landing so the visitor
  // can still see what the product is about and sign in. We don't surface
  // the fetch error: a typo'd group id isn't a sign-in failure.
  if (!loading && (error || !invite)) {
    return <Setup authError={authError} onDismissError={onDismissError} />
  }

  return (
    <div className="landing">
      <main className="landing-stage invite-stage">
        <section className="landing-hero invite-hero">
          <div className="landing-logo" aria-hidden="true">S</div>
          <p className="landing-eyebrow">You've been invited</p>

          {loading || !invite ? (
            <p className="muted invite-loading">Loading invite…</p>
          ) : (
            <>
              {(() => {
                const ownerName = memberDisplayName(invite.owner, invite.profiles)
                const ownerAvatar = memberAvatarUrl(invite.owner, invite.profiles, 64)
                return (
              <div className="invite-card">
                <div className="invite-owner">
                  <img
                    src={ownerAvatar}
                    alt=""
                    className="invite-owner-avatar"
                  />
                  <div className="invite-owner-text">
                    <span className="invite-owner-label">Owner</span>
                    <strong className="invite-owner-login">{ownerName}</strong>
                  </div>
                </div>
                <p className="invite-prose">
                  invited you to join
                </p>
                <h1 className="invite-title">{invite.name}</h1>
                <p className="invite-meta">
                  <span className="invite-meta-id">No. {invite.id}</span>
                  <span className="dot" />
                  <span>{invite.currency}</span>
                  <span className="dot" />
                  <span>
                    {invite.memberCount} member{invite.memberCount === 1 ? '' : 's'}
                  </span>
                  {invite.finalized && (
                    <>
                      <span className="dot" />
                      <span className="invite-meta-finalized">finalized</span>
                    </>
                  )}
                </p>
              </div>
                )
              })()}

              {invite.finalized ? (
                <p className="invite-note muted">
                  This trip is closed — you can sign in to view the receipt,
                  but the roster is frozen.
                </p>
              ) : (
                <p className="invite-note muted">
                  Sign in with GitHub to add yourself to the roster. Your
                  expenses get split with the rest of the group.
                </p>
              )}

              {authError && (
                <div className="error landing-error">
                  <span>Sign-in failed: {authError}</span>
                  <button onClick={onDismissError} aria-label="Dismiss">×</button>
                </div>
              )}

              {isOAuthConfigured() ? (
                <button className="landing-cta" onClick={() => startOAuthFlow()}>
                  <GitHubMark /> Sign in with GitHub
                </button>
              ) : (
                <div className="error landing-error">
                  OAuth isn't configured. Set <code>VITE_OAUTH_CLIENT_ID</code> and{' '}
                  <code>VITE_OAUTH_WORKER_URL</code> in <code>.env</code>.
                </div>
              )}

              <p className="landing-fineprint">
                No new account · Free · Open source
              </p>
            </>
          )}
        </section>

        <p className="invite-footnote">
          <a href="#/" className="invite-footnote-link">
            What is SplitStupid?
          </a>
          <span className="invite-footnote-dot"> · </span>
          <a href="/privacy.html" className="invite-footnote-link">
            Privacy Policy
          </a>
        </p>
      </main>
    </div>
  )
}

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  )
}
