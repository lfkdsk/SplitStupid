import { useEffect, useRef } from 'react'
import { isOAuthConfigured, startOAuthFlow } from '../lib/oauth'
import { renderReceipt } from '../lib/receipt'
import { renderPostcard } from '../lib/postcard'
import { computeBalances, settle, formatAmount } from '../lib/settle'
import type { Balance, Group, Transfer } from '../types'

// A coherent fake trip used for both the in-page sample card and the
// receipt/postcard canvas previews — five expenses, four splitters,
// numbers chosen so the resulting balances are clean round figures.
const SAMPLE_MEMBERS = ['ada', 'ren', 'mei', 'sol'] as const
const SAMPLE_GROUP: Group = {
  id: 'zKx9p',
  name: 'Kyoto, April',
  currency: 'JPY',
  owner: SAMPLE_MEMBERS[0],
  members: [...SAMPLE_MEMBERS],
  events: [
    {
      id: 'e1', type: 'expense', ts: '2026-04-04T20:30:00.000Z',
      author: SAMPLE_MEMBERS[0], payer: SAMPLE_MEMBERS[0],
      amount: 24000, participants: [...SAMPLE_MEMBERS],
      split: 'equal', note: 'sushi dinner — Pontocho',
    },
    {
      id: 'e2', type: 'expense', ts: '2026-04-05T16:00:00.000Z',
      author: SAMPLE_MEMBERS[0], payer: SAMPLE_MEMBERS[0],
      amount: 15000, participants: [...SAMPLE_MEMBERS],
      split: 'equal', note: 'ryokan, Higashiyama',
    },
    {
      id: 'e3', type: 'expense', ts: '2026-04-07T09:00:00.000Z',
      author: SAMPLE_MEMBERS[1], payer: SAMPLE_MEMBERS[1],
      amount: 11000, participants: [...SAMPLE_MEMBERS],
      split: 'equal', note: 'rental car day',
    },
    {
      id: 'e4', type: 'expense', ts: '2026-04-08T13:00:00.000Z',
      author: SAMPLE_MEMBERS[2], payer: SAMPLE_MEMBERS[2],
      amount: 3000, participants: [...SAMPLE_MEMBERS],
      split: 'equal', note: 'museum tickets',
    },
    {
      id: 'e5', type: 'expense', ts: '2026-04-10T15:00:00.000Z',
      author: SAMPLE_MEMBERS[3], payer: SAMPLE_MEMBERS[3],
      amount: 7000, participants: [...SAMPLE_MEMBERS],
      split: 'equal', note: 'matcha cafe rounds',
    },
  ],
  createdAt: Date.UTC(2026, 3, 4, 8, 0, 0),
  finalizedAt: Date.UTC(2026, 3, 12, 18, 0, 0),
}

export default function Setup({
  authError,
  onDismissError,
}: {
  authError: string | null
  onDismissError: () => void
}) {
  const balances = computeBalances(SAMPLE_GROUP.events, SAMPLE_GROUP.members)
  const transfers = settle(balances)

  return (
    <div className="landing">
      <main className="landing-stage">
        <Hero authError={authError} onDismissError={onDismissError} />
        <GlanceSection group={SAMPLE_GROUP} balances={balances} transfers={transfers} />
        <KeepsakesSection group={SAMPLE_GROUP} balances={balances} transfers={transfers} />
        <HowItWorksSection />
        <NotesSection />
        <FooterCta />
      </main>
    </div>
  )
}

function Hero({
  authError,
  onDismissError,
}: {
  authError: string | null
  onDismissError: () => void
}) {
  return (
    <section className="landing-hero">
      <div className="landing-logo" aria-hidden="true">S</div>
      <p className="landing-eyebrow">A small expense ledger</p>
      <h1 className="landing-title">
        Keep the ledger,<br />
        <em>keep the friendship.</em>
      </h1>
      <p className="landing-lede">
        Track who paid for what on trips, dinners, and shared bills.
        SplitStupid does the math, names the transfers, and stays out of your way.
      </p>
      {authError && (
        <div className="error landing-error">
          <span>Sign-in failed: {authError}</span>
          <button onClick={onDismissError} aria-label="Dismiss">×</button>
        </div>
      )}
      {isOAuthConfigured()
        ? (
          <button className="landing-cta" onClick={() => startOAuthFlow()}>
            <GitHubMark /> Sign in with GitHub
          </button>
        )
        : (
          <div className="error landing-error">
            OAuth isn't configured. Set <code>VITE_OAUTH_CLIENT_ID</code> and{' '}
            <code>VITE_OAUTH_WORKER_URL</code> in <code>.env</code>.
          </div>
        )
      }
      <p className="landing-fineprint">No new account · Free · Open source</p>
    </section>
  )
}

