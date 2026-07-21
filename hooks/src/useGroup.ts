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
  addOfflineMember,
  listFriends,
  finalizeGroup,
  reopenGroup,
  fetchExchangeRate,
  postEvent,
  makeExpense,
  makeVoid,
  makeEdit,
  makeSettle,
  computeBalances,
  settle,
  sinceLastSettle,
  lastSettleTs,
  latestEditByTarget,
  parseAmount,
  convertMinorAmount,
  normalizeCurrency,
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

interface MoneyInput {
  amountStr: string
  currency?: string
  manualExchangeRate?: number
}

async function resolveMoneyInput(input: MoneyInput, groupCurrency: string, dateMs?: number): Promise<{
  amount: number
  fx: {
    originalCurrency: string
    originalAmount: number
    exchangeRate: number
    exchangeRateSource: 'frankfurter' | 'manual'
    exchangeRateDate: string
    exchangeRateFetchedAt?: number
  }
} | null> {
  const originalCurrency = normalizeCurrency(input.currency || groupCurrency)
  const quote = normalizeCurrency(groupCurrency)
  const originalAmount = parseAmount(input.amountStr, originalCurrency)
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return null
  const rateDate = rateDateFromMs(dateMs)

  if (originalCurrency === quote) {
    return {
      amount: originalAmount,
      fx: {
        originalCurrency,
        originalAmount,
        exchangeRate: 1,
        exchangeRateSource: 'manual',
        exchangeRateDate: rateDate,
      },
    }
  }

  if (input.manualExchangeRate !== undefined) {
    const exchangeRate = input.manualExchangeRate
    const amount = convertMinorAmount(originalAmount, originalCurrency, quote, exchangeRate)
    if (!Number.isFinite(amount) || amount <= 0) return null
    return {
      amount,
      fx: {
        originalCurrency,
        originalAmount,
        exchangeRate,
        exchangeRateSource: 'manual',
        exchangeRateDate: rateDate,
      },
    }
  }

  const quoteRate = await fetchExchangeRate({ base: originalCurrency, quote, date: rateDate })
  const amount = convertMinorAmount(originalAmount, originalCurrency, quote, quoteRate.rate)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return {
    amount,
    fx: {
      originalCurrency,
      originalAmount,
      exchangeRate: quoteRate.rate,
      exchangeRateSource: 'frankfurter',
      exchangeRateDate: quoteRate.date,
      exchangeRateFetchedAt: quoteRate.fetchedAt,
    },
  }
}

function rateDateFromMs(ms?: number): string {
  const d = Number.isFinite(ms) ? new Date(ms!) : new Date()
  return d.toISOString().slice(0, 10)
}

/** Per-expense view model: the effective (edit-folded) figures plus the
 *  permission flags that decide whether the void / edit affordances show. */
export interface ExpenseView {
  effAmount: number
  effDateMs: number
  /** Effective note after folding the latest edit (undefined ⇒ no note). */
  effNote?: string
  effOriginalCurrency?: string
  effOriginalAmount?: number
  effExchangeRate?: number
  effExchangeRateSource?: 'frankfurter' | 'manual'
  effExchangeRateDate?: string
  effExchangeRateFetchedAt?: number
  isVoided: boolean
  edited: boolean
  /** Sits before the latest settle checkpoint — frozen as a paid-off record,
   *  so it can't be voided or edited and renders muted. */
  isSettled: boolean
  canVoid: boolean
  canEdit: boolean
}

export interface AddExpenseInput {
  amountStr: string
  currency?: string
  manualExchangeRate?: number
  note: string
  /** Defaults to the authenticated user. Owners may pass an offline member. */
  payer?: Member
  participants: Member[]
  /** Unix ms to backdate to; omit for "now". */
  dateMs?: number
}

export interface EditExpenseInput {
  amountStr: string
  currency?: string
  manualExchangeRate?: number
  dateMs: number
  note?: string
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
  /** Current-period balances are all zero — nothing left to settle. */
  isEven: boolean
  /** Unix ms of the last settle checkpoint, or undefined if never cleared. */
  lastSettledAt?: number
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
  saveEdit: (targetId: string, input: EditExpenseInput) => Promise<boolean>
  /** Stamp a clear-the-slate checkpoint: the current balances are settled up,
   *  the period resets, the group stays open. Any member may call it. */
  settleUp: (note?: string) => Promise<void>
  finalize: () => Promise<void>
  reopen: () => Promise<void>
  addFriend: (login: Member) => Promise<void>
  addOffline: (name: string) => Promise<void>
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

