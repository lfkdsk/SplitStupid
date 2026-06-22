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
  /** Unix ms when the owner finalized (locked) the group. Undefined while open. */
  finalizedAt?: number
}

/** Public preview returned by GET /groups/:id/invite — no auth required.
 *  Just enough to render the share-link landing ("<owner> invited you…"). */
export interface InviteSummary {
  id: string
  name: string
  currency: string
  owner: Member
  memberCount: number
  finalized: boolean
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
  finalizedAt?: number
}

/** Row shape returned by the read-only admin overview (GET /admin/groups).
 *  Like GroupSummary but for *every* group in the system, so it drops the
 *  caller-relative `role` (an admin is usually neither owner nor member of
 *  what they inspect) and carries an explicit `memberCount`. */
export interface AdminGroupSummary {
  id: string
  name: string
  currency: string
  owner: Member
  members: Member[]
  memberCount: number
  /** Active expense count (voided ones excluded). */
  eventCount: number
  createdAt: number
  finalizedAt?: number
}

export type Event = ExpenseEvent | VoidEvent | EditEvent

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

/** Amends an existing expense's amount / date (and optionally note) in place
 *  (the append-only alternative to a void+repost). `ts` is the audit instant —
 *  when the edit was recorded; the new *effective* expense date lives in `date`.
 *  Settlement and the receipt fold the latest edit over its target. */
export interface EditEvent {
  id: string
  type: 'edit'
  /** Server-assigned ISO timestamp — when the edit was made. */
  ts: string
  author: Member
  /** The expense event this edits. */
  targetId: string
  /** New amount in **minor units**. */
  amount: number
  /** New effective expense date, **unix ms**. */
  date: number
  /** New note. When present it overrides the target's note — an empty string
   *  clears it. When absent (legacy edits predating note-editing) the original
   *  note rides along untouched. */
  note?: string
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
