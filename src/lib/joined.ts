// Per-device "groups I've joined" index.
//
// Why localStorage instead of a personal index gist: joining a friend's
// group should not create new artifacts in the joiner's GitHub account.
// The only thing a join leaves on GitHub is a `splitstupid-event` join
// comment on the owner's gist — that's it. The list of "groups I'm in"
// is purely a UI affordance for the joiner's own browser to remember.
//
// Trade-off: the list isn't synced across devices. The share URL is
// the recovery path — opening it on a new device adds the group back
// to that device's localStorage. For owned groups this isn't an issue
// (gists.list always finds them); only joined groups depend on
// localStorage.

import { readLedger, type LedgerHandle } from './gist'

const STORAGE_KEY = 'splitstupid_joined'

export interface JoinedEntry {
  gistId: string
  name: string
  currency: string
  joinedAt: string
}

function load(): JoinedEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((e: any) => typeof e?.gistId === 'string')
      : []
  } catch {
    return []
  }
}

function save(entries: JoinedEntry[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) }
  catch { /* quota or disabled — accept that the list won't persist */ }
}

export function loadJoinedEntries(): JoinedEntry[] {
  return load()
}

// Idempotent: re-joining moves the entry to the front (most-recently
// joined first), no duplicates.
export async function recordJoin(entry: JoinedEntry): Promise<void> {
  const filtered = load().filter(e => e.gistId !== entry.gistId)
  save([entry, ...filtered])
}

// "Remove from my list" — just forgets the entry locally. The group
// still exists on GitHub; the user can rejoin any time from the share
// link, which would re-add it to localStorage on the next join click.
export async function recordLeave(gistId: string): Promise<void> {
  save(load().filter(e => e.gistId !== gistId))
}

// Resolve all joined entries to full LedgerHandles. Entries whose
// underlying ledger has been deleted (404) are silently skipped — the
// alternative is showing a tombstone in the UI which is uglier than
// just dropping them.
export async function listJoinedLedgers(): Promise<LedgerHandle[]> {
  const entries = load()
  const handles = await Promise.all(
    entries.map(async e => {
      try { return await readLedger(e.gistId) }
      catch { return null }
    }),
  )
  return handles.filter((h): h is LedgerHandle => !!h)
}
