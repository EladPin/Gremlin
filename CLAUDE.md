# Gremlin — AMOS Noise Floor Analyzer
## Project Guide for Claude

---

## What this app does

Gremlin is a desktop tool for LTE network engineers. It connects to the AMOS MO shell via SSH (plink), runs the `NF.mos` script and `pmr 206` on a given site, captures the output, and displays:
- **Per-cell average UL interference** (glass morphism summary cards with color coding — snapshot)
- **Per-PRB interference chart** (line chart, dBm vs PRB index — snapshot)
- **PMR 206 ROP-by-ROP trend charts** — interference power + UL BLER/DTX + SINR + UL PRB load + RRC SSR + DL rank over time
- **Auto-diagnosis** — Hebrew-language issue cards in a terminal card, each with a jump-to-chart button
- **Site info modal** — earfcn (DL), bandwidth, CRS gain, active UE count per cell
- **Raw AMOS terminal viewer** — `>_` button on PRB chart opens a terminal modal with the full SSH session output
- **Run history** — persisted to localStorage, shows last N runs with compare and re-load
- **Side-by-side comparison** — overlay a previous run's data on current charts (dimmed/dashed)
- **Export** — captures all charts and renders a printable HTML report
- **Per-run investigation notes** — free-text textarea saved per history entry
- **Hebrew "?" help modals** on every chart explaining what to look for
- **Splash screen** — Creation of Adam dot-matrix animation on load

Engineers use it to quickly assess the noise floor on a site without manually SSHing and reading AMOS output.

---

## How to run

```powershell
cd d:\projects\Gremlin
powershell -ExecutionPolicy Bypass -File server.ps1
# Opens http://localhost:8090/app/ in the browser
```

No Node.js needed. Port: **8090**.

---

## File structure

```
app/
  index.html        — single-page app
  css/main.css      — Monad design system (light + dark)
  fonts/            — self-hosted fonts (no CDN — OSP has no internet)
    fonts.css
    sourceserif4-latin-400.woff2      — headlines (Source Serif 4)
    sourceserif4-latin-ext-400.woff2
    jetbrainsmono-latin-400.woff2     — all UI text (JetBrains Mono)
    jetbrainsmono-latin-ext-400.woff2
    jetbrainsmono-latin-500.woff2
    jersey10-latin.woff2              — logo only
    jersey10-latin-ext.woff2
  img/
    hands.png         — Creation of Adam dot-matrix image for splash screen
  js/
    app.js          — main app: fetch, display, history, comparison, export, modals
    parser.js       — NF.mos + PMR 206 output parser
    theme.js        — dark/light toggle (re-renders charts after transition)
    splash.js       — splash screen dot-reveal animation
    sites.js        — ENM_SITES array (~300 site names, used for autocomplete)
lib/
  chart.umd.min.js  — Chart.js v4 (self-hosted)
server.ps1          — PowerShell HTTP server + /enm/nfmos endpoint
CLAUDE.md           — this file
DESIGN.md           — Monad design system reference (current)
```

---

## Design system — Monad

**Light theme:** `#f6f3f1` parchment cream canvas, `#cfdaf5` lavender mist cards, `#000000` ink black text, `#242424` charcoal CTAs
**Dark theme:** `#1a1917` warm charcoal canvas, `#2e2b29` panels, `#f0ede9` cream text

- **Headlines:** Source Serif 4, weight 400 (never bold — Monad signature)
- **All UI text:** JetBrains Mono, weight 400/500
- **Card radius:** 40px · **Button radius:** 100px (pill) · **Input radius:** 8px
- **Shadow:** `rgba(0,0,0,0.1) 0px 0px 10px 0px`
- **No saturated colors** — data colors only in charts/badges
- Dark mode toggle does a **0.35s CSS transition** on all elements, then re-renders charts at 360ms

### Summary cards
Glass morphism: `rgba(217,217,217,0.07)` bg, `rgba(255,255,255,0.18)` border, `backdrop-filter:blur(6px)`, 17px radius, scales 1.04x on hover.
Cell names formatted: `KD185_3` → `KD185 Sector 3` via `_fmtCell()` in app.js.

### Chart legends
Custom notebook-style hand-drawn checkboxes (from Uiverse). SVG `#handDrawnNoise` filter applied. **Unchecked = dataset visible, checked (strikethrough) = hidden.**

### Run Check button
Spring elastic hover animation: `cubic-bezier(0.68,-0.55,0.265,1.55)` — padding expands, shadow lifts. Borrowed from Interfex.