  // Live settlement is scoped to the *current period* — the events appended
  // since the last settle checkpoint. A group that's never been settled slices
  // to its whole log, so this is a no-op for the common case.
  const currentEvents = useMemo(
    () => (group ? sinceLastSettle(group.events) : []),
    [group],
  )
  const lastSettledAt = useMemo(
    () => (group ? lastSettleTs(group.events) : undefined),
    [group],
  )
  const balances = useMemo(
    () => (group ? computeBalances(currentEvents, settlementRoster) : []),
    [group, currentEvents, settlementRoster],
  )
  const transfers = useMemo(() => settle(balances), [balances])
  const isEven = useMemo(() => balances.every(b => b.balance === 0), [balances])
  // Ids of expenses that fall on or before the last settle checkpoint — frozen
  // history. Keyed by id (off the original append ts) so the flag is stable
  // whether the caller hands expenseView a raw or an edit-folded expense.
  const settledIds = useMemo(() => {
    const s = new Set<string>()
    if (group && lastSettledAt != null) {
      for (const e of group.events) {
        if (e.type === 'expense' && new Date(e.ts).getTime() <= lastSettledAt) s.add(e.id)
      }
    }
    return s
  }, [group, lastSettledAt])
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
      // A period boundary is by the expense's own (append/backdate) instant;
      // settledIds is precomputed off that so the flag matches the server's
      // freeze guard even when the caller passes an edit-folded expense.
      const isSettled = settledIds.has(e.id)
      return {
        effAmount: edit ? edit.amount : e.amount,
        effDateMs: edit ? edit.date : new Date(e.ts).getTime(),
        // Mirror applyEdit's note fold: an edit carrying a note wins (empty ⇒
        // cleared); a legacy edit without one leaves the original note.
        effNote: edit && edit.note !== undefined ? edit.note || undefined : e.note,
        effOriginalCurrency: edit?.originalCurrency ?? e.originalCurrency,
        effOriginalAmount: edit?.originalAmount ?? e.originalAmount,
        effExchangeRate: edit?.exchangeRate ?? e.exchangeRate,
        effExchangeRateSource: edit?.exchangeRateSource ?? e.exchangeRateSource,
        effExchangeRateDate: edit?.exchangeRateDate ?? e.exchangeRateDate,
        effExchangeRateFetchedAt: edit?.exchangeRateFetchedAt ?? e.exchangeRateFetchedAt,
        isVoided,
        edited: !!edit,
        isSettled,
        // Owner can void anything; others only their own. Frozen once finalized
        // or once the expense falls into a settled period.
        canVoid: (isOwner || e.author === me) && !isVoided && !isFinalized && !isSettled,
        // Edit is the author's alone (server only accepts edits from them).
        canEdit: e.author === me && !isVoided && !isFinalized && !isSettled,
      }
    },
    [edits, voided, settledIds, isOwner, isFinalized, me],
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
  const addOffline = useCallback(
    (name: string) => run(async () => { await addOfflineMember(groupId, name); await refresh() }),
    [run, groupId, refresh],
  )
  const voidExpense = useCallback(
    (targetId: string) => run(async () => { await postEvent(groupId, makeVoid({ targetId })); await refresh() }),
    [run, groupId, refresh],
  )
  const settleUp = useCallback(
    (note?: string) => run(async () => {
      await postEvent(groupId, makeSettle(note?.trim() ? { note: note.trim() } : {}))
      await refresh()
    }),
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
      if (input.dateMs !== undefined && !Number.isFinite(input.dateMs)) {
        setError('Pick a valid date')
        return false
      }
      let converted: Awaited<ReturnType<typeof resolveMoneyInput>>
      try {
        converted = await resolveMoneyInput(input, group.currency, input.dateMs)
      } catch (e) {
        setError((e as Error)?.message || 'Failed to fetch exchange rate')
        return false
      }
      if (!converted) {
        setError('Amount and exchange rate must be positive numbers')
        return false
      }
      if (input.participants.length === 0) {
        setError('Pick at least one participant')
        return false
      }
      let ok = false
      await run(async () => {
        await postEvent(
          group.id,
          makeExpense({
            payer: input.payer || me,
            amount: converted.amount,
            participants: input.participants,
            split: 'equal',
            note: input.note.trim() || undefined,
            ts: input.dateMs,
            ...converted.fx,
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
    async (targetId: string, input: EditExpenseInput): Promise<boolean> => {
      if (!group) return false
      if (!Number.isFinite(input.dateMs)) {
        setError('Pick a valid date')
        return false
      }
      let converted: Awaited<ReturnType<typeof resolveMoneyInput>>
      try {
        converted = await resolveMoneyInput(input, group.currency, input.dateMs)
      } catch (e) {
        setError((e as Error)?.message || 'Failed to fetch exchange rate')
        return false
      }
      if (!converted) {
        setError('Amount and exchange rate must be positive numbers')
        return false
      }
      let ok = false
      await run(async () => {
        // Pass note through only when the caller supplies it; an empty string
        // clears the note, undefined leaves it as-is (see EditEvent.note).
        await postEvent(group.id, makeEdit({
          targetId,
          amount: converted.amount,
          date: input.dateMs,
          note: input.note !== undefined ? input.note.trim() : undefined,
          ...converted.fx,
        }))
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
    isOwner, isMember, isFinalized, isEven, lastSettledAt, shareUrl, expenseView,
    friends, availableFriends, loadFriends,
    join, addExpense, voidExpense, saveEdit, settleUp, finalize, reopen, addFriend, addOffline, removeSelfOrMember,
  }
}