function GlanceSection({
  group, balances, transfers,
}: {
  group: Group; balances: Balance[]; transfers: Transfer[]
}) {
  const max = Math.max(1, ...balances.map(b => Math.abs(b.balance)))
  const expenseCount = group.events.filter(e => e.type === 'expense').length
  const created = new Date(group.createdAt)
  const monthShort = created.toLocaleString('en-US', { month: 'short' })
  return (
    <>
      <SectionRule>A live group</SectionRule>
      <SectionIntro
        title={<>This is what it <em>looks like.</em></>}
        body="Balances update as you log. Suggested transfers reduce settling to the fewest payments needed."
      />
      <article className="landing-sample">
        <header className="landing-sample-head">
          <h3>{group.name}</h3>
          <span className="landing-sample-num">No. {group.id}</span>
        </header>
        <p className="landing-sample-meta">
          <strong>{group.members.length}</strong> people
          <span className="dot" />
          <strong>{expenseCount}</strong> expenses
          <span className="dot" />
          {group.currency} · since {monthShort} {created.getDate()}
        </p>

        <p className="landing-row-label">Per-member balance</p>
        {balances.map(b => (
          <BalanceRow key={b.member} balance={b} max={max} currency={group.currency} />
        ))}

        <hr className="landing-sample-divider" />

        <p className="landing-row-label">Suggested transfers</p>
        {transfers.map((t, i) => (
          <TransferRow key={i} transfer={t} currency={group.currency} />
        ))}
      </article>
    </>
  )
}

