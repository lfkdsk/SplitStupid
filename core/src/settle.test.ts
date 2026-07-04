import { describe, it, expect } from 'vitest'
import {
  computeBalances,
  effectiveExpenses,
  latestEditByTarget,
  applyEdit,
  settle,
  sinceLastSettle,
  lastSettleTs,
  realCostByMember,
  formatAmount,
  parseAmount,
  convertMinorAmount,
} from './settle'
import type { EditEvent, Event, ExpenseEvent, Balance } from './types'

// ----- builders ---------------------------------------------------------

let seq = 0
function expense(p: Partial<ExpenseEvent> & Pick<ExpenseEvent, 'payer' | 'amount' | 'participants'>): ExpenseEvent {
  return {
    id: p.id ?? `e${++seq}`,
    type: 'expense',
    ts: p.ts ?? new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    author: p.author ?? p.payer,
    payer: p.payer,
    amount: p.amount,
    participants: p.participants,
    split: p.split ?? 'equal',
    note: p.note,
  }
}
function voidEv(targetId: string, ts?: string): Event {
  return { id: `v${++seq}`, type: 'void', ts: ts ?? new Date(1_700_000_500_000 + seq).toISOString(), author: 'x', targetId }
}
function editEv(targetId: string, amount: number, date: number, ts?: string, note?: string): EditEvent {
  return {
    id: `d${++seq}`, type: 'edit', ts: ts ?? new Date(1_700_000_900_000 + seq).toISOString(),
    author: 'x', targetId, amount, date,
    ...(note !== undefined ? { note } : {}),
  }
}
function settleEv(ts?: string): Event {
  return { id: `s${++seq}`, type: 'settle', ts: ts ?? new Date(1_700_001_000_000 + seq).toISOString(), author: 'x' }
}

const sum = (bs: Balance[]) => bs.reduce((a, b) => a + b.balance, 0)

// ----- computeBalances --------------------------------------------------

describe('computeBalances', () => {
  it('credits the payer and debits each participant their share', () => {
    const events = [expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob'] })]
    const bal = computeBalances(events, ['alice', 'bob'])
    expect(bal).toEqual([
      { member: 'alice', balance: 500 },
      { member: 'bob', balance: -500 },
    ])
  })

  it('dumps the equal-split rounding remainder on the first participant', () => {
    // 1000 / 3 = 333 r1 → first participant owes 334, others 333.
    const events = [expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob', 'carol'] })]
    const bal = computeBalances(events, ['alice', 'bob', 'carol'])
    expect(bal).toEqual([
      { member: 'alice', balance: 666 }, // +1000 paid, -334 own share
      { member: 'bob', balance: -333 },
      { member: 'carol', balance: -333 },
    ])
    expect(sum(bal)).toBe(0)
  })

  it('honours an explicit (non-equal) split map', () => {
    const events = [expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob'], split: { alice: 200, bob: 800 } })]
    const bal = computeBalances(events, ['alice', 'bob'])
    expect(bal).toEqual([
      { member: 'alice', balance: 800 },
      { member: 'bob', balance: -800 },
    ])
  })

  it('keeps zero-balance roster members and always sums to zero', () => {
    const events = [
      expense({ id: 'e1', payer: 'alice', amount: 900, participants: ['alice', 'bob', 'carol'] }),
      expense({ id: 'e2', payer: 'bob', amount: 300, participants: ['alice', 'bob', 'carol'] }),
    ]
    const bal = computeBalances(events, ['alice', 'bob', 'carol', 'dave'])
    expect(bal.find(b => b.member === 'dave')).toEqual({ member: 'dave', balance: 0 })
    expect(sum(bal)).toBe(0)
  })

  it('drops voided expenses', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob'] }),
      voidEv('e1'),
    ]
    const bal = computeBalances(events, ['alice', 'bob'])
    expect(bal).toEqual([
      { member: 'alice', balance: 0 },
      { member: 'bob', balance: 0 },
    ])
  })

  it('settles against the edited amount, not the original', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob'] }),
      editEv('e1', 2000, Date.now()),
    ]
    const bal = computeBalances(events, ['alice', 'bob'])
    expect(bal).toEqual([
      { member: 'alice', balance: 1000 },
      { member: 'bob', balance: -1000 },
    ])
  })

  it('settles multi-currency expenses with their converted group-currency amount', () => {
    const events = [
      expense({
        id: 'e1',
        payer: 'alice',
        amount: 11000,
        participants: ['alice', 'bob'],
        originalCurrency: 'EUR',
        originalAmount: 10000,
        exchangeRate: 1.1,
        exchangeRateSource: 'manual',
        exchangeRateDate: '2026-07-04',
      }),
    ]
    const bal = computeBalances(events, ['alice', 'bob'])
    expect(bal).toEqual([
      { member: 'alice', balance: 5500 },
      { member: 'bob', balance: -5500 },
    ])
  })
})

