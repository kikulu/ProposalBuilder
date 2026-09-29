// 將建議書 Markdown 轉為 Word (.docx)。支援：標題、段落、清單、表格、引言、粗體、行內程式碼、分隔線
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle } = require('docx');

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft JhengHei' };
const HEAD = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

const runs = (text, base = {}) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(t =>
  t.startsWith('**') ? new TextRun({ ...base, text: t.slice(2, -2), bold: true })
    : t.startsWith('`') ? new TextRun({ ...base, text: t.slice(1, -1), font: 'Consolas' })
      : new TextRun({ ...base, text: t }));

function table(lines) {
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const rows = lines.filter(r => !(/^\s*\|[\s:|-]+\|\s*$/.test(r) && r.includes('-'))).map(cells);
  const n = rows[0].length;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: n }, (_, i) => new TableCell({
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'DCEFEC', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: runs(r[i] || '', ri === 0 ? { bold: true } : {}) })]
      }))
    }))
  });
}

async function mdToDocx(md) {
  const L = md.replace(/\r/g, '').split('\n'), out = [];
  let i = 0, m;
  while (i < L.length) {
    const s = L[i];
    if (!s.trim()) { i++; continue; }
    if ((m = s.match(/^(#{1,4})\s+(.*)/))) {
      out.push(new Paragraph({ heading: HEAD[m[1].length - 1], children: runs(m[2]), spacing: { before: 240, after: 120 } })); i++; continue;
    }
    if (/^\s*\|/.test(s)) {
      const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]);
      out.push(table(rows), new Paragraph({})); continue;
    }
    if ((m = s.match(/^(\s*)[-*]\s+(.*)/))) {
      out.push(new Paragraph({ children: runs(m[2]), bullet: { level: Math.min(Math.floor(m[1].length / 2), 2) } })); i++; continue;
    }
    if (/^\d+\.\s+/.test(s)) { out.push(new Paragraph({ children: runs(s), indent: { left: 360 } })); i++; continue; }
    if ((m = s.match(/^>\s?(.*)/))) {
      out.push(new Paragraph({
        children: runs(m[1], { color: '555555' }), indent: { left: 360 }, spacing: { after: 160 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '0E6B62', space: 8 } }
      })); i++; continue;
    }
    if (/^-{3,}$/.test(s.trim())) { out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } } })); i++; continue; }
    out.push(new Paragraph({ children: runs(s), spacing: { after: 120 } })); i++;
  }
  const hs = (id, size, color) => ({ id, name: id, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, bold: true, size, color } });
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [hs('Title', 44, '16222B'), hs('Heading1', 32, '0E6B62'), hs('Heading2', 26, '16222B'), hs('Heading3', 24, '16222B')]
    },
    sections: [{ children: out }]
  });
  return Packer.toBuffer(doc);
}
module.exports = { mdToDocx };
