# Gremlin — AMOS Noise Floor Analyzer + ENM Topology Browser
## Project Guide for Claude

---

## What this app does

Gremlin is a dual-mode desktop tool for LTE network engineers, served by a single PowerShell HTTP server. After the splash screen, a **password-protected mode-select screen** routes to one of two routines:

### RF Routine (`Aa100100`)
Connects to the AMOS MO shell via SSH (plink), runs the `NF.mos` script and `pmr 206` on a given site, captures the output, and displays:
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

### Zira Routine (`Motorola2022`)
ENM-style topology browser for running quick AMOS site checks:
- **ENM Topology Browser tree** — 5G / ONRM_ROOT_MO / LTE hierarchy; LTE expands to all `ENM_SITES` with live filter; click any site row to select it
- **Actions panel** — HOST, AMOS USER, AMOS PASSWORD fields; Save persists to storage; SELECTED SITE display
- **Run AMOS button** — opens an interactive visible CMD window running `plink … "amos {site}"` (no `-batch`, fully interactive PTY)
- **Site Check Commands checklist** — per-command checkboxes with Select All / Deselect All; custom commands added via `+ Add` dialog; all state persists to localStorage
- **Run Site Check button** — opens a visible CMD window (green-on-black, same pattern as RF mode) that runs the enabled AMOS commands in batch mode and dumps output; server returns immediately

### Splash screen
Creation of Adam dot-matrix animation plays on every page load, then cross-fades into the mode-select screen.

Engineers use it to quickly assess noise floor (RF Routine) or run ad-hoc AMOS site checks (Zira Routine) without manually SSHing.

---

## How to run

```powershell
cd c:\projects\Gremlin
powershell -ExecutionPolicy Bypass -File server.ps1
# Opens http://localhost:8090/app/ in the browser
```

No Node.js needed. Port: **8090**.

---

## File structure

```
app/
  index.html        — single-page app (mode-select + RF mode + Zira mode all in one HTML)
  css/main.css      — Monad design system (light + dark) + mode-select + Zira/ENM styles
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
    app.js          — RF mode: fetch, display, history, comparison, export, modals
    parser.js       — NF.mos + PMR 206 output parser
    theme.js        — dark/light toggle (re-renders charts after transition)
    splash.js       — splash screen dot-reveal animation; calls window.onSplashDone() when done
    sites.js        — ENM_SITES array (~300 site names, used for autocomplete in both modes)
    modeselect.js   — mode-select screen: password validation, cross-fade transitions, msEnter/msShow
    zira.js         — Zira Routine: ENM tree, site check commands, /enm/amos and /enm/macro calls
lib/
  chart.umd.min.js  — Chart.js v4 (self-hosted)
server.ps1          — PowerShell HTTP server + /enm/nfmos + /enm/amos + /enm/macro endpoints
CLAUDE.md           — this file
DESIGN.md           — Monad design system reference (current)
```

Script load order in index.html matters:
`splash.js` → `chart.umd.min.js` → `theme.js` → `parser.js` → `sites.js` → `app.js` → `modeselect.js` → `zira.js`

`modeselect.js` and `zira.js` must load after `sites.js` (needs `ENM_SITES`) and `app.js` (needs `THEME`).

---

## Mode select screen

- **Element:** `#modeSelect` — `position:fixed; z-index:8000` dark overlay (`#0b0b0b`)
- **Appears:** after splash via `window.onSplashDone` callback (set in `modeselect.js`)
- **Transition:** splash fades out over 600ms; mode-select fades in 200ms after `onSplashDone` fires
- **Two cards:** RF card (left) and Zira card (right) — Source Serif 4 titles, mono descriptions, `$` password row
- **Password validation:** RF = `Aa100100`, Zira = `Motorola2022` (hardcoded in `modeselect.js`)
- **Wrong password:** 2-second red error message, input cleared
- **On correct RF password:** cross-fade to `#hdr` + `#layout` (RF mode); pre-fills `#inpPass`
- **On correct Zira password:** cross-fade to `#ziraMode`; calls `enmInit(pass)`
- **"Mode" button** in RF header (`#btnMode`) and Zira nav calls `msShow()` → cross-fades back to mode-select

