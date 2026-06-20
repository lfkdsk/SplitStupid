// @splitstupid/hooks — the isomorphic page-logic layer. The web app (root)
// and the RN app (mobile/) both import these hooks and render the result;
// the page behaviour (fetch, derive, actions, permissions) lives here once.
export * from './useGroups'
export * from './useGroup'
export * from './useInvite'