### Terminal card pattern (used in 4 places)
Dark terminal aesthetic used across the UI — always `#202425` header + `#0d0d0d` body, traffic-light dots, monospace uppercase label:
- **Site input** (`.site-term-*`) — animated typing placeholder cycles through example site names every 4s. Real `<input>` hidden until focused (`.cmd-active` class on `#siteCmdRow`). `ENM_SITES` array in `sites.js` drives autocomplete (filter on input, up/down arrows, Enter to select). `+` button opens add/remove panel for custom sites.
- **Auto-diagnosis** (`.diag-term-*`) — wraps all diagnosis cards. Header shows severity count badges (red/yellow). Dark overrides on `.diag-card` children for contrast.
- **Site Info button** (`.si-term-*`) — terminal-loader style (Uiverse creator1116): `#1a1a1a` body, `#333` header, "Site Info" text animates with `sit-type`/`sit-blink` keyframes.
- **Raw AMOS terminal modal** (`#rawTermOverlay`, `.rt-*`) — louloudev59 style. `>_` button in PRB chart title opens it. Renders full SSH stdout as `<pre class="rt-output">` with prompt lines above/below. `showRawTerminal()` / `closeRawTerminal()`. Closes on Escape, red dot, or backdrop click. Width `min(820px, 93vw)`, height `min(600px, 84vh)`.

### Collapsible sidebar
`#btnSbToggle` toggles `.collapsed` class on `#sidebar`. State persisted to `localStorage` key `gremlin_sb_collapsed`. `.sb-collapsible` wrapper is `display:none` when collapsed.

### Chart crosshair sync
Global Chart.js plugin `syncCrosshair` registered before any chart creation. `afterEvent` stores `_crosshairIdx`, calls `.draw()` on all `_allPmrCharts`. `afterDraw` draws a vertical dashed line at that index. Only fires for charts in `_allPmrCharts` array (updated after each render + 900 toggle).

### Comparison mode
`_cmpEntry` holds the comparison history entry. `setCompare(idx)` toggles it. `#cmpBanner` shows at top of main area. Comparison datasets added as dimmed (`opacity 0.4`) dashed (`borderDash:[7,4]`) overlays in `_renderPmrCharts`. Summary cards show `▼/▲ X.X dB` delta with `.cmp-better`/`.cmp-worse` color classes.

---

## Splash screen

- File: `app/js/splash.js` + `app/img/hands.png`
- Loads `hands.png` (Creation of Adam dot-matrix), samples bright pixels at `SAMPLE_STEP=4` intervals
- Dots revealed randomly over `REVEAL_DURATION=1800ms`, opacity scales with source pixel brightness
- Holds `HOLD_DURATION=600ms` then CSS fade-out (`.hidden` class, 0.6s transition)
- If image missing → `dismiss()` called immediately, app loads normally

---

## AMOS commands sent (one session)

NF.mos does `lt all` **internally** — do NOT send `lt all` before it.

```
amos {site}
run NF.mos       ← runs lt all internally, outputs PRB table + avg summary
pmr              ← enter PM mode, downloads latest ROP files from node
206              ← LTE EUtranCell Traffic Performance ROP by ROP
x                ← exit pmr menu
q
exit
```

plink invocation: `plink -ssh -t -batch -pw "pass" -l user host`
- PTY required (`-t`): AMOS won't run without a pseudo-terminal
- Unix LF only (`\n`): PTY `icrnl` translates `\r` → `\n`, making `\r\n` into double-`\n`
- Output captured silently: `RedirectStandardOutput = true`
- Timeout: **180s**

---

## NF.mos output format

NF.mos internally calls `lteUlInt.pl` which outputs a histogram table per cell first, then the PRB table and avg summary. Parser skips histogram, looks for two section headers. All lines are `.trimEnd()`'d at parse time (output has wide trailing spaces).

### PRB interference table
```
Estimation of interference per PRB
PRB         KD185_2                      KD185_3
1           -97.91                       -116.54
...
50          -118.83
```

### Average UL Int summary
```
Cell                                   Average UL Int dBm
KD185_2                                -99.31
KD185_2 pucch                          -100.55
KD185_3                                -113.90
KD185_3 pucch                          -114.87
```

### Color coding
- ≥ -100 dBm → **red** (bad)
- -100 to -110 dBm → **yellow** (warn)
- < -110 dBm → **green** (good)

---

## PMR 206 output format

Real output has a **massive gawk command block** between the `206) LTE EUtranCell...` menu line and the actual report. Parser anchors on `Date: YYYY-MM-DD` (not the menu line). Search window after `Date:` is 10 lines.

```
Date: 2026-06-02
Time  Counter                               KD185_2 KD185_3
11:30 Int_RadioRecInterferencePwr             -97.7  -115.0
```

**Counters extracted:**
- `Int_RadioRecInterferencePwr` — PUSCH interference dBm
- `Int_RadioRecInterferencePucchPwr` — PUCCH interference dBm
- `Int_MacHarqUlBler` — UL HARQ block error rate %
- `Int_MacHarqUlDtxRate` — UL DTX rate %
- `Int_SinrPuschDistr` — PUSCH SINR dB
- `Res_UlPrbPercUsage` — UL PRB load %

Each ROP = 15 minutes. Typically last 1–4h available on node.

