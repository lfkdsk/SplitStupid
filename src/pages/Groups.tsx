import { useEffect, useState } from 'react'
import {
  createLedger,
  deleteLedger,
  listLedgers,
  type LedgerHandle,
} from '../lib/gist'
import { listJoinedLedgers, recordLeave } from '../lib/joined'
import { avatarUrl } from '../lib/avatar'

export default function Groups({ me }: { me: string }) {
  const [groups, setGroups] = useState<LedgerHandle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('JPY')

  async function refresh() {
    setError(null)
    try {
      // Owned and joined are independent reads — fire in parallel. Then
      // dedupe by gistId (a user joining a group they already own would
      // appear twice otherwise; owner wins).
      const [owned, joined] = await Promise.all([
        listLedgers(),
        listJoinedLedgers().catch(() => [] as LedgerHandle[]),
      ])
      const seen = new Set<string>()
      const merged: LedgerHandle[] = []
      for (const h of [...owned, ...joined]) {
        if (seen.has(h.gistId)) continue
        seen.add(h.gistId)
        merged.push(h)
      }
      setGroups(merged)
    } catch (e: any) {
      setError(e?.message || 'Failed to list ledgers'); setGroups([])
    }
  }
  useEffect(() => { refresh() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      // Owner is the only initial member. Everyone else joins by scanning
      // the share QR — see Group page's join CTA.
      const handle = await createLedger({ name: name.trim(), currency, owner: me, members: [] })
      window.location.hash = `#/g/${handle.gistId}`
    } catch (err: any) {
      setError(err?.message || 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  // Owner → hard delete the underlying ledger (gone for everyone).
  // Joiner → "leave"; just removes the entry from the user's index, the
  // group continues to exist and they can rejoin from the share link.
  async function handleRemove(g: LedgerHandle) {
    const isOwned = g.ledger.owner === me
    const ok = window.confirm(
      isOwned
        ? `Delete group "${g.ledger.name}"? The ledger and its full history will be gone for good.`
        : `Remove "${g.ledger.name}" from your list? The group will still exist; you can rejoin from the share link.`,
    )
    if (!ok) return
    setRemoving(g.gistId)
    setError(null)
    try {
      if (isOwned) await deleteLedger(g.gistId)
      else await recordLeave(g.gistId)
      setGroups(prev => prev ? prev.filter(x => x.gistId !== g.gistId) : prev)
    } catch (err: any) {
      setError(err?.message || (isOwned ? 'Failed to delete' : 'Failed to remove'))
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
              <option>JPY</option>
              <option>USD</option>
              <option>EUR</option>
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
          const isOwned = g.ledger.owner === me
          return (
            <div key={g.gistId} className="group-row">
              <a href={`#/g/${g.gistId}`} className="group-link">
                <div className="avatar-stack">
                  {g.ledger.members.slice(0, 4).map(m => (
                    <img key={m} src={avatarUrl(m, 56)} alt={m} />
                  ))}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 className="group-name">{g.ledger.name}</h3>
                  <p className="group-meta">
                    {isOwned ? 'owner' : `joined · ${g.ledger.owner}`}
                    {' · '}{g.ledger.currency}
                    {' · '}{visibleEventCount(g)} event{visibleEventCount(g) === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="group-link-chev">→</span>
              </a>
              <button
                type="button"
                className="group-delete"
                onClick={() => handleRemove(g)}
                disabled={removing === g.gistId}
                title={isOwned ? 'Delete group' : 'Remove from your list'}
                aria-label={isOwned ? 'Delete group' : 'Remove from your list'}
              >
                {removing === g.gistId ? '…' : (isOwned ? <TrashIcon /> : <LeaveIcon />)}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

function visibleEventCount(g: LedgerHandle): number {
  const voided = new Set(
    g.ledger.events.filter(e => e.type === 'void').map(e => e.targetId),
  )
  return g.ledger.events.filter(e => e.type === 'expense' && !voided.has(e.id)).length
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
