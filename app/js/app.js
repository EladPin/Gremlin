/* ═══════════════════════════════════════════════════════════════
   NF Monitor — main app
═══════════════════════════════════════════════════════════════ */

const LS_HOST = 'nfm_host';
const LS_USER = 'nfm_user';
const LS_SITE = 'nfm_site';
const SS_PASS = 'nfm_pass'; // sessionStorage — clears on tab close
const LS_HIST         = 'gremlin_history';
const LS_CUSTOM_SITES = 'gremlin_custom_sites';

let _chartPrb   = null;
let _chartIntf  = null;
let _chartQual  = null;
let _chartSinr  = null;
let _chartLoad  = null;
let _chartRrc   = null;
let _chartAvail = null;
let _chartRank  = null;
let _allPmrCharts = [];   // updated after each render for 900 toggle
let _show900    = true;
let _history    = [];   // [{site, ts, raw, parsed}]
let _activeIdx  = -1;
let _cmpEntry   = null;

const PALETTE = ['#ff5e24','#2563eb','#16a34a','#9333ea','#e8a020','#0891b2'];
const LS_SB   = 'gremlin_sb_collapsed';

// ── Crosshair sync plugin ─────────────────────────────────────
let _crosshairIdx = -1;
Chart.register({
  id: 'syncCrosshair',
  afterEvent(chart, args) {
    if (!_allPmrCharts.includes(chart)) return;
    const evt = args.event;
    if (evt.type === 'mousemove') {
      const pts = chart.getElementsAtEventForMode(evt.native, 'index', { intersect: false }, false);
      const idx = pts.length ? pts[0].index : -1;
      if (idx !== _crosshairIdx) {
        _crosshairIdx = idx;
        _allPmrCharts.forEach(c => { if (c !== chart) c.draw(); });
      }
    } else if (evt.type === 'mouseout') {
      if (_crosshairIdx !== -1) {
        _crosshairIdx = -1;
        _allPmrCharts.forEach(c => { if (c !== chart) c.draw(); });
      }
    }
  },
  afterDraw(chart) {
    if (_crosshairIdx < 0 || !_allPmrCharts.includes(chart)) return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const x = xScale.getPixelForValue(_crosshairIdx);
    if (!x || isNaN(x)) return;
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = document.documentElement.classList.contains('dark')
      ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  }
});

// ── boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  _loadPrefs();
  _loadHistory();
  _renderHistory();
  _initSidebar();
  THEME.init();
  _loadCustomSites();
  _initSiteAutocomplete();
  ['inpSite','inpHost','inpUser','inpPass'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter' && !document.getElementById('btnRun').disabled) {
        e.preventDefault(); runFetch();
      }
    });
  });
  document.getElementById('inpNewSite').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _confirmAddSite(); }
    if (e.key === 'Escape') { e.preventDefault(); _toggleAddSite(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeRawTerminal();
  });
});

// ── Site autocomplete ─────────────────────────────────────────
function _initSiteAutocomplete() {
  const inp   = document.getElementById('inpSite');
  const drop  = document.getElementById('siteDropdown');
  const row   = document.getElementById('siteCmdRow');
  const ghost = document.getElementById('siteCmdGhost');
  let _acIdx  = -1;
  let _acItems = [];

  // ── Ghost / real input toggle ──────────────────────────────
  const EXAMPLES = ['KD185','Halif_10','MMSL_1005','Biranit','Zrifin','Nafach'];
  let _exIdx = 0;

  function _setCmdActive(on) {
    row.classList.toggle('cmd-active', on || !!inp.value);
  }

  inp.addEventListener('focus', () => _setCmdActive(true));
  inp.addEventListener('blur',  () => _setCmdActive(false));

  // Cycle placeholder examples every 4s (matches animation duration)
  setInterval(() => {
    if (!row.classList.contains('cmd-active') && ghost) {
      _exIdx = (_exIdx + 1) % EXAMPLES.length;
      ghost.setAttribute('data-cmd', EXAMPLES[_exIdx]);
    }
  }, 4000);

  if (row) row.addEventListener('click', () => { _setCmdActive(true); inp.focus(); });
  if (inp.value) _setCmdActive(true);

  // ── Dropdown ───────────────────────────────────────────────
  function _open(items) {
    _acItems = items;
    _acIdx   = -1;
    drop.innerHTML = items.map((s, i) =>
      `<div class="site-dd-item" data-i="${i}">${_hlMatch(s, inp.value)}</div>`
    ).join('');
    drop.classList.toggle('open', items.length > 0);
  }

  function _close() {
    drop.classList.remove('open');
    _acIdx = -1;
  }

  function _setDdActive(idx) {
    const els = drop.querySelectorAll('.site-dd-item');
    els.forEach((el, i) => el.classList.toggle('active', i === idx));
    if (idx >= 0 && idx < els.length) els[idx].scrollIntoView({ block: 'nearest' });
    _acIdx = idx;
  }

  function _select(name) {
    inp.value = name;
    try { localStorage.setItem(LS_SITE, name); } catch(e) {}
    _setCmdActive(true);
    _close();
  }

  inp.addEventListener('input', () => {
    const q = inp.value.trim();
    if (!q || typeof ENM_SITES === 'undefined') { _close(); return; }
    const ql = q.toLowerCase();
    const matches = ENM_SITES.filter(s => s.toLowerCase().includes(ql)).slice(0, 40);
    _open(matches);
  });

  inp.addEventListener('keydown', e => {
    if (!drop.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _setDdActive(Math.min(_acIdx + 1, _acItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _setDdActive(Math.max(_acIdx - 1, 0));
    } else if (e.key === 'Enter') {
      if (_acIdx >= 0 && _acItems[_acIdx]) {
        e.stopImmediatePropagation();
        _select(_acItems[_acIdx]);
      } else {
        _close();
      }
    } else if (e.key === 'Escape') {
      _close();
    }
  });

  drop.addEventListener('mousedown', e => {
    const item = e.target.closest('.site-dd-item');
    if (!item) return;
    e.preventDefault();
    _select(_acItems[+item.dataset.i]);
  });

  document.addEventListener('click', e => {
    if (!inp.contains(e.target) && !drop.contains(e.target) && !row?.contains(e.target)) _close();
  });
}

function _focusSiteInp() {
  const row = document.getElementById('siteCmdRow');
  row?.classList.add('cmd-active');
  document.getElementById('inpSite')?.focus();
}

function _hlMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return text.slice(0, idx)
    + `<mark>${text.slice(idx, idx + query.length)}</mark>`
    + text.slice(idx + query.length);
}

function _loadPrefs() {
  document.getElementById('inpHost').value = localStorage.getItem(LS_HOST) || '10.255.160.2';
  document.getElementById('inpUser').value = localStorage.getItem(LS_USER) || 'zira';
  document.getElementById('inpSite').value = localStorage.getItem(LS_SITE) || '';
  const savedPass = sessionStorage.getItem(SS_PASS);
  if (savedPass) document.getElementById('inpPass').value = savedPass;
}

// ── run ───────────────────────────────────────────────────────
async function runFetch() {
  const host = document.getElementById('inpHost').value.trim() || '10.255.160.2';
  const user = document.getElementById('inpUser').value.trim() || 'zira';
  const pass = document.getElementById('inpPass').value;
  const site = document.getElementById('inpSite').value.trim();

  if (!site) { _status('Enter a site name', 'err'); return; }
  if (!pass)  { _status('Enter SSH password', 'err'); return; }

  try {
    localStorage.setItem(LS_HOST, host);
    localStorage.setItem(LS_USER, user);
    localStorage.setItem(LS_SITE, site);
    sessionStorage.setItem(SS_PASS, pass);
  } catch(e) {}

  const btn = document.getElementById('btnRun');
  btn.disabled = true; btn.textContent = 'Running…';
  _startProgress();
  _status(`Running on ${site}…`, 'info');
  _showLoading(`Running check on ${site}…`);

  try {
    const res = await fetch('/enm/nfmos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, user, pass, site })
    });

    let data;
    try { data = await res.json(); } catch(_) {
      _hideLoading(); _finishProgress(false); _status('Server error — could not parse response', 'err');
      btn.disabled = false; btn.textContent = '▶ Run Check'; return;
    }

    if (!res.ok || data.error) {
      _hideLoading(); _finishProgress(false); _status(data.error || `Error ${res.status}`, 'err');
      btn.disabled = false; btn.textContent = '▶ Run Check'; return;
    }

    _hideLoading(); _finishProgress(true);
    btn.disabled = false; btn.textContent = '▶ Run Check';

    if (!data.output?.trim()) {
      _status('Empty response — check host key is cached and site name is correct', 'err'); return;
    }

    const parsed = PARSER.parse(data.output);

    if (!Object.keys(parsed.avg).length && !Object.keys(parsed.prb).length) {
      _status('No NF.mos data found in output — check site name and AMOS connectivity', 'err'); return;
    }

    const entry = { site, ts: new Date(), raw: data.output, parsed, notes: '' };
    _history.unshift(entry);
    if (_history.length > 20) _history.pop();
    _activeIdx = 0;
    _renderHistory();
    _saveHistory();
    _showResult(entry);

    const pmrNote  = parsed.pmr      ? `, ${parsed.pmr.rops.length} ROPs` : '';
    const infoNote = parsed.siteInfo  ? ', site info ✓' : '';
    _status(`✓ ${site} — ${Object.keys(parsed.avg).length} cells${pmrNote}${infoNote}`, 'ok');

  } catch(e) {
    _hideLoading(); _finishProgress(false); _status(`Network error: ${e.message}`, 'err');
    btn.disabled = false; btn.textContent = '▶ Run Check';
  }
}

