// Param lists for the root stack. `Group` and `Invite` both take a groupId;
// which one a `g/:groupId` deep link resolves to depends on whether you're
// signed in (see App.tsx) — exactly like the web's App.tsx routing.
export type RootStackParamList = {
  SignIn: undefined
  Groups: undefined
  Group: { groupId: string }
  Settings: undefined
  Invite: { groupId: string }
}
