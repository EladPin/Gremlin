/* ═══════════════════════════════════════════════════════════════
   NF Monitor — output parser
   parse(raw) returns:
   {
     cells: ['KD185_2', 'KD185_3'],
     prb:   { 'KD185_2': [-97.9, ...] },
     avg:   { 'KD185_2': -99.31, 'KD185_2 pucch': -100.55, ... },
     pmr:   {
       date: '2026-06-02',
       rops: ['11:30', ...],
       cells: [...],
       data: {
         'Int_RadioRecInterferencePwr':      { cell: [vals...] },
         'Int_RadioRecInterferencePucchPwr': { cell: [vals...] },
         'Int_MacHarqUlBler':               { cell: [vals...] },
         'Int_MacHarqUlDtxRate':            { cell: [vals...] },
         'Int_SinrPuschDistr':              { cell: [vals...] },
         'Res_UlPrbPercUsage':              { cell: [vals...] },
         'Res_DlPrbPercUsage':              { cell: [vals...] },
         'Acc_RrcConnSetupSuccRate':        { cell: [vals...] },
         'Av_CellDownAuto':                 { cell: [vals...] },
         'Drv_DlRank1Pct':                  { cell: [vals...] },  // derived
         'Drv_DlRank2Pct':                  { cell: [vals...] },  // derived
       }
     } | null,
     siteInfo: {
       'Astra_1': { admState, opState, earfcn, maxTxPower, bandwidth, crsGain, ueCount },
       ...
     } | null
   }
═══════════════════════════════════════════════════════════════ */