// ── help modal ────────────────────────────────────────────────
const HELP = {
  cards: {
    title: 'ממוצע הפרעת UL — מה הכרטיסיות מראות?',
    body: `
      <p>כל כרטיסייה מציגה את ממוצע רמת ההפרעה ב-UL עבור cell אחת, כפי שנמדדה ב-snapshot (קריאה נקודתית בזמן ריצת הסקריפט).</p>
      <p><b>PUSCH</b> = ערוץ הנתונים. <b>PUCCH</b> = ערוץ הבקרה (ACK/NACK, CQI). הפרש גדול בין השניים עשוי להצביע על מפריע סלקטיבי בתדר.</p>
      <ul>
        <li><span class="help-good">ירוק — מתחת לـ110– dBm</span>: רמת רעש נורמלית, אין בעיה</li>
        <li><span class="help-warn">צהוב — בין 110– לـ100– dBm</span>: רעש מורגש, כדאי לעקוב</li>
        <li><span class="help-bad">אדום — מעל 100– dBm</span>: הפרעה גבוהה, דורש בדיקה</li>
      </ul>
      <p>ערך יחיד זה לא מספר את כל הסיפור — השתמש בגרפי ה-ROP למטה כדי לראות אם הרעש קבוע או משתנה לאורך זמן.</p>
    `
  },
  prb: {
    title: 'הפרעה לפי PRB — מה הגרף הזה מראה?',
    body: `
      <p>כל PRB (Resource Block) הוא "פרוסה" של ספקטרום בתדר ה-UL. הגרף מראה את רמת הרעש הנמדדת בכל פרוסה בנפרד, בזמן נקודתי (snapshot).</p>
      <ul>
        <li><span class="help-good">טוב</span> — מתחת לـ110– dBm: רמת רעש נמוכה, הספקטרום נקי</li>
        <li><span class="help-warn">בינוני</span> — בין 110– לـ100– dBm: רעש מורגש, עשוי לפגוע בקצה הכיסוי</li>
        <li><span class="help-bad">רע</span> — מעל 100– dBm: רעש גבוה, ה-UE צריך להגביר הספק כדי להתגבר עליו</li>
      </ul>
      <p>שים לב לאם הרעש <b>שטוח</b> (רעש תרמי / אנטנה) או <b>ריכוזי בטווח PRBים מסוים</b> — טווח ריכוזי יכול להצביע על מפריע חיצוני (scrambler, פאזל תדרים).</p>
    `
  },
  intf: {
    title: 'עוצמת הפרעת UL לאורך זמן — מה הגרף הזה מראה?',
    body: `
      <p>הגרף מציג את ממוצע רמת ההפרעה ב-UL בכל ROP של 15 דקות. קו מלא = PUSCH (ערוץ הנתונים), קו מקווקו = PUCCH (ערוץ הבקרה).</p>
      <ul>
        <li><span class="help-good">טוב</span> — מתחת לـ110– dBm: רעש רקע תקין</li>
        <li><span class="help-warn">בינוני</span> — בין 110– לـ100– dBm: כדאי לעקוב, ייתכן מפריע לסירוגין</li>
        <li><span class="help-bad">רע</span> — מעל 100– dBm: הפרעה פעילה, UEים בשולי הכיסוי יסבלו</li>
      </ul>
      <p>אם רמת ה-PUCCH <b>גבוהה מה-PUSCH</b> — ייתכן מפריע ספציפי לתחום הבקרה. אם שתיהן עולות יחד זה לרוב מפריע רחב-סרט.</p>
      <p>חפש <b>קפיצות בשעות ספציפיות</b> — מפריע שמופעל בשעות עבודה, למשל מנוע תעשייתי, יראה מחזוריות.</p>
    `
  },
  qual: {
    title: 'איכות UL — BLER ו-DTX — מה הגרף הזה מראה?',
    body: `
      <p><b>BLER (Block Error Rate)</b> — אחוז בלוקי נתונים שנכשלו בשידור ראשון. גבוה = ה-UE מתקשה לשדר, ה-eNB מבקש retransmissions.</p>
      <p><b>DTX Rate</b> — אחוז ה-slots שבהם ה-eNB ציפה לשידור מה-UE אבל לא קיבל כלום. ערך גבוה מאוד (מעל 80–90%) יכול להצביע על כך שהאנטנה לא "שומעת" את ה-UE.</p>
      <ul>
        <li><span class="help-good">BLER תקין</span> — מתחת לـ10%: ה-link בריא</li>
        <li><span class="help-warn">BLER בינוני</span> — 10%–30%: LTE יכול להתמודד אבל ה-throughput נפגע</li>
        <li><span class="help-bad">BLER גבוה</span> — מעל 30%: בעיה חמורה, ה-UE מאבד פקטות רבות</li>
      </ul>
      <p>BLER גבוה + הפרעה גבוהה = כמעט בטוח שהרעש הוא הגורם. BLER גבוה בלי הפרעה גבוהה = בדוק כיסוי / הספק שידור של ה-UE.</p>
    `
  },
  sinr: {
    title: 'SINR — יחס איתות לרעש — מה הגרף הזה מראה?',
    body: `
      <p>SINR מראה כמה "חזק" האות של ה-UE ביחס לרעש הכולל. זה הפרמטר הכי ישיר לאיכות ה-link.</p>
      <ul>
        <li><span class="help-good">טוב</span> — מעל 5 dB: ה-UE נשמע טוב, מסוגל להשתמש ב-MCS גבוה</li>
        <li><span class="help-warn">בינוני</span> — בין 0 לـ5 dB: מצב שולי, אפשרי אבל עם הגבלות</li>
        <li><span class="help-bad">רע</span> — מתחת לـ0 dB: האות חלש מהרעש, ה-UE מתקשה מאוד לשדר</li>
      </ul>
      <p>אם ה-SINR נמוך אבל רמת ההפרעה <b>תקינה</b> — הבעיה היא כיסוי חלש (UE רחוק). אם ה-SINR נמוך <b>וגם</b> ההפרעה גבוהה — הרעש הוא הגורם המרכזי.</p>
    `
  },
  load: {
    title: 'עומס UL / DL — שימוש ב-PRBים — מה הגרף הזה מראה?',
    body: `
      <p>אחוז ה-PRBים ב-UL (קו מלא) וב-DL (קו מקווקו) שבשימוש פעיל בכל ROP. מראה כמה ה-cell עמוסה בפועל.</p>
      <ul>
        <li><span class="help-good">עומס נמוך</span> — מתחת לـ30%: ה-cell לא עמוסה</li>
        <li><span class="help-warn">עומס בינוני</span> — 30%–70%: טווח תקין לרוב האתרים</li>
        <li><span class="help-bad">עומס גבוה</span> — מעל 70%: ה-cell עמוסה; בשילוב עם הפרעה גבוהה — המצב קשה במיוחד</li>
      </ul>
      <p><b>הקשר להפרעה:</b> עומס גבוה + הפרעה גבוהה = UEים מגבירים הספק כדי להתחרות ברעש, מה שמגביר עוד יותר את ההפרעה לשכניהם (interference rise). עומס נמוך + הפרעה גבוהה = ההפרעה היא כנראה חיצונית.</p>
    `
  },
  rrc: {
    title: 'RRC Setup Success Rate — מה הגרף הזה מראה?',
    body: `
      <p>אחוז ה-UEים שהצליחו לבצע RRC Connection Setup (התחברות לרדיו) מתוך כלל הניסיונות בכל ROP.</p>
      <ul>
        <li><span class="help-good">תקין</span> — מעל 95%: נגישות תקינה לרשת</li>
        <li><span class="help-warn">בינוני</span> — 85%–95%: בעיות נגישות, ייתכן עומס יתר או הפרעה</li>
        <li><span class="help-bad">גרוע</span> — מתחת לـ85%: בעיית נגישות חמורה — UEים לא מצליחים להתחבר</li>
      </ul>
      <p>ירידה חדה ב-RRC Success בצמוד לעלייה בהפרעה היא הוכחה ישירה לכך שהרעש פוגע בנגישות. אם ה-BLER גבוה בו זמנית — מדובר בבעיה כוללת ב-link budget.</p>
    `
  },
  avail: {
    title: 'Cell Availability — זמן השבתה — מה הגרף הזה מראה?',
    body: `
      <p>מספר הדקות שבהן ה-cell הייתה מושבתת (DISABLED) בכל ROP של 15 דקות. הגרף מוצג רק כשיש השבתה כלשהי.</p>
      <ul>
        <li><span class="help-good">תקין</span> — 0: ה-cell פעילה לאורך כל הזמן</li>
        <li><span class="help-warn">בינוני</span> — 1–5 דקות: ייתכן ריסטארט חלקי או תקלה חולפת</li>
        <li><span class="help-bad">גרוע</span> — מעל 5 דקות: השבתה ממשית שמשפיעה על KPIs של אותו ROP</li>
      </ul>
      <p>חשוב: אם ה-cell הייתה מושבתת בחלק מה-ROP, כל שאר ה-KPIs של אותו ROP (BLER, SINR וכו') משקפים רק את הזמן שבו הייתה פעילה — לא בהכרח ייצוגיים.</p>
    `
  },
  rank: {
    title: 'DL TX Rank Distribution — ניצול MIMO — מה הגרף הזה מראה?',
    body: `
      <p>מראה כמה אחוז מה-subframes שודרו ב-Rank 1 (קו מלא, אנטנה בודדת / SISO) לעומת Rank 2 (קו מקווקו, שידור כפול / MIMO) עבור כל cell.</p>
      <ul>
        <li><span class="help-good">Rank 2 גבוה</span> — מעל 70%: UEים קרובים עם אות חזק, מנצלים MIMO ביעילות</li>
        <li><span class="help-warn">מעורב</span> — Rank 1 ו-2 דומים: אוכלוסיית UE מגוונת מבחינת מרחק / CQI</li>
        <li><span class="help-bad">Rank 1 גבוה</span> — מעל 70%: UEים רחוקים, אות חלש, לא ניתן להשתמש ב-MIMO</li>
      </ul>
      <p>עלייה ב-Rank 1 בצמוד לעלייה בהפרעה מאשרת שהרעש פוגע בקו הרדיו: ה-eNB נאלץ לעבור ל-SISO כי ה-CQI ירד מספיק כדי שלא יהיה כדאי לשדר בשני streams.</p>
    `
  }
};

