// Bundled (by `npm run build:webview`) into the share WebView. This is the
// whole point of the "B + WebView" decision: the receipt / postcard renderers
// are the EXACT same files the web app ships — we import them and run them
// unchanged inside a WKWebView, then hand the PNG back to React Native.
//
// esbuild resolves '@splitstupid/core' via the workspace symlink and the web
// renderers via the relative path into the root app. No copy, no fork.
import { renderReceiptBlob } from '../../src/lib/receipt'
import { renderPostcardBlob } from '../../src/lib/postcard'
import type { Balance, Group, Transfer } from '@splitstupid/core'

type RenderMsg =
  | { kind: 'receipt'; group: Group; balances: Balance[]; transfers: Transfer[] }
  | { kind: 'postcard'; group: Group }

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(s: string): void }
  }
}

function post(obj: unknown): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(obj))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('failed to read blob'))
    r.readAsDataURL(blob)
  })
}

async function handle(msg: RenderMsg): Promise<void> {
  try {
    const blob =
      msg.kind === 'postcard'
        ? await renderPostcardBlob({ group: msg.group })
        : await renderReceiptBlob({ group: msg.group, balances: msg.balances, transfers: msg.transfers })
    post({ type: 'png', dataUrl: await blobToDataUrl(blob) })
  } catch (e) {
    post({ type: 'error', message: (e as Error)?.message ?? 'render failed' })
  }
}

function onMessage(raw: unknown): void {
  if (typeof raw !== 'string') return
  let msg: RenderMsg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (msg && (msg.kind === 'receipt' || msg.kind === 'postcard')) void handle(msg)
}

// iOS delivers RN→page messages on window, Android on document.
window.addEventListener('message', e => onMessage((e as MessageEvent).data))
document.addEventListener('message', e => onMessage((e as unknown as MessageEvent).data))

// Tell RN we're mounted and ready for a payload.
post({ type: 'ready' })
