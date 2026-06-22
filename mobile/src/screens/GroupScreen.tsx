import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
  ActivityIndicator,
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { amountToInput, effectiveExpenses, formatAmount, type ExpenseEvent, type Member, type SettleEvent } from '@splitstupid/core'
import { useGroup, type AddExpenseInput } from '@splitstupid/hooks'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Button, Card, ErrorBanner, SectionLabel } from '../components/ui'
import { ShareIcon, AddFriendIcon, ReceiptIcon, LockIcon, UnlockIcon, PostcardIcon } from '../components/icons'
import { ShareImageSheet } from '../share/ShareImageSheet'
import { colors, fonts, isDark, radius, space } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Group'>

export default function GroupScreen({ route, navigation }: Props) {
  const { groupId } = route.params
  const { me } = useAuth()
  const myLogin = me?.login ?? ''

  // All page logic from the shared hook — same as the web Group page.
  const {
    group, loading, error, setError, refresh, busy,
    balances, transfers, maxBalance, settlementRoster, isOwner, isMember, isFinalized, isEven, lastSettledAt, shareUrl,
    join, addExpense, voidExpense, saveEdit, settleUp, finalize, reopen, expenseView,
    friends, availableFriends, loadFriends, addFriend, removeSelfOrMember,
  } = useGroup(groupId, myLogin)

  const [shareOpen, setShareOpen] = useState(false)        // QR invite panel
  const [friendsOpen, setFriendsOpen] = useState(false)    // friend picker
  const [addingFriend, setAddingFriend] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)    // receipt image sheet
  const [postcardOpen, setPostcardOpen] = useState(false)  // trip postcard (finalized only)
  const [editTarget, setEditTarget] = useState<ExpenseEvent | null>(null) // expense being edited

  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  if (loading && !group) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }
  if (!group) {
    return (
      <View style={styles.splash}>
        <ErrorBanner message={error ?? 'Group not found'} onDismiss={() => setError(null)} />
      </View>
    )
  }

  const expenses = effectiveExpenses(group.events)
  const total = expenses.reduce((a, e) => a + e.amount, 0)

  // Display timeline: surviving (edit-folded) expenses interleaved with settle
  // checkpoints, in reverse append order, so the feed shows "Settled up"
  // dividers between periods (mirrors the web activity feed).
  type Row = { kind: 'expense'; e: ExpenseEvent } | { kind: 'settle'; e: SettleEvent }
  const effById = new Map(expenses.map(e => [e.id, e]))
  const timeline: Row[] = []
  for (const ev of group.events) {
    if (ev.type === 'expense' && effById.has(ev.id)) timeline.push({ kind: 'expense', e: effById.get(ev.id)! })
    else if (ev.type === 'settle') timeline.push({ kind: 'settle', e: ev })
  }
  timeline.reverse()

  function confirmFinalize() {
    Alert.alert('Finalize group', `Lock "${group!.name}"? No one can add expenses or change the roster until you reopen.`,
      [{ text: 'Not yet', style: 'cancel' }, { text: 'Finalize', style: 'destructive', onPress: () => finalize() }])
  }
  function confirmReopen() {
    Alert.alert('Reopen group', `Unlock "${group!.name}" so members can add expenses again?`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Reopen', onPress: () => reopen() }])
  }
  function confirmSettle() {
    Alert.alert(
      'Settle up',
      `Mark "${group!.name}" settled up to here? The current balances reset to zero and the group stays open — earlier expenses freeze as a paid-off record.`,
      [{ text: 'Not yet', style: 'cancel' }, { text: 'Settle up', onPress: () => settleUp() }],
    )
  }
  function confirmVoid(e: ExpenseEvent) {
    Alert.alert('Void expense', `Strike ${e.payer}'s ${formatAmount(e.amount, group!.currency)}${e.note ? ` for "${e.note}"` : ''} from the ledger? It drops out of the settlement.`,
      [{ text: 'Keep it', style: 'cancel' }, { text: 'Void it', style: 'destructive', onPress: () => voidExpense(e.id) }])
  }
  function confirmRemoveMember(login: Member) {
    const isSelf = login === myLogin
    Alert.alert(
      isSelf ? 'Leave group' : `Remove ${login}`,
      isSelf
        ? `Leave "${group!.name}"? You can rejoin from the share link.`
        : `Remove ${login}? Their past expenses stay in the ledger; they just can't record new ones.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSelf ? 'Leave' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            const r = await removeSelfOrMember(login)
            if (r === 'left') navigation.navigate('Groups')
          },
        },
      ],
    )
  }

  async function toggleFriends() {
    const next = !friendsOpen
    setFriendsOpen(next)
    if (next && friends == null) await loadFriends()
  }
  async function onAddFriend(login: Member) {
    setAddingFriend(login)
    await addFriend(login)
    setAddingFriend(null)
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {/* Header — title, meta, member chips, action buttons (mirrors web). */}
      <Card style={{ gap: space(3) }}>
        {isFinalized && (
          <View style={styles.finalizedBanner}>
            <Text style={styles.finalizedStamp}>FINALIZED</Text>
            <Text style={styles.finalizedMeta}>
              Locked {new Date(group.finalizedAt!).toLocaleDateString()} · no more expenses or member changes
            </Text>
          </View>
        )}
        <View>
          <Text style={styles.title}>{group.name}</Text>
          <Text style={styles.meta}>
            {group.currency.toUpperCase()} · owner <Text style={styles.metaStrong}>{group.owner}</Text> ·{' '}
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
            {isFinalized ? ' · FINALIZED' : ''}
          </Text>
        </View>

        <View style={styles.chipRow}>
          {group.members.map(m => {
            const isOwnerChip = m === group.owner
            const canRemove = !isFinalized && !isOwnerChip && (isOwner || m === myLogin)
            return (
              <View key={m} style={styles.memberChip}>
                <Avatar login={m} size={20} />
                <Text style={styles.memberChipText}>{m}</Text>
                {canRemove && (
                  <Pressable onPress={() => confirmRemoveMember(m)} hitSlop={6} disabled={busy}>
                    <Text style={styles.chipRemove}>×</Text>
                  </Pressable>
                )}
              </View>
            )
          })}
        </View>

        <View style={styles.buttonRow}>
          {!isFinalized && (
            <Button
              title={shareOpen ? 'Hide share' : 'Share to invite'}
              variant="secondary"
              icon={<ShareIcon color={colors.fg} />}
              onPress={() => setShareOpen(o => !o)}
              style={styles.actionBtn}
            />
          )}
          {isOwner && !isFinalized && (
            <Button
              title={friendsOpen ? 'Hide friends' : 'Add a friend'}
              variant="secondary"
              icon={<AddFriendIcon color={colors.fg} />}
              onPress={toggleFriends}
              style={styles.actionBtn}
            />
          )}
          <Button
            title="Receipt"
            variant="secondary"
            icon={<ReceiptIcon color={colors.fg} />}
            onPress={() => setReceiptOpen(true)}
            style={styles.actionBtn}
          />
          {isFinalized && (
            <Button
              title="Postcard"
              variant="secondary"
              icon={<PostcardIcon color={colors.fg} />}
              onPress={() => setPostcardOpen(true)}
              style={styles.actionBtn}
            />
          )}
          {isOwner && (
            isFinalized ? (
              <Button title="Reopen" variant="secondary" icon={<UnlockIcon color={colors.fg} />} onPress={confirmReopen} style={styles.actionBtn} />
            ) : (
              <Button title="Finalize" variant="secondary" icon={<LockIcon color={colors.fg} />} onPress={confirmFinalize} style={styles.actionBtn} />
            )
          )}
        </View>
      </Card>

      {/* QR invite panel (toggled by Share to invite). */}
      {shareOpen && (
        <Card style={{ alignItems: 'center', gap: space(3) }}>
          <SectionLabel>Scan or share to invite</SectionLabel>
          <View style={styles.qrFrame}>
            <QRCode value={shareUrl} size={170} backgroundColor="#ffffff" color="#1a1410" />
          </View>
          <Text style={styles.qrHint}>Anyone who scans, signs in, and taps Join is added to the roster.</Text>
        </Card>
      )}

      {/* Friend picker (owner). */}
      {friendsOpen && isOwner && !isFinalized && (
        <Card style={{ gap: space(2) }}>
          <SectionLabel>Add someone you’ve split with</SectionLabel>
          {friends == null ? (
            <Text style={styles.allSquare}>Loading…</Text>
          ) : availableFriends.length === 0 ? (
            <Text style={styles.allSquare}>
              {friends.length === 0 ? 'No past split-mates yet — share the link.' : 'Everyone you’ve split with is already here.'}
            </Text>
          ) : (
            <View style={styles.chipRow}>
              {availableFriends.map(f => (
                <Pressable key={f} style={styles.friendChip} onPress={() => onAddFriend(f)} disabled={addingFriend != null}>
                  <Avatar login={f} size={20} />
                  <Text style={styles.memberChipText}>{f}</Text>
                  <Text style={styles.friendPlus}>{addingFriend === f ? '…' : '+'}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Card>
      )}

      {/* Join CTA for a signed-in non-member. */}
      {!isMember && !isFinalized && (
        <Card style={{ gap: space(2) }}>
          <SectionLabel>Join this group</SectionLabel>
          <Text style={styles.qrHint}>Joining adds you to the roster as {myLogin}, so your expenses get split with the group.</Text>
          <Button title={`Join as ${myLogin}`} onPress={join} loading={busy} />
        </Card>
      )}

      {/* Settlement — scoped to the current period (since the last settle). */}
      <Card style={{ gap: space(2) }}>
        <View style={styles.headRow}>
          <SectionLabel>Settlement</SectionLabel>
          {lastSettledAt ? (
            <Text style={styles.total}>since {new Date(lastSettledAt).toLocaleDateString()}</Text>
          ) : null}
        </View>
        {isEven ? (
          <Text style={styles.allSquare}>
            All settled up.{lastSettledAt ? ` Cleared ${new Date(lastSettledAt).toLocaleDateString()}.` : ''}
          </Text>
        ) : (
          <>
            {balances.map(b => {
              const pct = maxBalance > 0 ? Math.min(50, (Math.abs(b.balance) / maxBalance) * 50) : 0
              const sign = b.balance > 0 ? colors.positive : b.balance < 0 ? colors.negative : colors.fgSubtle
              return (
                <View key={b.member} style={styles.balRow}>
                  <View style={styles.rowLeft}>
                    <Avatar login={b.member} size={28} />
                    <Text style={styles.balName} numberOfLines={1}>{b.member}</Text>
                  </View>
                  <View style={styles.balBar}>
                    <View style={styles.balBarMid} />
                    {b.balance !== 0 && (
                      <View
                        style={[
                          styles.balBarFill,
                          { backgroundColor: sign },
                          b.balance > 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={[styles.balAmt, { color: sign }]}>
                    {b.balance > 0 ? '+' : ''}{formatAmount(b.balance, group.currency)}
                  </Text>
                </View>
              )
            })}
            {transfers.length > 0 && (
              <View style={{ marginTop: space(2), gap: 6 }}>
                <SectionLabel>Suggested transfers</SectionLabel>
                {transfers.map((t, i) => (
                  <View key={i} style={styles.transferRow}>
                    <Text style={styles.transferText}>{t.from} → {t.to}</Text>
                    <Text style={styles.transferAmt}>{formatAmount(t.amount, group.currency)}</Text>
                  </View>
                ))}
              </View>
            )}
            {isMember && !isFinalized && (
              <Button
                title="Settle up — mark everyone paid"
                onPress={confirmSettle}
                loading={busy}
                style={{ marginTop: space(2) }}
              />
            )}
          </>
        )}
      </Card>

      {/* Add an expense. */}
      {isMember && !isFinalized && (
        <AddExpense me={myLogin} roster={settlementRoster} currency={group.currency} onSubmit={addExpense} />
      )}

      {/* Activity. */}
      <Card style={{ gap: space(2) }}>
        <View style={styles.headRow}>
          <SectionLabel>Activity</SectionLabel>
          <Text style={styles.total}>Total {formatAmount(total, group.currency)}</Text>
        </View>
        {timeline.length === 0 ? (
          <Text style={styles.allSquare}>No expenses yet.</Text>
        ) : (
          timeline.map(row => {
            if (row.kind === 'settle') {
              const s = row.e
              return (
                <View key={s.id} style={styles.settleDivider}>
                  <View style={styles.settleDividerLine} />
                  <Text style={styles.settleDividerLabel}>
                    ✓ Settled up · {new Date(s.ts).toLocaleDateString()}{s.note ? ` · ${s.note}` : ''}
                  </Text>
                  <View style={styles.settleDividerLine} />
                </View>
              )
            }
            const e = row.e
            const ev = expenseView(e)
            return (
              <View key={e.id} style={[styles.activityRow, ev.isSettled && { opacity: 0.55 }]}>
                <Avatar login={e.payer} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle}>
                    {e.payer} paid {formatAmount(ev.effAmount, group.currency)}
                    {ev.edited ? <Text style={styles.editedTag}>  edited</Text> : null}
                    {ev.isSettled ? <Text style={styles.editedTag}>  settled</Text> : null}
                  </Text>
                  {e.note ? <Text style={styles.activityNote}>“{e.note}”</Text> : null}
                  <Text style={styles.activitySplit}>split among {e.participants.join(', ')}</Text>
                </View>
                {(ev.canEdit || ev.canVoid) && (
                  <View style={styles.rowActions}>
                    {ev.canEdit && (
                      <Pressable onPress={() => setEditTarget(e)} hitSlop={6} disabled={busy}>
                        <Text style={styles.editBtn}>edit</Text>
                      </Pressable>
                    )}
                    {ev.canVoid && (
                      <Pressable onPress={() => confirmVoid(e)} hitSlop={6} disabled={busy}>
                        <Text style={styles.voidBtn}>void</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            )
          })
        )}
      </Card>

      <ShareImageSheet open={receiptOpen} onClose={() => setReceiptOpen(false)} group={group} balances={balances} transfers={transfers} />
      <ShareImageSheet open={postcardOpen} kind="postcard" onClose={() => setPostcardOpen(false)} group={group} balances={balances} transfers={transfers} />

      <EditExpenseSheet
        target={editTarget}
        currency={group.currency}
        onClose={() => setEditTarget(null)}
        onSave={saveEdit}
      />
    </ScrollView>
  )
}

// ----- add-expense card -------------------------------------------------

function AddExpense({
  me,
  roster,
  currency,
  onSubmit,
}: {
  me: Member
  roster: Member[]
  currency: string
  onSubmit: (input: AddExpenseInput) => Promise<boolean>
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [participants, setParticipants] = useState<Member[]>(roster)
  const [submitting, setSubmitting] = useState(false)
  // Expense date — seeded to "now". Only send a backdate override once the
  // user actually touches the picker; otherwise the server stamps now.
  const [date, setDate] = useState(new Date())
  const [dateEdited, setDateEdited] = useState(false)

  function toggle(m: Member) {
    setParticipants(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]))
  }

  async function submit() {
    setSubmitting(true)
    const ok = await onSubmit({ amountStr: amount, note, participants, dateMs: dateEdited ? date.getTime() : undefined })
    setSubmitting(false)
    if (ok) {
      setAmount('')
      setNote('')
      setParticipants(roster)
      setDate(new Date())
      setDateEdited(false)
    }
  }

  return (
    <Card style={{ gap: space(3) }}>
      <SectionLabel>Add expense</SectionLabel>
      <View style={styles.payerFixed}>
        <Avatar login={me} size={28} />
        <Text style={styles.payerText}>
          <Text style={styles.payerStrong}>{me}</Text> paid
        </Text>
        <TextInput
          placeholder={`Amount (${currency.toUpperCase()})`}
          placeholderTextColor={colors.fgSubtle}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          style={styles.amountInline}
        />
      </View>
      <TextInput
        placeholder="Note (optional, e.g. dinner at Sushi Aoki)"
        placeholderTextColor={colors.fgSubtle}
        value={note}
        onChangeText={setNote}
        style={styles.input}
      />
      <View>
        <Text style={styles.splitLabel}>Date</Text>
        <DateTimePicker
          value={date}
          mode="datetime"
          display="compact"
          maximumDate={new Date()}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(_, d) => {
            if (d) {
              setDate(d)
              setDateEdited(true)
            }
          }}
          style={styles.datePicker}
        />
      </View>
      <View>
        <Text style={styles.splitLabel}>Split equally among</Text>
        <View style={styles.chipRow}>
          {roster.map(m => {
            const on = participants.includes(m)
            return (
              <Pressable key={m} onPress={() => toggle(m)} style={[styles.checkPill, on && styles.checkPillOn]}>
                <Avatar login={m} size={20} />
                <Text style={[styles.checkPillText, on && styles.checkPillTextOn]}>{m}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Button title="Add expense" onPress={submit} loading={submitting} />
    </Card>
  )
}

// ----- edit-expense sheet ----------------------------------------------

// Bottom sheet for amending an expense's amount / date / note in place. Seeds
// from the *effective* expense (the activity row hands us already-folded
// figures), and re-seeds whenever a different row opens it. Clearing the note
// field removes the note; see EditEvent.note for the fold semantics.
function EditExpenseSheet({
  target,
  currency,
  onClose,
  onSave,
}: {
  target: ExpenseEvent | null
  currency: string
  onClose: () => void
  onSave: (targetId: string, input: { amountStr: string; dateMs: number; note: string }) => Promise<boolean>
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(new Date())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    setAmount(amountToInput(target.amount, currency))
    setNote(target.note ?? '')
    setDate(new Date(target.ts))
  }, [target, currency])

  async function save() {
    if (!target) return
    setSaving(true)
    const ok = await onSave(target.id, { amountStr: amount, dateMs: date.getTime(), note })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal visible={target != null} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetBackdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Edit expense</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.editHint}>
            Adjust the amount, date, or note. Participants stay the same — the entry
            is amended in place and flagged as edited.
          </Text>
          <View>
            <Text style={styles.splitLabel}>Amount ({currency.toUpperCase()})</Text>
            <TextInput
              placeholder={`Amount (${currency.toUpperCase()})`}
              placeholderTextColor={colors.fgSubtle}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              style={styles.input}
            />
          </View>
          <View>
            <Text style={styles.splitLabel}>Note</Text>
            <TextInput
              placeholder="Note (optional, e.g. dinner at Sushi Aoki)"
              placeholderTextColor={colors.fgSubtle}
              value={note}
              onChangeText={setNote}
              style={styles.input}
            />
          </View>
          <View>
            <Text style={styles.splitLabel}>Date</Text>
            <DateTimePicker
              value={date}
              mode="datetime"
              display="compact"
              maximumDate={new Date()}
              themeVariant={isDark ? 'dark' : 'light'}
              onChange={(_, d) => { if (d) setDate(d) }}
              style={styles.datePicker}
            />
          </View>
          <View style={styles.editActions}>
            <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Save changes" onPress={save} loading={saving} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space(6) },
  title: { fontSize: 26, fontWeight: '600', color: colors.fg, fontFamily: fonts.display },
  meta: { fontSize: 13, color: colors.fgMuted, marginTop: 4, fontFamily: fonts.mono },
  metaStrong: { color: colors.fg, fontWeight: '600' },
  finalizedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  finalizedStamp: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    fontFamily: fonts.mono,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  finalizedMeta: { fontSize: 11, color: colors.fgMuted, fontFamily: fonts.sans, flexShrink: 1 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 2,
    paddingRight: 10,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSubtle,
    borderRadius: radius.full,
  },
  memberChipText: { fontSize: 12, color: colors.fg, fontWeight: '500', fontFamily: fonts.sans },
  chipRemove: { color: colors.fgSubtle, fontSize: 15, paddingHorizontal: 2 },

  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { height: 42, paddingHorizontal: 14 },

  qrFrame: { padding: 14, backgroundColor: '#ffffff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  qrHint: { fontSize: 13, color: colors.fgMuted, fontFamily: fonts.sans, lineHeight: 19 },

  friendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 2,
    paddingRight: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.full,
  },
  friendPlus: { fontSize: 14, color: colors.accent, fontWeight: '600', marginLeft: 2 },

  allSquare: { color: colors.fgSubtle, fontStyle: 'italic', fontFamily: fonts.display },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingVertical: 5 },
  rowLeft: { width: 104, flexDirection: 'row', alignItems: 'center', gap: space(2) },
  balName: { flex: 1, fontSize: 15, color: colors.fg, fontFamily: fonts.sans },
  balBar: { flex: 1, height: 8, position: 'relative', justifyContent: 'center' },
  balBarMid: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  balBarFill: { position: 'absolute', top: 1, bottom: 1, borderRadius: 3, minWidth: 2 },
  balAmt: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '600', textAlign: 'right', minWidth: 92 },
  transferRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transferText: { fontSize: 14, color: colors.fg, fontFamily: fonts.sans },
  transferAmt: { fontSize: 13, color: colors.accent, fontFamily: fonts.mono, fontWeight: '700' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontSize: 13, color: colors.fgMuted, fontFamily: fonts.mono },
  activityRow: { flexDirection: 'row', gap: space(3), alignItems: 'flex-start', paddingVertical: 6 },
  activityTitle: { fontSize: 15, color: colors.fg, fontWeight: '500', fontFamily: fonts.sans },
  editedTag: { fontSize: 11, color: colors.fgSubtle, fontFamily: fonts.mono },
  activityNote: { fontSize: 14, color: colors.fgMuted, fontStyle: 'italic', marginTop: 2, fontFamily: fonts.display },
  activitySplit: { fontSize: 12, color: colors.fgSubtle, marginTop: 2, fontFamily: fonts.mono },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 2 },
  editBtn: { fontSize: 12, color: colors.fgMuted, fontFamily: fonts.sans, fontWeight: '600' },
  voidBtn: { fontSize: 12, color: colors.negative, fontFamily: fonts.sans, fontWeight: '600' },
  settleDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: space(2) },
  settleDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  settleDividerLabel: { fontSize: 11, color: colors.positive, fontFamily: fonts.mono, flexShrink: 1, textAlign: 'center' },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    color: colors.fg,
    fontSize: 15,
    fontFamily: fonts.sans,
    backgroundColor: colors.bg,
  },
  payerFixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSubtle,
    borderRadius: radius.md,
  },
  payerText: { fontSize: 15, color: colors.fg, fontFamily: fonts.sans },
  payerStrong: { fontWeight: '600' },
  amountInline: { flex: 1, height: 38, color: colors.fg, fontSize: 15, fontFamily: fonts.sans, padding: 0, textAlign: 'right' },
  splitLabel: { fontSize: 13, color: colors.fgMuted, marginBottom: 8, fontFamily: fonts.sans },
  // The compact iOS picker sizes to its own intrinsic width; flex-start let
  // its date+time pill spill past the card's right edge on narrow phones.
  // Stretch pins it to the card's content width so it lays its pills out
  // within bounds (right-aligned, the iOS-standard placement).
  datePicker: { alignSelf: 'stretch' },
  checkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 2,
    paddingRight: 12,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgElevated,
  },
  checkPillOn: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  checkPillText: { fontSize: 13, color: colors.fgMuted, fontFamily: fonts.sans },
  checkPillTextOn: { color: colors.accent, fontWeight: '600' },

  // Edit-expense bottom sheet (mirrors ShareImageSheet's chrome).
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,20,16,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space(4),
    gap: space(3),
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: colors.fg, fontFamily: fonts.display },
  sheetClose: { fontSize: 18, color: colors.fgMuted },
  editHint: { fontSize: 13, color: colors.fgMuted, fontFamily: fonts.sans, lineHeight: 19 },
  editActions: { flexDirection: 'row', gap: space(2), marginTop: space(1) },
})
