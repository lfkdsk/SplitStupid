// Trip Postcard renderer — landscape PNG you can generate after finalize.
// Same canvas pipeline as receipt.ts: deterministic noise, no DOM-to-image
// dep, byte-stable output for a given group.
//
// Layout (logical px, scaled 2-3x at output time):
//   • Top-left   — ink-stamp brand + "TRIP POSTCARD" caption
//   • Title      — group.name in big Fraunces, auto-shrunk to fit
//   • Subtitle   — date range (created → finalized) + splitter count
//   • Avatars    — up to 4 GitHub avatars, "+N more" tail if larger
//   • Top-right  — concentric cinnabar postmark with "SETTLED" / "spent"
//                  / month·roman-year
//   • Bottom-R   — GRAND TOTAL big serif + per-splitter mono
//   • Bottom-L   — italic tagline + tilted olive FINALIZED stamp

import type { Group } from '../types'
import { formatAmount } from './settle'

const PAPER = '#faf6ef'
const INK = '#1a1410'
const MUTED = '#6f6356'
const ACCENT = '#c2410c'
const POSITIVE = '#3f6212'

const FONT_DISPLAY = `'Fraunces', 'Source Serif Pro', Georgia, serif`
const FONT_MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace`

const W = 720
const H = 460
const PAD = 38

export interface PostcardInput {
  group: Group
}

export async function renderPostcard(input: PostcardInput): Promise<HTMLCanvasElement> {
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try { await (document as any).fonts.ready } catch { /* not fatal */ }
  }

  const { group } = input

  const displayMembers = group.members.slice(0, 4)
  const remaining = Math.max(0, group.members.length - displayMembers.length)
  const avatars = await Promise.all(displayMembers.map(loadAvatar))

  const scale = Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1) + 1))
  const out = document.createElement('canvas')
  out.width = Math.round(W * scale)
  out.height = Math.round(H * scale)
  const ctx = out.getContext('2d')!
  ctx.scale(scale, scale)

  // Paper + grain.
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, H)
  drawPaperGrain(ctx, W, H, group.id)

  // Inner dashed postcard border.
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.setLineDash([2, 4])
  ctx.strokeRect(14, 14, W - 28, H - 28)
  ctx.restore()

  // 1. Brand block.
  drawBrand(ctx, PAD, 32)

  // 2. Title — auto-shrink so we don't crash into the postmark.
  drawTitle(ctx, group.name, PAD, 116, 380)

  // 3. Subtitle — date range + splitter count, mono-tracked.
  ctx.font = `500 11px ${FONT_MONO}`
  ctx.fillStyle = MUTED
  ctx.textBaseline = 'top'
  drawTrackedText(
    ctx,
    buildSubtitle(group),
    PAD + 2, 188, 11 * 0.22, 'left',
  )

  // 4. Avatars row.
  drawAvatars(ctx, displayMembers, avatars, remaining, PAD, 232)

  // 5. Postmark — top-right, rotated 8°.
  drawPostmark(ctx, W - 134, 130, group.finalizedAt ?? group.createdAt)

  // 6. Grand total — bottom-right.
  drawTotal(ctx, group)

  // 7. Tagline — italic serif, bottom-left.
  ctx.font = `italic 600 17px ${FONT_DISPLAY}`
  ctx.fillStyle = MUTED
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('Wish you were splitting here.', PAD, H - 38)

  // 8. FINALIZED stamp — tilted, sits above the tagline.
  drawFinalizedStamp(ctx, PAD + 50, H - 78)

  return out
}

export async function renderPostcardBlob(input: PostcardInput): Promise<Blob> {
  const canvas = await renderPostcard(input)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Failed to encode PNG')),
      'image/png',
    )
  })
}

// ----- pieces -----------------------------------------------------------

function drawBrand(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const s = 32
  ctx.fillStyle = INK
  roundRect(ctx, x, y, s, s, 6)
  ctx.fill()

  ctx.fillStyle = PAPER
  ctx.font = `italic 700 22px ${FONT_DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('S', x + s / 2, y + s / 2 + 1)

  ctx.fillStyle = INK
  ctx.font = `600 17px ${FONT_DISPLAY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('SplitStupid', x + s + 12, y + 2)

  ctx.fillStyle = MUTED
  ctx.font = `500 9px ${FONT_MONO}`
  drawTrackedText(ctx, '— TRIP POSTCARD —', x + s + 12, y + 22, 9 * 0.22, 'left')
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  x: number, y: number,
  maxW: number,
) {
  // Shrink-to-fit single line. Group names tend to be short ("Tokyo Trip",
  // "Roommates 2026") so wrapping is rarely needed, and a single line
  // composes better against the postmark on the right.
  let size = 60
  while (size > 28) {
    ctx.font = `600 ${size}px ${FONT_DISPLAY}`
    if (ctx.measureText(title).width <= maxW) break
    size -= 4
  }
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(title, x, y)
}

function buildSubtitle(group: Group): string {
  const start = group.createdAt
  const end = group.finalizedAt ?? Date.now()
  const range = formatDateRange(start, end)
  const n = group.members.length
  return `${range}   ·   ${n} ${n === 1 ? 'SPLITTER' : 'SPLITTERS'}`
}

function formatDateRange(startMs: number, endMs: number): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const s = new Date(startMs)
  const e = new Date(endMs)
  if (s.getFullYear() !== e.getFullYear()) {
    return `${months[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()} — ${months[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`
  }
  if (s.getMonth() !== e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()} — ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`
  }
  if (s.getDate() === e.getDate()) {
    return `${months[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()}`
  }
  return `${months[s.getMonth()]} ${s.getDate()} — ${e.getDate()}, ${s.getFullYear()}`
}

function drawAvatars(
  ctx: CanvasRenderingContext2D,
  members: string[],
  avatars: (HTMLImageElement | null)[],
  remaining: number,
  x: number, y: number,
) {
  const r = 19
  const gap = 12
  const startX = x + r
  members.forEach((login, i) => {
    drawAvatarCircle(ctx, startX + i * (r * 2 + gap), y + r, r, avatars[i], login)
  })

  const lastEnd = members.length === 0
    ? x
    : startX + (members.length - 1) * (r * 2 + gap) + r

  let cx = lastEnd + 14

  if (remaining > 0) {
    ctx.font = `500 11px ${FONT_MONO}`
    ctx.fillStyle = MUTED
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const tail = `+${remaining} more`
    ctx.fillText(tail, cx, y + r)
    cx += ctx.measureText(tail).width + 14
  }

  // Italic serif roster — truncate to fit before the postmark zone.
  ctx.font = `italic 500 16px ${FONT_DISPLAY}`
  ctx.fillStyle = MUTED
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const maxW = (W - 220) - cx
  let roster = members.join(' · ')
  if (ctx.measureText(roster).width > maxW) {
    while (roster.length > 4 && ctx.measureText(roster + '…').width > maxW) {
      roster = roster.slice(0, -1)
    }
    roster = roster + '…'
  }
  if (roster.length > 0) ctx.fillText(roster, cx, y + r)
}

function drawAvatarCircle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  img: HTMLImageElement | null,
  login: string,
) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  if (img && img.naturalWidth > 0) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2)
  } else {
    // Monogram fallback. Login-derived gradient → roster keeps colour
    // identity even without network access to GH avatars.
    const [c1, c2] = colorPairForLogin(login)
    const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.fillStyle = grad
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#fff8f1'
    ctx.font = `italic 700 ${Math.round(r * 0.95)}px ${FONT_DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((login[0] || '?').toUpperCase(), cx, cy + 1)
  }
  ctx.restore()

  // Hairline ring so the avatar reads against the cream paper.
  ctx.save()
  ctx.strokeStyle = 'rgba(26, 20, 16, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

const COLOR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#f1c597', '#c2410c'],
  ['#d6c5a0', '#6f6356'],
  ['#e8b3b3', '#9f1239'],
  ['#b8d49a', '#3f6212'],
  ['#cab5e0', '#6b46c1'],
]

function colorPairForLogin(login: string): readonly [string, string] {
  let h = 0
  for (let i = 0; i < login.length; i++) h = (h * 31 + login.charCodeAt(i)) >>> 0
  return COLOR_PAIRS[h % COLOR_PAIRS.length]
}

function drawPostmark(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  finalizedMs: number,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(Math.PI / 22) // ~8°
  ctx.strokeStyle = ACCENT
  ctx.fillStyle = ACCENT

  // Outer dashed ring.
  ctx.lineWidth = 2.5
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.arc(0, 0, 80, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // Mid solid ring.
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(0, 0, 65, 0, Math.PI * 2)
  ctx.stroke()

  // Inner faint ring.
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 0.6
  ctx.beginPath()
  ctx.arc(0, 0, 56, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // Top arc text (straight, hugging the inner ring).
  ctx.font = `700 10px ${FONT_MONO}`
  ctx.textBaseline = 'middle'
  drawTrackedText(ctx, '★ SETTLED ★', 0, -36, 10 * 0.32, 'center')

  // Big italic centre-piece.
  ctx.font = `italic 700 32px ${FONT_DISPLAY}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('spent', 0, 2)

  // Bottom arc text — month + roman year of finalize.
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const d = new Date(finalizedMs)
  const stampDate = `${months[d.getMonth()]} · ${toRoman(d.getFullYear())}`
  ctx.font = `500 9px ${FONT_MONO}`
  drawTrackedText(ctx, stampDate, 0, 36, 9 * 0.28, 'center')

  ctx.restore()
}

