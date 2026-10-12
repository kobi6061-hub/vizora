/* ALTARIS · exports — CSV, XLSX, JSON and print-to-PDF. No library.
 * XLSX: a minimal SpreadsheetML workbook in a stored (uncompressed) ZIP, one
 * right-to-left sheet per table; numbers stay numbers (with a format), text is
 * inline. CSV: UTF-8 with BOM for Excel; a text cell that starts like a formula
 * is prefixed with ' so a spreadsheet never executes it.
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ---------------- CRC32 + stored ZIP ---------------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files, when) {
    const d = when || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
      c.setUint32(38, 0, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  /* ---------------- XLSX ---------------- */
  const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const col = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  /* style ids: 0 text · 1 bold · 2 #,##0 · 3 0.0% · 4 0.00"x" · 5 bold #,##0 */
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="0.00&quot;x&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  /** a cell: a string, a number, or {v, f:'nis'|'pct'|'x'|'n', b:bold} */
  function cellXml(ref, c) {
    if (c == null || c === '') return '';
    let v = c, f = null, b = false;
    if (typeof c === 'object') { v = c.v; f = c.f || null; b = !!c.b; }
    if (isNum(v)) {
      const s = f === 'pct' ? 3 : f === 'x' ? 4 : f === 'n' ? 0 : b ? 5 : 2;
      return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    }
    if (v == null) return '';
    return `<c r="${ref}" t="inlineStr"${b ? ' s="1"' : ''}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }
  function sheetXml(rows, widths) {
    const body = rows.map((r, i) => `<row r="${i + 1}">${(r || []).map((c, j) => cellXml(col(j) + (i + 1), c)).join('')}</row>`).join('');
    const cols = (widths || []).length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  }
  /** sheets: [{name, rows, widths}] → Uint8Array (.xlsx) */
  function xlsx(sheets) {
    const safe = (n, i) => (String(n || 'Sheet' + (i + 1)).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet' + (i + 1));
    const names = sheets.map((s, i) => safe(s.name, i));
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
    ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) })));
    return zip(files);
  }

  /* ---------------- CSV ---------------- */
  function csvCell(c) {
    let v = c != null && typeof c === 'object' ? c.v : c;
    if (v == null) return '';
    if (isNum(v)) return String(v);
    v = String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;          // never a formula in a spreadsheet
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  /** sections: [{title, rows}] → string (UTF-8 BOM, CRLF) */
  function csv(sections) {
    const out = [];
    for (const s of sections) {
      if (s.title) out.push(csvCell('## ' + s.title));
      for (const r of s.rows) out.push((r || []).map(csvCell).join(','));
      out.push('');
    }
    return '﻿' + out.join('\r\n');
  }

  /* ---------------- files + print ---------------- */
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function printHTML(html, title) {
    const box = document.getElementById('ax-print');
    if (!box) return;
    box.innerHTML = html;
    const prev = document.title;
    if (title) document.title = title;
    document.body.classList.add('ax-printing');
    const done = () => { document.body.classList.remove('ax-printing'); box.innerHTML = ''; document.title = prev; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } catch (e) { done(); } }, 60);
  }
  /* ASCII only: browsers fall back to "download" for a name with Hebrew or typographic characters */
  const fileName = (s) => String(s || '').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'altaris';

  root.AxExport = { zip, crc32, xlsx, csv, csvCell, download, printHTML, fileName };
})(typeof self !== 'undefined' ? self : this);
