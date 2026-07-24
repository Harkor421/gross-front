# Gross income, frontend

Hold **$GROSS**, collect the bottom line. Single-page React 19 / Vite 7
site for the Gross income dispenser (`gross-back`). Fees are the token's
gross income and every fee splits 50/50: half to the growth wallet (DEX
boosts + marketing), half to holders as $1 drops of ETH every 5 minutes,
biggest bag first. The page renders a live income statement, next-drop
countdown, an animated 50/50 split diagram, a receipt-style line-items
feed (holder payouts + BOOST sweeps), and "The line": the full ranked
holder list (scrollable, search-as-you-type wallet filter + exact-match
spot card), all over the backend's WebSocket, with an offline demo mode.
Eligibility is open (min 0%), so the stat strip shows holders / holders
paid / $ to holders / $ to growth.

Tagline, used verbatim in the hero: "Half the fees go to growth, half go
to you. Gross in, split in two, straight on-chain."

> **For the next agent:** no framework beyond React, no UI deps, no
> state library. One component file, one stylesheet. Read "Wiring" and
> "File map" and you know the whole app.

## Deployed state (as of 2026-07-24)

| Thing | Where |
|---|---|
| Production | `https://gross-front.vercel.app` (Vercel project `gross-front`, scope harkor421) |
| Deploy | `vercel deploy --prod --yes` from this directory (CLI logged in) |
| Backend | `wss://gross-back-production.up.railway.app`, baked in as the default; no Vercel env needed |

## Wiring

`src/App.jsx` opens one WebSocket to the backend and consumes six
message types. Five keep the shapes documented in the backend README:
`service_status`, `holders_update`, `cycle_state`, `payments_update`,
`distribution_result`. One is new for this brand:

- `growth_sweep`: `{type, eth, usd, sig, ts, growthEthTotal,
  growthUsdTotal}`. Appended to the line-items feed as a visually
  distinct BOOST row (`kind: "boost"` on the item), merged into the held
  `cycle_state` so the statement totals move between cycle broadcasts,
  and surfaced as a "$X TO GROWTH" toast (no chime, the chime means a
  holder got paid).
- `cycle_state` carries 4 extra fields: `growthPct`, `growthEthTotal`,
  `growthUsdTotal`, `grossUsdTotal` (`grossUsdTotal = paidUsdTotal +
  growthUsdTotal`). They drive the income statement card: Gross fees,
  Less growth and marketing (parenthesized, accountant style), Net to
  holders (the bottom line, double-ruled).

If the socket doesn't connect within 1.2s the site enters **demo
mode**: fake holders, a self-refilling pot, a $1 burst every 45s, and a
fake `growth_sweep` every 3rd cycle so the statement, the BOOST rows and
the toasts all look alive offline. Reconnects with backoff; demo exits
the moment the real socket opens.

Env overrides (all optional, Vite-style):

| Var | Default | |
|---|---|---|
| `VITE_WS_URL` | `wss://gross-back-production.up.railway.app` | backend socket, patched after Railway domain exists |
| `VITE_CA` | (none) | pin the CA (else it arrives over WS) |
| `VITE_BUY_URL` | `https://www.noxa.fun` | GET $GROSS button target |
| `VITE_EXPLORER` | `https://robinhoodchain.blockscout.com` | address/tx links (the chain is Robinhood Chain) |
| `VITE_TICKER` | `GROSS` | display ticker |

## Design system (the whole aesthetic in one place)

Financial document. A printed 10-K with live numbers:

- Palette: CSS vars at the top of `src/index.css`. `--paper #faf8f2`
  page, `--card #fffefb` sheets, `--ink #1a1c18` near-black ink,
  `--ledger #0e7a3b` money green (the only strong color), `--stamp
  #b23a2f` rubber-stamp red for BOOST rows, negatives and stamps,
  `--rule/--rule-strong` thin ruled lines, `--bar #131511` ticker bar.
- Type: **Playfair Display** for display (headline, h2s, card titles),
  **Inter** body, **JetBrains Mono** for every number, tag, ticker and
  nav link. Loaded in `index.html`.
- Kit: white cards with 1px rules and a heavy ink top border, dotted
  leader lines in the statement (`.ir-dots`), a 3px double rule under
  the bottom line, faint paper grain (`body::before`, static), ruled
  ledger-row backgrounds on the feed and the line.
- Signature bits: rubber-stamp badges (`.stamp`: double ring, slight
  rotation, faded mask; PAID / SPLIT 50/50 / AUDITED BY NOBODY),
  receipt feed with perforated zigzag edges (`.receipt::before/after`),
  green = money to holders, red = money to growth, everywhere.
- Copy rule: **no em dashes in visible text** (owner preference); use
  commas or periods.
- Distribution toasts slide in and out; each holder payout plays a
  synthesized cash-register chime (Web Audio triangle arpeggio, no
  audio assets). Growth sweeps toast silently. Mute toggle in the nav
  persists to localStorage key `gross-sound`; audio unlocks on the
  first tap per browser autoplay policy.

## File map

```
index.html        fonts, meta, favicon (public/logo.svg)
src/main.jsx      React root
src/index.css     all styling: tokens > sections > diagram (.sd-*) > responsive
src/App.jsx       everything else:
  App             ws + demo mode + derived state + page layout
  Mark            the brand mark (green $ on a ledger page, mirrors public/logo.svg)
  SplitDiagram    the animated 50/50 scene (SVG; timings live in CSS @keyframes sd-*)
  SpotResult      the your-spot-in-line card (shown on exact wallet match)
  Reveal          IntersectionObserver blur-fade (Magic UI style, no deps)
  useNow / useCountUp / fmt* helpers
public/logo.svg   favicon + brand mark: green serif $ over ledger rules,
                  double total-rule underneath
```

### The split diagram (`SplitDiagram` + `.sd-*` CSS)

Fee dollars stream from TRADING FEES into THE SPLIT (2.4s loop), then
fork: red dollars ride the top lane to the GROWTH box, green dollars
ride the bottom lane to the HOLDERS box (4.8s loop, lanes alternate,
boxes pulse on landing). All CSS keyframes, React never re-renders for
it. Coin travel coordinates are absolute viewBox translates in `sd-in`,
`sd-up`, `sd-dn`; if you move boxes in the JSX, update those keyframes.
Diagram scrolls horizontally under 780px; reduced-motion hides the
coins and freezes the dashes.

### The line items feed

One list, two row kinds. Holder payouts render with a green PAID tag
and rank chip; growth sweeps render with a red BOOST tag, a
red-tinted row and "growth wallet" as the destination. Sim/demo sigs
(`demo*`, `sim*`, `0xSIM*`, `sent-*`) show "sim" instead of a tx link.

## Dev

```bash
npm i
npm run dev      # local, demo mode until the backend URL is patched in
npm run build    # dist/
```

Point `VITE_WS_URL` at `ws://localhost:8080` to develop against a local
`DRY_RUN=true` backend.
