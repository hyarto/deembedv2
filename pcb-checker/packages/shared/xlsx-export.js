/* ============================================================================
 * xlsx-export.js —— 纯前端 OOXML (.xlsx) 与 UTF-8 BOM CSV 生成器
 * 供走线检查、综合一体化工作台等模块统一复用，消除重复 ZIP/XML 打包代码
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.XlsxExport = api;
    if (!root.generateXLSX) root.generateXLSX = api.generateXLSX;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function buildCrc32Table() {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  var CRC32_TABLE = buildCrc32Table();

  function calcCRC32(buf) {
    var crc = 0 ^ (-1);
    for (var i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  function makeZip(files) {
    var enc = new TextEncoder();
    var fileEntries = files.map(function (f) {
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      var name = enc.encode(f.name);
      var crc = calcCRC32(data);
      return { name: name, data: data, crc: crc, size: data.length };
    });

    var localParts = [];
    var cdParts = [];
    var offset = 0;

    for (var i = 0; i < fileEntries.length; i++) {
      var f = fileEntries[i];
      var header = new Uint8Array(30 + f.name.length);
      var dv = new DataView(header.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, f.crc, true);
      dv.setUint32(18, f.size, true);
      dv.setUint32(22, f.size, true);
      dv.setUint16(26, f.name.length, true);
      dv.setUint16(28, 0, true);
      header.set(f.name, 30);

      localParts.push(header);
      localParts.push(f.data);

      var cd = new Uint8Array(46 + f.name.length);
      var cdDv = new DataView(cd.buffer);
      cdDv.setUint32(0, 0x02014b50, true);
      cdDv.setUint16(4, 20, true);
      cdDv.setUint16(6, 20, true);
      cdDv.setUint16(8, 0x0800, true);
      cdDv.setUint16(10, 0, true);
      cdDv.setUint16(12, 0, true);
      cdDv.setUint16(14, 0, true);
      cdDv.setUint32(16, f.crc, true);
      cdDv.setUint32(20, f.size, true);
      cdDv.setUint32(24, f.size, true);
      cdDv.setUint16(28, f.name.length, true);
      cdDv.setUint16(30, 0, true);
      cdDv.setUint16(32, 0, true);
      cdDv.setUint16(34, 0, true);
      cdDv.setUint16(36, 0, true);
      cdDv.setUint32(38, 0, true);
      cdDv.setUint32(42, offset, true);
      cd.set(f.name, 46);
      cdParts.push(cd);

      offset += header.length + f.data.length;
    }

    var cdOffset = offset;
    var cdSize = 0;
    for (var j = 0; j < cdParts.length; j++) cdSize += cdParts[j].length;

    var eocd = new Uint8Array(22);
    var eocdDv = new DataView(eocd.buffer);
    eocdDv.setUint32(0, 0x06054b50, true);
    eocdDv.setUint16(4, 0, true);
    eocdDv.setUint16(6, 0, true);
    eocdDv.setUint16(8, fileEntries.length, true);
    eocdDv.setUint16(10, fileEntries.length, true);
    eocdDv.setUint32(12, cdSize, true);
    eocdDv.setUint32(16, cdOffset, true);
    eocdDv.setUint16(20, 0, true);

    var totalLen = offset + cdSize + 22;
    var out = new Uint8Array(totalLen);
    var pos = 0;
    for (var p1 = 0; p1 < localParts.length; p1++) {
      out.set(localParts[p1], pos);
      pos += localParts[p1].length;
    }
    for (var p2 = 0; p2 < cdParts.length; p2++) {
      out.set(cdParts[p2], pos);
      pos += cdParts[p2].length;
    }
    out.set(eocd, pos);
    return out;
  }

  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetter(colIdx) {
    var temp = colIdx + 1;
    var letter = '';
    while (temp > 0) {
      var mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - mod) / 26);
    }
    return letter;
  }

  function generateXLSX(sheets) {
    var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
      '</Relationships>';

    var wbSheetNodes = '';
    var wbRels = '';
    var contentTypesSheets = '';

    sheets.forEach(function (sh, idx) {
      var rId = 'rId' + (idx + 1);
      wbSheetNodes += '<sheet name="' + xmlEscape(sh.name) + '" sheetId="' + (idx + 1) + '" r:id="' + rId + '"/>';
      wbRels += '<Relationship Id="' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (idx + 1) + '.xml"/>';
      contentTypesSheets += '<Override PartName="/xl/worksheets/sheet' + (idx + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });

    var stylesRId = 'rId' + (sheets.length + 1);
    wbRels += '<Relationship Id="' + stylesRId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\n' +
      '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
      '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n' +
      '  ' + contentTypesSheets + '\n</Types>';

    var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
      '  <sheets>' + wbSheetNodes + '</sheets>\n</workbook>';

    var wbRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  ' + wbRels + '\n</Relationships>';

    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
      '  <fonts count="4">\n' +
      '    <font><sz val="10"/><name val="Microsoft YaHei"/></font>\n' +
      '    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font>\n' +
      '    <font><b/><color rgb="FFDC2626"/><sz val="10"/><name val="Microsoft YaHei"/></font>\n' +
      '    <font><color rgb="FF16A34A"/><sz val="10"/><name val="Microsoft YaHei"/></font>\n' +
      '  </fonts>\n' +
      '  <fills count="5">\n' +
      '    <fill><patternFill patternType="none"/></fill>\n' +
      '    <fill><patternFill patternType="gray125"/></fill>\n' +
      '    <fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/></patternFill></fill>\n' +
      '    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill>\n' +
      '    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>\n' +
      '  </fills>\n' +
      '  <borders count="2">\n' +
      '    <border><left/><right/><top/><bottom/><diagonal/></border>\n' +
      '    <border>\n' +
      '      <left style="thin"><color rgb="FFCBD5E1"/></left>\n' +
      '      <right style="thin"><color rgb="FFCBD5E1"/></right>\n' +
      '      <top style="thin"><color rgb="FFCBD5E1"/></top>\n' +
      '      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>\n' +
      '    </border>\n' +
      '  </borders>\n' +
      '  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n' +
      '  <cellXfs count="5">\n' +
      '    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>\n' +
      '    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>\n' +
      '    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>\n' +
      '    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>\n' +
      '    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>\n' +
      '  </cellXfs>\n' +
      '  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n' +
      '</styleSheet>';

    var files = [
      { name: '[Content_Types].xml', data: contentTypesXml },
      { name: '_rels/.rels', data: relsXml },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRelsXml },
      { name: 'xl/workbook.xml', data: workbookXml },
      { name: 'xl/styles.xml', data: stylesXml }
    ];

    sheets.forEach(function (sh, idx) {
      var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

      if (sh.cols && sh.cols.length) {
        sheetXml += '<cols>';
        sh.cols.forEach(function (col, cIdx) {
          var w = col.width || 15;
          sheetXml += '<col min="' + (cIdx + 1) + '" max="' + (cIdx + 1) + '" width="' + w + '" customWidth="1"/>';
        });
        sheetXml += '</cols>';
      }

      sheetXml += '<sheetData>';
      var rowNum = 1;

      if (sh.headers && sh.headers.length) {
        sheetXml += '<row r="' + rowNum + '" ht="28" customHeight="1">';
        sh.headers.forEach(function (h, cIdx) {
          var cellRef = colLetter(cIdx) + rowNum;
          sheetXml += '<c r="' + cellRef + '" s="1" t="inlineStr"><is><t>' + xmlEscape(h) + '</t></is></c>';
        });
        sheetXml += '</row>';
        rowNum++;
      }

      (sh.rows || []).forEach(function (row) {
        sheetXml += '<row r="' + rowNum + '" ht="26" customHeight="1">';
        row.forEach(function (val, cIdx) {
          var cellRef = colLetter(cIdx) + rowNum;
          var sStyle = 0;
          var valStr = String(val == null ? '' : val);
          if (cIdx === 0 || cIdx === 2 || cIdx === row.length - 1) sStyle = 3;
          if (valStr.indexOf('不符合') >= 0 || valStr.indexOf('超差') >= 0 || valStr.indexOf('不一致') >= 0 ||
              valStr.indexOf('低于下限') >= 0 || valStr.indexOf('超出上限') >= 0 || valStr.indexOf('超标') >= 0) {
            sStyle = 2;
          } else if (valStr === '通过' || valStr === 'OK' || valStr === '已复验' || valStr === '全部合格' || valStr === '合格') {
            sStyle = 4;
          }
          if (typeof val === 'number' && Number.isFinite(val)) {
            sheetXml += '<c r="' + cellRef + '" s="' + sStyle + '"><v>' + val + '</v></c>';
          } else {
            sheetXml += '<c r="' + cellRef + '" s="' + sStyle + '" t="inlineStr"><is><t>' + xmlEscape(valStr) + '</t></is></c>';
          }
        });
        sheetXml += '</row>';
        rowNum++;
      });

      sheetXml += '</sheetData></worksheet>';
      files.push({ name: 'xl/worksheets/sheet' + (idx + 1) + '.xml', data: sheetXml });
    });

    return makeZip(files);
  }

  function toCSV(headers, rows) {
    var esc = function (v) {
      var s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '\uFEFF' + [headers.map(esc).join(',')]
      .concat(rows.map(function (r) { return r.map(esc).join(','); }))
      .join('\r\n');
  }

  return {
    generateXLSX: generateXLSX,
    toCSV: toCSV,
    makeZip: makeZip,
    calcCRC32: calcCRC32
  };
});
