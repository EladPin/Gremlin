/* ═══════════════════════════════════════════════════════════════
   Gremlin — Mode Select
   Fade-in after splash; cross-fade between RF / Zira / mode-select.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const RF_PASS   = 'Aa100100';
  const ZIRA_PASS = 'Motorola2022';

  // ── Fade helper ───────────────────────────────────────────────
  // Fades fromEl out, then fades toEl in. toEl must be block/flex-able.
  function _fadeTo(fromEl, toEl, displayValue, onDone) {
    displayValue = displayValue || 'flex';

    if (fromEl) {
      fromEl.style.transition  = 'opacity 0.28s ease';
      fromEl.style.opacity     = '0';
      fromEl.style.pointerEvents = 'none';
    }

    setTimeout(function () {
      if (fromEl) fromEl.style.display = 'none';

      if (toEl) {
        toEl.style.opacity      = '0';
        toEl.style.display      = displayValue;
        toEl.style.pointerEvents = 'none';
        toEl.style.transition   = '';
        // Force reflow so the browser registers opacity:0 before transitioning
        toEl.offsetHeight; // eslint-disable-line no-unused-expressions
        toEl.style.transition   = 'opacity 0.28s ease';
        toEl.style.opacity      = '1';
        toEl.style.pointerEvents = '';
      }

      if (onDone) setTimeout(onDone, 280);
    }, 280);
  }

  // ── Splash done → fade in mode select ────────────────────────
  window.onSplashDone = function () {
    // RF mode elements are in normal flow — just hide them instantly
    // (they were never visible; splash was on top)
    document.getElementById('hdr').style.display    = 'none';
    document.getElementById('layout').style.display = 'none';

    var ms = document.getElementById('modeSelect');
    if (!ms) return;
    // Small delay so splash fade-out has started
    setTimeout(function () {
      ms.style.opacity      = '0';
      ms.style.display      = 'flex';
      ms.style.transition   = '';
      ms.offsetHeight; // reflow
      ms.style.transition   = 'opacity 0.35s ease';
      ms.style.opacity      = '1';
    }, 200);
  };

  // ── Password entry ────────────────────────────────────────────
  function msEnter(mode) {
    var inpId = mode === 'rf' ? 'msPassRf'  : 'msPassZira';
    var errId = mode === 'rf' ? 'msErrRf'   : 'msErrZira';
    var inp   = document.getElementById(inpId);
    var val   = inp ? inp.value : '';
    var ok    = (mode === 'rf'   && val === RF_PASS)   ||
                (mode === 'zira' && val === ZIRA_PASS);

    if (!ok) {
      var err = document.getElementById(errId);
      if (err) {
        err.textContent = 'incorrect password';
        setTimeout(function () { err.textContent = ''; }, 2000);
      }
      if (inp) { inp.value = ''; inp.focus(); }
      return;
    }

    var ms = document.getElementById('modeSelect');

    if (mode === 'rf') {
      var hdr    = document.getElementById('hdr');
      var layout = document.getElementById('layout');
      _fadeTo(ms, hdr, '', function () {
        layout.style.display = '';
      });
      // Pre-fill RF password
      var rfPass = document.getElementById('inpPass');
      if (rfPass && !rfPass.value) rfPass.value = val;

    } else {
      var zm = document.getElementById('ziraMode');
      _fadeTo(ms, zm, 'flex', function () {
        if (typeof enmInit === 'function') enmInit(val);
      });
    }
  }

  // ── Return to mode select ─────────────────────────────────────
  function msShow() {
    // Determine which mode is currently visible
    var zm = document.getElementById('ziraMode');
    var hdr = document.getElementById('hdr');
    var layout = document.getElementById('layout');
    var ms = document.getElementById('modeSelect');

    var fromEl = null;
    if (zm && zm.style.display !== 'none') {
      fromEl = zm;
    } else if (hdr && hdr.style.display !== 'none') {
      // RF mode: fade hdr out; layout will hide after
      fromEl = hdr;
    }

    // Clear password fields before showing
    ['msPassRf', 'msPassZira'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    if (fromEl) {
      _fadeTo(fromEl, ms, 'flex', function () {
        // If we came from RF, also hide layout
        if (layout) layout.style.display = 'none';
      });
    } else {
      ms.style.display = 'flex';
      ms.style.opacity = '1';
    }
  }

  // ── Keyboard handlers ─────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var rfInp = document.getElementById('msPassRf');
    var zrInp = document.getElementById('msPassZira');
    if (rfInp) rfInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') msEnter('rf'); });
    if (zrInp) zrInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') msEnter('zira'); });
  });

  // ── Exports ───────────────────────────────────────────────────
  window.msEnter = msEnter;
  window.msShow  = msShow;
})();