function BalanceRow({ balance, max, currency }: { balance: Balance; max: number; currency: string }) {
  const pct = Math.min(50, (Math.abs(balance.balance) / max) * 50)
  const sign = balance.balance > 0 ? '+ ' : balance.balance < 0 ? '− ' : ''
  const cls = balance.balance > 0 ? 'positive' : balance.balance < 0 ? 'negative' : 'zero'
  return (
    <div className="balance-row">
      <span className="balance-name">
        <Monogram login={balance.member} />
        <span className="login">{balance.member}</span>
      </span>
      <div className="balance-bar">
        <div className="balance-bar-mid" />
        {balance.balance !== 0 && (
          <div className={`balance-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
        )}
      </div>
      <span className={`balance-amount ${cls}`}>
        {sign}{formatAmount(Math.abs(balance.balance), currency)}
      </span>
    </div>
  )
}

function TransferRow({ transfer, currency }: { transfer: Transfer; currency: string }) {
  return (
    <div className="transfer">
      <span className="transfer-name">
        <Monogram login={transfer.from} />
        {transfer.from}
      </span>
      <span className="transfer-arrow">→</span>
      <span className="transfer-name">
        <Monogram login={transfer.to} />
        {transfer.to}
      </span>
      <span className="transfer-amount">{formatAmount(transfer.amount, currency)}</span>
    </div>
  )
}

// Tiny CSS-rendered avatar — used in the sample card so the landing page
// doesn't fire 4-8 GitHub avatar requests for fake logins. The postcard
// canvas renderer below still loads real avatars (when they exist).
function Monogram({ login }: { login: string }) {
  const ch = (login[0] || '?').toUpperCase()
  const palette = MONOGRAM_PAIRS[hashString(login) % MONOGRAM_PAIRS.length]
  return (
    <span
      className="landing-monogram"
      style={{ background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}
      aria-hidden="true"
    >
      {ch}
    </span>
  )
}

const MONOGRAM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#f1c597', '#c2410c'],
  ['#d6c5a0', '#6f6356'],
  ['#e8b3b3', '#9f1239'],
  ['#b8d49a', '#3f6212'],
  ['#cab5e0', '#6b46c1'],
]

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function KeepsakesSection({
  group, balances, transfers,
}: {
  group: Group; balances: Balance[]; transfers: Transfer[]
}) {
  return (
    <>
      <SectionRule>Two keepsakes</SectionRule>
      <SectionIntro
        title={<>When it's done, <em>print it on paper.</em></>}
        body="Finalize a trip to freeze the books — then export one of two share-friendly PNGs, hand-drawn on a 2D canvas so they look the same on every phone."
      />
      <ReceiptShowcase group={group} balances={balances} transfers={transfers} />
      <ul className="landing-keepsake-notes">
        <li><b>Torn edges</b> — sawtooth top &amp; bottom, clipped from the canvas itself, not faked with images.</li>
        <li><b>Per-group barcode</b> — bars are random, but seeded by group id so the same trip always renders identically.</li>
        <li><b>Cinnabar "FINALIZED" stamp</b> tilts -7°, sits over the title corner — the same metaphor as the in-app banner.</li>
        <li><b>"Thank you for splitting stupid."</b> — a riff on the supermarket footer, in italic Fraunces.</li>
      </ul>

      <PostcardShowcase group={group} />
      <ul className="landing-keepsake-notes">
        <li><b>Cinnabar postmark</b> — three concentric rings (outer dashed, mid solid, inner faint), rotated 8° just like a real cancellation stamp.</li>
        <li><b>Roman-numeral year</b> — the postmark sits beside <code>MMXXVI</code> instead of 2026, the convention of old picture-postcards.</li>
        <li><b>"Wish you were splitting here."</b> — a one-line nod to the postcard cliché, in italic serif.</li>
        <li><b>Olive FINALIZED stamp</b> tilts -6°, set on a soft white pad so the rotation reads cleanly over the paper grain.</li>
      </ul>
    </>
  )
}

function ReceiptShowcase({
  group, balances, transfers,
}: {
  group: Group; balances: Balance[]; transfers: Transfer[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    renderReceipt({ group, balances, transfers }).then(canvas => {
      if (cancelled) return
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      canvas.style.display = 'block'
      ref.current?.replaceChildren(canvas)
    }).catch(() => { /* swallow — preview is non-critical */ })
    return () => { cancelled = true }
  }, [group, balances, transfers])
  return (
    <div className="landing-keepsake-stage">
      <div ref={ref} className="landing-keepsake-canvas landing-keepsake-receipt" />
    </div>
  )
}

function PostcardShowcase({ group }: { group: Group }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    renderPostcard({ group }).then(canvas => {
      if (cancelled) return
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      canvas.style.display = 'block'
      ref.current?.replaceChildren(canvas)
    }).catch(() => { /* swallow */ })
    return () => { cancelled = true }
  }, [group])
  return (
    <div className="landing-keepsake-stage">
      <div ref={ref} className="landing-keepsake-canvas landing-keepsake-postcard" />
    </div>
  )
}

function HowItWorksSection() {
  return (
    <>
      <SectionRule>How it works</SectionRule>
      <ol className="landing-steps">
        <li>
          <span className="landing-step-num">i.</span>
          <h3>Log it</h3>
          <p>Add an expense — who paid, how much, and who splits the bill.</p>
        </li>
        <li>
          <span className="landing-step-num">ii.</span>
          <h3>Settle</h3>
          <p>Balances update live; the suggested transfers minimize payments.</p>
        </li>
        <li>
          <span className="landing-step-num">iii.</span>
          <h3>Finalize</h3>
          <p>Freeze the books, export the receipt, send the postcard.</p>
        </li>
      </ol>
    </>
  )
}

function NotesSection() {
  return (
    <>
      <SectionRule>A few notes</SectionRule>
      <section className="landing-why-grid">
        <Note
          mark="No new account"
          title="Sign in with GitHub."
          body="Your friends already have one. No new password, no email confirmation loop."
        />
        <Note
          mark="Private by group"
          title="Only members see it."
          body="Each group is invite-only. Nothing is public, nothing is indexed."
        />
        <Note
          mark="Installable"
          title="Works as an app."
          body="Add to your home screen on iOS or Android. Works offline once loaded."
        />
        <Note
          mark="Open source"
          title="The math is auditable."
          body="The whole client is on GitHub. Inspect the splits, fork it, host your own."
        />
      </section>
    </>
  )
}

function Note({ mark, title, body }: { mark: string; title: string; body: string }) {
  return (
    <div className="landing-why">
      <p className="landing-why-mark">{mark}</p>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  )
}

function FooterCta() {
  return (
    <section className="landing-footer-cta">
      <h3>Ready to settle the bill?</h3>
      {isOAuthConfigured() && (
        <button className="landing-cta" onClick={() => startOAuthFlow()}>
          <GitHubMark /> Sign in with GitHub
        </button>
      )}
      <p className="landing-footer-foot">
        SplitStupid · <a href="https://github.com/lfkdsk/splitstupid" target="_blank" rel="noreferrer">github.com/lfkdsk/splitstupid</a>
      </p>
    </section>
  )
}

function SectionRule({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing-section-rule">
      <span className="landing-section-title">{children}</span>
    </div>
  )
}

function SectionIntro({ title, body }: { title: React.ReactNode; body: string }) {
  return (
    <div className="landing-section-intro">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  )
}
