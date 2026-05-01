// Ledger persistence — one gist == one ledger. We mark our gists with
//   - filename `ledger.json`
//   - description prefix `[SplitStupid]`
//   - body `kind: 'splitstupid.ledger'` sentinel
// All three are checked on read so a stray gist from another project that
// happens to be called ledger.json doesn't pollute the group list.

import { getClient } from './github'
import type { Event, ExpenseEvent, Ledger, Member, VoidEvent } from '../types'

export const LEDGER_FILENAME = 'ledger.json'
const DESCRIPTION_PREFIX = '[SplitStupid]'

export interface LedgerHandle {
  gistId: string
  htmlUrl: string
  ledger: Ledger
  /** Gist's `updated_at` from when we read it — used for stale-write detection. */
  updatedAt: string
}

export async function listLedgers(): Promise<LedgerHandle[]> {
  // GitHub paginates at 30/page by default; bump to 100 since most users
  // won't have hundreds of ledgers. We don't bother with cursor paging in
  // v1 — past 100 is a problem for later.
  const { data } = await getClient().gists.list({ per_page: 100 })
  const out: LedgerHandle[] = []
  for (const g of data) {
    if (!g.description?.startsWith(DESCRIPTION_PREFIX)) continue
    if (!g.files || !(LEDGER_FILENAME in g.files)) continue
    // List endpoint returns metadata only; need a second fetch for content.
    // Fine for now since the marker filter already narrowed the set.
    try {
      const handle = await readLedger(g.id!)
      if (handle) out.push(handle)
    } catch {
      // Skip gists that fail to parse — corrupted, hand-edited, etc.
    }
  }
  return out
}

export async function readLedger(gistId: string): Promise<LedgerHandle | null> {
  const { data } = await getClient().gists.get({ gist_id: gistId })
  const file = data.files?.[LEDGER_FILENAME]
  if (!file?.content) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(file.content)
  } catch {
    return null
  }
  if (!isLedger(parsed)) return null
  return {
    gistId,
    htmlUrl: data.html_url || '',
    ledger: parsed,
    updatedAt: data.updated_at || '',
  }
}

export async function createLedger(opts: {
  name: string
  currency: string
  owner: Member
  members: Member[]
}): Promise<LedgerHandle> {
  const ledger: Ledger = {
    version: 1,
    kind: 'splitstupid.ledger',
    name: opts.name,
    currency: opts.currency,
    owner: opts.owner,
    // Ensure owner is in the members list — settlement assumes it.
    members: opts.members.includes(opts.owner) ? opts.members : [opts.owner, ...opts.members],
    events: [],
    createdAt: new Date().toISOString(),
  }
  const { data } = await getClient().gists.create({
    description: `${DESCRIPTION_PREFIX} ${opts.name}`,
    // `public: false` = "secret" gist (unlisted, URL-as-capability).
    public: false,
    files: { [LEDGER_FILENAME]: { content: serialize(ledger) } },
  })
  return {
    gistId: data.id!,
    htmlUrl: data.html_url || '',
    ledger,
    updatedAt: data.updated_at || '',
  }
}

// Append events to the ledger and PATCH the gist. Caller passes the handle
// it last read; we re-fetch first and bail if the gist moved under us, so
// concurrent edits don't silently clobber. (Gists have no per-file SHA the
// way the contents API does, so updated_at is the closest thing to ETag
// semantics.)
export async function appendEvents(
  handle: LedgerHandle,
  events: Event[],
): Promise<LedgerHandle> {
  const fresh = await readLedger(handle.gistId)
  if (!fresh) throw new Error('Ledger gist disappeared')
  if (fresh.updatedAt !== handle.updatedAt) {
    throw new ConflictError(
      'Ledger was updated elsewhere — refresh and retry.',
      fresh,
    )
  }
  const next: Ledger = {
    ...fresh.ledger,
    events: [...fresh.ledger.events, ...events],
  }
  const { data } = await getClient().gists.update({
    gist_id: handle.gistId,
    files: { [LEDGER_FILENAME]: { content: serialize(next) } },
  })
  return {
    gistId: handle.gistId,
    htmlUrl: data.html_url || handle.htmlUrl,
    ledger: next,
    updatedAt: data.updated_at || '',
  }
}

export class ConflictError extends Error {
  constructor(message: string, public latest: LedgerHandle) {
    super(message)
    this.name = 'ConflictError'
  }
}

export function newExpenseId(): string {
  // Crockford-ish — gist content is human-readable, so a short id beats
  // a full UUID. Collision odds at 9 hex chars are fine for one ledger.
  return 'e_' + Math.random().toString(16).slice(2, 11)
}

export function newVoidId(): string {
  return 'v_' + Math.random().toString(16).slice(2, 11)
}

function serialize(l: Ledger): string {
  // Pretty-print so the gist is readable in GitHub's web UI; the diff is
  // also nicer if a human ever opens the revision view.
  return JSON.stringify(l, null, 2) + '\n'
}

function isLedger(x: unknown): x is Ledger {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return o.kind === 'splitstupid.ledger'
    && typeof o.name === 'string'
    && Array.isArray(o.members)
    && Array.isArray(o.events)
}

// Convenience wrappers so callers don't have to know about Event tagging.
export function makeExpense(input: Omit<ExpenseEvent, 'id' | 'type' | 'ts'>): ExpenseEvent {
  return { id: newExpenseId(), type: 'expense', ts: new Date().toISOString(), ...input }
}

export function makeVoid(input: Omit<VoidEvent, 'id' | 'type' | 'ts'>): VoidEvent {
  return { id: newVoidId(), type: 'void', ts: new Date().toISOString(), ...input }
}