// ----- settle checkpoints (period slicing) ------------------------------

describe('sinceLastSettle', () => {
  it('returns the whole log when there is no settle', () => {
    const events = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'] }),
      expense({ id: 'e2', payer: 'b', amount: 200, participants: ['b'] }),
    ]
    expect(sinceLastSettle(events).map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('returns only events appended after the last settle', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'] }),
      settleEv(),
      expense({ id: 'e2', payer: 'b', amount: 200, participants: ['b'] }),
    ]
    expect(sinceLastSettle(events).map(e => e.id)).toEqual(['e2'])
  })

  it('cuts at the most recent settle when there are several', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'] }),
      settleEv(),
      expense({ id: 'e2', payer: 'b', amount: 200, participants: ['b'] }),
      settleEv(),
      expense({ id: 'e3', payer: 'c', amount: 300, participants: ['c'] }),
    ]
    expect(sinceLastSettle(events).map(e => e.id)).toEqual(['e3'])
  })

  it('is empty right after a settle with nothing logged since', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'] }),
      settleEv(),
    ]
    expect(sinceLastSettle(events)).toEqual([])
  })

  it('drives a balance reset: only the current period counts', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob'] }),
      settleEv(),
      expense({ id: 'e2', payer: 'bob', amount: 400, participants: ['alice', 'bob'] }),
    ]
    const bal = computeBalances(sinceLastSettle(events), ['alice', 'bob'])
    expect(bal).toEqual([
      { member: 'alice', balance: -200 }, // owes their half of bob's 400
      { member: 'bob', balance: 200 },
    ])
  })
})

describe('lastSettleTs', () => {
  it('is undefined when the group was never settled', () => {
    expect(lastSettleTs([expense({ id: 'e1', payer: 'a', amount: 1, participants: ['a'] })])).toBeUndefined()
  })

  it('returns the ms of the most recent settle', () => {
    const events: Event[] = [
      settleEv('2024-01-01T00:00:00.000Z'),
      expense({ id: 'e1', payer: 'a', amount: 1, participants: ['a'] }),
      settleEv('2024-06-01T00:00:00.000Z'),
    ]
    expect(lastSettleTs(events)).toBe(Date.parse('2024-06-01T00:00:00.000Z'))
  })
})

// ----- effectiveExpenses / edits ---------------------------------------

describe('effectiveExpenses', () => {
  it('omits voided expenses entirely', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'] }),
      expense({ id: 'e2', payer: 'b', amount: 200, participants: ['b'] }),
      voidEv('e1'),
    ]
    expect(effectiveExpenses(events).map(e => e.id)).toEqual(['e2'])
  })

  it('folds the latest edit over its target (by audit ts)', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'], ts: '2024-01-01T00:00:00.000Z' }),
      editEv('e1', 200, Date.parse('2024-02-01'), '2024-03-01T00:00:00.000Z'),
      editEv('e1', 300, Date.parse('2024-04-01'), '2024-05-01T00:00:00.000Z'),
    ]
    const eff = effectiveExpenses(events)
    expect(eff).toHaveLength(1)
    expect(eff[0].amount).toBe(300) // latest edit wins
    expect(eff[0].ts).toBe(new Date(Date.parse('2024-04-01')).toISOString())
  })

  it('folds an edited note over the original', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 100, participants: ['a'], note: 'tacos' }),
      editEv('e1', 100, Date.parse('2024-02-01'), '2024-03-01T00:00:00.000Z', 'burritos'),
    ]
    expect(effectiveExpenses(events)[0].note).toBe('burritos')
  })

  it('preserves original append order', () => {
    const events: Event[] = [
      expense({ id: 'e1', payer: 'a', amount: 1, participants: ['a'] }),
      expense({ id: 'e2', payer: 'b', amount: 2, participants: ['b'] }),
      expense({ id: 'e3', payer: 'c', amount: 3, participants: ['c'] }),
    ]
    expect(effectiveExpenses(events).map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
  })
})

