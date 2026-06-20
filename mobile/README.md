# SplitStupid — iOS (React Native / Expo)

The native client. It is **isomorphic with the web app**: all the data
shapes, settlement math, and the Worker API client come from
[`@splitstupid/core`](../core) — the exact same TypeScript the web app at
the repo root imports. Only the UI is rebuilt with React Native, and the
share-image (receipt / postcard) is rendered by reusing the web's canvas
code inside a WebView.

```
                 @splitstupid/core  (types · settle · api · me · avatar)
                   ▲                         ▲
        ┌──────────┘                         └───────────┐
   web (repo root)                                   mobile (this app)
   React + Vite                                      React Native + Expo
   src/lib/receipt.ts  ──────── bundled by ───────►  WebView (share image)
   src/lib/postcard.ts          build:webview        identical PNG output
```

## What's here vs. what's deferred

Built and type-checked:

- Auth — GitHub OAuth via `ASWebAuthenticationSession` (`expo-auth-session`),
  token in the Keychain (`expo-secure-store`). See `src/auth/`.
- Groups list + create (`GroupsScreen`).
- Group detail: live settlement (`computeBalances`/`settle` from core),
  activity feed, **add-expense** write path, QR invite (`GroupScreen`).
- Invite landing / join (`InviteScreen`), deep-linked from `splitstupid://g/<id>`.
- Share-image sheet: renders the receipt PNG by running the web's canvas
  renderers in an offscreen WebView, then shares via the OS sheet
  (`src/share/`).

Deliberately stubbed (wired to the same core API — mechanical to finish):

- void / edit an expense, finalize / reopen, member kick / leave,
  add-a-past-split-mate, the trip **postcard** button, and the marketing
  flourishes on the sign-in screen (sample receipt, feature cards).
- Bundling the custom fonts (Fraunces / JetBrains Mono) via `expo-font`;
  native text currently falls back to the platform serif/mono. The share
  image already uses the real fonts (loaded inside the WebView).

## Run it (needs a Mac + Xcode)

```sh
# from the repo root — installs every workspace incl. core + mobile
npm install

# bundle the receipt/postcard renderers for the WebView (re-run whenever
# src/lib/receipt.ts or postcard.ts change). Regenerates src/share/receiptHtml.ts.
npm run build:webview --workspace @splitstupid/mobile

cd mobile
npx expo run:ios          # builds a dev client and launches the simulator
# iterate after the first build with:  npx expo start --dev-client
```

Type-check without a simulator (this is what CI / this repo verifies):

```sh
npm run typecheck --workspace @splitstupid/mobile
```

## Steps that need accounts / a device (not done here)

1. **Auth broker entry (one line — needs deploy)** — the one external
   dependency, and smaller than it looks: `lfkdsk-auth` already forwards
   tokens to custom URL schemes (its `picg-desktop` client uses
   `picg://oauth`). Native sign-in just needs its own project key. The entry

   ```
   "splitstupid-mobile": "splitstupid://callback"
   ```

   has been added to `PROJECT_ORIGINS` in lfkdsk-auth's `wrangler.toml`.
   Deploy that Worker (push to master, or `npx wrangler deploy`) and native
   sign-in works — no `index.ts` change, no new OAuth App. This app already
   points `oauthWorkerUrl` at `.../splitstupid-mobile` (app.json). Until the
   broker is deployed, sign-in completes in GitHub but the token can't return
   to the app.

2. **Apple Developer account + EAS** — `eas build` / TestFlight / App Store
   submission. Add `eas.json` and run `eas build -p ios`.

3. **OTA updates (the "dynamic" half)** — `npx expo install expo-updates`
   then `eas update`. This is what lets a JS-only change ship to installed
   apps without an App Store review, mirroring how the web redeploys.

4. **Universal links** — `app.json` already declares the associated domain.
   To make `https://splitstupid.lfkdsk.org/g/<id>` open the app you also need
   the AASA file served at that domain **and** the web app to expose a
   non-hash `/g/:id` route (it is currently hash-routed `#/g/<id>`, whose
   path the OS link matcher can't read). The custom scheme
   `splitstupid://g/<id>` works today without any of this.

## Why the WebView for share images

Decided over a Skia port: it reuses the ~1200 lines of finished, byte-stable
canvas code (`receipt.ts` / `postcard.ts`) verbatim and keeps the PNG
pixel-identical to the web, at the cost of a second (offscreen) render path.
If that render ever moves server-side (render the PNG in the Worker), this
WebView and its bundle step disappear and both clients just show an
`<Image>` from a URL.
