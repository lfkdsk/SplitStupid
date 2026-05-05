// Single source of data for the frontend. Replaces the previous
// gist-based stack (gist.ts / comments.ts / joined.ts / github.ts).
// Everything funnels through one Worker at VITE_API_URL.
//
// Auth: stash the GH OAuth token via setApiToken(); we forward it as
// `Authorization: Bearer <token>` on every request. The Worker resolves
// it to a GH login server-side; the frontend never has to think about
// scopes, gist permissions, or who can read what.

import type { ExpenseEvent, Group, GroupSummary, VoidEvent } from '../types'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')

let _token: string | null = null

export function setApiToken(token: string | null): void {
  _token = token
}

export function isApiConfigured(): boolean {
  return !!API_URL
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not configured')
  const headers = new Headers(init?.headers)
  if (_token) headers.set('authorization', `Bearer ${_token}`)
  if (init?.body) headers.set('content-type', 'application/json')

  const res = await fetch(API_URL + path, { ...init, headers })
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

// ---------------------------------------------------------------------------
// Events

/** Payload for a new expense — server fills in id, ts, author. */
export type NewExpense = Omit<ExpenseEvent, 'id' | 'ts' | 'author'>
/** Payload for a void — server fills in id, ts, author. */
export type NewVoid = Omit<VoidEvent, 'id' | 'ts' | 'author'>

export const postEvent = (
  groupId: string,
  event: NewExpense | NewVoid,
): Promise<ExpenseEvent | VoidEvent> =>
  call<ExpenseEvent | VoidEvent>(
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