function showHelp(key) {
  const h = HELP[key];
  document.getElementById('helpTitle').textContent = h.title;
  document.getElementById('helpBody').innerHTML = h.body;
  document.getElementById('helpOverlay').classList.add('open');
}
function closeHelp() {
  document.getElementById('helpOverlay').classList.remove('open');
}

// ── loading overlay ───────────────────────────────────────────
function _showLoading(msg) {
  document.getElementById('loMsg').textContent = msg;
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function _hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

// ── display ───────────────────────────────────────────────────
function _showResult(entry) {
  const { site, ts, raw, parsed } = entry;

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('siteHeader').style.display = 'flex';
  document.getElementById('siteName').textContent = site.toUpperCase();
  document.getElementById('siteTimestamp').textContent = _fmt(ts);
  document.getElementById('btnSiteInfo').style.display = '';
  document.getElementById('btnExport').style.display = '';

  const cmpParsed = (_cmpEntry && _cmpEntry !== entry) ? _cmpEntry.parsed : null;
  const banner = document.getElementById('cmpBanner');
  if (cmpParsed) {
    document.getElementById('cmpBannerText').textContent =
      `Comparing with: ${_cmpEntry.site.toUpperCase()} — ${_fmt(_cmpEntry.ts)}`;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }

  _renderNotes(entry);
  _renderSummary(parsed, cmpParsed);
  _renderSiteInfo(parsed);
  _renderDiagnosis(parsed);
  _renderPrbChart(parsed);
  _renderPmrCharts(parsed, cmpParsed);

  document.getElementById('rawPre').textContent = raw;
  document.getElementById('rawSection').style.display = 'block';
}

// ── summary cards ─────────────────────────────────────────────
function _renderSummary(parsed, parsedCmp) {
  const sec  = document.getElementById('summarySection');
  const wrap = document.getElementById('summaryCards');
  const mainCells = Object.keys(parsed.avg).filter(k => !k.includes('pucch'));
  if (!mainCells.length) { sec.style.display = 'none'; return; }

  wrap.innerHTML = mainCells.map((cell, i) => {
    const val   = parsed.avg[cell];
    const pucch = parsed.avg[cell + ' pucch'];
    const cls   = val >= -100 ? 'bad' : val >= -110 ? 'warn' : 'good';
    const dot   = PALETTE[i % PALETTE.length];
    const pucchHtml = pucch != null
      ? `<div class="sum-card-pucch">PUCCH: ${pucch.toFixed(1)} dBm</div>` : '';
    let cmpHtml = '';
    if (parsedCmp) {
      const cmpVal = parsedCmp.avg[cell];
      if (cmpVal != null) {
        const delta = val - cmpVal;
        const better = delta < 0;
        cmpHtml = `<div class="sum-card-cmp ${better ? 'cmp-better' : 'cmp-worse'}">${better ? '▼' : '▲'} ${Math.abs(delta).toFixed(1)} dB vs prev</div>`;
      }
    }
    return `
      <div class="sum-card">
        <div class="sum-card-name">
          <span class="sum-card-dot" style="background:${dot}"></span>${_fmtCell(cell)}
        </div>
        <div class="sum-card-val ${cls}">${val.toFixed(1)}<span class="sum-card-unit">dBm</span></div>
        ${pucchHtml}${cmpHtml}
      </div>`;
  }).join('');

  sec.style.display = 'block';
}

// ── PRB interference chart ────────────────────────────────────
function _renderPrbChart(parsed) {
  const sec   = document.getElementById('chartSection');
  const cells = Object.keys(parsed.prb);
  if (!cells.length) { sec.style.display = 'none'; return; }

  const maxPrb = Math.max(...cells.map(c => parsed.prb[c].length));
  const labels = Array.from({ length: maxPrb }, (_, i) => i + 1);
  const { grid, tick, legend } = _themeColors();

  const datasets = cells.map((cell, i) => ({
    label: cell,
    data: parsed.prb[cell],
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length] + '18',
    borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4,
    tension: 0.2, fill: false, spanGaps: true,
  }));

  if (_chartPrb) { _chartPrb.destroy(); _chartPrb = null; }
  _chartPrb = _makeLineChart('prbChart', labels, datasets, {
    xTitle: 'PRB', yTitle: 'Interference (dBm)',
    tooltipSuffix: ' dBm', grid, tick, legend,
  });
  sec.style.display = 'block';
}

