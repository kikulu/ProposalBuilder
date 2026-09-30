// 將建議書 Markdown 轉為 Word (.docx)。支援：標題、段落、清單、表格、引言、粗體、行內程式碼、分隔線、圖片
// 排版由「Word 格式範本」(style) 決定：字型、字級、顏色、行距、紙張/邊界、頁首頁尾、頁碼、章節換頁
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, Header, Footer, PageNumber,
  WidthType, ShadingType, BorderStyle, ImageRun, AlignmentType, PageOrientation, LineRuleType } = require('docx');

const HEAD = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
const PAGES = { A4: [11906, 16838], A3: [16838, 23811], Letter: [12240, 15840], Legal: [12240, 20160] }; // DXA（1440 = 1 吋），直式
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

const DEFAULT_WORD_STYLE = {
  id: 'ws-default', name: '預設（青綠）',
  fontEastAsia: 'Microsoft JhengHei', fontAscii: 'Calibri',
  sizes: { body: 11, title: 22, h1: 16, h2: 13, h3: 12 },                       // pt
  colors: { title: '16222B', h1: '0E6B62', h2: '16222B', h3: '16222B', tableHead: 'DCEFEC', quote: '0E6B62' },
  lineSpacing: 1.15, paraAfter: 6,                                              // 倍、pt
  page: { size: 'A4', landscape: false, margin: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 } }, // cm
  header: '', headerAlign: 'right', footer: '', footerAlign: 'center', pageNumber: 'full',              // pageNumber: none | num | full
  chapterPageBreak: false
};

const num = (v, d, lo, hi) => { v = parseFloat(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const hex = (v, d) => /^[0-9a-f]{6}$/i.test(v || '') ? v.toUpperCase() : d;
const txt = (v, d, max = 120) => typeof v === 'string' ? v.slice(0, max) : d;
const pick = (v, list, d) => list.includes(v) ? v : d;

// 正規化：缺欄位補預設、數值夾在合理範圍、色碼/選項驗證（範本可能來自匯入的 JSON）
function normStyle(s) {
  s = s && typeof s === 'object' ? s : {};
  const D = DEFAULT_WORD_STYLE, z = s.sizes || {}, c = s.colors || {}, p = s.page || {}, m = p.margin || {};
  return {
    id: s.id || D.id, name: txt(s.name, D.name, 60),
    fontEastAsia: txt(s.fontEastAsia, D.fontEastAsia, 60) || D.fontEastAsia, fontAscii: txt(s.fontAscii, D.fontAscii, 60) || D.fontAscii,
    sizes: { body: num(z.body, D.sizes.body, 8, 20), title: num(z.title, D.sizes.title, 12, 48), h1: num(z.h1, D.sizes.h1, 10, 36), h2: num(z.h2, D.sizes.h2, 9, 30), h3: num(z.h3, D.sizes.h3, 8, 24) },
    colors: { title: hex(c.title, D.colors.title), h1: hex(c.h1, D.colors.h1), h2: hex(c.h2, D.colors.h2), h3: hex(c.h3, D.colors.h3), tableHead: hex(c.tableHead, D.colors.tableHead), quote: hex(c.quote, D.colors.quote) },
    lineSpacing: num(s.lineSpacing, D.lineSpacing, 1, 3), paraAfter: num(s.paraAfter, D.paraAfter, 0, 36),
    page: { size: pick(p.size, Object.keys(PAGES), 'A4'), landscape: !!p.landscape,
      margin: { top: num(m.top, 2.54, 0.5, 6), bottom: num(m.bottom, 2.54, 0.5, 6), left: num(m.left, 2.54, 0.5, 6), right: num(m.right, 2.54, 0.5, 6) } },
    header: txt(s.header, '', 200), headerAlign: pick(s.headerAlign, Object.keys(ALIGN), 'right'),
    footer: txt(s.footer, '', 200), footerAlign: pick(s.footerAlign, Object.keys(ALIGN), 'center'),
    pageNumber: pick(s.pageNumber, ['none', 'num', 'full'], 'full'), chapterPageBreak: !!s.chapterPageBreak
  };
}

const runsFor = (S) => (text, base = {}) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(t =>
  t.startsWith('**') ? new TextRun({ ...base, text: t.slice(2, -2), bold: true })
    : t.startsWith('`') ? new TextRun({ ...base, text: t.slice(1, -1), font: 'Consolas' })
      : new TextRun({ ...base, text: t }));

function tableFor(lines, S, runs, contentW) {
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const rows = lines.filter(r => !(/^\s*\|[\s:|-]+\|\s*$/.test(r) && r.includes('-'))).map(cells);
  const n = Math.max(...rows.map(r => r.length)), w = Math.floor(contentW / n);
  return new Table({
    width: { size: w * n, type: WidthType.DXA }, columnWidths: Array(n).fill(w),
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: n }, (_, i) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: S.colors.tableHead, color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ spacing: { after: 0 }, children: runs(r[i] || '', ri === 0 ? { bold: true } : {}) })]
      }))
    }))
  });
}

