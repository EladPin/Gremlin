/* ═══════════════════════════════════════════════════════════════
   NF Monitor — output parser
   parse(raw) returns:
   {
     cells: ['KD185_2', 'KD185_3'],
     prb:   { 'KD185_2': [-97.9, ...] },      // index = PRB-1
     avg:   { 'KD185_2': -99.31, 'KD185_2 pucch': -100.55, ... },
     pmr:   {
       date: '2026-06-02',
       rops: ['11:30', '11:45', ...],          // ordered time labels
       cells: ['KD185_2', 'KD185_3'],
       data: {
         'Int_RadioRecInterferencePwr':    { 'KD185_2': [-97.7, -98.2, ...], ... },
         'Int_RadioRecInterferencePucchPwr': { ... },
         'Int_MacHarqUlBler':              { ... },
         'Int_MacHarqUlDtxRate':           { ... },
         'Int_SinrPuschDistr':             { ... },
       }
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
  ]);

  function parse(raw) {
    const lines = raw.replace(/\r/g, '').split('\n').map(l => l.trimEnd());
    const result = { cells: [], prb: {}, avg: {}, pmr: null };

    _parsePrbTable(lines, result);
    _parseAvgTable(lines, result);
    result.pmr = _parsePmr206(lines);

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

    // Header: "PRB   Cell1   Cell2 ..." — split on 2+ spaces
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
  // Format after "206) LTE EUtranCell Traffic Performance, ROP by ROP":
  //   Date: 2026-06-02
  //   Time  Counter                     KD185_2 KD185_3
  //   11:30 Int_RadioRecInterferencePwr  -97.7   -115.0
  //   11:45 Int_RadioRecInterferencePwr  -98.2   -114.4
  function _parsePmr206(lines) {
    // Find the actual 206 report block — look for "Date:" followed shortly by "Time  Counter"
    // The menu also contains "206) LTE..." but the real report block starts after the gawk command
    let tableStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^Date:\s*\d{4}-\d{2}-\d{2}/.test(lines[i].trim())) { tableStart = i; break; }
    }
    if (tableStart < 0) return null;

    // Find "Date:" line and "Time  Counter" header line
    let date = '';
    let hdrIdx = -1;
    let pmrCells = [];

    for (let i = tableStart; i < Math.min(tableStart + 10, lines.length); i++) {
      const l = lines[i].trim();
      const dm = l.match(/^Date:\s*(\d{4}-\d{2}-\d{2})/);
      if (dm) { date = dm[1]; }
      if (/^Time\s+Counter\s+\S/.test(l)) {
        hdrIdx = i;
        // Cell names are the tokens after 'Time' and 'Counter'
        const parts = l.split(/\s+/);
        pmrCells = parts.slice(2);
        break;
      }
    }
    if (hdrIdx < 0 || !pmrCells.length) return null;

    const ropsSet = [];
    const ropsOrder = [];
    const data = {};
    PMR_WANTED.forEach(c => {
      data[c] = {};
      pmrCells.forEach(cell => { data[c][cell] = []; });
    });

    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Stop at "Enter the report number" prompt
      if (/^Enter the report number/i.test(trimmed)) break;
      // Skip error/warning lines
      if (/^Error|^Warning/i.test(trimmed)) continue;

      // Data line: "HH:MM CounterName val1 val2 ..."
      const m = trimmed.match(/^(\d{2}:\d{2})\s+(\S+)\s+(.*)/);
      if (!m) continue;

      const time = m[1];
      const counter = m[2];
      const valParts = m[3].trim().split(/\s+/);

      // Track ROP order
      if (!ropsSet.includes(time)) {
        ropsSet.push(time);
        ropsOrder.push(time);
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

  return { parse };
})();
