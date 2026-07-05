import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { amountToInput, memberAvatarUrl, memberDisplayName, formatAmount } from '@splitstupid/core'
import type { ExpenseEvent } from '@splitstupid/core'
import { useGroup } from '@splitstupid/hooks'
import ConfirmModal from '../components/ConfirmModal'
import ShareImageModal from '../components/ShareImageModal'
import { renderReceipt } from '../lib/receipt'
import { renderPostcard } from '../lib/postcard'

export default function Group({ groupId, me }: { groupId: string; me: string }) {
  const {
    group, error, busy, setError,
    balances, transfers, maxBalance,
    isOwner, isMember, isFinalized, isEven, lastSettledAt, shareUrl, expenseView,
    friends, availableFriends, loadFriends,
    join, addExpense: postExpense, voidExpense, saveEdit: saveEditApi,
    settleUp, finalize, reopen, addFriend: addFriendApi, addOffline, removeSelfOrMember,
  } = useGroup(groupId, me)

  // View-only state: form inputs, which panels/modals are open, and the
  // per-chip "adding" spinner. The substantive page logic lives in useGroup.
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [addingFriend, setAddingFriend] = useState<string | null>(null)
  const [offlineName, setOfflineName] = useState('')
  const [addingOffline, setAddingOffline] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [postcardOpen, setPostcardOpen] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [confirmSettle, setConfirmSettle] = useState(false)

  // Add-expense form. Payer is always the authenticated user (server enforces).
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [payer, setPayer] = useState(me)
  const [participants, setParticipants] = useState<string[]>([])
  const [dateStr, setDateStr] = useState(() => toLocalInputValue(new Date()))
  const [dateEdited, setDateEdited] = useState(false)

  // Void / edit confirmation targets (the original expense being acted on).
  const [voidTarget, setVoidTarget] = useState<ExpenseEvent | null>(null)
  const [editTarget, setEditTarget] = useState<ExpenseEvent | null>(null)
  const [editAmountStr, setEditAmountStr] = useState('')
  const [editDateStr, setEditDateStr] = useState('')
  const [editNote, setEditNote] = useState('')

  // Once the roster loads, seed the add-expense participants (don't clobber
  // an in-progress selection).
  useEffect(() => {
    if (!group) return
    setParticipants(prev => prev.length ? prev : group.members)
    setPayer(prev => (prev === me || group.members.includes(prev)) ? prev : me)
  }, [group, me])

  if (!group) {
    return (
      <>
        {error && <div className="error"><span>{error}</span></div>}
        {!error && <p className="empty">Loading group…</p>}
      </>
    )
  }

  const profiles = group.profiles
  const memberName = (m: string) => memberDisplayName(m, profiles)
  const memberAvatar = (m: string, size: number) => memberAvatarUrl(m, profiles, size)
  const offlineMembers = group.members.filter(m => profiles?.[m]?.kind === 'offline')
  const payerOptions = isOwner ? [me, ...offlineMembers] : [me]

  async function handleJoin() { await join() }

  // Owner kicking a member, or a non-owner self-leaving via the chip's ×.
  // The confirm + (on self-leave) navigation are web concerns; the hook owns
  // the call and tells us which case happened so we can bounce to the list.
  async function handleRemoveMember(login: string) {
    if (!group) return
    const isSelf = login === me
    const ok = window.confirm(
      isSelf
        ? `Leave "${group.name}"? You can rejoin from the share link.`
        : `Remove ${memberName(login)} from "${group.name}"? Their past expenses stay in the ledger; they just can't record new ones.`,
    )
    if (!ok) return
    const result = await removeSelfOrMember(login)
    if (result === 'left') window.location.hash = '#/'
  }

  // Toggle the friends picker; fetch the candidate list on first open.
  async function toggleFriends() {
    const next = !friendsOpen
    setFriendsOpen(next)
    if (next && friends == null) await loadFriends()
  }

  async function addFriend(login: string) {
    setAddingFriend(login)
    await addFriendApi(login)
    setAddingFriend(null)
  }

  async function handleAddOffline(e: React.FormEvent) {
    e.preventDefault()
    const name = offlineName.trim()
    if (!name) return
    setAddingOffline(true)
    await addOffline(name)
    setAddingOffline(false)
    setOfflineName('')
  }

  async function handleFinalize() { await finalize(); setConfirmFinalize(false) }
  async function handleReopen() { await reopen(); setConfirmReopen(false) }
  async function handleSettle() { await settleUp(); setConfirmSettle(false) }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    const dateMs = dateEdited ? (dateStr ? new Date(dateStr).getTime() : NaN) : undefined
    const ok = await postExpense({ amountStr, note, payer, participants, dateMs })
    if (ok) {
      setAmountStr('')
      setNote('')
      setPayer(me)
      setDateStr(toLocalInputValue(new Date()))
      setDateEdited(false)
    }
  }

  async function voidEvent(targetId: string) {
    await voidExpense(targetId)
    setVoidTarget(null)
  }

  // Seed the edit dialog from an expense's *effective* figures (post any prior
  // edit), so re-editing starts from what's on screen. Amount is minor units,
  // so convert back to the human-typed major form.
  function openEdit(e: ExpenseEvent, effAmount: number, effDateMs: number, effNote?: string) {
    setEditTarget(e)
    setEditAmountStr(amountToInput(effAmount, group!.currency))
    setEditDateStr(toLocalInputValue(new Date(effDateMs)))
    setEditNote(effNote ?? '')
    setError(null)
  }

  async function saveEdit() {
    if (!editTarget) return
    const dateMs = editDateStr ? new Date(editDateStr).getTime() : NaN
    const ok = await saveEditApi(editTarget.id, { amountStr: editAmountStr, dateMs, note: editNote })
    if (ok) setEditTarget(null)
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
          <span>owner <strong>{memberName(group.owner)}</strong></span>
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
                <img src={memberAvatar(m, 36)} alt="" />
                {memberName(m)}
                {canRemove && (
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => handleRemoveMember(m)}
                    disabled={busy}
                    aria-label={m === me ? 'Leave group' : `Remove ${memberName(m)}`}
                    title={m === me ? 'Leave group' : `Remove ${memberName(m)}`}
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
              onClick={toggleFriends}
              title="Add people to this group"
            >
              <UsersIcon /> {friendsOpen ? 'Hide people' : 'Add people'}
            </button>
          )}
          <button
            type="button"
            className="secondary"
            style={{ flex: '0 0 auto' }}
            onClick={() => setReceiptOpen(true)}
            title="Generate a shareable receipt image"
          >
            <ReceiptIcon /> Receipt
          </button>
          {isFinalized && (
            <button
              type="button"
              className="secondary"
              style={{ flex: '0 0 auto' }}
              onClick={() => setPostcardOpen(true)}
              title="Generate a trip postcard image"
            >
              <PostcardIcon /> Postcard
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

      {friendsOpen && isOwner && !isFinalized && (
        <div className="card friends-panel">
          <p className="section-title" style={{ margin: '0 0 4px' }}>
            Add people
          </p>
          <form className="offline-add-form" onSubmit={handleAddOffline}>
            <input
              value={offlineName}
              onChange={e => setOfflineName(e.target.value)}
              placeholder="Offline name"
              maxLength={40}
              disabled={addingOffline}
            />
            <button type="submit" className="secondary" disabled={addingOffline || !offlineName.trim()}>
              {addingOffline ? 'Adding…' : 'Add'}
            </button>
          </form>
          {friends == null ? (
            <p className="empty">Loading…</p>
          ) : availableFriends.length === 0 ? (
            <p className="empty muted" style={{ margin: 0 }}>
              {friends.length === 0
                ? "No past split-mates yet — share the link to bring people in."
                : 'Everyone you\'ve split with is already here.'}
            </p>
          ) : (
            <div className="chip-row">
              {availableFriends.map(f => (
                <button
                  key={f}
                  type="button"
                  className="friend-add-chip"
                  onClick={() => addFriend(f)}
                  disabled={addingFriend != null}
                  title={`Add ${memberName(f)}`}
                >
                  <img src={memberAvatar(f, 36)} alt="" />
                  {memberName(f)}
                  <span className="friend-add-plus">{addingFriend === f ? '…' : '+'}</span>
                </button>
              ))}
            </div>
          )}
          <p className="subtle muted" style={{ margin: '4px 0 0', maxWidth: 320 }}>
            Offline people are added by name. Signed-in past split-mates can leave anytime.
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
          <button onClick={handleJoin} disabled={busy}>
            {busy ? 'Joining…' : `Join as ${me}`}
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
              <img src={memberAvatar(payer, 36)} alt="" />
              {payerOptions.length > 1 ? (
                <select
                  className="payer-select"
                  value={payer}
                  onChange={e => setPayer(e.target.value)}
                  aria-label="Paid by"
                >
                  {payerOptions.map(p => (
                    <option key={p} value={p}>{memberName(p)}</option>
                  ))}
                </select>
              ) : (
                <span><strong>{memberName(me)}</strong></span>
              )}
              <span>paid</span>
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
              <span className="field-label">Date</span>
              <input
                type="datetime-local"
                className="date-input"
                value={dateStr}
                max={toLocalInputValue(new Date())}
                onChange={e => { setDateStr(e.target.value); setDateEdited(true) }}
              />
            </div>
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
                    <img src={memberAvatar(m, 36)} alt="" />
                    {memberName(m)}
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
          {lastSettledAt && (
            <span className="section-count" title={`Last settled ${fmtDate(new Date(lastSettledAt).toISOString())}`}>
              since {new Date(lastSettledAt).toLocaleDateString()}
            </span>
          )}
        </div>
        {isEven ? (
          <p className="empty">
            All settled up.{lastSettledAt ? ` Cleared ${new Date(lastSettledAt).toLocaleDateString()}.` : ''}
          </p>
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
                      <img src={memberAvatar(b.member, 36)} alt="" />
                      <span className="login">{memberName(b.member)}</span>
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
                      <img src={memberAvatar(t.from, 36)} alt="" />
                      {memberName(t.from)}
                    </span>
                    <span className="transfer-arrow">→</span>
                    <span className="transfer-name">
                      <img src={memberAvatar(t.to, 36)} alt="" />
                      {memberName(t.to)}
                    </span>
                    <span className="transfer-amount">{formatAmount(t.amount, group.currency)}</span>
                  </div>
                ))}
              </>
            )}
            {isMember && !isFinalized && (
              <button
                type="button"
                className="settle-btn"
                onClick={() => setConfirmSettle(true)}
                disabled={busy}
                title="Mark everyone settled up to here and reset the balances"
              >
                <ChecksIcon /> Settle up — mark everyone paid
              </button>
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
          if (e.type === 'settle') {
            return (
              <div key={e.id} className="settle-divider" role="separator">
                <span className="settle-divider-rule" />
                <span className="settle-divider-label">
                  <ChecksIcon /> Settled up · {fmtDate(e.ts)}{e.note ? ` · ${e.note}` : ''}
                </span>
                <span className="settle-divider-rule" />
              </div>
            )
          }
          if (e.type === 'void') {
            return (
              <div key={e.id} className="event">
                <img src={memberAvatar(e.author, 56)} alt="" className="event-avatar" />
                <div className="event-body">
                  <p className="event-title">
                    <span className="event-void">VOID</span> · {e.targetId}
                  </p>
                  <p className="event-meta">{memberName(e.author)} · {fmtDate(e.ts)}</p>
                </div>
              </div>
            )
          }
          if (e.type === 'edit') {
            return (
              <div key={e.id} className="event">
                <img src={memberAvatar(e.author, 56)} alt="" className="event-avatar" />
                <div className="event-body">
                  <p className="event-title">
                    <span className="event-edit">EDITED</span> · {e.targetId}
                  </p>
                  <p className="event-meta">
                    {memberName(e.author)} · {fmtDate(e.ts)} · now {fmtDate(new Date(e.date).toISOString())}
                  </p>
                </div>
                <span className="event-amount">{formatAmount(e.amount, group.currency)}</span>
              </div>
            )
          }
          // Effective figures (edit-folded) + the void/edit permission flags
          // all come from the shared hook — same logic the RN screen uses.
          const { effAmount, effDateMs, effNote, isVoided, edited, isSettled, canVoid, canEdit } = expenseView(e)
          return (
            <div key={e.id} className={`event ${isVoided ? 'voided' : ''} ${isSettled ? 'settled' : ''}`}>
              <img src={memberAvatar(e.payer, 56)} alt="" className="event-avatar" />
              <div className="event-body">
                <p className="event-title">
                  <strong>{memberName(e.payer)}</strong> paid{effNote ? <> for <strong>{effNote}</strong></> : null}
                  {edited && !isVoided ? <span className="event-edited-tag">edited</span> : null}
                  {isSettled && !isVoided ? <span className="event-settled-tag">settled</span> : null}
                </p>
                <p className="event-meta">
                  split among {e.participants.map(memberName).join(', ')} · {fmtDate(new Date(effDateMs).toISOString())}
                </p>
              </div>
              <span className="event-amount">{formatAmount(effAmount, group.currency)}</span>
              {(canEdit || canVoid) && (
                <div className="event-actions">
                  {canEdit && (
                    <button
                      className="edit-ghost"
                      onClick={() => openEdit(e, effAmount, effDateMs, effNote)}
                      disabled={busy}
                    >
                      edit
                    </button>
                  )}
                  {canVoid && (
                    <button
                      className="danger-ghost"
                      onClick={() => setVoidTarget(e)}
                      disabled={busy}
                    >
                      void
                    </button>
                  )}
                </div>
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
        open={confirmSettle}
        title="Settle up"
        body={
          <>
            <p>
              Record a checkpoint for <strong>{group.name}</strong> confirming everyone's
              squared up the suggested transfers. The current balances reset to zero and a
              <em> settled</em> line is drawn across the ledger.
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              The group stays open — keep adding expenses for the next round. Entries before
              the line freeze as a paid-off record. Anyone in the group can do this.
            </p>
          </>
        }
        confirmLabel="Settle up"
        cancelLabel="Not yet"
        tone="neutral"
        busy={busy}
        onCancel={() => { if (!busy) setConfirmSettle(false) }}
        onConfirm={handleSettle}
      />

      <ShareImageModal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Share receipt"
        hint="A printable snapshot of the ledger — send it as an image."
        filename={`splitstupid-receipt-${group.id}.png`}
        shareTitle={`${group.name} — SplitStupid receipt`}
        shareText={`Receipt for ${group.name}`}
        renderCanvas={() => renderReceipt({ group, balances, transfers })}
        previewMaxWidth={360}
      />

      <ShareImageModal
        open={postcardOpen}
        onClose={() => setPostcardOpen(false)}
        title="Trip postcard"
        hint="A finalized-trip keepsake — send to everyone who split with you."
        filename={`splitstupid-postcard-${group.id}.png`}
        shareTitle={`${group.name} — SplitStupid postcard`}
        shareText={`Postcard from ${group.name}`}
        renderCanvas={() => renderPostcard({ group })}
        previewMaxWidth={560}
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

      <ConfirmModal
        open={voidTarget != null}
        title="Void this expense"
        body={
          voidTarget ? (
            <>
              <p>
                Strike <strong>{memberName(voidTarget.payer)}</strong>'s{' '}
                <strong>{formatAmount(voidTarget.amount, group.currency)}</strong>
                {voidTarget.note ? <> for <strong>{voidTarget.note}</strong></> : null}{' '}
                from the ledger? It stays in the activity log as a voided row, but
                drops out of the settlement.
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                To change just the date or amount, use <em>edit</em> instead — it keeps
                the same participants.
              </p>
            </>
          ) : null
        }
        confirmLabel="Void it"
        cancelLabel="Keep it"
        tone="danger"
        busy={busy}
        onCancel={() => { if (!busy) setVoidTarget(null) }}
        onConfirm={() => { if (voidTarget) voidEvent(voidTarget.id) }}
      />

      {editTarget && (
        <div className="modal-backdrop" onClick={() => { if (!busy) setEditTarget(null) }}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="edit-modal-title" className="modal-title">Edit expense</h3>
            <div className="modal-body">
              <p className="muted" style={{ marginTop: 0 }}>
                Adjust the amount, date, or note. Participants stay the same — the
                entry is amended in place, with an edit logged in the activity feed.
              </p>
              <div style={{ marginBottom: 14 }}>
                <span className="field-label">Amount ({group.currency})</span>
                <input
                  className="amount"
                  inputMode="decimal"
                  value={editAmountStr}
                  onChange={e => setEditAmountStr(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <span className="field-label">Note</span>
                <input
                  placeholder="Note (optional, e.g. dinner at Sushi Aoki)"
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                />
              </div>
              <div>
                <span className="field-label">Date</span>
                <input
                  type="datetime-local"
                  className="date-input"
                  value={editDateStr}
                  max={toLocalInputValue(new Date())}
                  onChange={e => setEditDateStr(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditTarget(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="button" onClick={saveEdit} disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Format a Date for a <input type="datetime-local">, whose value must be
// "YYYY-MM-DDTHH:mm" in *local* time. toISOString() is UTC and would shift
// the displayed clock, so build it from the local getters instead.
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9.5 4.5L7 2L4.5 4.5M7 2v7M3 8.5v2.25A1.25 1.25 0 0 0 4.25 12h5.5A1.25 1.25 0 0 0 11 10.75V8.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="5.25" cy="4.5" r="2.1" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M1.5 11.5c0-2 1.7-3.2 3.75-3.2 1 0 1.9.28 2.6.78"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M10.5 6.5v4M8.5 8.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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

function ChecksIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 7.5l2.25 2.25L8 5M6.5 9.25L7.25 10l4.25-4.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ReceiptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 1.5v11l1.25-1L5.5 12.5l1.25-1L8 12.5l1.25-1L10.5 12.5L11.75 11.5V1.5L10.5 2.5L9.25 1.5L8 2.5L6.75 1.5L5.5 2.5L4.25 1.5L3 1.5Z M5 5h5 M5 7.25h5 M5 9.5h3"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function PostcardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="11" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="9.5" cy="6" r="1.4" stroke="currentColor" strokeWidth="1" fill="none"/>
      <path d="M3 6.5h3 M3 8.5h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}
