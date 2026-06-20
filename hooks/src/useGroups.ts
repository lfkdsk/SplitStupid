// Dashboard page logic — shared by the web Groups page and the RN
// GroupsScreen. Lists the user's groups, creates new ones, and handles the
// owner-deletes / member-leaves action. The confirm UI (typed-name for a
// destructive delete, plain for a leave) is the view's; this returns the
// role so the view can choose its copy.
import { useCallback, useEffect, useState } from 'react'
import {
  listGroups,
  createGroup,
  deleteGroup,
  removeMember,
  type GroupSummary,
  type Member,
} from '@splitstupid/core'

export interface UseGroups {
  groups: GroupSummary[] | null
  loading: boolean
  error: string | null
  setError: (e: string | null) => void
  refresh: () => Promise<void>
  creating: boolean
  /** Create a group; returns its id on success (for the view to navigate to). */
  create: (input: { name: string; currency: string }) => Promise<string | null>
  removingId: string | null
  /** Owner → delete the group; member → leave it. Removes it from the list
   *  on success and returns true. */
  removeOrLeave: (g: GroupSummary) => Promise<boolean>
}

export function useGroups(me: Member): UseGroups {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setGroups(await listGroups())
    } catch (e) {
      setError((e as Error)?.message || 'Failed to list groups')
      setGroups([])
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: { name: string; currency: string }): Promise<string | null> => {
    setCreating(true)
    setError(null)
    try {
      const g = await createGroup({ name: input.name.trim(), currency: input.currency })
      return g.id
    } catch (e) {
      setError((e as Error)?.message || 'Failed to create group')
      return null
    } finally {
      setCreating(false)
    }
  }, [])

  const removeOrLeave = useCallback(async (g: GroupSummary): Promise<boolean> => {
    const isOwned = g.role === 'owner'
    setRemovingId(g.id)
    setError(null)
    try {
      if (isOwned) await deleteGroup(g.id)
      else await removeMember(g.id, me)
      setGroups(prev => (prev ? prev.filter(x => x.id !== g.id) : prev))
      return true
    } catch (e) {
      setError((e as Error)?.message || (isOwned ? 'Failed to delete' : 'Failed to leave'))
      return false
    } finally {
      setRemovingId(null)
    }
  }, [me])

  return { groups, loading: groups === null, error, setError, refresh, creating, create, removingId, removeOrLeave }
}
