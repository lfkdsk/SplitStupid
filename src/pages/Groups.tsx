import { useEffect, useState } from 'react'
import { createLedger, listLedgers, type LedgerHandle } from '../lib/gist'

export default function Groups({ me }: { me: string }) {
  const [groups, setGroups] = useState<LedgerHandle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('JPY')
  const [memberInput, setMemberInput] = useState('')

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
      const members = memberInput
        .split(/[\s,]+/)
        .map(s => s.trim())
        .filter(Boolean)
      const handle = await createLedger({ name: name.trim(), currency, owner: me, members })
      // Jump straight into the new group.
      window.location.hash = `#/g/${handle.gistId}`
    } catch (err: any) {
      setError(err?.message || 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>New group</h2>
        <form onSubmit={handleCreate}>
          <div className="row" style={{ marginBottom: 8 }}>
            <input
              placeholder="Group name (e.g. Tokyo trip)"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
            <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ flex: 0, width: 90 }}>
              <option>JPY</option>
              <option>USD</option>
              <option>EUR</option>
              <option>CNY</option>
              <option>GBP</option>
            </select>
          </div>
          <input
            placeholder={`Member GitHub logins (space or comma separated). You (${me}) are added automatically.`}
            value={memberInput}
            onChange={e => setMemberInput(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <button type="submit" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create group'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Your groups</h2>
        {groups === null && <p className="muted">Loading…</p>}
        {groups && groups.length === 0 && <p className="muted">No groups yet.</p>}
        {groups && groups.map(g => (
          <div key={g.gistId} className="event">
            <div>
              <a href={`#/g/${g.gistId}`}><strong>{g.ledger.name}</strong></a>
              <div className="meta">
                {g.ledger.members.length} members · {g.ledger.currency} · {g.ledger.events.length} events
              </div>
            </div>
            <div className="meta">
              <a href={g.htmlUrl} target="_blank" rel="noreferrer">gist ↗</a>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
