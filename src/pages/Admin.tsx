// Read-only operator view: every group and every user in the system. Reuses
// the dashboard's group-row styling, but with no create / delete / leave
// affordances — group rows just link through to the read-only AdminGroup
// detail; user rows link out to the GitHub profile. Data comes from
// listAllGroups() / listAllUsers(), which the Worker gates on ADMIN_LOGINS (a
// non-admin gets a 403 → thrown Error, surfaced here as an error banner rather
// than an empty list).
import { useEffect, useState } from 'react'
import {
  avatarUrl,
  listAllGroups,
  listAllUsers,
  type AdminGroupSummary,
  type AdminUserSummary,
} from '@splitstupid/core'

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Admin() {
  const [groups, setGroups] = useState<AdminGroupSummary[] | null>(null)
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Two independent admin reads. They share the ADMIN_LOGINS gate, so in
    // practice they fail or succeed together — but keep separate state so a
    // hiccup on one doesn't blank the other, and let the first error win the
    // banner.
    const fail = (e: unknown, fallback: string) => {
      if (cancelled) return
      setError(prev => prev ?? ((e as Error)?.message || fallback))
    }
    listAllGroups()
      .then(g => { if (!cancelled) setGroups(g) })
      .catch(e => { fail(e, 'Failed to load groups'); if (!cancelled) setGroups([]) })
    listAllUsers()
      .then(u => { if (!cancelled) setUsers(u) })
      .catch(e => { fail(e, 'Failed to load users'); if (!cancelled) setUsers([]) })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      {error && (
        <div className="error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="card">
        <div className="section-head">
          <h2 className="section-title">All groups</h2>
          <span className="section-count">{groups === null ? '—' : groups.length}</span>
        </div>
        <p className="subtle muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Read-only overview of every group in the system.
        </p>
        {groups === null && <p className="empty">Loading…</p>}
        {groups && groups.length === 0 && <p className="empty">No groups.</p>}
        {groups && groups.map(g => (
          <div key={g.id} className="group-row">
            <a href={`#/admin/g/${g.id}`} className="group-link">
              <div className="avatar-stack">
                {g.members.slice(0, 4).map(m => (
                  <img key={m} src={avatarUrl(m, 56)} alt={m} />
                ))}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 className="group-name">
                  {g.name}
                  {g.finalizedAt != null && (
                    <span className="group-finalized-tag" title="Finalized">finalized</span>
                  )}
                </h3>
                <p className="group-meta">
                  {g.owner}
                  {' · '}{g.currency}
                  {' · '}{g.memberCount} member{g.memberCount === 1 ? '' : 's'}
                  {' · '}{g.eventCount} event{g.eventCount === 1 ? '' : 's'}
                  {' · '}{fmtDate(g.createdAt)}
                </p>
              </div>
              <span className="group-link-chev">→</span>
            </a>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="section-head">
          <h2 className="section-title">All users</h2>
          <span className="section-count">{users === null ? '—' : users.length}</span>
        </div>
        <p className="subtle muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Every GitHub login that owns, belongs to, or has posted in a group.
        </p>
        {users === null && <p className="empty">Loading…</p>}
        {users && users.length === 0 && <p className="empty">No users.</p>}
        {users && users.map(u => (
          <div key={u.login} className="group-row">
            <a
              href={`https://github.com/${encodeURIComponent(u.login)}`}
              target="_blank"
              rel="noreferrer"
              className="group-link"
            >
              <div className="avatar-stack">
                <img src={avatarUrl(u.login, 56)} alt={u.login} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 className="group-name">{u.login}</h3>
                <p className="group-meta">
                  in {u.memberships} group{u.memberships === 1 ? '' : 's'}
                  {' · '}owns {u.owned}
                  {' · '}{u.expenseCount} expense{u.expenseCount === 1 ? '' : 's'}
                  {u.lastActiveAt != null && <>{' · '}active {fmtDate(u.lastActiveAt)}</>}
                </p>
              </div>
              <span className="group-link-chev">↗</span>
            </a>
          </div>
        ))}
      </div>
    </>
  )
}
