const THEME = (() => {
  const LS = 'nfm_theme';

  function init() {
    const saved = localStorage.getItem(LS) || 'light';
    _apply(saved);
  }

  function toggle() {
    const cur = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    _apply(next);
    try { localStorage.setItem(LS, next); } catch(e) {}
    // Re-render charts after CSS transition completes so colors match new theme
    setTimeout(() => {
      if (typeof _activeIdx !== 'undefined' && _activeIdx >= 0 && _history[_activeIdx]) {
        _renderPrbChart(_history[_activeIdx].parsed);
        _renderPmrCharts(_history[_activeIdx].parsed);
      }
    }, 360);
  }

  function _apply(theme) {
    const html = document.documentElement;
    html.classList.toggle('dark', theme === 'dark');
    html.classList.toggle('light', theme === 'light');
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = theme === 'dark' ? 'LIGHT' : 'DARK';
  }

  return { init, toggle };
})();
