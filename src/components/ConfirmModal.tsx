import { useEffect, useRef, useState } from 'react'

type Tone = 'danger' | 'neutral'

export interface ConfirmModalProps {
  open: boolean
  title: string
  /** Body text. Plain string or any node so callers can highlight names etc. */
  body: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: Tone
  /**
   * If set, the confirm button stays disabled until the user types this
   * exact phrase into the input. Use the group name for delete.
   */
  requirePhrase?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  requirePhrase,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Reset the typed value every time the modal opens — otherwise re-opening
  // a deletion dialog for a different group would carry over the previous
  // (probably-mismatched) phrase, which is just confusing UX.
  useEffect(() => {
    if (open) setTyped('')
  }, [open, requirePhrase])

  // Esc closes; autofocus the typed-phrase input if there is one, else the
  // cancel button so the destructive action is never the default.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => {
      if (requirePhrase) inputRef.current?.focus()
      else cancelRef.current?.focus()
    }, 30)
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open, onCancel, requirePhrase])

  if (!open) return null

  const phraseOk = !requirePhrase || typed.trim() === requirePhrase
  const confirmDisabled = busy || !phraseOk

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="confirm-modal-title" className="modal-title">{title}</h3>
        <div className="modal-body">{body}</div>
        {requirePhrase && (
          <label className="modal-typed">
            <span className="field-label">
              Type <code>{requirePhrase}</code> to confirm
            </span>
            <input
              ref={inputRef}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={requirePhrase}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'danger' : ''}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
