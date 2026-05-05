import { useEffect, useRef, useState } from 'react'
import type { Balance, Group, Transfer } from '../types'
import { renderReceipt, renderReceiptBlob } from '../lib/receipt'

// Modal that previews the rendered receipt PNG and offers Download / Share.
// We render to a fresh canvas inside the modal each time it opens so the
// preview always matches the current ledger — no stale snapshots if the
// user voids an expense and re-opens.
export default function ReceiptModal({
  open,
  onClose,
  group,
  balances,
  transfers,
}: {
  open: boolean
  onClose: () => void
  group: Group
  balances: Balance[]
  transfers: Transfer[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const blobCacheRef = useRef<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shareSupported, setShareSupported] = useState(false)

  useEffect(() => {
    setShareSupported(
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function',
    )
  }, [])

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return

    setError(null)
    setBusy(true)
    blobCacheRef.current = null

    let cancelled = false
    ;(async () => {
      try {
        const canvas = await renderReceipt({ group, balances, transfers })
        if (cancelled) return
        container.replaceChildren(canvas)
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        canvas.style.display = 'block'
      } catch (e: unknown) {
        if (cancelled) return
        setError((e as Error)?.message || 'Failed to render receipt')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()

    return () => { cancelled = true }
  }, [open, group, balances, transfers])

  // Esc-to-close. Mirrors ConfirmModal's behaviour.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function getBlob(): Promise<Blob> {
    if (blobCacheRef.current) return blobCacheRef.current
    const blob = await renderReceiptBlob({ group, balances, transfers })
    blobCacheRef.current = blob
    return blob
  }

  async function handleDownload() {
    setBusy(true)
    setError(null)
    try {
      const blob = await getBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `splitstupid-${group.id}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Defer revoke so the browser actually fetches the blob first.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to download')
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    setBusy(true)
    setError(null)
    try {
      const blob = await getBlob()
      const file = new File([blob], `splitstupid-${group.id}.png`, { type: 'image/png' })
      const data: ShareData = {
        files: [file],
        title: `${group.name} — SplitStupid receipt`,
        text: `Receipt for ${group.name}`,
      }
      if (
        typeof navigator.canShare === 'function' &&
        navigator.canShare(data) &&
        typeof navigator.share === 'function'
      ) {
        await navigator.share(data)
      } else {
        await handleDownload()
      }
    } catch (e: unknown) {
      // User-cancelled share dialogs throw AbortError — not an error.
      if ((e as { name?: string })?.name !== 'AbortError') {
        setError((e as Error)?.message || 'Failed to share')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal receipt-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Share receipt"
      >
        <div className="receipt-modal-head">
          <div>
            <h3 className="modal-title" style={{ margin: 0 }}>Share receipt</h3>
            <p className="muted subtle" style={{ margin: '4px 0 0' }}>
              A printable snapshot of the ledger — send it as an image.
            </p>
          </div>
          <button
            type="button"
            className="ghost receipt-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="error" style={{ marginTop: 14 }}>
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="receipt-preview">
          <div ref={containerRef} className="receipt-canvas-wrap" />
          {busy && <div className="receipt-busy">Composing…</div>}
        </div>

        <div className="receipt-actions">
          <button
            type="button"
            className="secondary"
            onClick={handleDownload}
            disabled={busy}
          >
            <DownloadIcon /> Download
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
          >
            <ShareIcon /> {shareSupported ? 'Share image' : 'Save image'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v7m0 0L4.5 6.5M7 9l2.5-2.5M3 11h8"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9.5 4.5L7 2L4.5 4.5M7 2v7M3 8.5v2.25A1.25 1.25 0 0 0 4.25 12h5.5A1.25 1.25 0 0 0 11 10.75V8.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
