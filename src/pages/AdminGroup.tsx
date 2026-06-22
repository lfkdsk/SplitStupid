// Read-only admin detail for one group. Reuses the shared useGroup hook for
// data + settlement derivation (balances, transfers, edit/void folding) — the
// exact same logic the live Group page and the RN screen run — but renders
// only the read-only sections: no add-expense form, no void / edit / finalize
// / member buttons. An admin is typically not a member, so even if a stray
// action were wired up the Worker would reject it; we just don't surface any.
import { avatarUrl, formatAmount } from '@splitstupid/core'
import { useGroup } from '@splitstupid/hooks'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdminGroup({ groupId, me }: { groupId: string; me: string }) {
  const { group, error, setError, balances, transfers, maxBalance, expenseView } = useGroup(groupId, me)

  return (
    <>
      <a href="#/admin" className="subtle muted" style={{ display: 'inline-block', marginBottom: 12 }}>
        ← All groups
      </a>

      {error && (
        <div className="error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {!group ? (
        <div className="card"><p className="empty">Loading…</p></div>
      ) : (
        <>
          <div className={`card group-header ${group.finalizedAt != null ? 'is-finalized' : ''}`}>
            {group.finalizedAt != null && (
              <div className="finalized-banner" role="status">
                <span className="finalized-stamp">FINALIZED</span>
                <span className="finalized-meta">
                  Locked {fmtDate(new Date(group.finalizedAt).toISOString())}
                  {' · '}no more expenses or member changes
                </span>
              </div>
            )}
            <h2>{group.name}</h2>
            <div className="group-header-meta">
              <span>{group.currency}</span>
              <span className="dot" />
              <span>owner <strong>{group.owner}</strong></span>
              <span className="dot" />
              <span>{group.members.length} member{group.members.length === 1 ? '' : 's'}</span>
              <span className="dot" />
              <span>created {fmtDate(new Date(group.createdAt).toISOString())}</span>
            </div>
            <div className="chip-row" style={{ marginBottom: 4 }}>
              {group.members.map(m => (
                <span key={m} className="member-chip">
                  <img src={avatarUrl(m, 36)} alt="" />
                  {m}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <h3 className="section-title">Settlement</h3>
            </div>
            {balances.every(b => b.balance === 0) ? (
              <p className="empty">All settled up.</p>
            ) : (
              <>
                <div className="balance-list">
                  {balances.map(b => {
                    const sign = b.balance > 0 ? 'positive' : b.balance < 0 ? 'negative' : 'zero'
                    const pct = maxBalance > 0
                      ? Math.min(100, Math.abs(b.balance) / maxBalance * 50)
                      : 0
                    return (
                      <div key={b.member} className="balance-row">
                        <span className="balance-name">
                          <img src={avatarUrl(b.member, 36)} alt="" />
                          <span className="login">{b.member}</span>
                        </span>
                        <div className="balance-bar">
                          <span className="balance-bar-mid" />
                          {b.balance !== 0 && (
                            <span className={`balance-bar-fill ${sign}`} style={{ width: `${pct}%` }} />
                          )}
                        </div>
                        <span className={`balance-amount ${sign}`}>
                          {b.balance > 0 ? '+' : ''}{formatAmount(b.balance, group.currency)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {transfers.length > 0 && (
                  <>
                    <p className="field-label" style={{ marginTop: 4 }}>Suggested transfers</p>
                    {transfers.map((t, i) => (
                      <div key={i} className="transfer">
                        <span className="transfer-name">
                          <img src={avatarUrl(t.from, 36)} alt="" />
                          {t.from}
                        </span>
                        <span className="transfer-arrow">→</span>
                        <span className="transfer-name">
                          <img src={avatarUrl(t.to, 36)} alt="" />
                          {t.to}
                        </span>
                        <span className="transfer-amount">{formatAmount(t.amount, group.currency)}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          <div className="card">
            <div className="section-head">
              <h3 className="section-title">Activity</h3>
              <span className="section-count">{group.events.length}</span>
            </div>
            {group.events.length === 0 && <p className="empty">No events yet.</p>}
            {[...group.events].reverse().map(e => {
              if (e.type === 'void') {
                return (
                  <div key={e.id} className="event">
                    <img src={avatarUrl(e.author, 56)} alt="" className="event-avatar" />
                    <div className="event-body">
                      <p className="event-title">
                        <span className="event-void">VOID</span> · {e.targetId}
                      </p>
                      <p className="event-meta">{e.author} · {fmtDate(e.ts)}</p>
                    </div>
                  </div>
                )
              }
              if (e.type === 'edit') {
                return (
                  <div key={e.id} className="event">
                    <img src={avatarUrl(e.author, 56)} alt="" className="event-avatar" />
                    <div className="event-body">
                      <p className="event-title">
                        <span className="event-edit">EDITED</span> · {e.targetId}
                      </p>
                      <p className="event-meta">
                        {e.author} · {fmtDate(e.ts)} · now {fmtDate(new Date(e.date).toISOString())}
                      </p>
                    </div>
                    <span className="event-amount">{formatAmount(e.amount, group.currency)}</span>
                  </div>
                )
              }
              if (e.type === 'settle') {
                return (
                  <div key={e.id} className="settle-divider" role="separator">
                    <span className="settle-divider-rule" />
                    <span className="settle-divider-label">
                      ✓ Settled up · {fmtDate(e.ts)}{e.note ? ` · ${e.note}` : ''}
                    </span>
                    <span className="settle-divider-rule" />
                  </div>
                )
              }
              const { effAmount, effDateMs, effNote, isVoided, edited } = expenseView(e)
              return (
                <div key={e.id} className={`event ${isVoided ? 'voided' : ''}`}>
                  <img src={avatarUrl(e.payer, 56)} alt="" className="event-avatar" />
                  <div className="event-body">
                    <p className="event-title">
                      <strong>{e.payer}</strong> paid{effNote ? <> for <strong>{effNote}</strong></> : null}
                      {edited && !isVoided ? <span className="event-edited-tag">edited</span> : null}
                    </p>
                    <p className="event-meta">
                      split among {e.participants.join(', ')} · {fmtDate(new Date(effDateMs).toISOString())}
                    </p>
                  </div>
                  <span className="event-amount">{formatAmount(effAmount, group.currency)}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
