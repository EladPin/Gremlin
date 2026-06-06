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
- **ENM Topology Browser tree** — 5G / ONRM_ROOT_MO / LTE hierarchy; LTE expands to all `ENM_SITES` with live filter; **multi-select checkboxes** on site rows; Select All / Deselect All (filter-aware); max 400 sites rendered
- **Actions panel** — HOST, AMOS USER, AMOS PASSWORD fields; Save persists to storage; SELECTED SITE count display
- **Run AMOS button** (`Ctrl+B`) — launches plink in a **PowerShell** window (black bg, green fg, ANSI-enabled via Win32 SetConsoleMode API). Disabled if more than 1 site selected.
- **Site Check Commands checklist** — per-command checkboxes with Select All / Deselect All; custom commands added via `+ Add` dialog; all state persists to localStorage
- **Run Site Check button** — runs one hidden plink session per selected site (max 5), collects output, displays in **results overlay** with per-command cards and raw output toggle; auto-dismissed 3-second warning if >5 sites selected
- **Results overlay** (`#siteResultsOverlay`) — fade-in overlay with per-site cards; each command card expandable with animation; raw output toggle per site; ESC or X button closes; "Last Results" button reopens last run
- **Progress bar** — shows connecting/running/reading status during Run Site Check

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
      .enm-tree-hdr — "Elad's Network Manager" h2 + action buttons
      .enm-toolbar  — Network Data dropdown + Selected count + refresh
      #enmTree      — tree rows built by JS (includes select-all row inside #enmLteBody)
    .enm-right      — actions panel (260px, scrollable)
                      contains: credentials, SELECTED SITE, Run AMOS btn, commands list,
                      Run Site Check btn, Last Results btn, progress bar (#enmProgressWrap),
                      status bar (#enmStatus)
  #siteResultsOverlay — results overlay (position:fixed, z-index:9400, opacity-based fade)
  #slcAddDialog     — add command dialog (position:fixed, z-index:9600)
```

### ENM nav bar
- Background `#0e1824` (dark navy)
- "E" circle: `#0082f0` (Ericsson blue), 26px; brand text: **"Elad's Network Manager"**
- Right side: `enm-chip` elements (enm01, clock, ? Help, zira) + DARK/LIGHT btn + "Mode" btn
- DARK/LIGHT btn calls `THEME.toggle(); enmSyncTheme()` — updates both the Gremlin theme and the Zira button text
- "Mode" btn calls `msShow()` → cross-fade back to mode-select

### Zira ENM color rules
All Zira/ENM CSS uses **fixed hex values** (not CSS custom properties like `var(--bg)`). The Gremlin dark/light theme toggle visually has no effect on the ENM interface — only the mode-select screen and Zira nav button text change. This is intentional: ENM always looks like ENM.

### Topology tree
- Three root nodes: `5G` (collapsed stub), `ONRM_ROOT_MO` (collapsed stub), `LTE` (expandable)
- LTE expanded by default — shows a filter `<input>`, then a Select All / Deselect All row, then all `ENM_SITES` as site rows
- Filter (`#enmTreeFilter`) re-renders site rows live via `enmFilterTree(val)` → `_renderSites(val)`
- Site rows use `.enm-chk-wrap` label checkboxes (blue fill when checked, 15px)
- Site row click → `enmSelectSite(name)` → toggles in `_selSites` (a `Set`), calls `_syncSelUI()`, re-renders rows
- `_syncSelUI()` — shared helper that updates SELECTED SITE display, toolbar count badge, and disables Run AMOS if `_selSites.size !== 1`
- `enmSelectAllSites()` / `enmDeselectAllSites()` — filter-aware: only acts on currently visible sites
- Max 400 sites rendered at once (sliced from filtered array)

### Checkboxes
Both site rows and command rows use the same pattern:
```html
<label class="enm-chk-wrap">
  <input type="checkbox" ...>
  <span class="enm-chk-box"></span>
  Label text
</label>
```
`.enm-chk-box` is a 15px (site) / 17px (cmd) square; turns `#0082f0` blue when `input:checked`. **IMPORTANT**: site name onclick handlers must use **single-quoted HTML attributes** (`onclick='enmSelectSite(...)'`) because site names can contain characters that would break double-quoted attributes, and `JSON.stringify(name)` produces double-quoted strings that break `onclick="enmSelectSite("name")"` parsing.

### Actions panel fields
| Element | ID | Storage key | Default |
|---|---|---|---|
| HOST | `enmHost` | `localStorage nfm_host` | `10.255.160.2` |
| AMOS USER | `enmUser` | `localStorage nfm_user` | `zira` |
| AMOS PASSWORD | `enmPass` | `sessionStorage nfm_pass` | — |

Save button (`enmSave()`) writes all three to storage. Password is sessionStorage only — gone when browser tab closes.

### Run AMOS button (`Ctrl+B`)
- Only enabled when exactly 1 site is selected (`_selSites.size === 1`)
- `enmOpenAmos()` → `POST /enm/amos` → server creates a `.ps1` and launches `powershell.exe`
- The PS1 enables ANSI/VT via Win32 `SetConsoleMode` (flag `0x0004` on stdout handle), sets black background + green foreground, then runs plink
- No `-batch`. No stdin pipe. Fully interactive PTY — engineer types AMOS commands directly
- Server returns `{ok:true}` immediately
- Button shows `Ctrl+B` keyboard hint via `.enm-kbd` span

### Site Check Commands
- Default commands: `lt all`, `st cell`, `st mme`, `st ike`, `get . earfcn`, `al`, `ue print -admitted`, `get . bandwidth`, `get . crsgain`, `syn status`
- Persisted to `localStorage gremlin_slc_commands` as `[{name, cmd, on}]`
- On first launch (no localStorage entry), defaults are saved immediately so toggles persist from session one
- `enmSelectAll()` / `enmDeselectAll()` — set all `on` flags and save
- `enmConfirmAddCmd()` — pushes new entry and saves immediately
- `enmDeleteCmd(idx)` — splices and saves
- `lt all` is always sent (needed for AMOS to connect to the node) but **filtered from the results display**

### Run Site Check button
- Max 5 sites; if >5 selected, shows orange warning that auto-dismisses after 3 seconds
- `enmRunCheck()` → loops over `_selSites`, fires sequential `POST /enm/macro` per site (server is single-threaded, must be sequential)
- Progress bar updates: "Connecting to {site}…" → "Running commands…" → "Reading output…" → complete
- Server runs plink in **hidden** CMD window (`WindowStyle Hidden`) — no visible window; returns `{ok, site, output}`
- After all sites done: parses output per site, displays in `#siteResultsOverlay`, enables "Last Results" button
- `_resultEntries` holds last run's data; `enmShowLastResults()` reopens overlay

### Results overlay (`#siteResultsOverlay`)
- Uses **opacity-based fade** (NOT `display:none`): CSS `opacity:0; pointer-events:none` hidden, `.visible` class → `opacity:1`
- Toggling requires `requestAnimationFrame` after setting `display` to trigger CSS transition
- Per-site sections, per-command cards with expand animation (`@keyframes rcard-open`)
- Raw output toggle button per site (shows/hides full plink stdout)
- X button + ESC key closes overlay (`enmCloseResults()`)
- `_keysReady` module-level flag prevents duplicate keyboard event listener registration

### Output parser (`_parseOutput` in zira.js)
CRITICAL — two regex fixes confirmed in production:
1. **AMOS prompt regex must match mixed case**: `[A-Za-z][A-Za-z0-9_\-]+\+?>(?: |$)`
   - Sites like `Arar`, `Astra` have mixed case — uppercase-only regex `[A-Z][A-Z0-9_]+` never detects boundaries → all commands show "not found in output"
2. **Space-after-`>` is required**: `(?: |$)` at end of regex
   - AMOS main prompt: `SITENAME> ` (always space after `>`)
   - coli sub-prompt: `coli>/lrat/ue print...` — matches letter+`>` but has `/` not space
   - Without the space check, `coli>` was treated as section boundary → `ue print -admitted` output cut short

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

Creates a temp `.ps1` and launches `powershell.exe -NoProfile -ExecutionPolicy Bypass -File path.ps1`.
The PS1:
1. Enables ANSI/VT via Win32 `SetConsoleMode` (stdout handle, flag `0x0004`) so AMOS colors render like MobaXterm
2. Sets black background + green foreground
3. Resizes window to 200×48
4. Clears screen
5. Runs `& 'plink' -ssh -t -pw 'pass' -l 'user' 'host' 'amos site'`
6. Self-deletes the PS1 file on exit

**No `-batch` flag. No stdin pipe.** Fully interactive PTY. Server returns immediately.

### POST /enm/macro — Zira site check (one call per site)
```json
{ "host": "10.255.160.2", "user": "zira", "pass": "...", "site": "KD185", "cmds": ["st cell", "al"] }
```
Response: `{ "ok": true, "site": "KD185", "output": "...raw stdout..." }`

Builds AMOS command sequence: `amos {site}` + enabled commands + `q` + `exit`, joined with `\n` (Unix LF only — critical). Runs plink in a **hidden** CMD window (`WindowStyle Hidden`) with `-batch` mode. Polls for done sentinel file (120s timeout). Returns raw stdout as JSON. The JS side fires one POST per selected site sequentially (server is single-threaded) and aggregates results before showing the overlay.

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

### Terminal window patterns per endpoint
- **nfmos** (RF mode): visible CMD window, bat file, stdout to temp file, `type out.txt` at end, waits for keypress
- **amos** (Zira interactive): PowerShell window (`powershell.exe -File ps1`), VT enabled, black/green, plink runs interactively, PS1 self-deletes on exit
- **macro** (Zira site check): hidden CMD window (`WindowStyle Hidden`), bat file, stdout to temp file, done sentinel, server reads file and returns JSON — no visible window at all

### ANSI/VT in the interactive AMOS terminal
CMD.exe does NOT reliably render ANSI escape codes even with `HKCU\Console\VirtualTerminalLevel=1`. The solution is to launch via `powershell.exe` and enable VT explicitly:
```powershell
Add-Type -TypeDefinition 'using System.Runtime.InteropServices;public class GK32{
  [DllImport("kernel32")]public static extern bool GetConsoleMode(System.IntPtr h,out uint m);
  [DllImport("kernel32")]public static extern bool SetConsoleMode(System.IntPtr h,uint m);
  [DllImport("kernel32")]public static extern System.IntPtr GetStdHandle(int n);}'
$ch=[GK32]::GetStdHandle(-11)   # -11 = STD_OUTPUT_HANDLE
[uint32]$cm=0
[GK32]::GetConsoleMode($ch,[ref]$cm)
[GK32]::SetConsoleMode($ch,$cm -bor 4)  # 4 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
```
This runs before plink and enables ANSI rendering for the console session. Child processes (plink) inherit the same console, so their ANSI output renders.

### `lt all` timing
Takes ~30–45 seconds on first connect as AMOS downloads and parses the MOM cache. Total NF.mos + PMR run is typically 90–120s. Gremlin uses a 180s timeout to be safe.

---

## RF mode additions

- **Clear History button** — inline with the History section label; calls `clearHistory()` which resets `_history`, `_activeIdx`, `_cmpEntry`, removes `gremlin_history` from localStorage, hides `#cmpBanner`, re-renders history panel

---

## Known issues / pending work

- **Zira + RF tested on OSP** — confirmed working with `zira` user for both modes
- RF mode blocks the server for up to 180s while running (single-threaded PowerShell) — Zira endpoints return immediately
- PMR only shows ROPs available on the node (typically last 1–4h)
- **Extend parser** with additional PMR report types once user provides raw outputs (PMR 103, 112, 203 are candidates)
- Zira topology tree is static (5G and ONRM_ROOT_MO are collapsed stubs with no children) — only LTE/MeContext nodes are real
- Zira results overlay: `lt all` is filtered from display but is always sent as first command in every site check session (required for AMOS to connect to the node)
