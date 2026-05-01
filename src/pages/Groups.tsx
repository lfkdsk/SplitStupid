import { useEffect, useState } from 'react'
import {
  createLedger,
  deleteLedger,
  listLedgers,
  type LedgerHandle,
} from '../lib/gist'
import { avatarUrl } from '../lib/avatar'

export default function Groups({ me }: { me: string }) {
  const [groups, setGroups] = useState<LedgerHandle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('JPY')

  async function refresh() {
    setError(null)
    try { setGroups(await listLedgers()) }
    catch (e: any) { setError(e?.message || 'Failed to list ledgers'); setGroups([]) }
  }
  useEffect(() => { refresh() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      // Owner is the only initial member. Everyone else joins by scanning
      // the share QR — see Group page's join CTA. createLedger guarantees
      // owner is in members[].
      const handle = await createLedger({ name: name.trim(), currency, owner: me, members: [] })
      window.location.hash = `#/g/${handle.gistId}`
    } catch (err: any) {
      setError(err?.message || 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(g: LedgerHandle) {
    // window.confirm is intentional — building a custom modal for a
    // destructive action is its own UX rabbit hole; native confirm is
    // un-ambiguous and unmissable.
    const ok = window.confirm(
      `Delete group "${g.ledger.name}"? This deletes the underlying gist; the ledger and its history are gone for good.`,
    )
    if (!ok) return
    setDeleting(g.gistId)
    setError(null)
    try {
      await deleteLedger(g.gistId)
      setGroups(prev => prev ? prev.filter(x => x.gistId !== g.gistId) : prev)
    } catch (err: any) {
      setError(err?.message || 'Failed to delete')
    } finally {
      setDeleting(null)
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
        {groups && groups.map(g => (
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
                  {g.ledger.members.length} member{g.ledger.members.length === 1 ? '' : 's'}
                  {' · '}{g.ledger.currency}
                  {' · '}{visibleEventCount(g)} event{visibleEventCount(g) === 1 ? '' : 's'}
                </p>
              </div>
              <span className="group-link-chev">→</span>
            </a>
            <button
              type="button"
              className="group-delete"
              onClick={() => handleDelete(g)}
              disabled={deleting === g.gistId}
              title="Delete group"
              aria-label="Delete group"
            >
              {deleting === g.gistId ? '…' : <TrashIcon />}
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

// Show the count of *active* expenses (voids and the events they
// reference don't really represent activity in the user's mental model).
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
