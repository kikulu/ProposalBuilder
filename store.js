// 範本儲存：JSON 索引檔 + Markdown 區塊檔（資料夾管理、編號檔名）。不依賴 Electron，可單獨測試。
//
// data/
//   templates.json              ← UTF-8 索引檔：範本 / 章節 / 區塊的名稱、順序、關鍵字、Word 格式，不含內文
//   templates/T001/C01/B0001.md ← 範本 001 › 章節 01 › 區塊 0001 的內文（Markdown）
//   library/L0001.md            ← 區塊庫的區塊內文
//
// 檔名一律用編號（不含中文或特殊字元），標題只存在索引檔裡，因此改名、換系統、壓縮傳輸都不會發生檔名錯亂。
// 編號建立後固定不變：區塊移到別的章節只會換資料夾，重新排序只改索引檔。
const fs = require('fs'), path = require('path');

const SCHEMA = 2;
const pad = (n, w) => String(n).padStart(w, '0');
const tplDir = t => `templates/T${pad(t.no, 3)}`;
const blockFile = (t, c, b) => `${tplDir(t)}/C${pad(c.no, 2)}/B${pad(b.no, 4)}.md`;
const libFile = b => `library/L${pad(b.no, 4)}.md`;

// 補齊 / 修正編號：缺少或重複的項目取「目前最大值 + 1」。範本、區塊庫各自獨立；章節與區塊在同一範本內不重複。
function assignNumbers(d) {
  const fix = (list, used) => {
    let max = Math.max(0, ...list.map(x => +x.no || 0));
    list.forEach(x => { if (!(x.no > 0) || used.has(x.no)) x.no = ++max; used.add(x.no); });
  };
  fix(d.templates, new Set());
  d.templates.forEach(t => {
    const usedB = new Set();
    fix(t.chapters, new Set());
    const all = t.chapters.flatMap(c => c.blocks);
    fix(all, usedB);
  });
  fix(d.library || (d.library = []), new Set());
  return d;
}

const isIndexed = d => d && d.schema === SCHEMA;

// 把「內文內嵌」的完整資料拆成 { index, files }。files: { 相對路徑: 內文 }
function split(d) {
  assignNumbers(d);
  const files = {};
  const templates = d.templates.map(t => ({
    id: t.id, no: t.no, name: t.name,
    chapters: t.chapters.map(c => ({
      id: c.id, no: c.no, title: c.title,
      blocks: c.blocks.map(b => {
        const file = blockFile(t, c, b); files[file] = b.content == null ? '' : String(b.content);
        return { id: b.id, no: b.no, title: b.title, keywords: b.keywords || [], file };
      })
    }))
  }));
  const library = d.library.map(b => {
    const file = libFile(b); files[file] = b.content == null ? '' : String(b.content);
    const { content, ...rest } = b;
    return { ...rest, keywords: b.keywords || [], file };
  });
  const { templates: _t, library: _l, ...other } = d;
  return { index: { schema: SCHEMA, ...other, templates, library }, files };
}

// 依索引與「讀檔函式」組回完整資料（內文放回 content；file 欄位僅供儲存用，不帶進記憶體資料）
function assemble(index, readText) {
  const missing = [], get = f => { const t = readText(f); if (t == null) { missing.push(f); return ''; } return t; };
  const { schema, ...rest } = index;
  const d = {
    ...rest,
    templates: index.templates.map(t => ({
      ...t, chapters: t.chapters.map(c => ({
        ...c, blocks: c.blocks.map(({ file, ...b }) => ({ ...b, content: get(file) }))
      }))
    })),
    library: (index.library || []).map(({ file, ...b }) => ({ ...b, content: get(file) }))
  };
  Object.defineProperty(d, '_missing', { value: missing, enumerable: false });
  return d;
}

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const pruneEmpty = dir => {                                  // 刪除空資料夾（含子層），保留 dir 本身
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) { const p = path.join(dir, e.name); pruneEmpty(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); }
};

// 寫入：先寫 md，再寫索引，最後清掉不再使用的 md（避免中途失敗時索引指向不存在的檔案）
function writeStore(dir, d) {
  const { index, files } = split(d);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) fs.writeFileSync(p, text, 'utf8');
  }
  fs.writeFileSync(path.join(dir, 'templates.json'), JSON.stringify(index, null, 2), 'utf8');
  const keep = new Set(Object.keys(files));
  for (const root of ['templates', 'library']) {
    for (const p of walk(path.join(dir, root))) {
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (p.endsWith('.md') && !keep.has(rel)) fs.unlinkSync(p);
    }
    pruneEmpty(path.join(dir, root));
  }
  return d;                                                  // 已補上 no 編號
}

// 讀取：新格式依索引組合；舊格式（內文內嵌在 templates.json）原樣回傳並標記 legacy，由呼叫端決定是否轉存
function readStore(dir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'templates.json'), 'utf8'));
  if (!isIndexed(raw)) { Object.defineProperty(raw, '_legacy', { value: true, enumerable: false }); return raw; }
  return assemble(raw, f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } });
}

// 把儲存後補上的編號同步回另一份資料（介面端的資料物件依 id 對應），讓下次儲存沿用同一組檔名
function adoptNumbers(target, src) {
  const by = (list, id) => (list || []).find(x => x.id === id);
  (target.templates || []).forEach(t => {
    const s = by(src.templates, t.id); if (!s) return; t.no = s.no;
    (t.chapters || []).forEach(c => {
      const sc = by(s.chapters, c.id); if (!sc) return; c.no = sc.no;
      (c.blocks || []).forEach(b => { const sb = by(sc.blocks, b.id); if (sb) b.no = sb.no; });
    });
  });
  (target.library || []).forEach(b => { const s = by(src.library, b.id); if (s) b.no = s.no; });
}

module.exports = { SCHEMA, assignNumbers, split, assemble, writeStore, readStore, isIndexed, adoptNumbers, blockFile, libFile };
