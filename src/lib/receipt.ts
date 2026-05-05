// Render a group's ledger as a supermarket-style receipt PNG. The whole
// thing is hand-drawn on a 2D canvas — no DOM-to-image dep, no foreignObject
// font-embedding gotchas — so the share image is byte-stable and runs in
// any browser that can do `canvas.toBlob`.
//
// Layout is built as an array of Blocks first (each declares its painted
// height), then the canvas is allocated to the exact total height and the
// blocks are painted top-down. Two-pass keeps the receipt's torn-edge
// clipping path tight: we never have to overshoot or guess.

import type { Balance, ExpenseEvent, Group, Transfer } from '../types'
import { formatAmount } from './settle'

const PAPER = '#faf6ef'
const INK = '#1a1410'
const MUTED = '#6f6356'
const SUBTLE = '#a89c8b'
const ACCENT = '#c2410c'
const POSITIVE = '#3f6212'
const NEGATIVE = '#9f1239'

const FONT_DISPLAY = `'Fraunces', 'Source Serif Pro', Georgia, serif`
const FONT_SANS = `'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
const FONT_MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace`

const W = 540
const PAD_X = 36
const TOP_PAD = 30
const BOTTOM_PAD = 28
const TOOTH_W = 12
const TOOTH_H = 7

interface Block {
  height: number
  paint(ctx: CanvasRenderingContext2D, y: number): void
}

export interface ReceiptInput {
  group: Group
  balances: Balance[]
  transfers: Transfer[]
}

export async function renderReceipt(input: ReceiptInput): Promise<HTMLCanvasElement> {
  // Wait for Fraunces / JetBrains Mono to actually load. Without this the
  // canvas falls back to a metric-sibling and the layout pass measures the
  // wrong glyphs.
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try { await (document as any).fonts.ready } catch { /* not fatal */ }
  }

  const measure = document.createElement('canvas').getContext('2d')!
  const { blocks, titleIndex } = buildBlocks(input, measure)

  let totalH = TOP_PAD
  for (const b of blocks) totalH += b.height
  totalH += BOTTOM_PAD

  // Cap upscaling at 3x — beyond that the file balloons without anyone
  // noticing on a phone screen.
  const scale = Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1) + 1))

  const out = document.createElement('canvas')
  out.width = Math.round(W * scale)
  out.height = Math.round(totalH * scale)
  const ctx = out.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.save()
  buildReceiptPath(ctx, W, totalH)
  ctx.clip()

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, W, totalH)
  drawPaperGrain(ctx, W, totalH, input.group.id)

  let y = TOP_PAD
  let titleY = 0
  for (let i = 0; i < blocks.length; i++) {
    if (i === titleIndex) titleY = y
    blocks[i].paint(ctx, y)
    y += blocks[i].height
  }

  // Diagonal "FINALIZED" stamp — same metaphor as the in-app banner, drawn
  // last so it sits over the title corner.
  if (input.group.finalizedAt && titleY > 0) {
    drawFinalizedStamp(ctx, W - PAD_X - 18, titleY + 6)
  }

  ctx.restore()
  return out
}

export async function renderReceiptBlob(input: ReceiptInput): Promise<Blob> {
  const canvas = await renderReceipt(input)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Failed to encode PNG')),
      'image/png',
    )
  })
}

// ----- shape & texture --------------------------------------------------

function buildReceiptPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath()
  ctx.moveTo(0, TOOTH_H)
  // Top torn edge — left to right.
  let x = 0
  while (x < w) {
    const next = Math.min(x + TOOTH_W, w)
    ctx.lineTo((x + next) / 2, 0)
    ctx.lineTo(next, TOOTH_H)
    x = next
  }
  ctx.lineTo(w, h - TOOTH_H)
  // Bottom torn edge — right to left.
  while (x > 0) {
    const next = Math.max(x - TOOTH_W, 0)
    ctx.lineTo((x + next) / 2, h)
    ctx.lineTo(next, h - TOOTH_H)
    x = next
  }
  ctx.lineTo(0, TOOTH_H)
  ctx.closePath()
}

function drawPaperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string) {
  // Deterministic flecks keyed off the group id so the same receipt looks
  // identical between regenerations — important if the user re-shares.
  const rng = mulberry32(hashSeed('grain:' + seed))
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

function drawFinalizedStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-Math.PI / 14)
  ctx.globalAlpha = 0.78
  ctx.strokeStyle = ACCENT
  ctx.fillStyle = ACCENT
  ctx.lineWidth = 1.6
  const text = 'FINALIZED'
  ctx.font = `700 11px ${FONT_MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText(text).width
  const padX = 8
  const padY = 4
  const w = tw + padX * 2
  const h = 18
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.fillText(text, 0, 1)
  void padY // keep symmetry note; vertical padding baked into h
  ctx.restore()
}

// ----- block construction ----------------------------------------------

function buildBlocks(
  input: ReceiptInput,
  mctx: CanvasRenderingContext2D,
): { blocks: Block[]; titleIndex: number } {
  const { group, balances, transfers } = input
  const blocks: Block[] = []

  blocks.push(brandBlock())
  blocks.push(spacer(8))
  blocks.push(centeredText('— RECEIPT —', `500 11px ${FONT_MONO}`, 14, MUTED))
  blocks.push(spacer(18))

  const titleIndex = blocks.length
  blocks.push(wrappedCentered(group.name, `600 28px ${FONT_DISPLAY}`, 32, INK, W - PAD_X * 2, mctx))
  blocks.push(spacer(8))

  const meta = `${group.currency.toUpperCase()}   ·   ${formatDate(new Date())}   ·   No. ${group.id}`
  blocks.push(centeredText(meta, `500 10.5px ${FONT_MONO}`, 12, SUBTLE))
  blocks.push(spacer(20))

  blocks.push(sectionHeader('EXPENSES'))
  blocks.push(spacer(12))

  const voided = new Set<string>()
  for (const e of group.events) if (e.type === 'void') voided.add(e.targetId)
  const expenses = group.events.filter(
    (e): e is ExpenseEvent => e.type === 'expense' && !voided.has(e.id),
  )

  let total = 0
  if (expenses.length === 0) {
    blocks.push(emptyLine('— no expenses recorded —'))
    blocks.push(spacer(8))
  } else {
    for (const e of expenses) {
      blocks.push(expenseRow(e, group.currency, mctx))
      blocks.push(spacer(10))
      total += e.amount
    }
  }

  blocks.push(dottedDivider())
  blocks.push(spacer(8))
  blocks.push(totalRow('TOTAL', formatAmount(total, group.currency)))
  blocks.push(spacer(22))

  blocks.push(sectionHeader('SETTLEMENT'))
  blocks.push(spacer(12))
  blocks.push(subSectionHeader('PER-MEMBER BALANCE'))
  blocks.push(spacer(8))

  if (balances.length === 0 || balances.every(b => b.balance === 0)) {
    blocks.push(emptyLine('all settled up.'))
  } else {
    for (const b of balances) blocks.push(balanceRow(b, group.currency))
  }

  blocks.push(spacer(18))

  if (transfers.length > 0) {
    blocks.push(subSectionHeader('SUGGESTED TRANSFERS'))
    blocks.push(spacer(8))
    for (const t of transfers) {
      blocks.push(transferRow(t, group.currency))
      blocks.push(spacer(4))
    }
  }

  blocks.push(spacer(16))
  blocks.push(dottedDivider())
  blocks.push(spacer(14))
  blocks.push(centeredItalic('Thank you for splitting stupid.'))
  blocks.push(spacer(14))
  blocks.push(barcode(group.id))
  blocks.push(spacer(8))
  blocks.push(centeredText(
    `g/${group.id} · ${formatDateShort(new Date())}`,
    `500 9.5px ${FONT_MONO}`, 12, SUBTLE,
  ))

  return { blocks, titleIndex }
}

// ----- block factories --------------------------------------------------

function spacer(h: number): Block {
  return { height: h, paint: () => { /* nothing */ } }
}

function brandBlock(): Block {
  const SQUARE = 30
  return {
    height: SQUARE,
    paint(ctx, y) {
      const cx = W / 2
      ctx.font = `600 17px ${FONT_DISPLAY}`
      const word = 'SplitStupid'
      const wordW = ctx.measureText(word).width
      const gap = 10
      const groupW = SQUARE + gap + wordW
      const x0 = cx - groupW / 2

      // Ink stamp.
      ctx.fillStyle = INK
      roundRect(ctx, x0, y, SQUARE, SQUARE, 6)
      ctx.fill()

      // Italic serif "S" inside.
      ctx.fillStyle = PAPER
      ctx.font = `italic 700 21px ${FONT_DISPLAY}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('S', x0 + SQUARE / 2, y + SQUARE / 2 + 1)

      // Wordmark.
      ctx.fillStyle = INK
      ctx.font = `600 18px ${FONT_DISPLAY}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(word, x0 + SQUARE + gap, y + SQUARE / 2)
    },
  }
}

function centeredText(text: string, font: string, lineH: number, color: string): Block {
  return {
    height: lineH,
    paint(ctx, y) {
      ctx.font = font
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(text, W / 2, y)
    },
  }
}

function centeredItalic(text: string): Block {
  return {
    height: 18,
    paint(ctx, y) {
      ctx.font = `italic 600 14px ${FONT_DISPLAY}`
      ctx.fillStyle = MUTED
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(text, W / 2, y)
    },
  }
}

function wrappedCentered(
  text: string,
  font: string,
  lineH: number,
  color: string,
  maxW: number,
  mctx: CanvasRenderingContext2D,
): Block {
  mctx.font = font
  const lines = wrapText(mctx, text, maxW)
  return {
    height: lines.length * lineH,
    paint(ctx, y) {
      ctx.font = font
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y + i * lineH))
    },
  }
}

function sectionHeader(label: string): Block {
  const HEIGHT = 16
  return {
    height: HEIGHT,
    paint(ctx, y) {
      const cy = y + HEIGHT / 2
      ctx.font = `600 10.5px ${FONT_MONO}`
      ctx.fillStyle = INK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const labelW = ctx.measureText(label).width
      const labelGap = 14

      ctx.strokeStyle = INK
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_X, cy)
      ctx.lineTo(W / 2 - labelW / 2 - labelGap, cy)
      ctx.moveTo(W / 2 + labelW / 2 + labelGap, cy)
      ctx.lineTo(W - PAD_X, cy)
      ctx.stroke()

      ctx.fillText(label, W / 2, cy)
    },
  }
}

function subSectionHeader(label: string): Block {
  return {
    height: 14,
    paint(ctx, y) {
      ctx.font = `600 9.5px ${FONT_MONO}`
      ctx.fillStyle = MUTED
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(label, PAD_X, y)
    },
  }
}

function expenseRow(
  e: ExpenseEvent,
  currency: string,
  mctx: CanvasRenderingContext2D,
): Block {
  const innerW = W - PAD_X * 2
  const titleFont = `500 13px ${FONT_SANS}`
  const amountFont = `600 13px ${FONT_MONO}`
  const noteFont = `italic 500 12px ${FONT_DISPLAY}`
  const splitFont = `500 10px ${FONT_MONO}`

  const splitText = `split among ${e.participants.join(', ')}`
  const dateText = formatDateShort(new Date(e.ts))

  mctx.font = noteFont
  const noteLines = e.note ? wrapText(mctx, `“${e.note}”`, innerW) : []
  mctx.font = splitFont
  // Reserve room on the right for the date stamp.
  const splitMaxW = innerW - mctx.measureText(dateText).width - 12
  const splitLines = wrapText(mctx, splitText, splitMaxW)

  const titleH = 18
  const noteH = noteLines.length * 16
  const splitH = Math.max(splitLines.length, 1) * 14
  const HEIGHT = titleH + (noteH ? noteH + 2 : 0) + splitH + 2

  return {
    height: HEIGHT,
    paint(ctx, y) {
      ctx.font = titleFont
      ctx.fillStyle = INK
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`${e.payer} paid`, PAD_X, y)

      ctx.font = amountFont
      ctx.textAlign = 'right'
      ctx.fillText(formatAmount(e.amount, currency), W - PAD_X, y)

      let cy = y + titleH

      if (noteLines.length) {
        ctx.font = noteFont
        ctx.fillStyle = MUTED
        ctx.textAlign = 'left'
        for (const ln of noteLines) {
          ctx.fillText(ln, PAD_X, cy)
          cy += 16
        }
        cy += 2
      }

      ctx.font = splitFont
      ctx.fillStyle = SUBTLE
      ctx.textAlign = 'left'
      splitLines.forEach((ln, i) => ctx.fillText(ln, PAD_X, cy + i * 14))

      ctx.textAlign = 'right'
      ctx.fillText(dateText, W - PAD_X, cy)
    },
  }
}

function totalRow(label: string, value: string): Block {
  return {
    height: 22,
    paint(ctx, y) {
      ctx.font = `600 10.5px ${FONT_MONO}`
      ctx.fillStyle = MUTED
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(label, PAD_X, y + 5)

      ctx.font = `700 16px ${FONT_MONO}`
      ctx.fillStyle = INK
      ctx.textAlign = 'right'
      ctx.fillText(value, W - PAD_X, y)
    },
  }
}

function balanceRow(b: Balance, currency: string): Block {
  return {
    height: 19,
    paint(ctx, y) {
      ctx.font = `500 13px ${FONT_SANS}`
      ctx.fillStyle = INK
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(b.member, PAD_X, y + 1)

      const sign = b.balance > 0 ? '+' : ''
      const color = b.balance > 0 ? POSITIVE : b.balance < 0 ? NEGATIVE : SUBTLE
      ctx.font = `600 12.5px ${FONT_MONO}`
      ctx.fillStyle = color
      ctx.textAlign = 'right'
      ctx.fillText(`${sign}${formatAmount(b.balance, currency)}`, W - PAD_X, y + 1)
    },
  }
}

function transferRow(t: Transfer, currency: string): Block {
  return {
    height: 22,
    paint(ctx, y) {
      // Cinnabar bullet.
      ctx.fillStyle = ACCENT
      ctx.beginPath()
      ctx.arc(PAD_X + 3, y + 9, 3, 0, Math.PI * 2)
      ctx.fill()

      ctx.font = `500 13px ${FONT_SANS}`
      ctx.fillStyle = INK
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(`${t.from}  →  ${t.to}`, PAD_X + 14, y + 2)

      ctx.font = `700 13px ${FONT_MONO}`
      ctx.fillStyle = ACCENT
      ctx.textAlign = 'right'
      ctx.fillText(formatAmount(t.amount, currency), W - PAD_X, y + 2)
    },
  }
}

function emptyLine(text: string): Block {
  return {
    height: 18,
    paint(ctx, y) {
      ctx.font = `italic 500 12px ${FONT_DISPLAY}`
      ctx.fillStyle = SUBTLE
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(text, W / 2, y)
    },
  }
}

function dottedDivider(): Block {
  const HEIGHT = 6
  return {
    height: HEIGHT,
    paint(ctx, y) {
      ctx.fillStyle = SUBTLE
      const step = 4
      const r = 0.85
      for (let x = PAD_X; x <= W - PAD_X; x += step) {
        ctx.beginPath()
        ctx.arc(x, y + HEIGHT / 2, r, 0, Math.PI * 2)
        ctx.fill()
      }
    },
  }
}

function barcode(seed: string): Block {
  const HEIGHT = 30
  return {
    height: HEIGHT,
    paint(ctx, y) {
      const rng = mulberry32(hashSeed('bar:' + seed))
      const x0 = PAD_X
      const x1 = W - PAD_X
      let x = x0
      ctx.fillStyle = INK
      while (x < x1) {
        const w = rng() < 0.5 ? 1 : rng() < 0.45 ? 3 : 2
        const gap = rng() < 0.7 ? 1.6 : 3
        if (rng() < 0.86) ctx.fillRect(x, y, w, HEIGHT)
        x += w + gap
      }
    },
  }
}

// ----- tiny utilities ---------------------------------------------------

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const tokens = text.split(/(\s+)/)
  const lines: string[] = []
  let cur = ''
  for (const tok of tokens) {
    const trial = cur + tok
    if (ctx.measureText(trial).width <= maxW) {
      cur = trial
      continue
    }
    if (cur.trim()) lines.push(cur.trimEnd())
    if (ctx.measureText(tok).width > maxW) {
      // Token alone overflows — hard-break by character.
      let buf = ''
      for (const ch of tok) {
        if (ctx.measureText(buf + ch).width > maxW) {
          if (buf) lines.push(buf)
          buf = ch
        } else {
          buf += ch
        }
      }
      cur = buf
    } else {
      cur = tok.trimStart()
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  return lines.length ? lines : ['']
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
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

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da} ${hh}:${mm}`
}

function formatDateShort(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}