describe('latestEditByTarget', () => {
  it('picks the highest-ts edit per target, ties go to last-seen', () => {
    const t = '2024-01-01T00:00:00.000Z'
    const events: Event[] = [
      editEv('e1', 10, 1, t),
      editEv('e1', 20, 2, t), // same ts → last seen wins
      editEv('e2', 99, 3, '2023-01-01T00:00:00.000Z'),
    ]
    const m = latestEditByTarget(events)
    expect(m.get('e1')?.amount).toBe(20)
    expect(m.get('e2')?.amount).toBe(99)
  })
})

describe('applyEdit', () => {
  it('touches amount + date, leaving payer / split / note when the edit omits a note', () => {
    const e = expense({ id: 'e1', payer: 'alice', amount: 100, participants: ['alice', 'bob'], split: { alice: 40, bob: 60 }, note: 'tacos' })
    const folded = applyEdit(e, editEv('e1', 250, Date.parse('2024-06-15')))
    expect(folded.amount).toBe(250)
    expect(folded.ts).toBe(new Date(Date.parse('2024-06-15')).toISOString())
    expect(folded.payer).toBe('alice')
    expect(folded.split).toEqual({ alice: 40, bob: 60 })
    expect(folded.note).toBe('tacos') // legacy edit (no note field) keeps the original
  })

  it('overrides the note when the edit carries one', () => {
    const e = expense({ id: 'e1', payer: 'alice', amount: 100, participants: ['alice'], note: 'tacos' })
    const folded = applyEdit(e, editEv('e1', 100, Date.parse('2024-06-15'), undefined, 'burritos'))
    expect(folded.note).toBe('burritos')
  })

  it('clears the note when the edit carries an empty string', () => {
    const e = expense({ id: 'e1', payer: 'alice', amount: 100, participants: ['alice'], note: 'tacos' })
    const folded = applyEdit(e, editEv('e1', 100, Date.parse('2024-06-15'), undefined, ''))
    expect(folded.note).toBeUndefined()
  })

  it('adds a note to an expense that had none', () => {
    const e = expense({ id: 'e1', payer: 'alice', amount: 100, participants: ['alice'] })
    const folded = applyEdit(e, editEv('e1', 100, Date.parse('2024-06-15'), undefined, 'sushi'))
    expect(folded.note).toBe('sushi')
  })

  it('folds edited FX metadata over the original expense', () => {
    const e = expense({
      id: 'e1',
      payer: 'alice',
      amount: 11000,
      participants: ['alice', 'bob'],
      originalCurrency: 'EUR',
      originalAmount: 10000,
      exchangeRate: 1.1,
      exchangeRateSource: 'manual',
      exchangeRateDate: '2026-07-04',
    })
    const edit = {
      ...editEv('e1', 12345, Date.parse('2026-07-05')),
      originalCurrency: 'GBP',
      originalAmount: 9500,
      exchangeRate: 1.2995,
      exchangeRateSource: 'frankfurter' as const,
      exchangeRateDate: '2026-07-05',
      exchangeRateFetchedAt: 1_783_214_400_000,
    }
    const folded = applyEdit(e, edit)
    expect(folded.amount).toBe(12345)
    expect(folded.originalCurrency).toBe('GBP')
    expect(folded.originalAmount).toBe(9500)
    expect(folded.exchangeRateSource).toBe('frankfurter')
  })
})

// ----- settle (min-cashflow) -------------------------------------------