### Cross-fade implementation (`modeselect.js` `_fadeTo`)
1. Fade out `fromEl` (opacity → 0, pointer-events none, 280ms)
2. After 280ms: `fromEl.display = none`; `toEl.display = flex/block`; `toEl.opacity = 0`
3. Force reflow (`toEl.offsetHeight`)
4. Fade in `toEl` (opacity → 1, 280ms)

`#hdr` and `#layout` are hidden immediately when `onSplashDone` fires (they're behind the splash anyway). Mode transitions are always through the fade helper — never set display directly.

---

## Zira Routine — ENM Topology Browser

### HTML structure (`#ziraMode`)
```
#ziraMode (position:fixed, z-index:7000, flex-column)
  .enm-nav          — dark navy top bar (#0e1824)
  .enm-bread        — breadcrumb bar (white, border-bottom)
  .enm-body         — flex row
    .enm-left       — topology tree (flex:1, scrollable)
      .enm-tree-hdr — "Topology Browser" h2 + action buttons
      .enm-toolbar  — Network Data dropdown + Selected count + refresh
      #enmTree      — tree rows built by JS
    .enm-right      — actions panel (260px, scrollable)
  #enmMacroOverlay  — macro output overlay (position:fixed, z-index:9500)
  #slcAddDialog     — add command dialog (position:fixed, z-index:9600)
```

### ENM nav bar
- Background `#0e1824` (dark navy)
- "E" circle: `#0082f0` (Ericsson blue), 26px
- Right side: `enm-chip` elements (enm01, clock, ? Help, zira) + DARK/LIGHT btn + "Mode" btn
- DARK/LIGHT btn calls `THEME.toggle(); enmSyncTheme()` — updates both the Gremlin theme and the Zira button text
- "Mode" btn calls `msShow()` → cross-fade back to mode-select

### Zira ENM color rules
All Zira/ENM CSS uses **fixed hex values** (not CSS custom properties like `var(--bg)`). The Gremlin dark/light theme toggle visually has no effect on the ENM interface — only the mode-select screen and Zira nav button text change. This is intentional: ENM always looks like ENM.

### Topology tree
- Three root nodes: `5G` (collapsed stub), `ONRM_ROOT_MO` (collapsed stub), `LTE` (expandable)
- LTE expanded by default — shows a filter `<input>` then all `ENM_SITES` as site rows
- Filter (`#enmTreeFilter`) re-renders site rows live via `enmFilterTree(val)` → `_renderSites(val)`
- Site row click → `enmSelectSite(name)` → sets `_selSite`, updates `#enmSelSite`, re-renders rows with `.enm-row-sel` highlight
- Max 400 sites rendered at once (sliced from filtered array)

### Actions panel fields
| Element | ID | Storage key | Default |
|---|---|---|---|
| HOST | `enmHost` | `localStorage nfm_host` | `10.255.160.2` |
| AMOS USER | `enmUser` | `localStorage nfm_user` | `zira` |
| AMOS PASSWORD | `enmPass` | `sessionStorage nfm_pass` | — |

Save button (`enmSave()`) writes all three to storage. Password is sessionStorage only — gone when browser tab closes.

### Run AMOS button
`enmOpenAmos()` → `POST /enm/amos` → server creates a `.bat` and launches visible CMD:
```bat
plink -ssh -t -pw "pass" -l "user" "host" "amos site"
```
No `-batch`. No stdin pipe. Fully interactive PTY — engineer types AMOS commands directly. Server returns `{ok:true}` immediately.

### Site Check Commands
- Default 7 commands (st cell, get . earfcn, al, ue print -admitted, get . bandwidth, get . crsgain, syn status)
- Persisted to `localStorage gremlin_slc_commands` as `[{name, cmd, on}]`
- On first launch (no localStorage entry), defaults are saved immediately so toggles persist from session one
- `enmSelectAll()` / `enmDeselectAll()` — set all `on` flags and save
- `enmConfirmAddCmd()` — pushes new entry and saves immediately
- `enmDeleteCmd(idx)` — splices and saves

### Run Site Check button
`enmRunCheck()` → `POST /enm/macro` → server creates a visible CMD window:
```
Banner: "GREMLIN Site Check -- {site}"
Connecting… (while plink runs in -batch mode with commands piped via stdin)
Output dumped after plink exits
"Press any key to close"
```
Server returns `{ok:true}` immediately (does not block). Same pattern as RF mode's nfmos visible window.

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

### Mode-select screen
Full-screen dark overlay (`#0b0b0b`). Two cards (`#161616` bg, `rgba(255,255,255,0.1)` border, 14px radius). Jersey 10 logo, Source Serif 4 card titles, mono descriptions and password row. Password row uses `#0d0d0d` bg with `$` prefix. Error text in `#e05050`.

### Summary cards (RF mode)
Glass morphism: `rgba(217,217,217,0.07)` bg, `rgba(255,255,255,0.18)` border, `backdrop-filter:blur(6px)`, 17px radius, scales 1.04x on hover.
Cell names formatted: `KD185_3` → `KD185 Sector 3` via `_fmtCell()` in app.js.

### Chart legends
Custom notebook-style hand-drawn checkboxes (from Uiverse). SVG `#handDrawnNoise` filter applied. **Unchecked = dataset visible, checked (strikethrough) = hidden.**

### Run Check button
Spring elastic hover animation: `cubic-bezier(0.68,-0.55,0.265,1.55)` — padding expands, shadow lifts. Borrowed from Interfex.

### Terminal card pattern (used in 4 places in RF mode)
Dark terminal aesthetic — always `#202425` header + `#0d0d0d` body, traffic-light dots, monospace uppercase label:
- **Site input** (`.site-term-*`) — animated typing placeholder cycles through example site names every 4s. Real `<input>` hidden until focused (`.cmd-active` class on `#siteCmdRow`). `ENM_SITES` array in `sites.js` drives autocomplete (filter on input, up/down arrows, Enter to select). `+` button opens add/remove panel for custom sites.
- **Auto-diagnosis** (`.diag-term-*`) — wraps all diagnosis cards. Header shows severity count badges (red/yellow). Dark overrides on `.diag-card` children for contrast.
- **Site Info button** (`.si-term-*`) — terminal-loader style (Uiverse creator1116): `#1a1a1a` body, `#333` header, "Site Info" text animates with `sit-type`/`sit-blink` keyframes.
- **Raw AMOS terminal modal** (`#rawTermOverlay`, `.rt-*`) — louloudev59 style. `>_` button in PRB chart title opens it. Renders full SSH stdout as `<pre class="rt-output">` with prompt lines above/below. `showRawTerminal()` / `closeRawTerminal()`. Closes on Escape, red dot, or backdrop click. Width `min(820px, 93vw)`, height `min(600px, 84vh)`.

### Collapsible sidebar (RF mode)
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
- After adding `.hidden`, calls `window.onSplashDone()` if defined — this is set by `modeselect.js` to trigger mode-select fade-in
- If image missing → `dismiss()` called immediately (still fires `onSplashDone`)

---

## AMOS commands sent — RF mode (one session)

NF.mos does `lt all` **internally** — do NOT send `lt all` before it.

```
amos {site}
run NF.mos       ← runs lt all internally, outputs PRB table + avg summary
st cell
get . earfcn
get . bandwidth
get . crsgain
ue print -admitted
pmr              ← enter PM mode, downloads latest ROP files from node
206              ← LTE EUtranCell Traffic Performance ROP by ROP
x                ← exit pmr menu
q
exit
```

plink invocation: `plink -ssh -t -batch -pw "pass" -l user host`
- PTY required (`-t`): AMOS won't run without a pseudo-terminal
- Unix LF only (`\n`): PTY `icrnl` translates `\r` → `\n`, making `\r\n` into double-`\n`
- Output captured silently via bat file + stdout redirect to temp file
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
5. **RRC Setup Success Rate** — % per ROP
6. **Cell Availability** — downtime minutes per ROP (hidden if all zero)
7. **DL TX Rank Distribution** — Rank 1% (solid) + Rank 2% (dashed)

---

## PMR reports — pending exploration

Node has many more PMR types. Priority candidates once user provides raw outputs:
- **103** — Carrier RSSI & Transmitted Power, ROP by ROP
- **112** — Radiolinks performance, ROP by ROP
- **203** — LTE Node Traffic Performance, ROP by ROP

**Action: user will provide raw PMR output files for these reports so parser can be extended.**

---

## Server endpoints

### POST /enm/nfmos — RF mode full run
```json
{ "host": "10.255.160.2", "user": "zira", "pass": "...", "site": "KD185" }
```
Response: `{ "ok": true, "site": "KD185", "output": "...raw AMOS stdout..." }`

Creates a temp `.bat` + `.txt` files. Launches a visible CMD window showing "Connecting…" while plink runs in `-batch` mode with commands piped via stdin. Polls for a done sentinel file (180s timeout). Reads stdout from temp file and returns it as JSON. The CMD window dumps the output and waits for keypress.

### POST /enm/amos — Zira interactive terminal
```json
{ "host": "10.255.160.2", "user": "zira", "pass": "...", "site": "KD185" }
```
Response: `{ "ok": true }`

Creates a temp `.bat` and launches a visible CMD window running:
```
plink -ssh -t -pw "pass" -l "user" "host" "amos site"
```
**No `-batch` flag. No stdin pipe.** Fully interactive PTY — engineer types AMOS commands directly. Server returns immediately without waiting. CMD window closes when engineer types `exit` in AMOS.

### POST /enm/macro — Zira site check
```json
{ "host": "10.255.160.2", "user": "zira", "pass": "...", "site": "KD185", "cmds": ["st cell", "al"] }
```
Response: `{ "ok": true }`

Builds AMOS command sequence: `amos {site}` + enabled commands + `q` + `exit`, joined with `\n` (Unix LF only — critical). Creates a temp `.bat` and launches a **visible CMD window** (same green-on-black pattern as nfmos): shows connecting banner, runs plink in `-batch` mode with commands piped via stdin, dumps output when done, waits for keypress. Server returns immediately.

---

## Session persistence

| Data | Storage key | Storage type | Lifetime |
|------|-------------|--------------|---------|
| SSH host / ENM host | `nfm_host` | localStorage | permanent |
| RF SSH user | `nfm_user` | localStorage | permanent |
| Zira AMOS user | `nfm_user` | localStorage | permanent (same key as RF) |
| RF site last run | `nfm_site` | localStorage | permanent |
| Password (both modes) | `nfm_pass` | sessionStorage | until tab closes |
| Run history | `gremlin_history` | localStorage | permanent |
| Sidebar collapsed | `gremlin_sb_collapsed` | localStorage | permanent |
| Custom sites (RF) | `gremlin_custom_sites` | localStorage | permanent |
| Site check commands | `gremlin_slc_commands` | localStorage | permanent |

`nfm_host`, `nfm_user`, `nfm_pass` are **shared between RF mode and Zira mode** — switching modes pre-fills the other mode's credential fields automatically.

Password is saved to `sessionStorage` on RF's first successful run, or when Zira's Save button is clicked. Auto-fills on page refresh within same tab. Gone when tab/window closed.

Site check commands (`gremlin_slc_commands`) are saved as `[{name, cmd, on}]`. On first Zira launch (key absent), the 7 default commands are written to localStorage immediately so future toggles and additions persist from session one.

---

## OSP context

- OSP has **no internet** — all fonts, Chart.js, hands.png self-hosted
- plink.exe at `C:\tools\plink.exe` on OSP
- AMOS MO shell at `10.255.160.2`
- Default user: **`zira`** (has NF.mos and lteUlInt.pl — `aatia` does not)
- Host key already cached — `-batch` mode works silently
- To run: copy entire `Gremlin` folder to OSP, then `powershell -ExecutionPolicy Bypass -File server.ps1`
- ENM is reachable at `https://enm01.black.msi` from the OSP only (not from dev machine)
- The developer's home computer cannot reach ENM or the AMOS VM — only the OSP can

---

## AMOS / plink — critical implementation details (shared with Interfex)

These are confirmed behaviours from Interfex production use on the same OSP/ENM environment.

### `zira` user vs `aatia` user
- **`zira`** — has NF.mos script and lteUlInt.pl. Use for Gremlin (both RF and Zira modes).
- **`aatia`** — used by Interfex for frequency changes and SYNC ENM. Does NOT have NF.mos.
- Both users: `lt all` auto-fetches node password from `com_password` variable — no manual `rbs`/`rbs` needed. Do NOT send `rbs` after `lt all`.

### PTY is required
AMOS will not run without a pseudo-terminal. plink must use `-t` flag. Without it, AMOS silently fails.

### Unix LF line endings are CRITICAL
Commands sent to plink via stdin must use `\n` only, **not `\r\n`**.
- Reason: Linux PTY has `icrnl` enabled (standard default) — translates incoming `\r` → `\n`
- So `cmd\r\n` becomes `cmd\n\n` at AMOS — the extra `\n` immediately answers the next interactive prompt with empty input, corrupting all subsequent commands
- In PowerShell: build command strings with `` `n `` separators and write with `[IO.File]::WriteAllText(..., [Text.Encoding]::ASCII)`

### plink.exe location on OSP
Confirmed at `C:\tools\plink.exe`. `Find-Plink` in server.ps1 also searches: PATH, `C:\Program Files\PuTTY`, `C:\PuTTY`, Desktop, Downloads.

### Interactive vs batch plink
- **`-batch`**: for non-interactive sessions where stdin is piped. Host key must already be cached.
- **No `-batch`**: for interactive sessions (Zira's "Run AMOS"). CMD window stays open, engineer types directly.
- Never use `-batch` for interactive sessions — it will disconnect immediately if any prompt appears.

### Host key caching (one-time setup per user)
Run once in cmd on OSP: `plink -ssh zira@10.255.160.2` → type `y` → Ctrl+C.
After that, `-batch` mode works silently for that host/user combination.

### Pipe-buffer deadlock prevention
When capturing plink stdout **and** stderr, always read both streams concurrently via `ReadToEndAsync()`. If you read stdout to completion before touching stderr (or vice versa), the process blocks when the pipe buffer fills — looks like a hang/timeout. The bat-file-with-redirect approach (`> out.txt 2>&1`) sidesteps this entirely.

### Bat file visible window pattern
Used by all three endpoints (nfmos, amos, macro). Key points:
- CMD launched with `Start-Process cmd.exe /C "batfile.bat"` — `WindowStyle Normal` for visible, `Hidden` for silent
- For interactive sessions (amos): no stdout redirect, CMD inherits the console → plink gets a real PTY
- For batch sessions (nfmos, macro): stdout redirected to temp file (`> out.txt 2>&1`), then `type out.txt` in the bat dumps it to the visible window
- Bat files self-delete on exit (`del "%~f0" 2>nul`)

### `lt all` timing
Takes ~30–45 seconds on first connect as AMOS downloads and parses the MOM cache. Total NF.mos + PMR run is typically 90–120s. Gremlin uses a 180s timeout to be safe.

---

## Known issues / pending work

- **VERIFY ON OSP**: First live run with `zira` for both RF and Zira modes not yet confirmed — check end-to-end
- RF mode blocks the server for up to 180s while running (single-threaded PowerShell) — Zira endpoints return immediately
- PMR only shows ROPs available on the node (typically last 1–4h)
- **Extend parser** with additional PMR report types once user provides raw outputs (PMR 103, 112, 203 are candidates)
- Zira topology tree is static (5G and ONRM_ROOT_MO are collapsed stubs with no children) — only LTE/MeContext nodes are real