function drawTotal(ctx: CanvasRenderingContext2D, group: Group) {
  const { total, count } = computeTotal(group)
  const n = Math.max(group.members.length, 1)
  const perPerson = Math.floor(total / n)
  const x = W - PAD

  let y = H - 102
  ctx.fillStyle = MUTED
  ctx.font = `500 9px ${FONT_MONO}`
  ctx.textBaseline = 'top'
  drawTrackedText(ctx, 'GRAND TOTAL', x, y, 9 * 0.28, 'right')

  y += 14
  ctx.font = `600 44px ${FONT_DISPLAY}`
  ctx.fillStyle = INK
  ctx.textAlign = 'right'
  ctx.fillText(formatAmount(total, group.currency), x, y)

  y += 50
  ctx.font = `500 10px ${FONT_MONO}`
  ctx.fillStyle = MUTED
  ctx.fillText(
    `${formatAmount(perPerson, group.currency)} per splitter · ${count} ${count === 1 ? 'expense' : 'expenses'}`,
    x, y,
  )
}

function computeTotal(group: Group): { total: number; count: number } {
  const voided = new Set<string>()
  for (const e of group.events) if (e.type === 'void') voided.add(e.targetId)
  let total = 0
  let count = 0
  for (const e of group.events) {
    if (e.type === 'expense' && !voided.has(e.id)) {
      total += e.amount
      count += 1
    }
  }
  return { total, count }
}

function drawFinalizedStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-Math.PI / 30) // ~ -6°
  ctx.strokeStyle = POSITIVE
  ctx.fillStyle = POSITIVE
  ctx.lineWidth = 1.5

  ctx.font = `700 11px ${FONT_MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = 'FINALIZED'
  const tw = ctx.measureText(text).width
  const w = tw + 22
  const h = 22
  // Soft white pad behind the stamp so the rotated rect doesn't read
  // muddy over the postcard's grain.
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.restore()
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.fillText(text, 0, 1)
  ctx.restore()
}

// ----- shared utilities -------------------------------------------------

async function loadAvatar(login: string): Promise<HTMLImageElement | null> {
  // crossOrigin must be set BEFORE src for the request to include the
  // CORS preflight. GitHub avatars send `Access-Control-Allow-Origin: *`,
  // so this works for any real login. For typo'd logins (or if GH is
  // down) we resolve null and the renderer falls back to a monogram.
  return new Promise(resolve => {
    const img = new Image()
    let settled = false
    const finish = (val: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      resolve(val)
    }
    img.crossOrigin = 'anonymous'
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    img.src = `https://github.com/${encodeURIComponent(login)}.png?size=120`
    // Hard cap so a slow network can't keep the modal in the busy state.
    setTimeout(() => finish(null), 4000)
  })
}

function drawPaperGrain(
  ctx: CanvasRenderingContext2D, w: number, h: number, seed: string,
) {
  const rng = mulberry32(hashSeed('postcard:' + seed))
  ctx.save()
  ctx.globalAlpha = 0.045
  ctx.fillStyle = INK
  const dots = Math.floor((w * h) / 520)
  for (let i = 0; i < dots; i++) {
    const x = rng() * w
    const y = rng() * h
    const r = rng() * 0.7 + 0.18
    ctx.fillRect(x, y, r, r)
  }
  ctx.restore()
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  letterPx: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  // Manual letter-spacing — `ctx.letterSpacing` is wide-but-not-universal,
  // and the loop here is cheap enough that bypassing it keeps the renderer
  // portable.
  const baseAlign = ctx.textAlign
  ctx.textAlign = 'left'
  let total = 0
  for (let i = 0; i < text.length; i++) {
    total += ctx.measureText(text[i]).width
    if (i < text.length - 1) total += letterPx
  }
  let cx = x
  if (align === 'center') cx = x - total / 2
  else if (align === 'right') cx = x - total
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + letterPx
  }
  ctx.textAlign = baseAlign
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function toRoman(n: number): string {
  const pairs: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let out = ''
  let r = n
  for (const [v, sym] of pairs) {
    while (r >= v) { out += sym; r -= v }
  }
  return out
}
