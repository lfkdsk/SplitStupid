import { useState } from 'react'
import { memberAvatarUrl, memberDisplayName } from '@splitstupid/core'
import { useGroups } from '@splitstupid/hooks'
import type { GroupSummary } from '@splitstupid/core'
import ConfirmModal from '../components/ConfirmModal'

export default function Groups({ me }: { me: string }) {
  const { groups, error, setError, creating, create, removingId: removing, removeOrLeave } = useGroups(me)
  const [pendingRemove, setPendingRemove] = useState<GroupSummary | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const id = await create({ name, currency })
    if (id) window.location.hash = `#/g/${id}`
  }

  // Owner → hard delete (typed-name confirmation). Non-owner → leave.
  function requestRemove(g: GroupSummary) {
    setPendingRemove(g)
  }

  async function confirmRemove() {
    if (!pendingRemove) return
    if (await removeOrLeave(pendingRemove)) setPendingRemove(null)
  }

  return (
    <>
      {error && (
        <div className="error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="card">
        <h2 className="section-title lg" style={{ marginBottom: 4 }}>New group</h2>
        <p className="subtle muted" style={{ marginTop: 0, marginBottom: 16 }}>
          You start as the only member. Share the group's QR — anyone who scans
          it and signs in can join themselves.
        </p>
        <form onSubmit={handleCreate} className="form-stack">
          <div className="row">
            <input
              placeholder="Group name (e.g. Tokyo trip)"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
            <select className="currency-select" value={currency} onChange={e => setCurrency(e.target.value)}>
              <option>USD</option>
              <option>EUR</option>
              <option>JPY</option>
              <option>CNY</option>
              <option>GBP</option>
            </select>
          </div>
          <div>
            <button type="submit" disabled={creating || !name.trim()}>
              {creating ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="section-head">
          <h2 className="section-title">Your groups</h2>
          <span className="section-count">
            {groups === null ? '—' : groups.length}
          </span>
        </div>
        {groups === null && <p className="empty">Loading…</p>}
        {groups && groups.length === 0 && <p className="empty">No groups yet — create one above.</p>}
        {groups && groups.map(g => {
          const isOwned = g.role === 'owner'
          const memberName = (m: string) => memberDisplayName(m, g.profiles)
          const memberAvatar = (m: string, size: number) => memberAvatarUrl(m, g.profiles, size)
          return (
            <div key={g.id} className="group-row">
              <a href={`#/g/${g.id}`} className="group-link">
                <div className="avatar-stack">
                  {g.members.slice(0, 4).map(m => (
                    <img key={m} src={memberAvatar(m, 56)} alt={memberName(m)} />
                  ))}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 className="group-name">
                    {g.name}
                    {g.finalizedAt != null && (
                      <span className="group-finalized-tag" title="Finalized">finalized</span>
                    )}
                  </h3>
                  <p className="group-meta">
                    {isOwned ? 'owner' : `joined · ${memberName(g.owner)}`}
                    {' · '}{g.currency}
                    {' · '}{g.eventCount} event{g.eventCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="group-link-chev">→</span>
              </a>
              <button
                type="button"
                className="group-delete"
                onClick={() => requestRemove(g)}
                disabled={removing === g.id}
                title={isOwned ? 'Delete group' : 'Leave group'}
                aria-label={isOwned ? 'Delete group' : 'Leave group'}
              >
                {removing === g.id ? '…' : (isOwned ? <TrashIcon /> : <LeaveIcon />)}
              </button>
            </div>
          )
        })}
      </div>

      <ConfirmModal
        open={pendingRemove !== null}
        title={pendingRemove?.role === 'owner' ? 'Delete group' : 'Leave group'}
        body={pendingRemove?.role === 'owner' ? (
          <>
            <p>
              You're about to delete <strong>{pendingRemove?.name}</strong>. The full
              ledger — every expense, void, and member — will be erased for everyone, not
              just you.
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              This cannot be undone.
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>
            Leave <strong>{pendingRemove?.name}</strong>? The group keeps running without
            you; rejoin any time from the share link.
          </p>
        )}
        confirmLabel={pendingRemove?.role === 'owner' ? 'Delete group' : 'Leave group'}
        tone="danger"
        requirePhrase={pendingRemove?.role === 'owner' ? pendingRemove?.name : undefined}
        busy={removing === pendingRemove?.id}
        onCancel={() => { if (removing === null) setPendingRemove(null) }}
        onConfirm={confirmRemove}
      />
    </>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4h10M5 4V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V4M3 4l.5 7.5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L11 4M6 6.5v4M8 6.5v4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function LeaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 2.5H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2M9 4.5L11.5 7M11.5 7L9 9.5M11.5 7H6"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
