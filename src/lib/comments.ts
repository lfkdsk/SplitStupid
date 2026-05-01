// Multi-writer extension. The owner's gist is the single ledger file, but
// any authenticated GitHub user with the gist URL can ALSO POST a comment
// on it without being a collaborator — that's the magic that lets
// non-owners record events. Comments are signed by the GH user (the API
// returns `user.login` which we trust as `author`) so spoofing requires
// stealing a token.
//
// The exchange protocol:
//   - Each "event comment" body is a fenced JSON block:
//
//       ```splitstupid-event
//       { "type": "expense", "payer": "...", "amount": 1200, ... }
//       ```
//
//     surrounded by free-form text. We extract the block, parse, then
//     stamp `author` from the Comment user and `ts` from createdAt.
//   - A non-event comment (no fence, or fence in unknown shape) is just
//     ignored — keeps the comments thread usable for chat too.
//
// The ledger UI is owner-driven for v1: the owner periodically "compacts"
// pending comment-events into the ledger.json file (via gist.appendEvents)
// and optionally deletes the comments. Until compacted, comment-events are
// merged into the in-memory event list at view-time so they show up
// immediately for everyone.

import { getClient } from './github'
import type { Event, ExpenseEvent, VoidEvent, Member } from '../types'

const FENCE_OPEN = /```\s*splitstupid-event\s*\n/
const FENCE_CLOSE = /```/

export interface CommentEvent {
  /** Numeric gist comment id — needed to delete after compaction. */
  commentId: number
  event: Event
}

export async function listEventComments(gistId: string): Promise<CommentEvent[]> {
  const { data } = await getClient().gists.listComments({
    gist_id: gistId,
    per_page: 100,
  })
  const out: CommentEvent[] = []
  for (const c of data) {
    const event = parseCommentBody(c.body || '', {
      fallbackAuthor: c.user?.login || 'unknown',
      fallbackTs: c.created_at || new Date().toISOString(),
    })
    if (event) out.push({ commentId: c.id, event })
  }
  return out
}

export async function postEventComment(
  gistId: string,
  event: Omit<ExpenseEvent, 'author' | 'ts'> | Omit<VoidEvent, 'author' | 'ts'>,
): Promise<void> {
  // Author + ts are stamped by the server from the comment metadata, so we
  // strip whatever the caller might have set to avoid drift between
  // "what's in the JSON" and "who actually posted it".
  const body = formatCommentBody(event)
  await getClient().gists.createComment({ gist_id: gistId, body })
}

export async function deleteComment(gistId: string, commentId: number): Promise<void> {
  await getClient().gists.deleteComment({ gist_id: gistId, comment_id: commentId })
}

function formatCommentBody(payload: object): string {
  return [
    'New SplitStupid event:',
    '```splitstupid-event',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')
}

function parseCommentBody(
  body: string,
  ctx: { fallbackAuthor: Member; fallbackTs: string },
): Event | null {
  const open = body.match(FENCE_OPEN)
  if (!open || open.index === undefined) return null
  const after = body.slice(open.index + open[0].length)
  const close = after.match(FENCE_CLOSE)
  if (!close || close.index === undefined) return null
  const json = after.slice(0, close.index).trim()
  let parsed: any
  try { parsed = JSON.parse(json) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null

  // Stamp author + ts from the comment, NOT the body. The body's claim of
  // who recorded the event is unverifiable; the comment metadata is signed
  // by GitHub.
  const stamped = {
    ...parsed,
    author: ctx.fallbackAuthor,
    ts: ctx.fallbackTs,
  }
  if (stamped.type === 'expense') return stamped as ExpenseEvent
  if (stamped.type === 'void') return stamped as VoidEvent
  return null
}