### Charts rendered from PMR 206
1. **UL Interference Power** — PUSCH (solid) + PUCCH (dashed) dBm over time
2. **UL Quality** — HARQ BLER% (solid) + DTX Rate% (dashed) over time
3. **SINR** — avg PUSCH SINR dB over time (below 0 dB = UEs struggling)
4. **UL Load** — PRB usage % over time

---

## PMR reports — pending exploration

Node has many more PMR types. Priority candidates once user provides raw outputs:
- **103** — Carrier RSSI & Transmitted Power, ROP by ROP
- **112** — Radiolinks performance, ROP by ROP
- **203** — LTE Node Traffic Performance, ROP by ROP

**Action: user will provide raw PMR output files for these reports so parser can be extended.**

---

## Server endpoint

### POST /enm/nfmos
```json
{ "host": "10.255.160.2", "user": "zira", "pass": "...", "site": "KD185" }
```
Response:
```json
{ "ok": true, "site": "KD185", "output": "...raw AMOS stdout..." }
```
Reads stdout/stderr concurrently via `ReadToEndAsync()` to prevent pipe-buffer deadlock.

---

## Session persistence

| Data | Storage | Lifetime |
|------|---------|---------|
| host, user, site | `localStorage` (`nfm_host`, `nfm_user`, `nfm_site`) | permanent |
| password | `sessionStorage` (`nfm_pass`) | until tab closes |
| run history | `localStorage` (`gremlin_history`) | permanent |
| sidebar state | `localStorage` (`gremlin_sb_collapsed`) | permanent |
| custom sites | `localStorage` (`gremlin_custom_sites`) | permanent |

Password saved to `sessionStorage` on first successful run. Auto-fills on page refresh within same tab. Gone when tab/window closed.

History entries are `{site, ts, raw, notes}` — `raw` is the full AMOS stdout, `parsed` is re-derived on load via `parseOutput()`. Custom sites are a JSON array of strings merged into `ENM_SITES` at boot (then sorted). Removing a custom site splices it from the runtime array and rewrites localStorage.

---

## OSP context

- OSP has **no internet** — all fonts, Chart.js, hands.png self-hosted
- plink.exe at `C:\tools\plink.exe` on OSP
- AMOS MO shell at `10.255.160.2`
- Default user: **`zira`** (has NF.mos — `aatia` does not)
- Host key already cached — `-batch` mode works silently
- To run: copy entire `Gremlin` folder to OSP, then `powershell -ExecutionPolicy Bypass -File server.ps1`
- ENM is reachable at `https://enm01.black.msi` from the OSP only (not from dev machine)
- The developer's home computer cannot reach ENM or the AMOS VM — only the OSP can

---

## AMOS / plink — critical implementation details (shared with Interfex)

These are confirmed behaviours from Interfex production use on the same OSP/ENM environment.

### `zira` user vs `aatia` user
- **`zira`** — has NF.mos script and lteUlInt.pl. Use for Gremlin.
- **`aatia`** — used by Interfex for frequency changes and SYNC ENM. Does NOT have NF.mos.
- Both users: `lt all` auto-fetches node password from `com_password` variable — no manual `rbs`/`rbs` needed. Do NOT send `rbs` after `lt all`.

### PTY is required
AMOS will not run without a pseudo-terminal. plink must use `-t` flag. Without it, AMOS silently fails.

### Unix LF line endings are CRITICAL
Commands sent to plink via stdin must use `\n` only, **not `\r\n`**.
- Reason: Linux PTY has `icrnl` enabled (standard default) — translates incoming `\r` → `\n`
- So `cmd\r\n` becomes `cmd\n\n` at AMOS — the extra `\n` immediately answers the next interactive prompt with empty input, corrupting all subsequent commands
- In PowerShell: write command files using `[IO.File]::WriteAllText` with explicit `\n` separators

### plink.exe location on OSP
Confirmed at `C:\tools\plink.exe`. server.ps1 also searches: PATH, `C:\Program Files\PuTTY`, `C:\PuTTY`, Desktop, Downloads.

### Host key caching (one-time setup per user)
Run once in cmd on OSP: `plink -ssh zira@10.255.160.2` → type `y` → Ctrl+C.
After that, `-batch` mode works silently for that host/user combination.

### Pipe-buffer deadlock prevention
When capturing plink stdout **and** stderr, always read both streams concurrently via `ReadToEndAsync()`. If you read stdout to completion before touching stderr (or vice versa), the process blocks when the pipe buffer fills — looks like a hang/timeout.

### `lt all` timing
Takes ~30–45 seconds on first connect as AMOS downloads and parses the MOM cache. Total NF.mos + PMR run is typically 90–120s. Gremlin uses a 180s timeout to be safe.

---

## Known issues / pending work

- **VERIFY ON OSP**: First live run with `zira` not yet confirmed — check that data displays correctly end-to-end
- Gremlin blocks the server for up to 180s while running (single-threaded PowerShell)
- PMR only shows ROPs available on the node (typically last 1–4h)
- **Extend parser** with additional PMR report types once user provides raw outputs (PMR 103, 112, 203 are candidates)

