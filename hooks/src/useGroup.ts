// Group-detail page logic — shared by the web Group page and the RN
// GroupScreen. Holds the group data, all settlement/edit derivations, the
// permission predicates, and the domain actions (join / add-expense / void /
// edit / finalize / reopen / add-friend / remove-member).
//
// Actions are "raw": they hit the API and refresh, but do NOT show confirm
// dialogs, copy to clipboard, or navigate — those are platform concerns the
// view owns (window.confirm vs Alert, hash vs navigation). removeMember
// returns 'left' | 'removed' so the view can navigate on a self-leave.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  readGroup,
  joinGroup,
  removeMember,
  addMember,
  listFriends,
  finalizeGroup,
  reopenGroup,
  postEvent,
  makeExpense,
  makeVoid,
  makeEdit,
  computeBalances,
  settle,
  latestEditByTarget,
  parseAmount,
  type Group,
  type Balance,
  type Transfer,
  type ExpenseEvent,
  type EditEvent,
  type Member,
} from '@splitstupid/core'

// The canonical web origin the QR / share link points at — the same URL on
// both platforms (a phone scanner opens it in a browser).
const SHARE_ORIGIN = 'https://splitstupid.lfkdsk.org'

/** Per-expense view model: the effective (edit-folded) figures plus the
 *  permission flags that decide whether the void / edit affordances show. */
export interface ExpenseView {
  effAmount: number
  effDateMs: number
  isVoided: boolean
  edited: boolean
  canVoid: boolean
  canEdit: boolean
}

export interface AddExpenseInput {
  amountStr: string
  note: string
  participants: Member[]
  /** Unix ms to backdate to; omit for "now". */
  dateMs?: number
}

export interface UseGroup {
  group: Group | null
  loading: boolean
  busy: boolean
  error: string | null
  setError: (e: string | null) => void
  clearError: () => void
  refresh: () => Promise<void>

  // Derived settlement state.
  balances: Balance[]
  transfers: Transfer[]
  /** Largest |balance| — for sizing the balance bars. */
  maxBalance: number
  settlementRoster: Member[]
  isOwner: boolean
  isMember: boolean
  isFinalized: boolean
  shareUrl: string
  /** Effective figures + permission flags for one expense row. */
  expenseView: (e: ExpenseEvent) => ExpenseView

  // Owner's "add a past split-mate" picker.
  friends: Member[] | null
  availableFriends: Member[]
  loadFriends: () => Promise<void>

  // Domain actions. addExpense / saveEdit validate and return success.
  join: () => Promise<void>
  addExpense: (input: AddExpenseInput) => Promise<boolean>
  voidExpense: (targetId: string) => Promise<void>
  saveEdit: (targetId: string, input: { amountStr: string; dateMs: number }) => Promise<boolean>
  finalize: () => Promise<void>
  reopen: () => Promise<void>
  addFriend: (login: Member) => Promise<void>
  /** Self-leave or owner-kick (same endpoint). Returns 'left' on self-leave
   *  so the caller can navigate away; 'removed' otherwise. */
  removeSelfOrMember: (login: Member) => Promise<'left' | 'removed' | undefined>
}

