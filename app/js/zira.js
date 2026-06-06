/* ═══════════════════════════════════════════════════════════════
   Gremlin — Zira Routine
   ENM Topology Browser + AMOS site-check wiring.
   Credentials shared with RF mode (nfm_host / nfm_user / nfm_pass).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LS_HOST   = 'nfm_host';
  const LS_USER   = 'nfm_user';
  const SS_PASS   = 'nfm_pass';
  const LS_SLC    = 'gremlin_slc_commands';
  const LS_CUSTOM = 'gremlin_custom_sites';

  const DEFAULT_CMDS = [
    { name: 'Cell Status', cmd: 'st cell',           on: true  },
    { name: 'EARFCN',      cmd: 'get . earfcn',       on: true  },
    { name: 'Alarm List',  cmd: 'al',                 on: true  },
    { name: 'UE Count',    cmd: 'ue print -admitted',  on: true  },
    { name: 'Bandwidth',   cmd: 'get . bandwidth',     on: false },
    { name: 'CRS Gain',    cmd: 'get . crsgain',       on: false },
    { name: 'Sync Status', cmd: 'syn status',          on: false },
  ];

  let _cmds          = [];
  let _customSites   = [];
  let _selSites      = new Set();
  let _lteExpanded   = true;
  let _clockTimer    = null;
  let _dragSrc       = -1;
  let _resultEntries = [];
  let _resultIdx     = 0;
  let _showRaw       = false;
  let _keysReady     = false;

  // ═════════════════════════════════════════════════════════════
  // Init
  // ═════════════════════════════════════════════════════════════
  function enmInit(pass) {
    const hostEl = document.getElementById('enmHost');
    const userEl = document.getElementById('enmUser');
    const passEl = document.getElementById('enmPass');

    if (hostEl) hostEl.value = localStorage.getItem(LS_HOST) || '10.255.160.2';
    if (userEl) userEl.value = localStorage.getItem(LS_USER) || 'zira';
    if (passEl) passEl.value = sessionStorage.getItem(SS_PASS) || pass || '';

    _loadCmds();
    _loadCustomSites();
    _renderCmds();
    _buildTree();
    _updateClock();
    if (_clockTimer) clearInterval(_clockTimer);
    _clockTimer = setInterval(_updateClock, 30000);
    _syncThemeBtn();

    // Dialog keyboard handlers (safe to re-add; same element)
    document.getElementById('slcAddName')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  enmConfirmAddCmd();
      if (e.key === 'Escape') enmCloseAddCmd();
    });
    document.getElementById('slcAddCmd')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  enmConfirmAddCmd();
      if (e.key === 'Escape') enmCloseAddCmd();
    });
    document.getElementById('siteAddInp')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  enmConfirmAddSite();
      if (e.key === 'Escape') enmCloseSiteManage();
    });

    if (!_keysReady) {
      _keysReady = true;
      document.addEventListener('keydown', function (e) {
        const zm = document.getElementById('ziraMode');
        if (!zm || zm.style.display === 'none') return;
        // ESC — close results overlay if open
        if (e.key === 'Escape') {
          const ov = document.getElementById('siteResultsOverlay');
          if (ov && ov.classList.contains('visible')) { e.preventDefault(); enmCloseResults(); return; }
        }
        // Ctrl+B — run AMOS for single selected site
        if (e.ctrlKey && e.key.toLowerCase() === 'b') {
          const tag = (e.target.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea') return;
          e.preventDefault();
          if (_selSites.size === 1) enmOpenAmos();
        }
      });
    }
  }

  // ═════════════════════════════════════════════════════════════
  // Credential helpers
  // ═════════════════════════════════════════════════════════════
  function enmSave() {
    const host = _getHost();
    const user = _getUser();
    const pass = _getPass();
    try {
      localStorage.setItem(LS_HOST, host);
      localStorage.setItem(LS_USER, user);
      sessionStorage.setItem(SS_PASS, pass);
    } catch (e) {}

    const btn = document.getElementById('enmSaveBtn');
    if (btn) {
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    }
  }

  function _getHost() {
    return (document.getElementById('enmHost') || {}).value?.trim()
      || localStorage.getItem(LS_HOST) || '10.255.160.2';
  }
  function _getUser() {
    return (document.getElementById('enmUser') || {}).value?.trim()
      || localStorage.getItem(LS_USER) || 'zira';
  }
  function _getPass() {
    return (document.getElementById('enmPass') || {}).value
      || sessionStorage.getItem(SS_PASS) || '';
  }

  // ═════════════════════════════════════════════════════════════
  // Run AMOS — opens interactive CMD window (same pattern as RF)
  // ═════════════════════════════════════════════════════════════
  function enmOpenAmos() {
    if (_selSites.size === 0) { _status('Select a site first', 'warn'); return; }
    if (_selSites.size > 1)   { _status('Select one site for Run AMOS', 'warn'); return; }
    const site = [..._selSites][0];
    const pass = _getPass();
    if (!pass) { document.getElementById('enmPass')?.focus(); _status('Enter password first', 'warn'); return; }

    fetch('/enm/amos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: _getHost(), user: _getUser(), pass, site }),
    }).then(r => r.json()).then(d => {
      if (!d.ok) _status(d.error || 'Server error', 'warn');
    }).catch(e => _status('Network error: ' + e.message, 'warn'));
  }

  // ═════════════════════════════════════════════════════════════
  // Run Site Check — opens visible CMD window with commands output
  // Same visible-window pattern as RF mode's nfmos endpoint.
  // ═════════════════════════════════════════════════════════════
  // ── Progress bar ──────────────────────────────────────────────
  let _progTimer = null;

  function _progStart(label) {
    clearInterval(_progTimer);
    const steps = ['Connecting to ' + label + '…', 'Logging in…', 'Running commands…'];
    let step = 0;
    const wrap = document.getElementById('enmProgressWrap');
    if (wrap) wrap.style.display = 'block';
    function _upd() {
      const fill = document.getElementById('enmProgressFill');
      const lbl  = document.getElementById('enmProgressStatus');
      if (fill) fill.style.width = Math.round((step / steps.length) * 85) + '%';
      if (lbl)  lbl.textContent  = steps[step];
    }
    _upd();
    _progTimer = setInterval(function () {
      if (step < steps.length - 1) { step++; _upd(); }
    }, 2800);
  }

  function _progReading(label) {
    clearInterval(_progTimer);
    const fill = document.getElementById('enmProgressFill');
    const lbl  = document.getElementById('enmProgressStatus');
    if (fill) fill.style.width = '90%';
    if (lbl)  lbl.textContent  = 'Reading output…';
  }

  function _progEnd() {
    clearInterval(_progTimer);
    const fill = document.getElementById('enmProgressFill');
    const lbl  = document.getElementById('enmProgressStatus');
    if (fill) fill.style.width = '100%';
    if (lbl)  lbl.textContent  = 'Done';
    setTimeout(function () {
      const wrap = document.getElementById('enmProgressWrap');
      if (wrap) wrap.style.display = 'none';
      if (fill) fill.style.width = '0%';
    }, 700);
  }

  async function enmRunCheck() {
    if (_selSites.size === 0) { _status('Select a site first', 'warn'); return; }
    if (_selSites.size > 5)   {
      _status('Maximum 5 sites at once', 'warn');
      setTimeout(() => { const el = document.getElementById('enmStatus'); if (el) el.style.display = 'none'; }, 3000);
      return;
    }
    const enabled = _cmds.filter(c => c.on).map(c => c.cmd);
    if (!enabled.length) { _status('Enable at least one command', 'warn'); return; }
    const pass = _getPass();
    if (!pass) { document.getElementById('enmPass')?.focus(); _status('Enter password first', 'warn'); return; }

    const btn     = document.querySelector('.enm-run-btn');
    const sites   = [..._selSites];
    const results = [];

    try {
      for (var si = 0; si < sites.length; si++) {
        const site  = sites[si];
        const label = sites.length > 1 ? site + ' (' + (si + 1) + '/' + sites.length + ')' : site;
        if (btn) btn.textContent = sites.length > 1 ? ('Running ' + (si + 1) + '/' + sites.length + '…') : 'Running…';
        _progStart(label);
        const d = await fetch('/enm/macro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: _getHost(), user: _getUser(), pass, site, cmds: enabled }),
        }).then(function (r) { return r.json(); });
        _progReading(label);
        await new Promise(function (res) { setTimeout(res, 300); });
        results.push({ site, output: d.output || '', cmds: enabled });
      }
      _progEnd();
      if (results.length) { _showResults(results); }
    } catch (e) {
      _progEnd();
      _status('Network error: ' + e.message, 'warn');
    } finally {
      if (btn) btn.textContent = 'Run Site Check';
    }
  }

  function enmCloseMacro() {
    const ov = document.getElementById('enmMacroOverlay');
    if (ov) ov.style.display = 'none';
  }

  // ═════════════════════════════════════════════════════════════
  // Site check results overlay
  // ═════════════════════════════════════════════════════════════
  function _stripAnsi(s) {
    return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
            .replace(/\x1B\][^\x07]*\x07/g, '')
            .replace(/\x1B[()][AB012]/g, '')
            .replace(/\r/g, '');
  }

  function _parseOutput(rawOutput, cmds) {
    const clean = _stripAnsi(rawOutput);
    const lines  = clean.split('\n');
    const results = [];
    for (var ci = 0; ci < cmds.length; ci++) {
      const cmd = cmds[ci];
      var cmdLine = -1;
      const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('> ?' + escaped + '\\s*$');
      for (var li = 0; li < lines.length; li++) {
        if (re.test(lines[li].trimEnd())) { cmdLine = li; break; }
      }
      if (cmdLine === -1) {
        results.push({ cmd, output: null, status: 'none' });
        continue;
      }
      var outLines = [];
      for (var oi = cmdLine + 1; oi < lines.length; oi++) {
        // AMOS main prompt always has a space after ">": "SITE> cmd" or "SITE>"
        // coli>/lrat/... has no space after ">" — don't break on it
        if (/^[A-Za-z][A-Za-z0-9_\-]+\+?>(?: |$)/.test(lines[oi])) break;
        outLines.push(lines[oi]);
      }
      const output = outLines.join('\n').trim();
      results.push({ cmd, output: output || '', status: _cmdStatus(cmd, output) });
    }
    return results;
  }

  function _cmdStatus(cmd, output) {
    if (output === null || output === undefined) return 'none';
    if (!output.trim()) return 'none';
    const low = output.toLowerCase();
    if (low.includes('failed') || low.includes('unreachable') || low.includes('error')) return 'err';
    // alarm list — non-empty output with real alarm rows = warning
    if (/^al(\s|$)/.test(cmd.trim())) {
      var dataLines = output.split('\n').filter(function (l) {
        return l.trim() && !/^-+$/.test(l.trim()) && !/alarm list/i.test(l);
      });
      return dataLines.length > 2 ? 'warn' : 'ok';
    }
    return 'ok';
  }

  function _showResults(entries) {
    _resultEntries = entries;
    _resultIdx = 0;
    _showRaw = false;
    _renderResultsPage();
    const ov = document.getElementById('siteResultsOverlay');
    if (ov) requestAnimationFrame(function () { ov.classList.add('visible'); });
    const lastBtn = document.getElementById('enmLastResultsBtn');
    if (lastBtn) lastBtn.disabled = false;
  }

  function enmShowLastResults() {
    if (!_resultEntries.length) return;
    _resultIdx = 0;
    _showRaw = false;
    _renderResultsPage();
    const ov = document.getElementById('siteResultsOverlay');
    if (ov) requestAnimationFrame(function () { ov.classList.add('visible'); });
  }

  function _renderResultsPage() {
    const entry = _resultEntries[_resultIdx];
    if (!entry) return;
    const el = document.getElementById('enmResultsSite');
    if (el) el.textContent = entry.site;
    const nav = document.getElementById('enmResultsNav');
    if (nav) nav.style.display = _resultEntries.length > 1 ? 'flex' : 'none';
    const cnt = document.getElementById('enmResultsCount');
    if (cnt) cnt.textContent = (_resultIdx + 1) + ' / ' + _resultEntries.length;
    const prev = document.getElementById('enmResultsPrev');
    const next = document.getElementById('enmResultsNext');
    if (prev) prev.disabled = _resultIdx === 0;
    if (next) next.disabled = _resultIdx === _resultEntries.length - 1;

    const icons = { ok: '✓', warn: '!', err: '✗', none: '—' };
    const parsed = _parseOutput(entry.output, entry.cmds)
      .filter(function (r) { return r.cmd.trim().toLowerCase() !== 'lt all'; });
    const body = document.getElementById('enmResultsBody');
    if (body) {
      body.innerHTML = parsed.map(function (r) {
        const icon = icons[r.status] || '—';
        const hasOutput = r.output && r.output.trim();
        return '<div class="enm-rcard">' +
          '<div class="enm-rcard-hdr" onclick="this.nextElementSibling.classList.toggle(\'open\');this.querySelector(\'.enm-rcard-arrow\').classList.toggle(\'open\')">' +
            '<div class="enm-rcard-status enm-rcard-' + r.status + '">' + icon + '</div>' +
            '<span class="enm-rcard-cmd">' + _esc(r.cmd) + '</span>' +
            '<span class="enm-rcard-arrow">' + (hasOutput ? '▼' : '') + '</span>' +
          '</div>' +
          '<div class="enm-rcard-body">' +
            (hasOutput ? '<pre class="enm-rcard-pre">' + _esc(r.output) + '</pre>'
                       : '<div class="enm-rcard-empty">not found in output</div>') +
          '</div>' +
        '</div>';
      }).join('');
    }

    const rawSec = document.getElementById('enmResultsRaw');
    const rawPre = document.getElementById('enmResultsRawPre');
    if (rawPre) rawPre.textContent = _stripAnsi(entry.output || '(no output)');
    if (rawSec) rawSec.className = 'enm-results-raw' + (_showRaw ? ' open' : '');
    const rawBtn = document.getElementById('enmRawToggle');
    if (rawBtn) rawBtn.className = 'enm-results-rawtoggle' + (_showRaw ? ' active' : '');
  }

  function enmCloseResults() {
    const ov = document.getElementById('siteResultsOverlay');
    if (ov) ov.classList.remove('visible');
  }

  function enmResultsNav(dir) {
    const next = _resultIdx + dir;
    if (next < 0 || next >= _resultEntries.length) return;
    _resultIdx = next;
    _showRaw = false;
    _renderResultsPage();
  }

  function enmToggleRaw() {
    _showRaw = !_showRaw;
    const rawSec = document.getElementById('enmResultsRaw');
    if (rawSec) rawSec.className = 'enm-results-raw' + (_showRaw ? ' open' : '');
    const btn = document.getElementById('enmRawToggle');
    if (btn) {
      btn.className = 'enm-results-rawtoggle' + (_showRaw ? ' active' : '');
      btn.textContent = _showRaw ? 'Hide Raw Output' : 'Show Raw Output';
    }
  }

  // ═════════════════════════════════════════════════════════════
  // Add Command dialog
  // ═════════════════════════════════════════════════════════════
  function enmOpenAddCmd() {
    const n = document.getElementById('slcAddName');
    const c = document.getElementById('slcAddCmd');
    if (n) n.value = '';
    if (c) c.value = '';
    const dlg = document.getElementById('slcAddDialog');
    if (dlg) dlg.style.display = 'flex';
    setTimeout(() => n?.focus(), 50);
  }
  function enmCloseAddCmd() {
    const dlg = document.getElementById('slcAddDialog');
    if (dlg) dlg.style.display = 'none';
  }
  function enmConfirmAddCmd() {
    const name = document.getElementById('slcAddName')?.value.trim();
    const cmd  = document.getElementById('slcAddCmd')?.value.trim();
    if (!name || !cmd) return;
    _cmds.push({ name, cmd, on: true });
    _saveCmds();   // persist immediately
    _renderCmds();
    enmCloseAddCmd();
  }

  // ═════════════════════════════════════════════════════════════
  // Command list
  // ═════════════════════════════════════════════════════════════
  function _loadCmds() {
    try {
      const raw = localStorage.getItem(LS_SLC);
      if (raw) { _cmds = JSON.parse(raw); return; }
    } catch (e) {}
    // First launch — use defaults and immediately persist
    _cmds = DEFAULT_CMDS.map(c => ({ ...c }));
    _saveCmds();
  }

  function _saveCmds() {
    try { localStorage.setItem(LS_SLC, JSON.stringify(_cmds)); } catch (e) {}
  }

  // ═════════════════════════════════════════════════════════════
  // Custom sites
  // ═════════════════════════════════════════════════════════════
  function _loadCustomSites() {
    try {
      const raw = localStorage.getItem(LS_CUSTOM);
      if (raw) { _customSites = JSON.parse(raw); return; }
    } catch (e) {}
    _customSites = [];
  }

  function _saveCustomSites() {
    try { localStorage.setItem(LS_CUSTOM, JSON.stringify(_customSites)); } catch (e) {}
  }

  function _allSites() {
    const base = typeof ENM_SITES !== 'undefined' ? ENM_SITES : [];
    const extra = _customSites.filter(function (s) { return !base.includes(s); });
    return base.concat(extra).slice().sort(function (a, b) { return a.localeCompare(b); });
  }

  function enmOpenSiteManage() {
    const dlg = document.getElementById('siteManageDialog');
    if (dlg) dlg.style.display = 'flex';
    const inp = document.getElementById('siteAddInp');
    if (inp) { inp.value = ''; setTimeout(function () { inp.focus(); }, 50); }
    _renderSiteList();
  }

  function enmCloseSiteManage() {
    const dlg = document.getElementById('siteManageDialog');
    if (dlg) dlg.style.display = 'none';
  }

  function enmConfirmAddSite() {
    const inp  = document.getElementById('siteAddInp');
    const name = inp ? inp.value.trim() : '';
    if (!name) return;
    const base = typeof ENM_SITES !== 'undefined' ? ENM_SITES : [];
    if (base.includes(name) || _customSites.includes(name)) {
      if (inp) inp.select();
      return;
    }
    _customSites.push(name);
    _saveCustomSites();
    if (inp) inp.value = '';
    _renderSiteList();
    _renderSites((document.getElementById('enmTreeFilter') || {}).value || '');
  }

  function enmRemoveSite(name) {
    _customSites = _customSites.filter(function (s) { return s !== name; });
    _saveCustomSites();
    _selSites.delete(name);
    _syncSelUI();
    _renderSiteList();
    _renderSites((document.getElementById('enmTreeFilter') || {}).value || '');
  }

  function _renderSiteList() {
    const list = document.getElementById('siteCustomList');
    if (!list) return;
    if (!_customSites.length) {
      list.innerHTML = '<div class="enm-site-empty">No custom sites added</div>';
      return;
    }
    const sorted = _customSites.slice().sort(function (a, b) { return a.localeCompare(b); });
    list.innerHTML = sorted.map(function (s) {
      return `<div class="enm-site-item">
        <span>${_esc(s)}</span>
        <button class="enm-site-item-del" onclick='enmRemoveSite(${JSON.stringify(s)})'>×</button>
      </div>`;
    }).join('');
  }

  function _renderCmds() {
    const list = document.getElementById('enmCmdList');
    if (!list) return;
    list.innerHTML = _cmds.map((c, i) => `
      <div class="enm-cmd-item" id="enm-cmd-${i}" draggable="true"
           ondragstart="enmDragStart(${i})"
           ondragover="enmDragOver(event,${i})"
           ondrop="enmDrop(event,${i})"
           ondragend="enmDragEnd()">
        <span class="enm-drag-handle" title="Drag to reorder">⠿</span>
        <label class="enm-chk-wrap">
          <input type="checkbox" ${c.on ? 'checked' : ''} onchange="enmToggleCmd(${i},this.checked)">
          <span class="enm-chk-box"></span>
        </label>
        <span class="enm-cmd-name">${_esc(c.name)}</span>
        <code class="enm-cmd-code">${_esc(c.cmd.length > 14 ? c.cmd.slice(0, 12) + '…' : c.cmd)}</code>
        <button class="enm-cmd-del" onclick="enmDeleteCmd(${i})">×</button>
      </div>`).join('');
  }

  function enmDragStart(idx) {
    _dragSrc = idx;
    setTimeout(function () {
      const el = document.getElementById('enm-cmd-' + idx);
      if (el) el.classList.add('enm-dragging');
    }, 0);
  }

  function enmDragOver(e, idx) {
    e.preventDefault();
    document.querySelectorAll('.enm-cmd-item').forEach(function (el) {
      el.classList.remove('enm-drag-over');
    });
    if (idx !== _dragSrc) {
      const el = document.getElementById('enm-cmd-' + idx);
      if (el) el.classList.add('enm-drag-over');
    }
  }

  function enmDrop(e, idx) {
    e.preventDefault();
    if (_dragSrc < 0 || _dragSrc === idx) return;
    const moved = _cmds.splice(_dragSrc, 1)[0];
    _cmds.splice(idx, 0, moved);
    _saveCmds();
    _renderCmds();
  }

  function enmDragEnd() {
    _dragSrc = -1;
    document.querySelectorAll('.enm-cmd-item').forEach(function (el) {
      el.classList.remove('enm-dragging', 'enm-drag-over');
    });
  }

  function enmToggleCmd(idx, on) {
    if (_cmds[idx]) { _cmds[idx].on = on; _saveCmds(); }
  }
  function enmDeleteCmd(idx) {
    _cmds.splice(idx, 1);
    _saveCmds();
    _renderCmds();
  }

  function enmSelectAll() {
    _cmds.forEach(c => { c.on = true; });
    _saveCmds();
    _renderCmds();
  }
  function enmDeselectAll() {
    _cmds.forEach(c => { c.on = false; });
    _saveCmds();
    _renderCmds();
  }

  // ═════════════════════════════════════════════════════════════
  // Topology tree
  // ═════════════════════════════════════════════════════════════
  function _buildTree() {
    const tree = document.getElementById('enmTree');
    if (!tree) return;

    tree.innerHTML = `
      <div class="enm-row" onclick="enmToggleStub()">
        <input type="checkbox" class="enm-row-cb" onclick="event.stopPropagation()">
        <span class="enm-expand enm-expand-coll">▶</span>
        <span class="enm-icon enm-icon-net"></span>
        <span class="enm-node">5G</span>
        <span class="enm-badge">SubNetwork</span>
      </div>
      <div class="enm-row" onclick="enmToggleStub()">
        <input type="checkbox" class="enm-row-cb" onclick="event.stopPropagation()">
        <span class="enm-expand enm-expand-coll">▶</span>
        <span class="enm-icon enm-icon-net"></span>
        <span class="enm-node">ONRM_ROOT_MO</span>
        <span class="enm-badge">SubNetwork</span>
      </div>
      <div class="enm-row enm-row-parent" id="enmLteRow" onclick="enmToggleLte()">
        <input type="checkbox" class="enm-row-cb" onclick="event.stopPropagation()">
        <span class="enm-expand" id="enmLteArrow">▼</span>
        <span class="enm-icon enm-icon-net"></span>
        <span class="enm-node">LTE</span>
        <span class="enm-badge">SubNetwork</span>
      </div>
      <div id="enmLteBody">
        <div class="enm-filter-row">
          <input type="text" class="enm-filter-inp" id="enmTreeFilter"
                 placeholder="Filter sites…"
                 oninput="enmFilterTree(this.value)"
                 onclick="event.stopPropagation()">
          <button class="enm-sites-btn" onclick="event.stopPropagation();enmOpenSiteManage()">+ Sites</button>
        </div>
        <div class="enm-site-selall">
          <button class="enm-site-selall-btn" onclick="enmSelectAllSites()">Select all</button>
          <span class="enm-site-selall-sep">·</span>
          <button class="enm-site-selall-btn" onclick="enmDeselectAllSites()">Deselect all</button>
        </div>
        <div id="enmSiteList"></div>
      </div>`;

    _lteExpanded = true;
    _renderSites('');
  }

  function _renderSites(filter) {
    const container = document.getElementById('enmSiteList');
    if (!container) return;
    const all  = _allSites();
    const fl   = filter.toLowerCase();
    const list = fl ? all.filter(function (s) { return s.toLowerCase().includes(fl); }) : all;
    container.innerHTML = list.slice(0, 400).map(function (s, i) {
      const sel    = _selSites.has(s);
      const safeId = 'enm-site-' + i;
      return '<div class="enm-row enm-row-site' + (sel ? ' enm-row-sel' : '') + '" ' +
        'onclick=\'enmSelectSite(' + JSON.stringify(s) + ')\'>' +
        '<label class="enm-chk-wrap" onclick="event.stopPropagation()">' +
          '<input type="checkbox"' + (sel ? ' checked' : '') + ' ' +
            'onchange=\'enmSelectSite(' + JSON.stringify(s) + ')\'>' +
          '<span class="enm-chk-box"></span>' +
        '</label>' +
        '<span class="enm-expand enm-expand-coll" style="visibility:hidden">▶</span>' +
        '<span class="enm-icon enm-icon-me"></span>' +
        '<span class="enm-node">' + _esc(s) + '</span>' +
        '<span class="enm-badge">MeContext</span>' +
        '<span class="enm-badge enm-badge-4g">4G</span>' +
      '</div>';
    }).join('');
  }

  function _syncSelUI() {
    const size = _selSites.size;
    const el = document.getElementById('enmSelSite');
    if (el) {
      if (size === 0)      el.textContent = '—';
      else if (size === 1) el.textContent = [..._selSites][0];
      else                 el.textContent = size + ' sites selected';
    }
    const cnt = document.getElementById('enmSelCount');
    if (cnt) cnt.textContent = '| Selected (' + size + ')';
    const amosBtn = document.querySelector('.enm-amos-btn');
    if (amosBtn) amosBtn.disabled = size !== 1;
  }

  function enmSelectSite(name) {
    if (_selSites.has(name)) { _selSites.delete(name); }
    else                     { _selSites.add(name);    }
    _syncSelUI();
    _renderSites((document.getElementById('enmTreeFilter') || {}).value || '');
  }

  function enmSelectAllSites() {
    const fl  = ((document.getElementById('enmTreeFilter') || {}).value || '').toLowerCase();
    const all = _allSites();
    (fl ? all.filter(function (s) { return s.toLowerCase().includes(fl); }) : all)
      .forEach(function (s) { _selSites.add(s); });
    _syncSelUI();
    _renderSites((document.getElementById('enmTreeFilter') || {}).value || '');
  }

  function enmDeselectAllSites() {
    _selSites.clear();
    _syncSelUI();
    _renderSites((document.getElementById('enmTreeFilter') || {}).value || '');
  }

  function enmFilterTree(val) { _renderSites(val); }

  function enmToggleLte() {
    _lteExpanded = !_lteExpanded;
    const body  = document.getElementById('enmLteBody');
    const arrow = document.getElementById('enmLteArrow');
    if (body)  body.style.display = _lteExpanded ? '' : 'none';
    if (arrow) arrow.textContent  = _lteExpanded ? '▼' : '▶';
  }

  function enmToggleStub() {}

  // ═════════════════════════════════════════════════════════════
  // Clock + theme
  // ═════════════════════════════════════════════════════════════
  function _updateClock() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const el  = document.getElementById('enmClock');
    if (el) el.textContent = `${hh}:${mm} (GMT+3)`;
  }

  function _syncThemeBtn() {
    const dark = document.documentElement.classList.contains('dark');
    const btn  = document.getElementById('enmThemeBtn');
    if (btn) btn.textContent = dark ? 'LIGHT' : 'DARK';
  }

  function enmSyncTheme() { _syncThemeBtn(); }

  // ═════════════════════════════════════════════════════════════
  // Status bar
  // ═════════════════════════════════════════════════════════════
  function _status(msg, type) {
    const el = document.getElementById('enmStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'enm-status enm-status-' + (type || 'info');
    el.style.display = 'block';
    if (type !== 'warn') setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ═════════════════════════════════════════════════════════════
  // Exports
  // ═════════════════════════════════════════════════════════════
  window.enmInit          = enmInit;
  window.enmSave          = enmSave;
  window.enmOpenAmos      = enmOpenAmos;
  window.enmRunCheck      = enmRunCheck;
  window.enmCloseMacro    = enmCloseMacro;
  window.enmOpenAddCmd    = enmOpenAddCmd;
  window.enmCloseAddCmd   = enmCloseAddCmd;
  window.enmConfirmAddCmd = enmConfirmAddCmd;
  window.enmToggleCmd     = enmToggleCmd;
  window.enmDeleteCmd     = enmDeleteCmd;
  window.enmSelectAll     = enmSelectAll;
  window.enmDeselectAll   = enmDeselectAll;
  window.enmSelectSite       = enmSelectSite;
  window.enmSelectAllSites   = enmSelectAllSites;
  window.enmDeselectAllSites = enmDeselectAllSites;
  window.enmFilterTree       = enmFilterTree;
  window.enmToggleLte     = enmToggleLte;
  window.enmToggleStub    = enmToggleStub;
  window.enmSyncTheme     = enmSyncTheme;
  window.enmDragStart       = enmDragStart;
  window.enmDragOver        = enmDragOver;
  window.enmDrop            = enmDrop;
  window.enmDragEnd         = enmDragEnd;
  window.enmOpenSiteManage  = enmOpenSiteManage;
  window.enmCloseSiteManage = enmCloseSiteManage;
  window.enmConfirmAddSite  = enmConfirmAddSite;
  window.enmRemoveSite      = enmRemoveSite;
  window.enmCloseResults    = enmCloseResults;
  window.enmResultsNav      = enmResultsNav;
  window.enmToggleRaw       = enmToggleRaw;
  window.enmShowLastResults = enmShowLastResults;
})();
