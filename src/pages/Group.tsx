import { useEffect, useMemo, useState } from 'react'
import {
  appendEvents,
  ConflictError,
  makeExpense,
  makeVoid,
  readLedger,
  type LedgerHandle,
} from '../lib/gist'
import { computeBalances, formatAmount, parseAmount, settle } from '../lib/settle'

export default function Group({ gistId, me }: { gistId: string; me: string }) {
  const [handle, setHandle] = useState<LedgerHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Add-expense form state.
  const [payer, setPayer] = useState(me)
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [participants, setParticipants] = useState<string[]>([])

  async function refresh() {
    setError(null)
    try {
      const h = await readLedger(gistId)
      if (!h) { setError('Ledger not found or not a SplitStupid gist.'); return }
      setHandle(h)
      // Initialise the participant checkboxes to "everyone in" once we
      // know the roster — much more often the right default than empty.
      setParticipants(prev => prev.length ? prev : h.ledger.members)
      if (!h.ledger.members.includes(payer)) setPayer(h.ledger.owner)
    } catch (e: any) {
      setError(e?.message || 'Failed to read ledger')
    }
  }
  useEffect(() => { refresh() }, [gistId])

  const balances = useMemo(
    () => handle ? computeBalances(handle.ledger) : [],
    [handle],
  )
  const transfers = useMemo(() => settle(balances), [balances])

  if (!handle) {
    return (
      <>
        {error && <div className="error">{error}</div>}
        {!error && <p className="muted">Loading ledger…</p>}
      </>
    )
  }

  const ledger = handle.ledger
  const isOwner = ledger.owner === me
  const voided = new Set(ledger.events.filter(e => e.type === 'void').map(e => (e as any).targetId))

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    if (!handle) return
    const amount = parseAmount(amountStr, ledger.currency)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      return
    }
    if (participants.length === 0) {
      setError('Pick at least one participant')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await appendEvents(handle, [
        makeExpense({
          author: me,
          payer,
          amount,
          participants,
          split: 'equal',
          note: note.trim() || undefined,
        }),
      ])
      setHandle(next)
      setAmountStr('')
      setNote('')
    } catch (err: any) {
      if (err instanceof ConflictError) {
        setHandle(err.latest)
        setError('Ledger changed elsewhere — your view is now refreshed. Try again.')
      } else {
        setError(err?.message || 'Failed to save')
      }
    } finally {
      setBusy(false)
    }
  }

  async function voidEvent(targetId: string) {
    if (!handle) return
    setBusy(true)
    setError(null)
    try {
      const next = await appendEvents(handle, [
        makeVoid({ author: me, targetId }),
      ])
      setHandle(next)
    } catch (err: any) {
      if (err instanceof ConflictError) {
        setHandle(err.latest)
        setError('Ledger changed elsewhere — view refreshed.')
      } else {
        setError(err?.message || 'Failed to void')
      }
    } finally {
      setBusy(false)
    }
  }

  function toggleParticipant(m: string) {
    setParticipants(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  return (
    <>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{ledger.name}</h2>
        <div className="muted">
          {ledger.currency} · members: {ledger.members.join(', ')} ·
          owner: <strong>{ledger.owner}</strong> ·{' '}
          <a href={handle.htmlUrl} target="_blank" rel="noreferrer">open gist ↗</a>
        </div>
      </div>

      {isOwner && (
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Add expense</h3>
          <form onSubmit={addExpense}>
            <div className="row" style={{ marginBottom: 8 }}>
              <select value={payer} onChange={e => setPayer(e.target.value)}>
                {ledger.members.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                inputMode="decimal"
                placeholder={`Amount (${ledger.currency})`}
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
              />
            </div>
            <input
              placeholder="Note (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <div style={{ marginBottom: 8 }}>
              <div className="muted" style={{ marginBottom: 4 }}>Split equally among:</div>
              {ledger.members.map(m => (
                <label key={m} style={{ marginRight: 12, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={participants.includes(m)}
                    onChange={() => toggleParticipant(m)}
                  /> {m}
                </label>
              ))}
            </div>
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</button>
          </form>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Settlement</h3>
        {balances.every(b => b.balance === 0) && (
          <p className="muted">All settled up.</p>
        )}
        {balances.some(b => b.balance !== 0) && (
          <>
            <div style={{ marginBottom: 10 }}>
              {balances.map(b => (
                <div key={b.member} className="transfer">
                  {b.member}: <strong style={{ color: b.balance >= 0 ? '#0a7' : '#d33' }}>
                    {b.balance >= 0 ? '+' : ''}{formatAmount(b.balance, ledger.currency)}
                  </strong>
                </div>
              ))}
            </div>
            <div className="muted" style={{ marginBottom: 4 }}>Suggested transfers:</div>
            {transfers.length === 0 && <p className="muted">No transfers needed.</p>}
            {transfers.map((t, i) => (
              <div key={i} className="transfer">
                {t.from} → {t.to}: <strong>{formatAmount(t.amount, ledger.currency)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Events ({ledger.events.length})</h3>
        {ledger.events.length === 0 && <p className="muted">No events yet.</p>}
        {[...ledger.events].reverse().map(e => {
          if (e.type === 'void') {
            return (
              <div key={e.id} className="event">
                <div>
                  <span className="muted">void</span> {e.targetId}
                </div>
                <div className="meta">{e.author} · {fmtDate(e.ts)}</div>
              </div>
            )
          }
          const isVoided = voided.has(e.id)
          return (
            <div key={e.id} className="event" style={isVoided ? { opacity: 0.4, textDecoration: 'line-through' } : undefined}>
              <div>
                <strong>{e.payer}</strong> paid <strong>{formatAmount(e.amount, ledger.currency)}</strong>
                {e.note ? <> — {e.note}</> : null}
                <div className="meta">
                  split among {e.participants.join(', ')} · {fmtDate(e.ts)}
                </div>
              </div>
              {isOwner && !isVoided && (
                <button
                  className="secondary"
                  style={{ padding: '4px 8px', fontSize: 12 }}
                  onClick={() => voidEvent(e.id)}
                  disabled={busy}
                >
                  void
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
