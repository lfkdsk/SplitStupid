// Single source of data for every client. Everything funnels through one
// Worker; the base URL is injected once at startup via configureApi() so
// this module stays platform-agnostic (the web app reads it from
// import.meta.env, the RN app from its Expo config — core doesn't care).
//
// Auth: stash the GH OAuth token via setApiToken(); we forward it as
// `Authorization: Bearer <token>` on every request. The Worker resolves
// it to a GH login server-side; the client never has to think about
// scopes, gist permissions, or who can read what.

import type { AdminGroupSummary, AdminUserSummary, EditEvent, ExpenseEvent, Group, GroupSummary, InviteSummary, SettleEvent, VoidEvent } from './types'

let _baseUrl: string | undefined
let _token: string | null = null

/** Point the client at a Worker. Call once before any request. Idempotent —
 *  safe to call again to repoint (e.g. in tests, or env switches). */
export function configureApi(opts: { baseUrl?: string | null }): void {
  _baseUrl = opts.baseUrl?.replace(/\/$/, '') || undefined
}

export function setApiToken(token: string | null): void {
  _token = token
}

export function isApiConfigured(): boolean {
  return !!_baseUrl
}

function requireBaseUrl(): string {
  if (!_baseUrl) {
    throw new Error('API base URL not configured — call configureApi({ baseUrl }) at startup')
  }
  return _baseUrl
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const base = requireBaseUrl()
  const headers = new Headers(init?.headers)
  if (_token) headers.set('authorization', `Bearer ${_token}`)
  if (init?.body) headers.set('content-type', 'application/json')

  const res = await fetch(base + path, { ...init, headers })
  const text = await res.text()
  if (!res.ok) {
    // Worker returns { error: "..." } JSON on failure; fall back to raw
    // text if it's something else (cold start 502, CORS reject, etc.).
    let msg = text
    try { const parsed = JSON.parse(text); if (parsed?.error) msg = parsed.error } catch { /* not json */ }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return text ? JSON.parse(text) as T : (undefined as unknown as T)
}

// ---------------------------------------------------------------------------
// Groups

export const listGroups = (): Promise<GroupSummary[]> =>
  call<GroupSummary[]>('/groups')

export const readGroup = (id: string): Promise<Group> =>
  call<Group>(`/groups/${encodeURIComponent(id)}`)

// Public — intentionally bypasses `call` so it works with no token at all.
export async function readInvite(id: string): Promise<InviteSummary> {
  const base = requireBaseUrl()
  const res = await fetch(`${base}/groups/${encodeURIComponent(id)}/invite`)
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { const p = JSON.parse(text); if (p?.error) msg = p.error } catch { /* not json */ }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return JSON.parse(text) as InviteSummary
}

export const createGroup = (input: { name: string; currency: string }): Promise<Group> =>
  call<Group>('/groups', { method: 'POST', body: JSON.stringify(input) })

export const deleteGroup = (id: string): Promise<void> =>
  call<void>(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const joinGroup = (id: string): Promise<{ ok: true }> =>
  call<{ ok: true }>(`/groups/${encodeURIComponent(id)}/join`, { method: 'POST' })

// Owner-only: lock the ledger. Worker rejects subsequent expense / void /
// member-change requests with 409 until reopenGroup is called.
export const finalizeGroup = (id: string): Promise<{ ok: true; finalizedAt?: number }> =>
  call<{ ok: true; finalizedAt?: number }>(
    `/groups/${encodeURIComponent(id)}/finalize`, { method: 'POST' },
  )

export const reopenGroup = (id: string): Promise<{ ok: true }> =>
  call<{ ok: true }>(
    `/groups/${encodeURIComponent(id)}/finalize`, { method: 'DELETE' },
  )

// Remove a member from a group. Used both for owner-kicks-someone and
// for member-leaves-self (call with login=me). The Worker enforces
// the permission matrix server-side.
export const removeMember = (groupId: string, login: string): Promise<{ ok: true }> =>
  call<{ ok: true }>(
    `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(login)}`,
    { method: 'DELETE' },
  )

// Logins the signed-in user has shared at least one group with — the
// candidate list for owner's "add a past split-mate" picker.
export const listFriends = (): Promise<string[]> =>
  call<string[]>('/friends')

// Read-only admin overview: every group in the system. The Worker gates this
// on its ADMIN_LOGINS allowlist and returns 403 for anyone else — so a
// non-admin caller gets a thrown Error, not a silent empty list.
export const listAllGroups = (): Promise<AdminGroupSummary[]> =>
  call<AdminGroupSummary[]>('/admin/groups')

// Read-only admin roster: every distinct login in the system with light
// per-user stats. Same ADMIN_LOGINS gate as listAllGroups — a non-admin
// caller gets a thrown Error from the 403, not a silent empty list.
export const listAllUsers = (): Promise<AdminUserSummary[]> =>
  call<AdminUserSummary[]>('/admin/users')

// Owner-only: directly add a past split-mate to the group. Worker gates
// this on (owner ∧ login-is-a-prior-split-mate); see addMember there.
export const addMember = (groupId: string, login: string): Promise<{ ok: true }> =>
  call<{ ok: true }>(
    `/groups/${encodeURIComponent(groupId)}/members`,
    { method: 'POST', body: JSON.stringify({ login }) },
  )

// ---------------------------------------------------------------------------
// Events

/**
 * Payload for a new expense — server fills in id and author. `ts` is an
 * optional override (unix ms): when present the server backdates the event
 * to that instant, when omitted it stamps "now". This is what lets the
 * add-expense form offer a date picker.
 */
export type NewExpense = Omit<ExpenseEvent, 'id' | 'ts' | 'author'> & { ts?: number }
/** Payload for a void — server fills in id, ts, author. */
export type NewVoid = Omit<VoidEvent, 'id' | 'ts' | 'author'>
/** Payload for an edit — server fills in id, ts (audit), author. `amount`
 *  and `date` are the expense's new figures; `targetId` is the expense edited. */
export type NewEdit = Omit<EditEvent, 'id' | 'ts' | 'author'>
/** Payload for a settle checkpoint — server fills in id, ts (the clear
 *  instant), author. Just an optional note. */
export type NewSettle = Omit<SettleEvent, 'id' | 'ts' | 'author'>

export const postEvent = (
  groupId: string,
  event: NewExpense | NewVoid | NewEdit | NewSettle,
): Promise<ExpenseEvent | VoidEvent | EditEvent | SettleEvent> =>
  call<ExpenseEvent | VoidEvent | EditEvent | SettleEvent>(
    `/groups/${encodeURIComponent(groupId)}/events`,
    { method: 'POST', body: JSON.stringify(event) },
  )

// ---------------------------------------------------------------------------
// Convenience event constructors — same shape as the old gist-era helpers
// so callers in pages/ stay terse. The `type` field is implicit from
// which constructor you call.

export function makeExpense(input: Omit<NewExpense, 'type'>): NewExpense {
  return { type: 'expense', ...input }
}

export function makeVoid(input: Omit<NewVoid, 'type'>): NewVoid {
  return { type: 'void', ...input }
}

export function makeEdit(input: Omit<NewEdit, 'type'>): NewEdit {
  return { type: 'edit', ...input }
}

export function makeSettle(input: Omit<NewSettle, 'type'> = {}): NewSettle {
  return { type: 'settle', ...input }
}
