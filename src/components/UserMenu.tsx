import { useEffect, useRef, useState } from 'react'
import { isAdmin } from '../lib/admin'

// Account control in the header. Collapses to just the avatar — tapping it
// opens a small popover with the identity, the Admin link, and Sign out. This
// mirrors the iOS app (header shows only the avatar; tapping it opens the
// account settings) and keeps the header from crowding on narrow screens,
// where the old inline name + Admin + Sign out pill overflowed.
export function UserMenu({
  login,
  avatar,
  onSignOut,
}: {
  login: string
  avatar: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Dismiss on outside click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-avatar-btn"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
      >
        <img src={avatar} alt="" />
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-id">
            <img src={avatar} alt="" />
            <div className="user-menu-id-text">
              <span className="user-menu-id-label">Signed in as</span>
              <span className="user-menu-id-login">{login}</span>
            </div>
          </div>
          {isAdmin(login) && (
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                window.location.hash = '#/admin'
              }}
            >
              Admin
            </button>
          )}
          <button
            type="button"
            className="user-menu-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