// ── PMR time-series charts ────────────────────────────────────
function _renderPmrCharts(parsed, parsedCmp) {
  const pmr = parsed.pmr;
  const sec  = document.getElementById('pmrSection');

  if (!pmr) { sec.style.display = 'none'; return; }

  const { rops, cells, data, date } = pmr;
  const pmrCmp = parsedCmp?.pmr || null;
  const { grid, tick, legend } = _themeColors();

  document.getElementById('pmrDateLabel').textContent =
    `${date}  —  ${rops[0]} to ${rops[rops.length - 1]}  (${rops.length} ROPs × 15 min)`;

  // Chart 1: Interference power (dBm) — PUSCH + PUCCH per cell
  if (_chartIntf) { _chartIntf.destroy(); _chartIntf = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const pusch = data['Int_RadioRecInterferencePwr']?.[cell];
      const pucch = data['Int_RadioRecInterferencePucchPwr']?.[cell];
      if (pusch?.some(v => v !== null))
        ds.push({ label: cell, data: pusch, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
      if (pucch?.some(v => v !== null))
        ds.push({ label: cell + ' pucch', data: pucch, borderColor: color, backgroundColor: color+'10',
                  borderWidth: 1, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 4,
                  tension: 0.2, fill: false, spanGaps: true });
    });
    if (pmrCmp) cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const pusch = pmrCmp.data['Int_RadioRecInterferencePwr']?.[cell];
      if (pusch?.some(v => v !== null))
        ds.push({ label: cell + ' prev', data: pusch, borderColor: _hexAlpha(color, 0.4),
                  backgroundColor: 'transparent', borderWidth: 1, borderDash: [7, 4],
                  pointRadius: 0, pointHoverRadius: 3, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartIntf = _makeLineChart('intfChart', rops, ds, {
      xTitle: 'ROP', yTitle: 'dBm', tooltipSuffix: ' dBm', grid, tick, legend,
    });
  }

  // Chart 2: UL quality — BLER% + DTX Rate%
  if (_chartQual) { _chartQual.destroy(); _chartQual = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const bler  = data['Int_MacHarqUlBler']?.[cell];
      const dtx   = data['Int_MacHarqUlDtxRate']?.[cell];
      if (bler?.some(v => v !== null))
        ds.push({ label: cell + ' BLER', data: bler, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
      if (dtx?.some(v => v !== null))
        ds.push({ label: cell + ' DTX', data: dtx, borderColor: color, backgroundColor: color+'10',
                  borderWidth: 1, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 4,
                  tension: 0.2, fill: false, spanGaps: true });
    });
    if (pmrCmp) cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const bler = pmrCmp.data['Int_MacHarqUlBler']?.[cell];
      if (bler?.some(v => v !== null))
        ds.push({ label: cell + ' BLER prev', data: bler, borderColor: _hexAlpha(color, 0.4),
                  backgroundColor: 'transparent', borderWidth: 1, borderDash: [7, 4],
                  pointRadius: 0, pointHoverRadius: 3, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartQual = _makeLineChart('qualChart', rops, ds, {
      xTitle: 'ROP', yTitle: '%', tooltipSuffix: '%', grid, tick, legend,
    });
  }

  // Chart 3: SINR (how well UEs can "hear" through the noise)
  if (_chartSinr) { _chartSinr.destroy(); _chartSinr = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const sinr  = data['Int_SinrPuschDistr']?.[cell];
      if (sinr?.some(v => v !== null))
        ds.push({ label: cell, data: sinr, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
    });
    if (pmrCmp) cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const sinr = pmrCmp.data['Int_SinrPuschDistr']?.[cell];
      if (sinr?.some(v => v !== null))
        ds.push({ label: cell + ' prev', data: sinr, borderColor: _hexAlpha(color, 0.4),
                  backgroundColor: 'transparent', borderWidth: 1, borderDash: [7, 4],
                  pointRadius: 0, pointHoverRadius: 3, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartSinr = _makeLineChart('sinrChart', rops, ds, {
      xTitle: 'ROP', yTitle: 'dB', tooltipSuffix: ' dB', grid, tick, legend,
    });
  }

  // Chart 4: UL + DL PRB usage
  if (_chartLoad) { _chartLoad.destroy(); _chartLoad = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const ul    = data['Res_UlPrbPercUsage']?.[cell];
      const dl    = data['Res_DlPrbPercUsage']?.[cell];
      if (ul?.some(v => v !== null))
        ds.push({ label: cell, data: ul, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
      if (dl?.some(v => v !== null))
        ds.push({ label: cell + ' DL', data: dl, borderColor: color, backgroundColor: color+'10',
                  borderWidth: 1, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 4,
                  tension: 0.2, fill: false, spanGaps: true });
    });
    if (pmrCmp) cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const ul = pmrCmp.data['Res_UlPrbPercUsage']?.[cell];
      if (ul?.some(v => v !== null))
        ds.push({ label: cell + ' prev', data: ul, borderColor: _hexAlpha(color, 0.4),
                  backgroundColor: 'transparent', borderWidth: 1, borderDash: [7, 4],
                  pointRadius: 0, pointHoverRadius: 3, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartLoad = _makeLineChart('loadChart', rops, ds, {
      xTitle: 'ROP', yTitle: '%', tooltipSuffix: '%', grid, tick, legend,
    });
  }

  // Chart 5: RRC Setup Success Rate %
  if (_chartRrc) { _chartRrc.destroy(); _chartRrc = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const rrc   = data['Acc_RrcConnSetupSuccRate']?.[cell];
      if (rrc?.some(v => v !== null))
        ds.push({ label: cell, data: rrc, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
    });
    if (pmrCmp) cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const rrc = pmrCmp.data['Acc_RrcConnSetupSuccRate']?.[cell];
      if (rrc?.some(v => v !== null))
        ds.push({ label: cell + ' prev', data: rrc, borderColor: _hexAlpha(color, 0.4),
                  backgroundColor: 'transparent', borderWidth: 1, borderDash: [7, 4],
                  pointRadius: 0, pointHoverRadius: 3, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartRrc = _makeLineChart('rrcChart', rops, ds, {
      xTitle: 'ROP', yTitle: '%', tooltipSuffix: '%', grid, tick, legend,
    });
  }

  // Chart 6: Cell downtime per ROP (show only if any cell had downtime)
  if (_chartAvail) { _chartAvail.destroy(); _chartAvail = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const down  = data['Av_CellDownAuto']?.[cell];
      if (down?.some(v => v !== null && v > 0))
        ds.push({ label: cell, data: down, borderColor: color, backgroundColor: color+'30',
                  borderWidth: 1.5, pointRadius: 3, pointHoverRadius: 5, tension: 0.2, fill: true, spanGaps: true });
    });
    const availWrap = document.getElementById('availWrap');
    if (ds.length) {
      _chartAvail = _makeLineChart('availChart', rops, ds, {
        xTitle: 'ROP', yTitle: 'min', tooltipSuffix: ' min', grid, tick, legend,
      });
      availWrap.style.display = '';
    } else {
      availWrap.style.display = 'none';
    }
  }

  // Chart 7: DL TX Rank 1% (solid) + Rank 2% (dashed)
  if (_chartRank) { _chartRank.destroy(); _chartRank = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const r1    = data['Drv_DlRank1Pct']?.[cell];
      const r2    = data['Drv_DlRank2Pct']?.[cell];
      if (r1?.some(v => v !== null))
        ds.push({ label: cell + ' R1', data: r1, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
      if (r2?.some(v => v !== null))
        ds.push({ label: cell + ' R2', data: r2, borderColor: color, backgroundColor: color+'10',
                  borderWidth: 1, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 4,
                  tension: 0.2, fill: false, spanGaps: true });
    });
    if (pmrCmp) cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const r1 = pmrCmp.data['Drv_DlRank1Pct']?.[cell];
      if (r1?.some(v => v !== null))
        ds.push({ label: cell + ' R1 prev', data: r1, borderColor: _hexAlpha(color, 0.4),
                  backgroundColor: 'transparent', borderWidth: 1, borderDash: [7, 4],
                  pointRadius: 0, pointHoverRadius: 3, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartRank = _makeLineChart('rankChart', rops, ds, {
      xTitle: 'ROP', yTitle: '%', tooltipSuffix: '%', grid, tick, legend,
    });
  }

  _allPmrCharts = [_chartIntf, _chartQual, _chartSinr, _chartLoad, _chartRrc, _chartAvail, _chartRank].filter(Boolean);

  // Restore 900MHz visibility state after re-render
  if (!_show900) {
    _allPmrCharts.forEach(chart => {
      chart.data.datasets.forEach((ds, i) => {
        if (!/_900\b/.test(ds.label || '')) return;
        chart.getDatasetMeta(i).hidden = true;
        const cb = document.getElementById(`cb-${chart.canvas.id}-${i}`);
        if (cb) cb.checked = true;
      });
      chart.update();
    });
  }

  sec.style.display = 'block';
}

// ── 900 MHz toggle ────────────────────────────────────────────
function toggle900() {
  _show900 = !_show900;
  const btn = document.getElementById('btn900');
  btn.textContent = _show900 ? '900 MHz ✓' : '900 MHz ✗';
  btn.classList.toggle('btn-900-off', !_show900);

  _allPmrCharts.forEach(chart => {
    if (!chart) return;
    chart.data.datasets.forEach((ds, i) => {
      if (!/_900\b/.test(ds.label || '')) return;
      chart.getDatasetMeta(i).hidden = !_show900;
      const cb = document.getElementById(`cb-${chart.canvas.id}-${i}`);
      if (cb) cb.checked = !_show900;
    });
    chart.update();
  });
}

// ── Auto-diagnosis engine ─────────────────────────────────────
function _diagnose(parsed) {
  const issues = [];
  const push = (sev, cell, title, body, chartId) => issues.push({ sev, cell, title, body, chartId: chartId || null });

  const { avg, prb, pmr } = parsed;

  // — Snapshot: PUSCH–PUCCH gap (selective interference) ——
  Object.keys(avg).filter(k => !k.includes('pucch')).forEach(cell => {
    const pusch = avg[cell];
    const pucch = avg[cell + ' pucch'];
    if (pusch == null || pucch == null) return;
    const gap = Math.abs(pusch - pucch);
    if (gap > 5)
      push('warning', cell, `פער PUSCH/PUCCH: ${gap.toFixed(1)} dB`,
        `ב-<b>${cell}</b> קיים פער של ${gap.toFixed(1)} dB בין ערוץ הנתונים (PUSCH = ${pusch.toFixed(1)}) לערוץ הבקרה (PUCCH = ${pucch.toFixed(1)}). פער גדול מרמז על <b>מפריע סלקטיבי-תדר</b> — ממוקד בחלק מה-PRBים בלבד. בדוק את גרף ה-PRB כדי לאתר את הטווח הבעייתי.`,
        'intfChart');
  });

  // — Snapshot: PRB pattern (flat vs selective) ———————
  Object.entries(prb).forEach(([cell, vals]) => {
    const clean = vals.filter(v => v !== null);
    if (clean.length < 5) return;
    const mn = Math.min(...clean), mx = Math.max(...clean), spread = mx - mn;
    if (spread > 10 && mx > -105)
      push('warning', cell, `הפרעה סלקטיבית ב-PRBים: ${spread.toFixed(1)} dB spread`,
        `הרעש ב-<b>${cell}</b> אינו אחיד — טווח של ${spread.toFixed(1)} dB בין ה-PRB הנקי ביותר (${mn.toFixed(1)}) לרועש ביותר (${mx.toFixed(1)}). מפיזור כזה ניתן להסיק שיש <b>מפריע ריכוזי</b> בתדר. בדוק באיזה EARFCN / PRB מתרכזת השיא.`,
        'prbChart');
  });

  if (pmr) {
    const { cells, data, rops } = pmr;

    cells.forEach(cell => {
      const get = key => (data[key]?.[cell] || []).filter(v => v !== null);

      // — BLER ————————————————————————————————————————
      const blers = get('Int_MacHarqUlBler');
      if (blers.length) {
        const mx = Math.max(...blers), avg_ = blers.reduce((a,b)=>a+b,0)/blers.length;
        if (mx >= 30)
          push('critical', cell, `UL BLER גבוה: שיא ${mx.toFixed(1)}%, ממוצע ${avg_.toFixed(1)}%`,
            `BLER מעל 30% ב-<b>${cell}</b> — ה-eNB מבקש retransmissions תכופות מאוד. בשילוב עם הפרעה גבוהה כמעט בוודאי שהרעש הוא הגורם. HARQ יכול להתמודד עם עד ~10% BLER — מעל זה ה-throughput נחתך משמעותית ו-latency עולה חדות.`,
            'qualChart');
        else if (mx >= 15)
          push('warning', cell, `UL BLER מוגבר: שיא ${mx.toFixed(1)}%`,
            `BLER בין 15%-30% ב-<b>${cell}</b> — LTE מתמודד אך ה-throughput נפגע. אם המגמה עולה לאורך הזמן ייתכן מפריע מתגבר.`,
            'qualChart');
      }

      // — DTX ————————————————————————————————————————
      const dtxs = get('Int_MacHarqUlDtxRate');
      if (dtxs.length) {
        const mx = Math.max(...dtxs);
        if (mx >= 70)
          push('critical', cell, `DTX Rate גבוה מאוד: שיא ${mx.toFixed(1)}%`,
            `DTX מעל 70% ב-<b>${cell}</b>: ה-eNB ציפה לנתונים אבל לא קיבל כלום ברוב ה-slots. סיבות אפשריות: כיסוי קיצוני (UE רחוק מאוד), הפרעה שמונעת מה-UE לשדר, או UE שנשמט בין ה-grants.`,
            'qualChart');
        else if (mx >= 50)
          push('warning', cell, `DTX Rate מוגבר: שיא ${mx.toFixed(1)}%`,
            `DTX מעל 50% ב-<b>${cell}</b> — חלק ניכר מה-slots ריקים. ייתכן כיסוי שולי, UE עם סוללה חלשה שנכנס ל-Power Saving, או הפרעה חולפת.`,
            'qualChart');
      }

      // — SINR ———————————————————————————————————————
      const sinrs = get('Int_SinrPuschDistr');
      if (sinrs.length) {
        const mn = Math.min(...sinrs);
        if (mn < 0)
          push('critical', cell, `SINR שלילי: מינימום ${mn.toFixed(1)} dB`,
            `SINR מתחת ל-0 dB ב-<b>${cell}</b> — רמת הרעש <b>גבוהה מעוצמת האות</b>. ה-UE מתקשה קשות לשדר. זה ישירות מוביל ל-BLER גבוה, throughput נמוך, ובמקרים קיצוניים — נפילת חיבור.`,
            'sinrChart');
        else if (mn < 3)
          push('warning', cell, `SINR שולי: מינימום ${mn.toFixed(1)} dB`,
            `SINR בין 0 ל-3 dB ב-<b>${cell}</b> — מצב שולי. ה-MCS (מודולציה) ייבחר נמוך ו-throughput יוגבל. UEים בשולי הכיסוי יורגשו.`,
            'sinrChart');
      }

      // — RRC Success Rate ——————————————————————————
      const rrcs = get('Acc_RrcConnSetupSuccRate');
      if (rrcs.length) {
        const mn = Math.min(...rrcs);
        if (mn < 85)
          push('critical', cell, `RRC Setup Rate נמוך: ${mn.toFixed(1)}%`,
            `פחות מ-85% מהניסיונות להתחבר לרדיו הצליחו ב-<b>${cell}</b>. בעיית נגישות חמורה — UEים לא מצליחים לבסס חיבור. סיבות: הפרעה גבוהה, עומס גבוה, בעיה בציוד, או cell שהייתה מושבתת.`,
            'rrcChart');
        else if (mn < 95)
          push('warning', cell, `RRC Setup Rate: ${mn.toFixed(1)}%`,
            `RRC Success מתחת ל-95% ב-<b>${cell}</b> — נגישות פחות מאידיאלית. ייתכן עומס זמני, הפרעה חולפת, או ירידה בביצועי הציוד.`,
            'rrcChart');
      }

      // — Cell downtime ——————————————————————————————
      const downs = data['Av_CellDownAuto']?.[cell] || [];
      const total = downs.reduce((a,b)=>a+(b||0),0);
      if (total > 0) {
        const firstRop = rops[downs.findIndex(v => v > 0)] || '?';
        push('warning', cell, `השבתה: ${total.toFixed(0)} דקות (החל מ-${firstRop})`,
          `ה-cell <b>${cell}</b> הייתה מושבתת ${total.toFixed(0)} דקות בסה"כ. KPIs מ-ROPים אלה (BLER, SINR, RRC) אינם ייצוגיים לפעילות תקינה — הם מבוססים על זמן פעילות חלקי בלבד.`,
          'availChart');
      }
    });
  }

  return issues;
}

function _renderDiagnosis(parsed) {
  const sec    = document.getElementById('diagnosisSection');
  const issues = _diagnose(parsed);

  const _termHead = (extra = '') => `
    <div class="diag-term-head">
      <span class="diag-term-dots">
        <span class="diag-dot d-red"></span>
        <span class="diag-dot d-ylw"></span>
        <span class="diag-dot d-grn"></span>
      </span>
      <span class="diag-term-title">auto diagnosis</span>
      ${extra}
    </div>`;

  if (!issues.length) {
    sec.innerHTML = `
      <div class="diag-term-card">
        ${_termHead()}
        <div class="diag-term-body">
          <div class="diag-all-ok">
            <span class="diag-ok-icon">✓</span>
            <div>
              <div class="diag-ok-title">הכל תקין</div>
              <div class="diag-ok-sub">לא נמצאו חריגות משמעותיות — רמות הפרעה, BLER, SINR ו-RRC בטווח תקין.</div>
            </div>
          </div>
        </div>
      </div>`;
    sec.style.display = 'block';
    return;
  }

  const critCount = issues.filter(i => i.sev === 'critical').length;
  const warnCount = issues.filter(i => i.sev === 'warning').length;
  const summary   = [
    critCount ? `<span class="diag-count critical">${critCount} קריטי</span>` : '',
    warnCount ? `<span class="diag-count warning">${warnCount} אזהרה</span>` : '',
  ].filter(Boolean).join(' ');

  const cards = issues.map((iss, idx) => `
    <div class="diag-card diag-${iss.sev}" onclick="_diagToggle(${idx})">
      <div class="diag-card-top">
        <span class="diag-sev-dot"></span>
        <span class="diag-cell-tag">${_esc(iss.cell)}</span>
        <span class="diag-card-title">${iss.title}</span>
        ${iss.chartId ? `<button class="diag-jump-btn" title="עבור לגרף" onclick="event.stopPropagation();_jumpToChart('${iss.chartId}')">↓ גרף</button>` : ''}
        <span class="diag-chevron" id="diag-chev-${idx}">▸</span>
      </div>
      <div class="diag-card-body" id="diag-body-${idx}">${iss.body}</div>
    </div>`).join('');

  sec.innerHTML = `
    <div class="diag-term-card">
      ${_termHead(`<div style="margin-left:auto;display:flex;gap:6px;align-items:center">${summary}</div>`)}
      <div class="diag-term-body">
        <div class="diag-list">${cards}</div>
      </div>
    </div>`;
  sec.style.display = 'block';
}

// ── Custom site list ──────────────────────────────────────────
function _loadCustomSites() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_SITES);
    if (!raw) return;
    const names = JSON.parse(raw);
    if (!Array.isArray(names) || typeof ENM_SITES === 'undefined') return;
    names.forEach(n => { if (!ENM_SITES.includes(n)) ENM_SITES.push(n); });
    ENM_SITES.sort();
  } catch(e) {}
}

function _toggleAddSite() {
  const row  = document.getElementById('siteAddRow');
  const open = row.classList.toggle('open');
  if (open) {
    _renderCustomSitesList();
    document.getElementById('inpNewSite').focus();
  }
}

function _confirmAddSite() {
  const inp  = document.getElementById('inpNewSite');
  const name = inp.value.trim();
  if (!name) { _toggleAddSite(); return; }

  if (typeof ENM_SITES !== 'undefined' && !ENM_SITES.includes(name)) {
    ENM_SITES.push(name);
    ENM_SITES.sort();
  }
  try {
    const raw  = localStorage.getItem(LS_CUSTOM_SITES);
    const list = raw ? JSON.parse(raw) : [];
    if (!list.includes(name)) { list.push(name); localStorage.setItem(LS_CUSTOM_SITES, JSON.stringify(list)); }
  } catch(e) {}

  inp.value = '';
  _renderCustomSitesList();
  _status(`"${name}" added to site list`, 'ok');
}

function _removeCustomSite(name) {
  if (typeof ENM_SITES !== 'undefined') {
    const i = ENM_SITES.indexOf(name);
    if (i > -1) ENM_SITES.splice(i, 1);
  }
  try {
    const raw  = localStorage.getItem(LS_CUSTOM_SITES);
    const list = raw ? JSON.parse(raw) : [];
    localStorage.setItem(LS_CUSTOM_SITES, JSON.stringify(list.filter(n => n !== name)));
  } catch(e) {}
  _renderCustomSitesList();
}

function _renderCustomSitesList() {
  const el = document.getElementById('siteCustomList');
  if (!el) return;
  let list = [];
  try {
    const raw = localStorage.getItem(LS_CUSTOM_SITES);
    list = raw ? JSON.parse(raw) : [];
  } catch(e) {}
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(n =>
    `<div class="site-custom-item">
       <code class="site-term-ps1">~&nbsp;</code>
       <span class="site-custom-name">${_esc(n)}</span>
       <button class="site-custom-del" onclick="_removeCustomSite('${_esc(n).replace(/'/g,"\\'")}')">×</button>
     </div>`
  ).join('');
}

function _diagToggle(idx) {
  const body = document.getElementById(`diag-body-${idx}`);
  const chev = document.getElementById(`diag-chev-${idx}`);
  const open = body.classList.toggle('open');
  chev.textContent = open ? '▾' : '▸';
}

function _jumpToChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.closest('.chart-wrap') || canvas.parentElement;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  wrap.classList.add('chart-flash');
  setTimeout(() => wrap.classList.remove('chart-flash'), 900);
}

// ── Site info modal ───────────────────────────────────────────
function _renderSiteInfo(parsed) {
  const si = parsed.siteInfo;
  if (!si) {
    document.getElementById('siteInfoBody').innerHTML =
      '<p style="color:var(--txt3);font-family:var(--mono);font-size:12px;padding:8px 0">No site data — st cell / get . earfcn / crsgain / maxtxpower output not found in this capture.</p>';
    return;
  }

  const rows = Object.entries(si).filter(([cell]) => !cell.startsWith('__')).map(([cell, d]) => {
    const up   = d.opState  === 'ENABLED';
    const lock = d.admState === 'UNLOCKED';
    const badge = (up && lock)
      ? `<span class="si-badge si-badge-ok">✓ UP</span>`
      : `<span class="si-badge si-badge-err">✗ ${d.opState || '?'}</span>`;
    const bwNum   = parseFloat(d.bandwidth);
    const bwDisp  = d.bandwidth && !isNaN(bwNum) ? (bwNum / 1000).toFixed(0) + ' MHz' : (d.bandwidth || '—');
    const crsNum  = parseFloat(d.crsGain);
    const crsDisp = d.crsGain != null && !isNaN(crsNum) ? (crsNum / 100).toFixed(2) + ' dB' : (d.crsGain != null ? d.crsGain : '—');
    const ue      = d.ueCount != null ? d.ueCount : '—';
    return `<tr>
      <td class="si-cell-name">${_esc(cell)}</td>
      <td>${badge}</td>
      <td>${_esc(d.earfcn || '—')}</td>
      <td>${_esc(bwDisp)}</td>
      <td>${_esc(crsDisp)}</td>
      <td>${_esc(String(ue))}</td>
    </tr>`;
  }).join('');

  document.getElementById('siteInfoBody').innerHTML = `
    <table class="si-table">
      <thead><tr>
        <th>Cell</th><th>Status</th><th>EARFCN</th><th>BW</th>
        <th>CRS Gain</th><th>UEs (admitted)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function showSiteInfo() {
  const site = document.getElementById('siteName').textContent;
  document.getElementById('siteInfoTitle').textContent = site + ' — Site Information';
  document.getElementById('siteInfoOverlay').classList.add('open');
}
function closeSiteInfo() {
  document.getElementById('siteInfoOverlay').classList.remove('open');
}

// ── Raw AMOS terminal modal ───────────────────────────────────
function showRawTerminal() {
  const entry   = _history[_activeIdx];
  const body    = document.getElementById('rtBody');
  const overlay = document.getElementById('rawTermOverlay');

  if (!entry || !entry.raw) {
    body.innerHTML = '<div class="rt-empty">No run data available yet.</div>';
    document.getElementById('rtTitle').textContent = 'AMOS — MO Shell';
  } else {
    const site = _esc(entry.site || '?');
    document.getElementById('rtTitle').textContent = `AMOS — ${entry.site || '?'}`;
    body.innerHTML = `
      <div class="rt-prompt-line">
        <span class="rt-p-user">zira@enm</span><span class="rt-p-sep">:</span><span class="rt-p-loc">~</span>
        <span class="rt-p-cmd">$ amos ${site}</span>
      </div>
      <pre class="rt-output">${_esc(entry.raw)}</pre>
      <div class="rt-prompt-line">
        <span class="rt-p-user">zira@enm</span><span class="rt-p-sep">:</span><span class="rt-p-loc">~</span>
        <span class="rt-p-cmd">$</span><span class="rt-cursor"></span>
      </div>`;
    body.scrollTop = 0;
  }
  overlay.classList.add('open');
}

function closeRawTerminal() {
  document.getElementById('rawTermOverlay').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeHelp(); closeSiteInfo(); } });

// ── Custom HTML tooltip ───────────────────────────────────────
function _renderTooltip({ chart, tooltip }, suffix) {
  let el = document.getElementById('chartTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chartTooltip';
    el.className = 'chart-tooltip';
    document.body.appendChild(el);
  }

  if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

  const title = tooltip.title?.[0] || '';
  const rows  = (tooltip.dataPoints || []).map(dp => {
    const color  = dp.dataset.borderColor || '#999';
    const isDash = dp.dataset.borderDash?.length > 0;
    const val    = dp.parsed.y != null ? dp.parsed.y.toFixed(1) : '—';
    const dot    = isDash
      ? `style="background:transparent;border:2px solid ${color};width:6px;height:6px;"`
      : `style="background:${color};"`;
    return `<div class="ct-row">
      <span class="ct-dot" ${dot}></span>
      <span class="ct-label">${_esc(dp.dataset.label)}</span>
      <span class="ct-val">${_esc(val)}${_esc(suffix)}</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="ct-title">${_esc(title)}</div><div class="ct-rows">${rows}</div>`;

  const rect    = chart.canvas.getBoundingClientRect();
  const x       = rect.left + tooltip.caretX;
  const y       = rect.top  + tooltip.caretY;
  const flipLeft = tooltip.caretX > chart.width * 0.55;

  el.style.left      = x + 'px';
  el.style.top       = y + 'px';
  el.style.transform = flipLeft ? 'translate(calc(-100% - 14px), -50%)' : 'translate(14px, -50%)';
  el.style.opacity   = '1';
}

// ── shared chart factory ──────────────────────────────────────
function _makeLineChart(canvasId, labels, datasets, { xTitle, yTitle, tooltipSuffix, grid, tick }) {
  const chart = new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      animation: { duration: 250 },
      scales: {
        x: {
          title: { display: true, text: xTitle, color: tick, font: { size: 11, family: "'JetBrains Mono'" } },
          ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 20 },
          grid:  { color: grid },
        },
        y: {
          title: { display: true, text: yTitle, color: tick, font: { size: 11, family: "'JetBrains Mono'" } },
          ticks: { color: tick, font: { size: 10 } },
          grid:  { color: grid },
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: ctx => _renderTooltip(ctx, tooltipSuffix),
        }
      }
    }
  });
  _buildLegend(canvasId, chart);
  return chart;
}

// ── notebook checkbox legend ──────────────────────────────────
function _buildLegend(canvasId, chart) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.closest('.chart-wrap');
  if (!wrap) return;

  // Remove any existing legend
  const old = wrap.querySelector('.chart-legend');
  if (old) old.remove();

  const legend = document.createElement('div');
  legend.className = 'chart-legend';

  chart.data.datasets.forEach((ds, i) => {
    const color = ds.borderColor || '#999';
    const id = `cb-${canvasId}-${i}`;
    const checked = !!ds.hidden;

    const label = document.createElement('label');
    label.className = 'notebook-checkbox';
    label.style.setProperty('--dot-color', color);
    label.style.color = color;
    label.innerHTML = `
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
      <span class="checkmark"></span>
      <span class="nb-text">
        ${_esc(ds.label)}
        <svg class="cut-line" viewBox="0 0 100 10" preserveAspectRatio="none">
          <path d="M0,5 Q25,3 50,5 Q75,7 100,5"/>
        </svg>
      </span>`;

    label.querySelector('input').addEventListener('change', function() {
      const meta = chart.getDatasetMeta(i);
      meta.hidden = this.checked; // checked = erased = hidden
      chart.update();
    });

    legend.appendChild(label);
  });

  // Insert legend after the canvas
  canvas.insertAdjacentElement('afterend', legend);
}

// ── history sidebar ───────────────────────────────────────────
function _renderHistory() {
  const wrap = document.getElementById('histList');
  if (!_history.length) { wrap.innerHTML = '<div class="sb-hist-empty">No runs yet</div>'; return; }
  wrap.innerHTML = _history.map((e, i) => {
    const isCmp = _cmpEntry === e;
    return `
    <div class="sb-hist-item${i === _activeIdx ? ' active' : ''}${isCmp ? ' cmp' : ''}" onclick="selectHistory(${i})">
      <div class="sb-hist-dot"></div>
      <div class="sb-hist-name">${_esc(e.site)}</div>
      <div class="sb-hist-time">${_fmtShort(e.ts)}</div>
      <button class="sb-hist-cmp-btn${isCmp ? ' active' : ''}" title="${isCmp ? 'Clear comparison' : 'Compare'}"
        onclick="event.stopPropagation();setCompare(${i})">⇄</button>
    </div>`;
  }).join('');
}

function selectHistory(idx) {
  _activeIdx = idx; _renderHistory(); _showResult(_history[idx]);
}

function clearHistory() {
  _history   = [];
  _activeIdx = -1;
  _cmpEntry  = null;
  try { localStorage.removeItem(LS_HIST); } catch(e) {}
  _renderHistory();
  const banner = document.getElementById('cmpBanner');
  if (banner) banner.style.display = 'none';
}

// ── history persistence ───────────────────────────────────────
function _saveHistory() {
  try {
    const toSave = _history.slice(0, 10).map(e => ({ site: e.site, ts: e.ts.toISOString(), raw: e.raw, notes: e.notes || '' }));
    localStorage.setItem(LS_HIST, JSON.stringify(toSave));
  } catch(e) {}
}

function _loadHistory() {
  try {
    const saved = localStorage.getItem(LS_HIST);
    if (!saved) return;
    JSON.parse(saved).forEach(e => {
      const parsed = PARSER.parse(e.raw);
      if (Object.keys(parsed.avg).length || Object.keys(parsed.prb).length)
        _history.push({ site: e.site, ts: new Date(e.ts), raw: e.raw, parsed, notes: e.notes || '' });
    });
  } catch(e) {}
}

// ── comparison ────────────────────────────────────────────────
function setCompare(idx) {
  _cmpEntry = (_cmpEntry === _history[idx]) ? null : _history[idx];
  _renderHistory();
  if (_activeIdx >= 0) _showResult(_history[_activeIdx]);
}

function clearCompare() {
  _cmpEntry = null;
  _renderHistory();
  if (_activeIdx >= 0) _showResult(_history[_activeIdx]);
}

// ── sidebar collapse ──────────────────────────────────────────
function _initSidebar() {
  if (localStorage.getItem(LS_SB) === '1') _setSidebar(true, false);
}
function toggleSidebar() {
  const collapsed = !document.getElementById('sidebar').classList.contains('collapsed');
  _setSidebar(collapsed, true);
}
function _setSidebar(collapsed, save) {
  const sb  = document.getElementById('sidebar');
  const btn = document.getElementById('btnSbToggle');
  sb.classList.toggle('collapsed', collapsed);
  btn.textContent = collapsed ? '›' : '‹';
  if (save) localStorage.setItem(LS_SB, collapsed ? '1' : '0');
}

// ── per-run notes ─────────────────────────────────────────────
function saveNotes() {
  if (_activeIdx < 0) return;
  _history[_activeIdx].notes = document.getElementById('notesInput').value;
  _saveHistory();
}

function _renderNotes(entry) {
  const sec   = document.getElementById('notesSection');
  const input = document.getElementById('notesInput');
  input.value = entry.notes || '';
  sec.style.display = 'block';
}

// ── export report ─────────────────────────────────────────────
function exportReport() {
  const entry = _activeIdx >= 0 ? _history[_activeIdx] : null;
  if (!entry) return;
  const { site, ts, parsed } = entry;

  const chartDefs = [
    { title: 'Interference per PRB (snapshot)',          chart: _chartPrb  },
    { title: 'UL Interference Power over time',          chart: _chartIntf },
    { title: 'UL Quality — HARQ BLER & DTX Rate',        chart: _chartQual },
    { title: 'SINR — Signal quality through the noise',  chart: _chartSinr },
    { title: 'UL / DL Load — PRB usage %',               chart: _chartLoad },
    { title: 'RRC Setup Success Rate',                   chart: _chartRrc  },
    { title: 'Cell Availability',                        chart: _chartAvail},
    { title: 'DL TX Rank Distribution',                  chart: _chartRank },
  ].filter(c => c.chart);

  const summaryRows = Object.keys(parsed.avg)
    .filter(k => !k.includes('pucch'))
    .map(cell => {
      const val   = parsed.avg[cell];
      const pucch = parsed.avg[cell + ' pucch'];
      const cls   = val >= -100 ? 'color:#c0392b' : val >= -110 ? 'color:#d68910' : 'color:#1e8449';
      return `<tr>
        <td>${_esc(cell)}</td>
        <td style="${cls};font-weight:600">${val.toFixed(1)} dBm</td>
        <td style="color:#888">${pucch != null ? pucch.toFixed(1) + ' dBm' : '—'}</td>
      </tr>`;
    }).join('');

  const cmpNote = _cmpEntry
    ? `<div style="margin-bottom:18px;padding:8px 12px;background:#eef2ff;border-radius:6px;font-size:11px;color:#3730a3">Compared with: ${_esc(_cmpEntry.site.toUpperCase())} — ${_fmt(_cmpEntry.ts)}</div>`
    : '';

  const chartImgs = chartDefs.map(c => {
    const img = c.chart.canvas.toDataURL('image/png');
    return `<div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:600;color:#555;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">${_esc(c.title)}</div>
      <img src="${img}" style="width:100%;border:1px solid #e5e5e5;border-radius:4px">
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Gremlin — ${_esc(site)} — ${ts.toLocaleDateString('en-GB')}</title>
<style>
  body{font-family:monospace;color:#111;background:#fff;padding:28px 36px;max-width:960px;margin:0 auto}
  h1{font-size:20px;font-weight:600;margin:0 0 4px}
  .sub{font-size:11px;color:#888;margin-bottom:20px}
  table{border-collapse:collapse;margin-bottom:24px;font-size:12px;width:auto}
  th,td{border:1px solid #ddd;padding:6px 14px;text-align:left}
  th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:0.05em}
  @media print{body{padding:12px} img{page-break-inside:avoid}}
</style>
</head>
<body>
<h1>Gremlin — ${_esc(site.toUpperCase())} — Noise Floor Report</h1>
<div class="sub">${_fmt(ts)}</div>
${cmpNote}
<table>
  <thead><tr><th>Cell</th><th>Avg UL Int (PUSCH)</th><th>Avg UL Int (PUCCH)</th></tr></thead>
  <tbody>${summaryRows}</tbody>
</table>
${chartImgs}
<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ── raw toggle ────────────────────────────────────────────────
function toggleRaw() {
  const pre  = document.getElementById('rawPre');
  const btn  = document.getElementById('rawToggleBtn');
  const show = pre.style.display === 'none';
  pre.style.display = show ? '' : 'none';
  btn.textContent   = show ? '▾ Hide raw output' : '▸ Show raw output';
}

// ── progress / status ─────────────────────────────────────────
function _startProgress() {
  const bar = document.getElementById('sbProgressBar');
  const wrap = document.getElementById('sbProgress');
  wrap.style.display = 'block';
  bar.style.transition = 'none'; bar.style.width = '0%'; bar.offsetWidth;
  bar.style.transition = 'width 90s cubic-bezier(.05,.7,.2,1)';
  bar.style.width = '85%';
}
function _finishProgress(ok) {
  const bar = document.getElementById('sbProgressBar');
  const wrap = document.getElementById('sbProgress');
  bar.style.transition = 'width .3s ease';
  bar.style.width = ok ? '100%' : '0%';
  setTimeout(() => { wrap.style.display = 'none'; bar.style.width = '0%'; bar.style.transition = 'none'; }, 400);
}
function _status(msg, type) {
  const el = document.getElementById('sbStatus');
  el.textContent = msg; el.className = `sb-status ${type}`; el.style.display = 'block';
}

// ── helpers ───────────────────────────────────────────────────
function _themeColors() {
  const dark = document.documentElement.classList.contains('dark');
  return {
    grid:   dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
    tick:   dark ? '#6e6660' : '#797776',
    legend: dark ? '#b0a89e' : '#4e4d4d',
  };
}
function _fmt(d) { return d.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
function _hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function _fmtShort(d) { return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }); }
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// "KD185_3" → "<span class='cell-site'>KD185</span> <span class='cell-sector'>Sector 3</span>"
function _fmtCell(name) {
  const m = name.match(/^(.+?)_(\w+)$/);
  if (!m) return `<span class='cell-site'>${_esc(name)}</span>`;
  return `<span class='cell-site'>${_esc(m[1])}</span><span class='cell-sector'>Sector ${_esc(m[2])}</span>`;
}