const PARSER = (() => {

  const PMR_WANTED = new Set([
    'Int_RadioRecInterferencePwr',
    'Int_RadioRecInterferencePucchPwr',
    'Int_MacHarqUlBler',
    'Int_MacHarqUlDtxRate',
    'Int_SinrPuschDistr',
    'Res_UlPrbPercUsage',
    'Res_DlPrbPercUsage',
    'Acc_RrcConnSetupSuccRate',
    'Av_CellDownAuto',
  ]);

  const RANK_COUNTER = 'Int_DlRadioMeasTxRankDistr';

  function parse(raw) {
    // Strip ANSI/VT100 escape sequences — AMOS PTY emits these in its prompt echoes
    // e.g. "\x1b[1mAMITAY\x1b[0m> st cell" must become "AMITAY> st cell"
    const clean = raw
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // CSI: colors, cursor moves, modes
      .replace(/\x1b[^[]/g, '');               // other 2-char escape sequences
    const lines = clean.replace(/\r/g, '').split('\n').map(l => l.trimEnd());
    const result = { cells: [], prb: {}, avg: {}, pmr: null, siteInfo: null };

    _parsePrbTable(lines, result);
    _parseAvgTable(lines, result);
    result.pmr      = _parsePmr206(lines);
    result.siteInfo = _parseSiteInfo(lines);

    if (!result.cells.length) result.cells = Object.keys(result.prb);
    return result;
  }

  // ── "Estimation of interference per PRB" ─────────────────────
  function _parsePrbTable(lines, result) {
    let hi = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/estimation of interference per PRB/i.test(lines[i])) { hi = i; break; }
    }
    if (hi < 0) return;

    let hdrIdx = hi + 1;
    while (hdrIdx < lines.length && !lines[hdrIdx].trim()) hdrIdx++;
    if (hdrIdx >= lines.length) return;

    const hdrParts = lines[hdrIdx].trim().split(/\s{2,}/);
    const cells = hdrParts.slice(1).map(s => s.trim()).filter(Boolean);
    cells.forEach(c => { result.prb[c] = []; });
    if (!result.cells.length) result.cells = cells;

    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[A-Za-z]/.test(line)) break;
      const parts = line.split(/\s+/);
      const prb = parseInt(parts[0], 10);
      if (isNaN(prb)) break;
      cells.forEach((cell, ci) => {
        const val = parseFloat(parts[ci + 1]);
        result.prb[cell].push(isNaN(val) ? null : val);
      });
    }
  }

  // ── "Average UL Int dBm" summary ─────────────────────────────
  function _parseAvgTable(lines, result) {
    let hi = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/Average UL Int dBm/i.test(lines[i])) { hi = i; break; }
    }
    if (hi < 0) return;

    for (let i = hi + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(/^(.+?)\s{2,}(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { result.avg[m[1].trim()] = parseFloat(m[2]); continue; }
      if (!/\d/.test(line)) break;
    }
  }

  // ── PMR 206 ROP-by-ROP table ─────────────────────────────────
  function _parsePmr206(lines) {
    let tableStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^Date:\s*\d{4}-\d{2}-\d{2}/.test(lines[i].trim())) { tableStart = i; break; }
    }
    if (tableStart < 0) return null;

    let date = '';
    let hdrIdx = -1;
    let pmrCells = [];

    for (let i = tableStart; i < Math.min(tableStart + 10, lines.length); i++) {
      const l = lines[i].trim();
      const dm = l.match(/^Date:\s*(\d{4}-\d{2}-\d{2})/);
      if (dm) { date = dm[1]; }
      if (/^Time\s+Counter\s+\S/.test(l)) {
        hdrIdx = i;
        pmrCells = l.split(/\s+/).slice(2);
        break;
      }
    }
    if (hdrIdx < 0 || !pmrCells.length) return null;

    const ropsOrder = [];
    const ropsSet   = new Set();
    const data      = {};

    PMR_WANTED.forEach(c => {
      data[c] = {};
      pmrCells.forEach(cell => { data[c][cell] = []; });
    });
    // Derived rank distribution
    ['Drv_DlRank1Pct', 'Drv_DlRank2Pct'].forEach(k => {
      data[k] = {};
      pmrCells.forEach(cell => { data[k][cell] = []; });
    });

    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (/^Enter the report number/i.test(trimmed)) break;
      if (/^Error|^Warning/i.test(trimmed)) continue;

      const m = trimmed.match(/^(\d{2}:\d{2})\s+(\S+)\s+(.*)/);
      if (!m) continue;

      const time    = m[1];
      const counter = m[2];
      const valParts = m[3].trim().split(/\s+/);

      if (!ropsSet.has(time)) { ropsSet.add(time); ropsOrder.push(time); }

      // Special: rank distribution → derive Rank1% and Rank2%
      if (counter === RANK_COUNTER) {
        pmrCells.forEach((cell, ci) => {
          const raw = valParts[ci];
          if (!raw || raw === 'N/A') {
            data['Drv_DlRank1Pct'][cell].push(null);
            data['Drv_DlRank2Pct'][cell].push(null);
            return;
          }
          const bins  = raw.split(',').map(Number);
          const total = bins.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);
          if (total === 0) {
            data['Drv_DlRank1Pct'][cell].push(null);
            data['Drv_DlRank2Pct'][cell].push(null);
          } else {
            data['Drv_DlRank1Pct'][cell].push(+(((bins[0] || 0) / total) * 100).toFixed(1));
            data['Drv_DlRank2Pct'][cell].push(+(((bins[1] || 0) / total) * 100).toFixed(1));
          }
        });
        continue;
      }

      if (!PMR_WANTED.has(counter)) continue;

      pmrCells.forEach((cell, ci) => {
        const raw = valParts[ci];
        const val = (raw === undefined || raw === 'N/A') ? null : parseFloat(raw);
        data[counter][cell].push(isNaN(val) ? null : val);
      });
    }

    if (!ropsOrder.length) return null;
    return { date, rops: ropsOrder, cells: pmrCells, data };
  }

  // ── Site info: st cell / get . attr / ue print -admitted ─────
  // Primary: AMOS PTY echo "SITENAME> command" lines delineate blocks.
  // Fallback: scan directly for each command's output pattern — used when
  // prompts aren't echoed or ANSI stripping wasn't sufficient.
  function _parseSiteInfo(lines) {
    const cells    = {};
    const promptRe = /^[A-Za-z][A-Za-z0-9_]+>\s+(.+)$/;

    let i = 0;
    while (i < lines.length) {
      const pm = lines[i].match(promptRe);
      if (pm) {
        const cmd = pm[1].trim();
        let j = i + 1;
        while (j < lines.length && !promptRe.test(lines[j])) j++;
        const block = lines.slice(i + 1, j);

        if      (cmd === 'st cell')             _parseStCell(block, cells);
        else if (cmd === 'get . earfcn')        _parseGetEarfcn(block, cells);
        else if (cmd === 'get . bandwidth')     _parseGetBandwidth(block, cells);
        else if (cmd === 'get . crsgain')       _parseGetCrsGain(block, cells);
        else if (cmd === 'ue print -admitted')  _parseUePrint(block, cells);

        i = j;
      } else {
        i++;
      }
    }

    if (Object.keys(cells).length) return cells;

    // ── Fallback: no prompt echoes detected — scan output directly ──────────
    _parseStCell(lines, cells);
    _parseUePrint(lines, cells);
    _parseGetEarfcn(lines, cells);
    _parseGetBandwidth(lines, cells);
    _parseGetCrsGain(lines, cells);

    return Object.keys(cells).length ? cells : null;
  }

  function _parseStCell(block, cells) {
    for (const line of block) {
      // "   41  1 (UNLOCKED)  1 (ENABLED)   ENodeBFunction=1,EUtranCellFDD=Astra_1"
      const m = line.match(/\d+\s+\((\w+)\)\s+\d+\s+\((\w+)\)\s+.*EUtranCell\w*=(\w+)/);
      if (!m) continue;
      const [, admState, opState, cell] = m;
      if (!cells[cell]) cells[cell] = {};
      cells[cell].admState = admState;
      cells[cell].opState  = opState;
    }
  }

  // "EUtranCellFDD=Cell  earfcndl  9310" — DL EARFCN (canonical cell identifier)
  function _parseGetEarfcn(block, cells) {
    for (const line of block) {
      const m = line.match(/EUtranCellFDD=(\w+)\s+earfcndl\s+(\d+)/i);
      if (!m) continue;
      const [, cell, value] = m;
      if (!cells[cell]) cells[cell] = {};
      cells[cell].earfcn = value;
    }
  }


  // "EUtranCellFDD=Cell  dlChannelBandwidth  5000" — direct EUtranCellFDD only (no sub-MO)
  // Sub-MOs like EUtranCellFDD-EUtranFreqRelation=... also appear — excluded by requiring
  // the MO path ends at the cell name (no comma before the cell token).
  function _parseGetBandwidth(block, cells) {
    for (const line of block) {
      const m = line.match(/(?:^|,)EUtranCellFDD=(\w+)\s+dlChannelBandwidth\s+(\d+)/i);
      if (!m) continue;
      const [, cell, value] = m;
      if (!cells[cell]) cells[cell] = {};
      cells[cell].bandwidth = value;
    }
  }

  // "EUtranCellFDD=Cell  crsGain  300" (units: 0.01 dB, so 300 = 3.00 dB)
  function _parseGetCrsGain(block, cells) {
    for (const line of block) {
      const m = line.match(/EUtranCellFDD=(\w+)\s+crsGain\s+(-?\d+)/i);
      if (!m) continue;
      const [, cell, value] = m;
      if (!cells[cell]) cells[cell] = {};
      cells[cell].crsGain = value;
    }
  }

  // "ue print -admitted" output is a CellId table:
  //   CellId  #UE:s  #Bearers
  //   1       6      15
  //   2       2      2
  // Cell name convention: trailing digit matches CellId (Amitay_1 → CellId 1).
  function _parseUePrint(block, cells) {
    // Find the header line to confirm we're in the right table
    let inTable = false;
    const cellIdMap = {}; // cellId (string) → ueCount

    for (const line of block) {
      if (/CellId\s+#UE/i.test(line)) { inTable = true; continue; }
      if (!inTable) continue;
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const cellId = parts[0];
      const ueCount = parseInt(parts[1], 10);
      if (/^\d+$/.test(cellId) && !isNaN(ueCount)) {
        cellIdMap[cellId] = ueCount;
      }
    }

    // Map cellId → cell name using known cells (trailing number after _ matches CellId)
    Object.entries(cellIdMap).forEach(([cellId, ueCount]) => {
      // Find a cell whose name ends with _<cellId>
      const matchedCell = Object.keys(cells).find(c => c.endsWith('_' + cellId));
      if (matchedCell) {
        cells[matchedCell].ueCount = ueCount;
      } else {
        // Store by cellId for later resolution if cells aren't populated yet
        const key = '__cellId_' + cellId;
        cells[key] = { ueCount };
      }
    });

    // Resolve any pending __cellId_ entries against now-known cells
    Object.keys(cells).filter(k => k.startsWith('__cellId_')).forEach(k => {
      const cellId = k.replace('__cellId_', '');
      const matchedCell = Object.keys(cells).find(c => !c.startsWith('__') && c.endsWith('_' + cellId));
      if (matchedCell) {
        cells[matchedCell].ueCount = cells[k].ueCount;
        delete cells[k];
      }
    });
  }

  return { parse };
})();
