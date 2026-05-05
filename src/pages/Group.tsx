import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  finalizeGroup,
  joinGroup,
  makeExpense,
  makeVoid,
  postEvent,
  readGroup,
  removeMember,
  reopenGroup,
} from '../lib/api'
import { computeBalances, formatAmount, parseAmount, settle } from '../lib/settle'
import { avatarUrl } from '../lib/avatar'
import type { Group } from '../types'
import ConfirmModal from '../components/ConfirmModal'

export default function Group({ groupId, me }: { groupId: string; me: string }) {
  const [group, setGroup] = useState<Group | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // Two-step finalize / reopen confirmation. We track each separately so
  // the modal copy can adapt without juggling a "mode" enum.
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)

  // Add-expense form state. Payer is always the authenticated user —
  // server enforces this too, so even a poked request can't claim
  // someone else paid.
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [participants, setParticipants] = useState<string[]>([])

  async function refresh() {
    setError(null)
    try {
      setGroup(await readGroup(groupId))
    } catch (e: any) {
      setError(e?.message || 'Failed to load group')
    }
  }
  useEffect(() => { refresh() }, [groupId])

  // Once the roster is known, lazily seed the add-expense form. We avoid
  // overwriting the user's in-progress edits — if `participants` is
  // already populated, leave it alone.
  useEffect(() => {
    if (!group) return
    setParticipants(prev => prev.length ? prev : group.members)
  }, [group])

  // Settlement roster includes everyone who shows up in any event,
  // not just the *current* members list. That way a member who paid
  // for stuff and then got kicked / left still gets a balance row +
  // any "owe-them" transfer line — past activity isn't erased by
  // present membership state.
  const settlementRoster = useMemo(() => {
    if (!group) return []
    const set = new Set<string>(group.members)
    for (const e of group.events) {
      if (e.type === 'expense') {
        set.add(e.payer)
        for (const p of e.participants) set.add(p)
      }
    }
    return Array.from(set)
  }, [group])

  const balances = useMemo(
    () => group ? computeBalances(group.events, settlementRoster) : [],
    [group, settlementRoster],
  )
  const transfers = useMemo(() => settle(balances), [balances])
  const maxBalance = useMemo(
    () => balances.reduce((m, b) => Math.max(m, Math.abs(b.balance)), 0),
    [balances],
  )

  if (!group) {
    return (
      <>
        {error && <div className="error"><span>{error}</span></div>}
        {!error && <p className="empty">Loading group…</p>}
      </>
    )
  }

  const isOwner = group.owner === me
  const isMember = group.members.includes(me)
  const isFinalized = group.finalizedAt != null
  const voided = new Set(
    group.events.filter(e => e.type === 'void').map(e => (e as any).targetId),
  )
  const shareUrl = `${window.location.origin}/#/g/${group.id}`

  async function handleJoin() {
    setJoining(true)
    setError(null)
    try {
      await joinGroup(group!.id)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to join group')
    } finally {
      setJoining(false)
    }
  }

  // Either an owner kicking another member, or a non-owner self-leaving
  // from the chip's × button. Same endpoint, server enforces who's
  // allowed to do what. On self-leave we bounce back to the list since
  // the user no longer has visibility into this group.
  async function handleRemoveMember(login: string) {
    if (!group) return
    const isSelf = login === me
    const ok = window.confirm(
      isSelf
        ? `Leave "${group.name}"? You can rejoin from the share link.`
        : `Remove ${login} from "${group.name}"? Their past expenses stay in the ledger; they just can't record new ones.`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await removeMember(group.id, login)
      if (isSelf) {
        window.location.hash = '#/'
      } else {
        await refresh()
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to remove member')
    } finally {
      setBusy(false)
    }
  }

  async function handleFinalize() {
    if (!group) return
    setBusy(true)
    setError(null)
    try {
      await finalizeGroup(group.id)
      setConfirmFinalize(false)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to finalize')
    } finally {
      setBusy(false)
    }
  }

  async function handleReopen() {
    if (!group) return
    setBusy(true)
    setError(null)
    try {
      await reopenGroup(group.id)
      setConfirmReopen(false)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to reopen')
    } finally {
      setBusy(false)
    }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    if (!group) return
    const amount = parseAmount(amountStr, group.currency)
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
      await postEvent(group.id, makeExpense({
        payer: me,
        amount,
        participants,
        split: 'equal',
        note: note.trim() || undefined,
      }))
      await refresh()
      setAmountStr('')
      setNote('')
    } catch (err: any) {
      setError(err?.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  async function voidEvent(targetId: string) {
    if (!group) return
    setBusy(true)
    setError(null)
    try {
      await postEvent(group.id, makeVoid({ targetId }))
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to void')
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

      <div className={`card group-header ${isFinalized ? 'is-finalized' : ''}`}>
        {isFinalized && (
          <div className="finalized-banner" role="status">
            <span className="finalized-stamp">FINALIZED</span>
            <span className="finalized-meta">
              Locked {fmtDate(new Date(group.finalizedAt!).toISOString())}
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
        </div>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {group.members.map(m => {
            // Owner's chip is permanent — to dispose of the group they
            // have to delete it outright. Otherwise:
            //   - Owner viewing a member's chip → × kicks them.
            //   - Member viewing their own chip → × is a self-leave.
            //   - Member viewing another member's chip → no × (server
            //     would 403 anyway, but no point teasing it).
            // When the group is finalized the roster freezes too — server
            // would 409, so don't dangle the affordance.
            const isOwnerChip = m === group.owner
            const canRemove = !isFinalized && !isOwnerChip && (isOwner || m === me)
            return (
              <span key={m} className="member-chip">
                <img src={avatarUrl(m, 36)} alt="" />
                {m}
                {canRemove && (
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => handleRemoveMember(m)}
                    disabled={busy}
                    aria-label={m === me ? 'Leave group' : `Remove ${m}`}
                    title={m === me ? 'Leave group' : `Remove ${m}`}
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!isFinalized && (
            <button
              type="button"
              className="secondary"
              style={{ flex: '0 0 auto' }}
              onClick={() => setShareOpen(o => !o)}
            >
              <ShareIcon /> {shareOpen ? 'Hide share' : 'Share to invite'}
            </button>
          )}
          {isOwner && !isFinalized && (
            <button
              type="button"
              className="secondary"
              style={{ flex: '0 0 auto' }}
              onClick={() => setConfirmFinalize(true)}
              disabled={busy}
              title="Lock the ledger — use once everyone has settled up"
            >
              <LockIcon /> Finalize
            </button>
          )}
          {isOwner && isFinalized && (
            <button
              type="button"
              className="secondary"
              style={{ flex: '0 0 auto' }}
              onClick={() => setConfirmReopen(true)}
              disabled={busy}
            >
              <UnlockIcon /> Reopen
            </button>
          )}
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

      {!isMember && !isFinalized && (
        <div className="card join-cta">
          <h3 className="section-title lg" style={{ marginBottom: 6 }}>Join this group</h3>
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            You're viewing as a guest. Joining adds you to the roster as <strong>{me}</strong>,
            so you can record your own expenses and be included when the bill is split.
          </p>
          <button onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining…' : `Join as ${me}`}
          </button>
        </div>
      )}

      {isMember && !isFinalized && (
        <div className="card">
          <div className="section-head">
            <h3 className="section-title">Add expense</h3>
          </div>
          <form onSubmit={addExpense} className="form-stack">
            <div className="payer-fixed">
              <img src={avatarUrl(me, 36)} alt="" />
              <span><strong>{me}</strong> paid</span>
              <input
                className="amount"
                inputMode="decimal"
                placeholder={`Amount (${group.currency})`}
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
                {group.members.map(m => (
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
          const isVoided = voided.has(e.id)
          // Owner can void anything; otherwise members can only void
          // events they themselves authored. Server enforces; this is
          // just the affordance. A finalized group freezes voiding too.
          const canVoid = (isOwner || e.author === me) && !isVoided && !isFinalized
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
              <span className="event-amount">{formatAmount(e.amount, group.currency)}</span>
              {canVoid && (
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

      <ConfirmModal
        open={confirmFinalize}
        title="Finalize this group"
        body={
          <>
            <p>
              Lock <strong>{group.name}</strong>'s ledger. Once finalized, no one can add
              expenses, void existing ones, or change the roster — the page becomes a
              read-only record.
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Use this once everyone has actually paid up. As the owner you can reopen
              later if something needs to change.
            </p>
          </>
        }
        confirmLabel="Finalize"
        cancelLabel="Not yet"
        tone="danger"
        busy={busy}
        onCancel={() => { if (!busy) setConfirmFinalize(false) }}
        onConfirm={handleFinalize}
      />

      <ConfirmModal
        open={confirmReopen}
        title="Reopen this group"
        body={
          <p style={{ margin: 0 }}>
            Unlock <strong>{group.name}</strong> so members can add expenses and change
            the roster again? You can finalize again later.
          </p>
        }
        confirmLabel="Reopen"
        tone="neutral"
        busy={busy}
        onCancel={() => { if (!busy) setConfirmReopen(false) }}
        onConfirm={handleReopen}
      />
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

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 6.5h7a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-7a.75.75 0 0 1-.75-.75v-4A.75.75 0 0 1 3.5 6.5Z M4.75 6.5V4.25a2.25 2.25 0 0 1 4.5 0V6.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function UnlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 6.5h7a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-7a.75.75 0 0 1-.75-.75v-4A.75.75 0 0 1 3.5 6.5Z M4.75 6.5V4.25a2.25 2.25 0 0 1 4.5 0"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
