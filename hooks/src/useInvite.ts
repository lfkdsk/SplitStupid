// Invite-landing page logic — shared by the web Invite page and the RN
// InviteScreen. Fetches the public invite preview (no auth). The sign-in /
// join actions are platform-specific (web redirect vs native auth session),
// so they stay in the view; this just owns the fetch + loading/error.
import { useEffect, useState } from 'react'
import { readInvite, type InviteSummary } from '@splitstupid/core'

export interface UseInvite {
  invite: InviteSummary | null
  loading: boolean
  error: string | null
}

export function useInvite(groupId: string): UseInvite {
  const [invite, setInvite] = useState<InviteSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    readInvite(groupId)
      .then(i => {
        if (cancelled) return
        setInvite(i)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setError((e as Error)?.message || 'Failed to load invite')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [groupId])

  return { invite, loading, error }
}
