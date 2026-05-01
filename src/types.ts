// SplitStupid data model. One ledger = one gist. The gist holds a single
// `ledger.json` whose schema is below. Events are append-only: edits and
// deletes are expressed as `void` events that reference the targetId,
// keeping the gist's git history readable.

export type Member = string // GitHub login

export interface Ledger {
  version: 1
  /** Sentinel so we can distinguish SplitStupid gists from arbitrary ones. */
  kind: 'splitstupid.ledger'
  name: string
  /** ISO 4217 code or any short token; we don't validate. */
  currency: string
  owner: Member
  members: Member[]
  events: Event[]
  createdAt: string
}

export type Event = ExpenseEvent | VoidEvent

export interface ExpenseEvent {
  id: string
  type: 'expense'
  ts: string
  /** GitHub login that recorded this event. In single-writer mode == owner. */
  author: Member
  payer: Member
  /** Stored in **minor units** (e.g. cents). Avoids float drift in settlement. */
  amount: number
  participants: Member[]
  /** 'equal' = split evenly across participants; otherwise an explicit map. */
  split: 'equal' | Record<Member, number>
  note?: string
}

export interface VoidEvent {
  id: string
  type: 'void'
  ts: string
  author: Member
  targetId: string
  reason?: string
}

export interface Transfer {
  from: Member
  to: Member
  /** Minor units. */
  amount: number
}

export interface Balance {
  member: Member
  /** Minor units. Positive = owed by group; negative = owes the group. */
  balance: number
}
