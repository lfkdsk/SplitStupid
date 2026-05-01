// Per-user "groups I've joined" index. The owner's gists.list returns
// only gists they OWN — but a user who joined via QR scan needs to see
// those groups in their own Groups list too. Solution: every user has
// a single dedicated index gist in their own account that records the
// gistIds (and a bit of metadata) of groups they've joined.
//
// The index is itself a gist, matching the rest of the storage model
// ("everything the user has lives in their GH account"). It's lazily
// created on first join — users who only own groups never accrue an
// index gist.

import { getClient } from './github'
import { readLedger, type LedgerHandle } from './gist'

const INDEX_FILENAME = 'splitstupid-index.json'
const INDEX_DESCRIPTION = '[SplitStupid Index] joined groups'

export interface JoinedEntry {
  gistId: string
  name: string
  currency: string
  joinedAt: string
}

interface IndexFile {
  version: 1
  kind: 'splitstupid.index'
  joined: JoinedEntry[]
}

interface IndexHandle {
  gistId: string
  file: IndexFile
}

async function findIndexGist(): Promise<{ id: string; content: string } | null> {
  const { data } = await getClient().gists.list({ per_page: 100 })
  for (const g of data) {
    if (g.description === INDEX_DESCRIPTION && g.files && INDEX_FILENAME in g.files) {
      // List endpoint truncates content over ~1MB; we re-fetch to be safe.
      const { data: full } = await getClient().gists.get({ gist_id: g.id! })
      const file = full.files?.[INDEX_FILENAME]
      if (file?.content) return { id: full.id!, content: file.content }
    }
  }
  return null
}

async function loadIndex(): Promise<IndexHandle | null> {
  const found = await findIndexGist()
  if (!found) return null
  let parsed: unknown
  try { parsed = JSON.parse(found.content) }
  catch { return null }
  if (!isIndex(parsed)) return null
  return { gistId: found.id, file: parsed }
}

async function createIndex(): Promise<IndexHandle> {
  const empty: IndexFile = { version: 1, kind: 'splitstupid.index', joined: [] }
  const { data } = await getClient().gists.create({
    description: INDEX_DESCRIPTION,
    public: false,
    files: { [INDEX_FILENAME]: { content: serialize(empty) } },
  })
  return { gistId: data.id!, file: empty }
}

async function ensureIndex(): Promise<IndexHandle> {
  return (await loadIndex()) ?? (await createIndex())
}

export async function loadJoinedEntries(): Promise<JoinedEntry[]> {
  const handle = await loadIndex()
  return handle?.file.joined ?? []
}

// Idempotent on gistId — re-joining moves the entry to the front
// (most-recently-joined first) instead of duplicating.
export async function recordJoin(entry: JoinedEntry): Promise<void> {
  const handle = await ensureIndex()
  const filtered = handle.file.joined.filter(e => e.gistId !== entry.gistId)
  const next: IndexFile = {
    ...handle.file,
    joined: [entry, ...filtered],
  }
  await getClient().gists.update({
    gist_id: handle.gistId,
    files: { [INDEX_FILENAME]: { content: serialize(next) } },
  })
}

// "Remove from my list" — does NOT delete the underlying ledger; the
// owner still has it, the user simply takes it off their dashboard.
// They can rejoin any time by reopening the share link.
export async function recordLeave(gistId: string): Promise<void> {
  const handle = await loadIndex()
  if (!handle) return
  const next = handle.file.joined.filter(e => e.gistId !== gistId)
  if (next.length === handle.file.joined.length) return
  const updated: IndexFile = { ...handle.file, joined: next }
  await getClient().gists.update({
    gist_id: handle.gistId,
    files: { [INDEX_FILENAME]: { content: serialize(updated) } },
  })
}

// Resolve all joined entries to full LedgerHandles. Entries whose
// underlying ledger has been deleted (404) are silently skipped — the
// alternative is showing a tombstone in the UI which is uglier than
// just dropping them.
export async function listJoinedLedgers(): Promise<LedgerHandle[]> {
  const entries = await loadJoinedEntries()
  const handles = await Promise.all(
    entries.map(async e => {
      try { return await readLedger(e.gistId) }
      catch { return null }
    }),
  )
  return handles.filter((h): h is LedgerHandle => !!h)
}

function serialize(f: IndexFile): string {
  return JSON.stringify(f, null, 2) + '\n'
}

function isIndex(x: unknown): x is IndexFile {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return o.kind === 'splitstupid.index' && Array.isArray(o.joined)
}
