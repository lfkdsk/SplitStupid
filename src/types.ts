// SplitStupid data shapes. Mirror exactly what api.splitstupid.lfkdsk.org
// returns; we don't re-shape on the client. Settlement / balance rendering
// stays pure-functional over these.

export type Member = string // GitHub login

export interface Group {
  id: string
  name: string
  currency: string
  owner: Member
  members: Member[]
  events: Event[]
  /** Unix ms (server-assigned). */
  createdAt: number
}

/** Lightweight shape returned by GET /groups for the dashboard list view. */
export interface GroupSummary {
  id: string
  name: string
  currency: string
  owner: Member
  /** Convenience flag set by the server: am I owner here, or just a member? */
  role: 'owner' | 'member'
  members: Member[]
  /** Active expense count (voided ones excluded). */
  eventCount: number
  createdAt: number
}

export type Event = ExpenseEvent | VoidEvent

export interface ExpenseEvent {
  id: string
  type: 'expense'
  /** Server-assigned ISO timestamp. */
  ts: string
  author: Member
  payer: Member
  /** Stored in **minor units** (cents / yen) — integer math, no float drift. */
  amount: number
  participants: Member[]
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
