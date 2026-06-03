/* ═══════════════════════════════════════════════════════════════
   NF Monitor — main app
═══════════════════════════════════════════════════════════════ */

const LS_HOST = 'nfm_host';
const LS_USER = 'nfm_user';
const LS_SITE = 'nfm_site';
const SS_PASS = 'nfm_pass'; // sessionStorage — clears on tab close

let _chartPrb  = null;
let _chartIntf = null;
let _chartQual = null;
let _chartSinr = null;
let _chartLoad = null;
let _history   = [];   // [{site, ts, raw, parsed}]
let _activeIdx = -1;

const PALETTE = ['#ff5e24','#2563eb','#16a34a','#9333ea','#e8a020','#0891b2'];

// ── boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  _loadPrefs();
  _renderHistory();
  THEME.init();
});

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

    const entry = { site, ts: new Date(), raw: data.output, parsed };
    _history.unshift(entry);
    if (_history.length > 20) _history.pop();
    _activeIdx = 0;
    _renderHistory();
    _showResult(entry);

    const pmrNote = parsed.pmr ? `, ${parsed.pmr.rops.length} ROPs` : '';
    _status(`✓ ${site} — ${Object.keys(parsed.avg).length} cells${pmrNote}`, 'ok');

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
    title: 'עומס UL — שימוש ב-PRBים — מה הגרף הזה מראה?',
    body: `
      <p>אחוז ה-PRBים ב-UL שבשימוש פעיל בכל ROP. מראה כמה ה-cell עמוסה בפועל.</p>
      <ul>
        <li><span class="help-good">עומס נמוך</span> — מתחת לـ30%: ה-cell לא עמוסה, ייתכן שהבעיה לא קשורה לעומס</li>
        <li><span class="help-warn">עומס בינוני</span> — 30%–70%: טווח תקין לרוב האתרים</li>
        <li><span class="help-bad">עומס גבוה</span> — מעל 70%: ה-cell עמוסה; בשילוב עם הפרעה גבוהה — המצב קשה במיוחד</li>
      </ul>
      <p><b>הקשר להפרעה:</b> עומס גבוה + הפרעה גבוהה = UEים מגבירים הספק כדי להתחרות ברעש, מה שמגביר עוד יותר את ההפרעה לשכניהם (interference rise). עומס נמוך + הפרעה גבוהה = ההפרעה היא כנראה חיצונית ולא self-interference.</p>
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });

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

  _renderSummary(parsed);
  _renderPrbChart(parsed);
  _renderPmrCharts(parsed);

  document.getElementById('rawPre').textContent = raw;
  document.getElementById('rawSection').style.display = 'block';
}

// ── summary cards ─────────────────────────────────────────────
function _renderSummary(parsed) {
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
    return `
      <div class="sum-card">
        <div class="sum-card-name">
          <span class="sum-card-dot" style="background:${dot}"></span>${_fmtCell(cell)}
        </div>
        <div class="sum-card-val ${cls}">${val.toFixed(1)}<span class="sum-card-unit">dBm</span></div>
        ${pucchHtml}
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
function _renderPmrCharts(parsed) {
  const pmr = parsed.pmr;
  const sec  = document.getElementById('pmrSection');

  if (!pmr) { sec.style.display = 'none'; return; }

  const { rops, cells, data, date } = pmr;
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
    _chartSinr = _makeLineChart('sinrChart', rops, ds, {
      xTitle: 'ROP', yTitle: 'dB', tooltipSuffix: ' dB', grid, tick, legend,
    });
  }

  // Chart 4: UL PRB usage (how loaded the uplink is)
  if (_chartLoad) { _chartLoad.destroy(); _chartLoad = null; }
  {
    const ds = [];
    cells.forEach((cell, i) => {
      const color = PALETTE[i % PALETTE.length];
      const prb   = data['Res_UlPrbPercUsage']?.[cell];
      if (prb?.some(v => v !== null))
        ds.push({ label: cell, data: prb, borderColor: color, backgroundColor: color+'18',
                  borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5, tension: 0.2, fill: false, spanGaps: true });
    });
    _chartLoad = _makeLineChart('loadChart', rops, ds, {
      xTitle: 'ROP', yTitle: '%', tooltipSuffix: '%', grid, tick, legend,
    });
  }

  sec.style.display = 'block';
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
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}${tooltipSuffix}` } }
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
  wrap.innerHTML = _history.map((e, i) => `
    <div class="sb-hist-item${i === _activeIdx ? ' active' : ''}" onclick="selectHistory(${i})">
      <div class="sb-hist-dot"></div>
      <div class="sb-hist-name">${_esc(e.site)}</div>
      <div class="sb-hist-time">${_fmtShort(e.ts)}</div>
    </div>`).join('');
}

function selectHistory(idx) {
  _activeIdx = idx; _renderHistory(); _showResult(_history[idx]);
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
function _fmtShort(d) { return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }); }
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// "KD185_3" → "<span class='cell-site'>KD185</span> <span class='cell-sector'>Sector 3</span>"
function _fmtCell(name) {
  const m = name.match(/^(.+?)_(\w+)$/);
  if (!m) return `<span class='cell-site'>${_esc(name)}</span>`;
  return `<span class='cell-site'>${_esc(m[1])}</span><span class='cell-sector'>Sector ${_esc(m[2])}</span>`;
}
