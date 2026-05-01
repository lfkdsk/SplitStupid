import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  appendEvents,
  ConflictError,
  makeExpense,
  makeVoid,
  readLedger,
  type LedgerHandle,
} from '../lib/gist'
import {
  listGroupComments,
  postJoinComment,
  type GroupComments,
} from '../lib/comments'
import { computeBalances, formatAmount, parseAmount, settle } from '../lib/settle'
import { avatarUrl } from '../lib/avatar'

export default function Group({ gistId, me }: { gistId: string; me: string }) {
  const [handle, setHandle] = useState<LedgerHandle | null>(null)
  const [comments, setComments] = useState<GroupComments | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Add-expense form state.
  const [payer, setPayer] = useState(me)
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [participants, setParticipants] = useState<string[]>([])

  async function refresh() {
    setError(null)
    try {
      // Ledger and comments are independent reads — fire in parallel.
      const [h, c] = await Promise.all([
        readLedger(gistId),
        listGroupComments(gistId).catch(() => ({ events: [], joins: [] }) as GroupComments),
      ])
      if (!h) { setError('Group not found, or this link isn\'t a SplitStupid group.'); return }
      setHandle(h)
      setComments(c)
    } catch (e: any) {
      setError(e?.message || 'Failed to read ledger')
    }
  }
  useEffect(() => { refresh() }, [gistId])

  // Roster = gist owner ∪ stored members[] ∪ join-comment authors.
  // Computed fresh each render so a fresh join is reflected immediately
  // after the comment posts.
  const effectiveMembers = useMemo(() => {
    if (!handle) return []
    const set = new Set<string>([handle.ledger.owner, ...handle.ledger.members])
    if (comments) for (const j of comments.joins) set.add(j.author)
    return Array.from(set)
  }, [handle, comments])

  // Once the roster is known, lazily seed the add-expense form. We avoid
  // overwriting the user's in-progress edits — if `participants` is
  // already populated, leave it alone.
  useEffect(() => {
    if (effectiveMembers.length === 0) return
    setParticipants(prev => prev.length ? prev : effectiveMembers)
    setPayer(prev => effectiveMembers.includes(prev) ? prev : (handle?.ledger.owner ?? prev))
  }, [effectiveMembers, handle])

  const balances = useMemo(
    () => handle ? computeBalances(handle.ledger.events, effectiveMembers) : [],
    [handle, effectiveMembers],
  )
  const transfers = useMemo(() => settle(balances), [balances])
  const maxBalance = useMemo(
    () => balances.reduce((m, b) => Math.max(m, Math.abs(b.balance)), 0),
    [balances],
  )

  if (!handle) {
    return (
      <>
        {error && <div className="error"><span>{error}</span></div>}
        {!error && <p className="empty">Loading ledger…</p>}
      </>
    )
  }

  const ledger = handle.ledger
  const isOwner = ledger.owner === me
  const isMember = effectiveMembers.includes(me)
  const voided = new Set(
    ledger.events.filter(e => e.type === 'void').map(e => (e as any).targetId),
  )
  const shareUrl = `${window.location.origin}/#/g/${gistId}`

  async function handleJoin() {
    setJoining(true)
    setError(null)
    try {
      await postJoinComment(gistId)
      // Refresh just the comments (ledger didn't change) — the joiner
      // appears in effectiveMembers as soon as setComments lands.
      const c = await listGroupComments(gistId)
      setComments(c)
    } catch (err: any) {
      setError(err?.message || 'Failed to join group')
    } finally {
      setJoining(false)
    }
  }

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

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('Copy this URL:', shareUrl)
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

      <div className="card group-header">
        <h2>{ledger.name}</h2>
        <div className="group-header-meta">
          <span>{ledger.currency}</span>
          <span className="dot" />
          <span>owner <strong>{ledger.owner}</strong></span>
          <span className="dot" />
          <span>{effectiveMembers.length} member{effectiveMembers.length === 1 ? '' : 's'}</span>
        </div>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {effectiveMembers.map(m => (
            <span key={m} className="member-chip">
              <img src={avatarUrl(m, 36)} alt="" />
              {m}
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="secondary"
            style={{ flex: '0 0 auto' }}
            onClick={() => setShareOpen(o => !o)}
          >
            <ShareIcon /> {shareOpen ? 'Hide share' : 'Share to invite'}
          </button>
        </div>
      </div>

      {shareOpen && (
        <div className="card share-panel">
          <p className="section-title" style={{ margin: 0 }}>Scan or share to invite</p>
          <div className="qr-frame">
            <QRCodeSVG
              value={shareUrl}
              size={180}
              level="M"
              fgColor="#1a1410"
              bgColor="#ffffff"
            />
          </div>
          <div className="share-url">{shareUrl}</div>
          <button type="button" className="secondary" onClick={copyShareUrl}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <p className="subtle muted" style={{ textAlign: 'center', maxWidth: 280, margin: 0 }}>
            Anyone who scans, signs in with GitHub, and taps <em>Join</em> is added to the roster.
          </p>
        </div>
      )}

      {!isMember && (
        <div className="card join-cta">
          <h3 className="section-title lg" style={{ marginBottom: 6 }}>Join this group</h3>
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            You're viewing as a guest. Joining adds you to the roster as <strong>{me}</strong>,
            so you'll be included when expenses are split.
          </p>
          <button onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining…' : `Join as ${me}`}
          </button>
        </div>
      )}

      {isOwner && (
        <div className="card">
          <div className="section-head">
            <h3 className="section-title">Add expense</h3>
          </div>
          <form onSubmit={addExpense} className="form-stack">
            <div className="row">
              <select value={payer} onChange={e => setPayer(e.target.value)}>
                {effectiveMembers.map(m => (
                  <option key={m} value={m}>{m} paid</option>
                ))}
              </select>
              <input
                className="amount"
                inputMode="decimal"
                placeholder={`Amount (${ledger.currency})`}
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
              />
            </div>
            <input
              placeholder="Note (optional, e.g. dinner at Sushi Aoki)"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
            <div>
              <span className="field-label">Split equally among</span>
              <div className="chip-row">
                {effectiveMembers.map(m => (
                  <label key={m} className="check-pill">
                    <input
                      type="checkbox"
                      checked={participants.includes(m)}
                      onChange={() => toggleParticipant(m)}
                    />
                    <img src={avatarUrl(m, 36)} alt="" />
                    {m}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Add expense'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                        <span
                          className={`balance-bar-fill ${sign}`}
                          style={{ width: `${pct}%` }}
                        />
                      )}
                    </div>
                    <span className={`balance-amount ${sign}`}>
                      {b.balance > 0 ? '+' : ''}{formatAmount(b.balance, ledger.currency)}
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
                    <span className="transfer-amount">{formatAmount(t.amount, ledger.currency)}</span>
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
          <span className="section-count">{ledger.events.length}</span>
        </div>
        {ledger.events.length === 0 && <p className="empty">No events yet.</p>}
        {[...ledger.events].reverse().map(e => {
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
          const isVoided = voided.has(e.id)
          return (
            <div key={e.id} className={`event ${isVoided ? 'voided' : ''}`}>
              <img src={avatarUrl(e.payer, 56)} alt="" className="event-avatar" />
              <div className="event-body">
                <p className="event-title">
                  <strong>{e.payer}</strong> paid{e.note ? <> for <strong>{e.note}</strong></> : null}
                </p>
                <p className="event-meta">
                  split among {e.participants.join(', ')} · {fmtDate(e.ts)}
                </p>
              </div>
              <span className="event-amount">{formatAmount(e.amount, ledger.currency)}</span>
              {isOwner && !isVoided && (
                <button
                  className="danger-ghost"
                  onClick={() => voidEvent(e.id)}
                  disabled={busy}
                  style={{ marginLeft: 4 }}
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

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9.5 4.5L7 2L4.5 4.5M7 2v7M3 8.5v2.25A1.25 1.25 0 0 0 4.25 12h5.5A1.25 1.25 0 0 0 11 10.75V8.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
