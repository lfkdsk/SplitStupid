// Multi-writer extension. The owner's gist is the single ledger file, but
// any authenticated GitHub user with the gist URL can ALSO POST a comment
// on it without being a collaborator — that's the magic that lets people
// (1) self-join a group by scanning the QR and (2) record events without
// being a gist collaborator. Comments are signed by GitHub (the API
// returns user.login) so spoofing requires stealing a token.
//
// Wire format — every "structured" comment carries a fenced JSON block:
//
//   ```splitstupid-event
//   { "type": "join" }                     ← used by scan-to-join
//   { "type": "expense", "amount": ... }   ← future: non-owner records
//   { "type": "void", "targetId": "..." }
//   ```
//
// The ledger UI reads gist content + comments together: members =
// owner ∪ ledger.members[] ∪ {authors of join comments}, and event log
// = ledger.events ∪ comment-events. Owners can periodically "compact"
// pending comment events into ledger.json; until then, comments are
// merged into the in-memory view so everyone sees the same state.

import { getClient } from './github'
import type { ExpenseEvent, Member, VoidEvent } from '../types'

const FENCE = /```\s*splitstupid-event\s*\n([\s\S]*?)```/

export interface CommentEvent {
  commentId: number
  event: ExpenseEvent | VoidEvent
}

export interface CommentJoin {
  commentId: number
  /** GitHub login of whoever posted the join comment. */
  author: Member
  ts: string
}

export interface GroupComments {
  events: CommentEvent[]
  joins: CommentJoin[]
}

export async function listGroupComments(gistId: string): Promise<GroupComments> {
  const { data } = await getClient().gists.listComments({
    gist_id: gistId,
    per_page: 100,
  })
  const events: CommentEvent[] = []
  const joins: CommentJoin[] = []
  for (const c of data) {
    const parsed = parseFenced(c.body || '')
    if (!parsed) continue
    const author = c.user?.login || 'unknown'
    const ts = c.created_at || new Date().toISOString()
    if (parsed.type === 'join') {
      joins.push({ commentId: c.id, author, ts })
    } else if (parsed.type === 'expense') {
      events.push({ commentId: c.id, event: { ...parsed, author, ts } as ExpenseEvent })
    } else if (parsed.type === 'void') {
      events.push({ commentId: c.id, event: { ...parsed, author, ts } as VoidEvent })
    }
  }
  return { events, joins }
}

// Self-join: the scanner of the share QR signs in, hits this, and is
// thereafter included in `effective members` everywhere. Idempotent —
// posting twice is harmless because callers dedupe by author.
export async function postJoinComment(gistId: string): Promise<void> {
  await getClient().gists.createComment({
    gist_id: gistId,
    body: formatBody({ type: 'join' }, 'Joined SplitStupid group:'),
  })
}

export async function postEventComment(
  gistId: string,
  event: Omit<ExpenseEvent, 'author' | 'ts'> | Omit<VoidEvent, 'author' | 'ts'>,
): Promise<void> {
  // Author + ts come from the comment metadata at read time, so we strip
  // whatever the caller stashed to avoid drift between body and signature.
  await getClient().gists.createComment({
    gist_id: gistId,
    body: formatBody(event, 'New SplitStupid event:'),
  })
}

export async function deleteComment(gistId: string, commentId: number): Promise<void> {
  await getClient().gists.deleteComment({ gist_id: gistId, comment_id: commentId })
}

function formatBody(payload: object, prelude: string): string {
  return [
    prelude,
    '```splitstupid-event',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')
}

function parseFenced(body: string): { type: string; [k: string]: unknown } | null {
  const m = body.match(FENCE)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1].trim())
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed
    }
  } catch { /* malformed fence body */ }
  return null
}
