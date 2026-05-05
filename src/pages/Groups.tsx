import { useEffect, useState } from 'react'
import { createGroup, deleteGroup, listGroups, removeMember } from '../lib/api'
import type { GroupSummary } from '../types'
import { avatarUrl } from '../lib/avatar'
import ConfirmModal from '../components/ConfirmModal'

export default function Groups({ me }: { me: string }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<GroupSummary | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')

  async function refresh() {
    setError(null)
    try { setGroups(await listGroups()) }
    catch (e: any) { setError(e?.message || 'Failed to list groups'); setGroups([]) }
  }
  useEffect(() => { refresh() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const g = await createGroup({ name: name.trim(), currency })
      window.location.hash = `#/g/${g.id}`
    } catch (err: any) {
      setError(err?.message || 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  // Owner → hard delete (typed-name confirmation, since the ledger is
  // gone for everyone). Non-owner → leave (plain confirmation, since
  // they can rejoin via share link).
  function requestRemove(g: GroupSummary) {
    setPendingRemove(g)
  }

  async function confirmRemove() {
    const g = pendingRemove
    if (!g) return
    const isOwned = g.role === 'owner'
    setRemoving(g.id)
    setError(null)
    try {
      if (isOwned) await deleteGroup(g.id)
      else await removeMember(g.id, me)
      setGroups(prev => prev ? prev.filter(x => x.id !== g.id) : prev)
      setPendingRemove(null)
    } catch (err: any) {
      setError(err?.message || (isOwned ? 'Failed to delete' : 'Failed to leave'))
    } finally {
      setRemoving(null)
    }
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
          return (
            <div key={g.id} className="group-row">
              <a href={`#/g/${g.id}`} className="group-link">
                <div className="avatar-stack">
                  {g.members.slice(0, 4).map(m => (
                    <img key={m} src={avatarUrl(m, 56)} alt={m} />
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
                    {isOwned ? 'owner' : `joined · ${g.owner}`}
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