export function useGroup(groupId: string, me: Member): UseGroup {
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [friends, setFriends] = useState<Member[] | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setGroup(await readGroup(groupId))
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load group')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { refresh() }, [refresh])

  // Roster includes everyone who appears in any event, not just current
  // members — so a kicked/left member who paid still gets a balance row.
  const settlementRoster = useMemo(() => {
    if (!group) return []
    const set = new Set<Member>(group.members)
    for (const e of group.events) {
      if (e.type === 'expense') {
        set.add(e.payer)
        for (const p of e.participants) set.add(p)
      }
    }
    return Array.from(set)
  }, [group])

  const balances = useMemo(
    () => (group ? computeBalances(group.events, settlementRoster) : []),
    [group, settlementRoster],
  )
  const transfers = useMemo(() => settle(balances), [balances])
  const maxBalance = useMemo(
    () => balances.reduce((m, b) => Math.max(m, Math.abs(b.balance)), 0),
    [balances],
  )
  const edits = useMemo<Map<string, EditEvent>>(
    () => (group ? latestEditByTarget(group.events) : new Map()),
    [group],
  )
  const voided = useMemo(() => {
    const s = new Set<string>()
    if (group) for (const e of group.events) if (e.type === 'void') s.add(e.targetId)
    return s
  }, [group])

  const isOwner = !!group && group.owner === me
  const isMember = !!group && group.members.includes(me)
  const isFinalized = !!group && group.finalizedAt != null
  const shareUrl = `${SHARE_ORIGIN}/#/g/${groupId}`
  const availableFriends = useMemo(
    () => (friends ?? []).filter(f => !group?.members.includes(f)),
    [friends, group],
  )

  const expenseView = useCallback(
    (e: ExpenseEvent): ExpenseView => {
      const edit = edits.get(e.id)
      const isVoided = voided.has(e.id)
      return {
        effAmount: edit ? edit.amount : e.amount,
        effDateMs: edit ? edit.date : new Date(e.ts).getTime(),
        isVoided,
        edited: !!edit,
        // Owner can void anything; others only their own. Frozen when finalized.
        canVoid: (isOwner || e.author === me) && !isVoided && !isFinalized,
        // Edit is the author's alone (server only accepts edits from them).
        canEdit: e.author === me && !isVoided && !isFinalized,
      }
    },
    [edits, voided, isOwner, isFinalized, me],
  )

  // Wrap an action with busy/error bookkeeping.
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error)?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }, [])

  const join = useCallback(
    () => run(async () => { await joinGroup(groupId); await refresh() }),
    [run, groupId, refresh],
  )
  const finalize = useCallback(
    () => run(async () => { await finalizeGroup(groupId); await refresh() }),
    [run, groupId, refresh],
  )
  const reopen = useCallback(
    () => run(async () => { await reopenGroup(groupId); await refresh() }),
    [run, groupId, refresh],
  )
  const addFriend = useCallback(
    (login: Member) => run(async () => { await addMember(groupId, login); await refresh() }),
    [run, groupId, refresh],
  )
  const voidExpense = useCallback(
    (targetId: string) => run(async () => { await postEvent(groupId, makeVoid({ targetId })); await refresh() }),
    [run, groupId, refresh],
  )

  const loadFriends = useCallback(async () => {
    try {
      setFriends(await listFriends())
    } catch (e) {
      setFriends([])
      setError((e as Error)?.message || 'Failed to load friends')
    }
  }, [])

  const addExpense = useCallback(
    async (input: AddExpenseInput): Promise<boolean> => {
      if (!group) return false
      const amount = parseAmount(input.amountStr, group.currency)
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Amount must be a positive number')
        return false
      }
      if (input.participants.length === 0) {
        setError('Pick at least one participant')
        return false
      }
      if (input.dateMs !== undefined && !Number.isFinite(input.dateMs)) {
        setError('Pick a valid date')
        return false
      }
      let ok = false
      await run(async () => {
        await postEvent(
          group.id,
          makeExpense({
            payer: me,
            amount,
            participants: input.participants,
            split: 'equal',
            note: input.note.trim() || undefined,
            ts: input.dateMs,
          }),
        )
        await refresh()
        ok = true
      })
      return ok
    },
    [group, run, me, refresh],
  )

  const saveEdit = useCallback(
    async (targetId: string, input: { amountStr: string; dateMs: number }): Promise<boolean> => {
      if (!group) return false
      const amount = parseAmount(input.amountStr, group.currency)
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Amount must be a positive number')
        return false
      }
      if (!Number.isFinite(input.dateMs)) {
        setError('Pick a valid date')
        return false
      }
      let ok = false
      await run(async () => {
        await postEvent(group.id, makeEdit({ targetId, amount, date: input.dateMs }))
        await refresh()
        ok = true
      })
      return ok
    },
    [group, run, refresh],
  )

  const removeSelfOrMember = useCallback(
    async (login: Member): Promise<'left' | 'removed' | undefined> => {
      let result: 'left' | 'removed' | undefined
      await run(async () => {
        await removeMember(groupId, login)
        if (login === me) {
          result = 'left'
        } else {
          result = 'removed'
          await refresh()
        }
      })
      return result
    },
    [run, groupId, me, refresh],
  )

  return {
    group, loading, busy, error,
    setError, clearError: () => setError(null), refresh,
    balances, transfers, maxBalance, settlementRoster,
    isOwner, isMember, isFinalized, shareUrl, expenseView,
    friends, availableFriends, loadFriends,
    join, addExpense, voidExpense, saveEdit, finalize, reopen, addFriend, removeSelfOrMember,
  }
}