describe('settle', () => {
  it('returns no transfers when everyone is square', () => {
    expect(settle([{ member: 'a', balance: 0 }, { member: 'b', balance: 0 }])).toEqual([])
  })

  it('produces a single transfer for a two-person debt', () => {
    const transfers = settle([{ member: 'alice', balance: 500 }, { member: 'bob', balance: -500 }])
    expect(transfers).toEqual([{ from: 'bob', to: 'alice', amount: 500 }])
  })

  it('clears a 3-way ledger in ≤ N-1 transfers and conserves money', () => {
    const balances: Balance[] = [
      { member: 'alice', balance: 666 },
      { member: 'bob', balance: -333 },
      { member: 'carol', balance: -333 },
    ]
    const transfers = settle(balances)
    expect(transfers.length).toBeLessThanOrEqual(2)
    // Everyone nets to zero once the transfers are applied.
    const net = new Map(balances.map(b => [b.member, b.balance]))
    for (const t of transfers) {
      net.set(t.from, (net.get(t.from) ?? 0) + t.amount)
      net.set(t.to, (net.get(t.to) ?? 0) - t.amount)
    }
    for (const v of net.values()) expect(v).toBe(0)
  })

  it('does not mutate the caller’s balances array', () => {
    const balances: Balance[] = [{ member: 'a', balance: 500 }, { member: 'b', balance: -500 }]
    const snapshot = JSON.parse(JSON.stringify(balances))
    settle(balances)
    expect(balances).toEqual(snapshot)
  })
})

// ----- realCostByMember -------------------------------------------------

describe('realCostByMember', () => {
  it('per-member real cost sums back to the grand total', () => {
    const expenses = [
      expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob', 'carol'] }),
      expense({ id: 'e2', payer: 'bob', amount: 555, participants: ['bob', 'carol'] }),
      expense({ id: 'e3', payer: 'carol', amount: 200, participants: ['carol'] }),
    ]
    const cost = realCostByMember(expenses)
    const total = expenses.reduce((a, e) => a + e.amount, 0)
    const costTotal = [...cost.values()].reduce((a, v) => a + v, 0)
    expect(costTotal).toBe(total)
  })

  it('matches the settlement debit side exactly (remainder on first participant)', () => {
    const e = expense({ id: 'e1', payer: 'alice', amount: 1000, participants: ['alice', 'bob', 'carol'] })
    const cost = realCostByMember([e])
    expect(cost.get('alice')).toBe(334)
    expect(cost.get('bob')).toBe(333)
    expect(cost.get('carol')).toBe(333)
  })
})

// ----- formatting -------------------------------------------------------

describe('formatAmount', () => {
  it('renders two decimals for ordinary currencies', () => {
    expect(formatAmount(12345, 'USD')).toBe('123.45 USD')
    expect(formatAmount(5, 'EUR')).toBe('0.05 EUR')
  })
  it('renders zero-decimal currencies as whole units', () => {
    expect(formatAmount(1500, 'JPY')).toBe('1,500 JPY')
    expect(formatAmount(42, 'KRW')).toBe('42 KRW')
  })
})

describe('parseAmount', () => {
  it('scales major units to minor for 2-decimal currencies', () => {
    expect(parseAmount('123.45', 'USD')).toBe(12345)
    expect(parseAmount('1,234.50', 'USD')).toBe(123450)
  })
  it('rounds zero-decimal currencies to whole minor units', () => {
    expect(parseAmount('1500', 'JPY')).toBe(1500)
    expect(parseAmount('1,500', 'JPY')).toBe(1500)
  })
  it('returns NaN on garbage', () => {
    expect(Number.isNaN(parseAmount('abc', 'USD'))).toBe(true)
  })
  it('round-trips with formatAmount', () => {
    for (const [input, cur] of [['10.00', 'USD'], ['0.99', 'EUR'], ['2500', 'JPY']] as const) {
      const minor = parseAmount(input, cur)
      expect(formatAmount(minor, cur)).toBe(`${input.includes('.') ? Number(input).toFixed(2) : Number(input).toLocaleString()} ${cur}`)
    }
  })
})

describe('convertMinorAmount', () => {
  it('converts between two-decimal currencies using major-unit rates', () => {
    expect(convertMinorAmount(10000, 'EUR', 'USD', 1.1)).toBe(11000)
  })

  it('converts zero-decimal currencies without adding phantom cents', () => {
    expect(convertMinorAmount(1000, 'JPY', 'USD', 0.0067)).toBe(670)
    expect(convertMinorAmount(1234, 'USD', 'JPY', 150)).toBe(1851)
  })
})