async function mdToDocx(md, opts = {}) {
  const S = normStyle(opts.style), runs = runsFor(S);
  const [pw, ph] = PAGES[S.page.size], mg = S.page.margin, cm = v => Math.round(v * 567);
  const contentW = (S.page.landscape ? ph : pw) - cm(mg.left) - cm(mg.right);
  const L = md.replace(/\r/g, '').split('\n'), out = [];
  let i = 0, m;
  while (i < L.length) {
    const s = L[i];
    if (!s.trim()) { i++; continue; }
    if ((m = s.match(/^(#{1,4})\s+(.*)/))) { out.push(new Paragraph({ heading: HEAD[m[1].length - 1], children: runs(m[2]) })); i++; continue; }
    if (/^\s*\|/.test(s)) {
      const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]);
      out.push(tableFor(rows, S, runs, contentW), new Paragraph({})); continue;
    }
    if ((m = s.match(/^(\s*)[-*]\s+(.*)/))) { out.push(new Paragraph({ children: runs(m[2]), bullet: { level: Math.min(Math.floor(m[1].length / 2), 2) } })); i++; continue; }
    if (/^\d+\.\s+/.test(s)) { out.push(new Paragraph({ children: runs(s), indent: { left: 360 } })); i++; continue; }
    if ((m = s.match(/^>\s?(.*)/))) {
      out.push(new Paragraph({
        children: runs(m[1], { color: '555555' }), indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: S.colors.quote, space: 8 } }
      })); i++; continue;
    }
    if ((m = s.match(/^!\[([^\]]*)\]\(image:([\w-]+\.\w+)\)\s*$/))) {
      const im = opts.readImage && opts.readImage(m[2]);
      if (im) {
        const maxW = Math.round(contentW / 15), w = Math.min(im.width, maxW, 560), h = Math.round(im.height * w / im.width); // DXA → px（1px = 15 DXA）
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: im.type, data: im.data, transformation: { width: w, height: h } })] }));
        if (m[1]) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs(m[1], { size: 18, color: '555555' }) }));
      } else out.push(new Paragraph({ children: runs(`[找不到圖片：${m[2]}]`, { color: 'B3261E' }) }));
      i++; continue;
    }
    if (/^-{3,}$/.test(s.trim())) { out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } } })); i++; continue; }
    out.push(new Paragraph({ children: runs(s) })); i++;
  }

  const FONT = { ascii: S.fontAscii, hAnsi: S.fontAscii, eastAsia: S.fontEastAsia };
  // 直接覆寫內建的 Title / Heading1-3 樣式（不可再用 paragraphStyles 加同 ID 樣式，否則檔內會有兩份，多數讀取器只採用第一份）
  const hs = (size, color, extra = {}) => ({ run: { font: FONT, bold: true, size: Math.round(size * 2), color }, paragraph: { spacing: { before: 240, after: 120 }, ...extra } });
  const hf = (t, align, size = 18) => new Paragraph({ alignment: ALIGN[align], children: runs(t, { size, color: '777777' }) });
  const pn = { full: ['第 ', PageNumber.CURRENT, ' 頁 / 共 ', PageNumber.TOTAL_PAGES, ' 頁'], num: [PageNumber.CURRENT] }[S.pageNumber];
  const footKids = [];
  if (S.footer) footKids.push(...runs(S.footer + (pn ? '　' : ''), { size: 18, color: '777777' }));
  if (pn) footKids.push(new TextRun({ children: pn, size: 18, color: '777777' }));

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: Math.round(S.sizes.body * 2) }, paragraph: { spacing: { line: Math.round(S.lineSpacing * 240), lineRule: LineRuleType.AUTO, after: Math.round(S.paraAfter * 20) } } },
        title: hs(S.sizes.title, S.colors.title),
        heading1: hs(S.sizes.h1, S.colors.h1, { outlineLevel: 0, pageBreakBefore: S.chapterPageBreak }),
        heading2: hs(S.sizes.h2, S.colors.h2, { outlineLevel: 1 }),
        heading3: hs(S.sizes.h3, S.colors.h3, { outlineLevel: 2 })
      }
    },
    sections: [{
      properties: { page: { size: { width: pw, height: ph, orientation: S.page.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: cm(mg.top), bottom: cm(mg.bottom), left: cm(mg.left), right: cm(mg.right) } } },
      headers: S.header ? { default: new Header({ children: [hf(S.header, S.headerAlign)] }) } : undefined,
      footers: footKids.length ? { default: new Footer({ children: [new Paragraph({ alignment: ALIGN[S.footerAlign], children: footKids })] }) } : undefined,
      children: out
    }]
  });
  return Packer.toBuffer(doc);
}
module.exports = { mdToDocx, normStyle, DEFAULT_WORD_STYLE };
