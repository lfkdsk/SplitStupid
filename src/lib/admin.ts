// Frontend half of the admin gate. This ONLY controls whether the Admin link
// and its routes are shown/reachable in the UI. The real access boundary is
// the Worker's ADMIN_LOGINS check on /admin/*, which 403s anyone else no
// matter what the client believes — so a tampered build leaks nothing. Keep
// VITE_ADMIN_LOGINS in sync with the Worker's ADMIN_LOGINS by convention.
//
// Unset env ⇒ default to ["lfkdsk"]. An explicit empty string disables the
// link entirely (no admins).
const ADMIN_LOGINS: string[] = (() => {
  const raw = import.meta.env.VITE_ADMIN_LOGINS as string | undefined
  if (raw === undefined) return ['lfkdsk']
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
})()

export function isAdmin(login: string | null | undefined): boolean {
  if (!login) return false
  return ADMIN_LOGINS.includes(login.toLowerCase())
}
