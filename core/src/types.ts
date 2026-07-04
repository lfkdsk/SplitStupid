// SplitStupid data shapes. Mirror exactly what api.splitstupid.lfkdsk.org
// returns; we don't re-shape on the client. Settlement / balance rendering
// stays pure-functional over these.

export type Member = string // canonical SplitStupid account key

export interface UserProfile {
  key: Member
  kind?: 'account' | 'offline'
  displayName: string
  avatarUrl?: string
  email?: string
  provider?: 'github' | 'apple'
  providerLogin?: string
}

export interface AuthMe extends UserProfile {
  isAdmin?: boolean
}

export interface Group {
  id: string
  name: string
  currency: string
  owner: Member
  members: Member[]
  profiles?: Record<Member, UserProfile>
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
  profiles?: Record<Member, UserProfile>
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
  profiles?: Record<Member, UserProfile>
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
  profiles?: Record<Member, UserProfile>
  memberCount: number
  /** Active expense count (voided ones excluded). */
  eventCount: number
  createdAt: number
  finalizedAt?: number
}

/** Row shape returned by the read-only admin user roster (GET /admin/users).
 *  There's no users table — a "user" is just a GH login that shows up as a
 *  group owner, member, and/or event author — so these are aggregates over
 *  those facts. */
export interface AdminUserSummary {
  login: Member
  profile?: UserProfile
  /** Groups this login owns. */
  owned: number
  /** Groups this login currently belongs to. Owners are auto-added as
   *  members, so this count includes the groups they own. */
  memberships: number
  /** Active (non-voided) expenses this login recorded. */
  expenseCount: number
  /** Unix ms of the last event they authored. Undefined if they've joined a
   *  group but never recorded anything. */
  lastActiveAt?: number
}

export type Event = ExpenseEvent | VoidEvent | EditEvent | SettleEvent

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
  /** Original currency the payer typed. Omitted for legacy/default-currency
   *  expenses where `amount` is already the only amount that matters. */
  originalCurrency?: string
  /** Original amount in originalCurrency minor units. */
  originalAmount?: number
  /** Major-unit conversion rate: originalCurrency -> group.currency. */
  exchangeRate?: number
  exchangeRateSource?: 'frankfurter' | 'manual'
  /** YYYY-MM-DD rate date used for the conversion. */
  exchangeRateDate?: string
  /** Unix ms when an automatic rate was fetched. */
  exchangeRateFetchedAt?: number
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
  /** Same FX metadata as ExpenseEvent, replacing the target expense's FX
   *  metadata when present. Omitted on legacy/default-currency edits. */
  originalCurrency?: string
  originalAmount?: number
  exchangeRate?: number
  exchangeRateSource?: 'frankfurter' | 'manual'
  exchangeRateDate?: string
  exchangeRateFetchedAt?: number
}

/** A "clear the slate" checkpoint. Any member can stamp one to record that,
 *  as of `ts`, the group is settled up: balance computation resets here and
 *  the prior expenses freeze as a paid-off record. Repeatable and non-terminal
 *  — unlike a finalize, the group stays open afterwards. The checkpoint itself
 *  is the proof everyone was even at that instant. */
export interface SettleEvent {
  id: string
  type: 'settle'
  /** Server-assigned ISO timestamp — the clear instant. Stamped strictly
   *  after every prior event in the group so it cleanly bounds the period
   *  even against backdated expenses. */
  ts: string
  author: Member
  /** Optional human note, e.g. "June rent squared up". */
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

export interface ExchangeRateQuote {
  base: string
  quote: string
  rate: number
  date: string
  provider: 'frankfurter'
  fetchedAt: number
  cached: boolean
}
