// Read-only operator view: every group in the system. Reuses the dashboard's
// group-row styling, but with no create / delete / leave affordances — rows
// just link through to the read-only AdminGroup detail. Data comes from
// listAllGroups(), which the Worker gates on ADMIN_LOGINS (a non-admin gets a
// 403 → thrown Error, surfaced here as an error banner rather than an empty
// list).
import { useEffect, useState } from 'react'
import { avatarUrl, listAllGroups, type AdminGroupSummary } from '@splitstupid/core'

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Admin() {
  const [groups, setGroups] = useState<AdminGroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAllGroups()
      .then(g => { if (!cancelled) setGroups(g) })
      .catch(e => {
        if (cancelled) return
        setError((e as Error)?.message || 'Failed to load groups')
        setGroups([])
      })
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
    </>
  )
}
