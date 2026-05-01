// Pure functions: events → balances → minimum-cashflow transfer plan.
// Stateless, no I/O, easy to unit test (and to re-run client-side every
// render — the input set is small).

import type { Balance, Event, ExpenseEvent, Member, Transfer } from '../types'

// Walk the event log and return per-member running balance. Members
// missing from the events list still appear (with zero) so the UI can
// render the full roster — including people who joined via QR scan
// after the gist's stored members[] was last updated.
//
// Members are passed in explicitly (rather than read from a Ledger) so
// the caller can union ledger.members with join-comment authors and get
// the right roster without our help.
//
// Convention: positive balance = the group OWES this member (they paid
// more than their share). Negative = this member OWES the group.
export function computeBalances(events: Event[], members: Member[]): Balance[] {
  const balances = new Map<Member, number>()
  for (const m of members) balances.set(m, 0)

  const voided = collectVoided(events)

  for (const e of events) {
    if (e.type !== 'expense') continue
    if (voided.has(e.id)) continue
    applyExpense(balances, e)
  }
  return members.map(m => ({ member: m, balance: balances.get(m) ?? 0 }))
}

function collectVoided(events: Event[]): Set<string> {
  const out = new Set<string>()
  for (const e of events) if (e.type === 'void') out.add(e.targetId)
  return out
}

function applyExpense(balances: Map<Member, number>, e: ExpenseEvent): void {
  // Payer fronted the bill — their balance goes UP by the full amount.
  balances.set(e.payer, (balances.get(e.payer) ?? 0) + e.amount)

  // Each participant's share comes back DOWN. For 'equal', spread the
  // amount across N participants and dump any rounding remainder onto
  // the first participant — keeps the integer total exact.
  if (e.split === 'equal') {
    const n = e.participants.length
    if (n === 0) return
    const base = Math.floor(e.amount / n)
    const remainder = e.amount - base * n
    e.participants.forEach((p, i) => {
      const owed = base + (i === 0 ? remainder : 0)
      balances.set(p, (balances.get(p) ?? 0) - owed)
    })
  } else {
    for (const [member, owed] of Object.entries(e.split)) {
      balances.set(member, (balances.get(member) ?? 0) - owed)
    }
  }
}

// Greedy min-cashflow: pair the biggest debtor with the biggest creditor,
// settle as much as possible, repeat. Produces ≤ N-1 transfers for N
// people, which is the minimum in the general case (proper min-cashflow
// is NP-hard but the greedy is essentially optimal in practice).
export function settle(balances: Balance[]): Transfer[] {
  // Copy + ignore zeros so we don't mutate the caller's array.
  const positions = balances
    .map(b => ({ member: b.member, balance: b.balance }))
    .filter(b => b.balance !== 0)
    .sort((a, b) => a.balance - b.balance)

  const transfers: Transfer[] = []
  let i = 0
  let j = positions.length - 1
  while (i < j) {
    const debtor = positions[i]
    const creditor = positions[j]
    // After zero-filtering, balances at the tails always have opposite
    // signs (sum is zero by construction; positive on one end, negative
    // on the other). The loop condition keeps that invariant.
    const amount = Math.min(-debtor.balance, creditor.balance)
    transfers.push({ from: debtor.member, to: creditor.member, amount })
    debtor.balance += amount
    creditor.balance -= amount
    if (debtor.balance === 0) i++
    if (creditor.balance === 0) j--
  }
  return transfers
}

// Convenience for the UI: amounts are stored as minor units so settlement
// stays integer-clean, but humans want decimals.
export function formatAmount(minor: number, currency: string): string {
  // Most currencies use 2 decimals; JPY/KRW/etc. use 0. Hard-code the
  // zero-decimal set since v1 doesn't need a full ISO 4217 table.
  const zeroDecimal = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR'])
  if (zeroDecimal.has(currency.toUpperCase())) {
    return `${minor.toLocaleString()} ${currency}`
  }
  const major = (minor / 100).toFixed(2)
  return `${major} ${currency}`
}

export function parseAmount(input: string, currency: string): number {
  const zeroDecimal = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR'])
  const n = Number(input.trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) return NaN
  if (zeroDecimal.has(currency.toUpperCase())) return Math.round(n)
  return Math.round(n * 100)
}
