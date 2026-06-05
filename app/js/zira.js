/* ═══════════════════════════════════════════════════════════════
   Gremlin — Zira Routine
   ENM Topology Browser + AMOS site-check wiring.
   Credentials shared with RF mode (nfm_host / nfm_user / nfm_pass).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LS_HOST = 'nfm_host';
  const LS_USER = 'nfm_user';
  const SS_PASS = 'nfm_pass';
  const LS_SLC  = 'gremlin_slc_commands';

  const DEFAULT_CMDS = [
    { name: 'Cell Status', cmd: 'st cell',           on: true  },
    { name: 'EARFCN',      cmd: 'get . earfcn',       on: true  },
    { name: 'Alarm List',  cmd: 'al',                 on: true  },
    { name: 'UE Count',    cmd: 'ue print -admitted',  on: true  },
    { name: 'Bandwidth',   cmd: 'get . bandwidth',     on: false },
    { name: 'CRS Gain',    cmd: 'get . crsgain',       on: false },
    { name: 'Sync Status', cmd: 'syn status',          on: false },
  ];

  let _cmds        = [];
  let _selSite     = null;
  let _lteExpanded = true;
  let _clockTimer  = null;

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
    if (!_selSite) { _status('Select a site first', 'warn'); return; }
    const pass = _getPass();
    if (!pass) { document.getElementById('enmPass')?.focus(); _status('Enter password first', 'warn'); return; }

    fetch('/enm/amos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: _getHost(), user: _getUser(), pass, site: _selSite }),
    }).then(r => r.json()).then(d => {
      if (!d.ok) _status(d.error || 'Server error', 'warn');
    }).catch(e => _status('Network error: ' + e.message, 'warn'));
  }

  // ═════════════════════════════════════════════════════════════
  // Run Site Check — opens visible CMD window with commands output
  // Same visible-window pattern as RF mode's nfmos endpoint.
  // ═════════════════════════════════════════════════════════════
  async function enmRunCheck() {
    if (!_selSite) { _status('Select a site first', 'warn'); return; }
    const enabled = _cmds.filter(c => c.on).map(c => c.cmd);
    if (!enabled.length) { _status('Enable at least one command', 'warn'); return; }
    const pass = _getPass();
    if (!pass) { document.getElementById('enmPass')?.focus(); _status('Enter password first', 'warn'); return; }

    const btn = document.querySelector('.enm-run-btn');
    if (btn) btn.textContent = 'Opening…';

    try {
      await fetch('/enm/macro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: _getHost(), user: _getUser(), pass, site: _selSite, cmds: enabled }),
      });
      _status('CMD window opened', 'ok');
    } catch (e) {
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

  function _renderCmds() {
    const list = document.getElementById('enmCmdList');
    if (!list) return;
    list.innerHTML = _cmds.map((c, i) => `
      <div class="enm-cmd-item">
        <label class="enm-cmd-lbl">
          <input type="checkbox" class="enm-cmd-chk" ${c.on ? 'checked' : ''}
                 onchange="enmToggleCmd(${i},this.checked)">
          <span class="enm-chk-box"></span>
        </label>
        <span class="enm-cmd-name">${_esc(c.name)}</span>
        <code class="enm-cmd-code">${_esc(c.cmd.length > 14 ? c.cmd.slice(0, 12) + '…' : c.cmd)}</code>
        <button class="enm-cmd-del" onclick="enmDeleteCmd(${i})">×</button>
      </div>`).join('');
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
        </div>
        <div id="enmSiteList"></div>
      </div>`;

    _lteExpanded = true;
    _renderSites('');
  }

  function _renderSites(filter) {
    const container = document.getElementById('enmSiteList');
    if (!container) return;
    const all  = typeof ENM_SITES !== 'undefined' ? ENM_SITES : [];
    const fl   = filter.toLowerCase();
    const list = fl ? all.filter(s => s.toLowerCase().includes(fl)) : all;
    container.innerHTML = list.slice(0, 400).map(s => `
      <div class="enm-row enm-row-site${_selSite === s ? ' enm-row-sel' : ''}"
           onclick="enmSelectSite(${JSON.stringify(s)})">
        <input type="checkbox" class="enm-row-cb" onclick="event.stopPropagation()">
        <span class="enm-expand enm-expand-coll" style="visibility:hidden">▶</span>
        <span class="enm-icon enm-icon-me"></span>
        <span class="enm-node">${_esc(s)}</span>
        <span class="enm-badge">MeContext</span>
        <span class="enm-badge enm-badge-4g">4G</span>
      </div>`).join('');
  }

  function enmSelectSite(name) {
    _selSite = name;
    const el = document.getElementById('enmSelSite');
    if (el) el.textContent = name;
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
  window.enmSelectSite    = enmSelectSite;
  window.enmFilterTree    = enmFilterTree;
  window.enmToggleLte     = enmToggleLte;
  window.enmToggleStub    = enmToggleStub;
  window.enmSyncTheme     = enmSyncTheme;
})();
