const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeImage } = require('electron');
const fs = require('fs'), path = require('path'), { execFile, spawn } = require('child_process');
const { mdToDocx } = require('./mdToDocx');
const store = require('./store');

const defaults = () => JSON.parse(JSON.stringify(require('./defaults')));
let win, dir, file, imgDir, attDir, defImg, defAtt, docDir, settingsFile, idxFile, settings = {}, settingsWarn = '';

// ---- 資料與 git 版本控管（範本資料存於使用者資料夾 /data，自帶獨立 git repo）----
const git = (...a) => new Promise(r => execFile('git', a, { cwd: dir, maxBuffer: 20e6 }, (e, o) => r(e ? null : o)));
const read = () => {
  const d = store.readStore(dir), df = defaults();
  if (d._legacy) { store.writeStore(dir, d); commit('範本拆分為 Markdown 區塊檔（JSON 索引 + 編號資料夾）'); }   // 舊版把內文放在 templates.json，第一次讀取時自動轉換
  d.library = d.library || df.library;
  if ((d.libSeed || 0) < df.libSeed) {                       // 補入內建區塊（以 標題+內容 比對，不重複）；只做一次
    const have = new Set(d.library.map(b => b.title + '\u0000' + b.content)), ids = new Set(d.library.map(b => b.id));
    df.library.forEach(b => { if (!have.has(b.title + '\u0000' + b.content)) d.library.push({ ...b, id: ids.has(b.id) ? 'lb' + Math.random().toString(36).slice(2, 8) : b.id }); });
    d.libSeed = df.libSeed; write(d);
  }
  d.wordStyles = Array.isArray(d.wordStyles) && d.wordStyles.length ? d.wordStyles : df.wordStyles;   // Word 格式範本
  if (!d.wordStyles.some(x => x.id === d.defaultWordStyle)) d.defaultWordStyle = d.wordStyles[0].id;
  return d;
};
const write = d => store.writeStore(dir, d);          // 索引檔 templates.json + templates/T001/C01/B0001.md …
const hasGit = () => fs.existsSync(path.join(dir, '.git'));
let commitQ = Promise.resolve();
const enqueue = fn => (commitQ = commitQ.then(fn).catch(() => {}));
const IDENT = ['-c', 'user.name=ProposalBuilder', '-c', 'user.email=pb@local'];
// ---- 版本 Tag：每個版本自動編號 v0001、v0002…（附註標籤）；標籤的「說明文字」= 使用者為此版本取的名稱 ----
const TAGRE = /^v\d{4,}$/;
async function nextTag() {
  const o = (await git('tag', '-l', 'v[0-9]*')) || '';
  return 'v' + String(Math.max(0, ...o.split('\n').filter(x => TAGRE.test(x)).map(x => +x.slice(1))) + 1).padStart(4, '0');
}
async function tagMap() {                                // 完整 commit hash → { tag, label }
  const o = await gq('for-each-ref', 'refs/tags', '--format=%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objectname)%09%(contents:subject)');
  const m = new Map(); if (!o) return m;
  for (const l of o.split('\n').filter(Boolean)) {
    const [name, type, obj, target, label] = l.split('\t'); if (!TAGRE.test(name)) continue;
    const h = type === 'tag' ? target : obj; if (h && !m.has(h)) m.set(h, { tag: name, label: type === 'tag' ? (label || '') : '' });
  }
  return m;
}
async function tagRef(ref, label = '') { const t = await nextTag(); await git(...IDENT, 'tag', '-a', t, '-m', label, ref); return t; }
async function backfillTags() {                          // 舊資料（升級前的版本）補上編號，依時間由舊到新
  const o = await git('rev-list', '--reverse', 'HEAD'); if (!o) return;
  const have = await tagMap();
  for (const h of o.split('\n').filter(Boolean)) if (!have.has(h)) await tagRef(h);
}
const commit = msg => enqueue(async () => {
  if (!hasGit()) return;
  await git('add', '-A');
  if ((await git(...IDENT, 'commit', '-m', msg)) !== null) await tagRef('HEAD');
});
// ---- 版本歷史：檢視 git 紀錄、查看差異、還原範本 / 文件、找回已刪除文件 ----
const REF = /^[0-9a-f]{4,40}\^?$/, HASH = /^[0-9a-f]{4,40}$/;
const okHPath = p => typeof p === 'string' && (p === 'templates.json' || p === 'files-index.json' || /^documents\/[\w-]+\.json$/.test(p));
const gq = (...a) => git('-c', 'core.quotepath=false', ...a);
const PRETTY = '--pretty=format:%x1e%h%x1f%aI%x1f%H%x1f%s';
const parseCommits = o => o.split('\x1e').filter(b => b.trim()).map(b => {
  const [head, ...rest] = b.split('\n'), [h, d, H, ...sub] = head.split('\x1f');
  return { h, H, d, s: sub.join('\x1f'), files: rest.filter(l => l.trim()).map(l => { const [st, ...pp] = l.split('\t'); return { s: st[0], p: pp.join('\t') }; }) };
});
const kindOf = p => p === 'templates.json' || /^(templates|library)\//.test(p) ? 'tpl' : /^documents\//.test(p) ? 'doc' : p === 'files-index.json' ? 'idx' : /^images\//.test(p) ? 'img' : 'other';
const blob = async (ref, p) => (REF.test(ref) && okHPath(p)) ? await gq('show', `${ref}:${p}`) : null;
// 一次讀出某版本的多個檔案（git cat-file --batch，只開一個程序）
const gitBatch = (ref, paths) => new Promise(res => {
  const p = spawn('git', ['cat-file', '--batch'], { cwd: dir }), chunks = [];
  p.on('error', () => res(null)); p.stdout.on('data', c => chunks.push(c));
  p.on('close', () => {
    const buf = Buffer.concat(chunks), out = {}; let pos = 0;
    for (const f of paths) {
      const nl = buf.indexOf(10, pos); if (nl < 0) break;
      const head = buf.slice(pos, nl).toString(), m = head.match(/^\S+ blob (\d+)$/); pos = nl + 1;
      if (!m) { out[f] = null; continue; }
      const len = +m[1]; out[f] = buf.slice(pos, pos + len).toString('utf8'); pos += len + 1;
    }
    res(out);
  });
  p.stdin.end(paths.map(f => `${ref}:${f}\n`).join(''));
});
// 某個版本的完整範本資料：新格式依索引 + md 組回；舊格式（內文內嵌）直接回傳
async function tplAt(ref) {
  if (!REF.test(ref)) return null;
  const t = await gq('show', `${ref}:templates.json`); if (!t) return null;
  let idx; try { idx = JSON.parse(t); } catch { return null; }
  if (!store.isIndexed(idx)) return idx;
  const files = [...idx.templates.flatMap(x => x.chapters.flatMap(c => c.blocks.map(b => b.file))), ...(idx.library || []).map(b => b.file)];
  const got = await gitBatch(ref, files); if (!got) return null;
  return store.assemble(idx, f => got[f]);
}
const titleAt = async (ref, p) => { try { return JSON.parse(await blob(ref, p)).title || ''; } catch { return ''; } };
ipcMain.handle('historyInfo', async () => ({ enabled: hasGit() && (await git('--version')) !== null }));
ipcMain.handle('historyList', async (e, o = {}) => {
  const skip = Math.max(0, parseInt(o.skip) || 0), limit = Math.min(100, Math.max(1, parseInt(o.limit) || 40));
  const paths = { tpl: ['templates.json', 'templates/', 'library/'], doc: ['documents/'], file: ['files-index.json', 'images/'] }[o.kind] || [];
  const q = String(o.q || '').trim().slice(0, 100).toLowerCase();
  const a = ['log', '--no-renames', '--name-status', PRETTY];
  if (!q) a.push('-n', String(limit + 1), '--skip', String(skip)); else a.push('-n', '1000');
  const out = await gq(...a, '--', ...paths); if (out === null) return null;
  const tags = await tagMap();
  let all = parseCommits(out).map(c => ({ ...c, ...(tags.get(c.H) || {}) }));
  if (q) all = all.filter(c => (c.s + ' ' + (c.tag || '') + ' ' + (c.label || '')).toLowerCase().includes(q)).slice(skip);   // 搜尋範圍：說明、Tag 編號、Tag 名稱
  const more = all.length > limit;
  return { items: all.slice(0, limit).map(c => ({ h: c.h, d: c.d, s: c.s, tag: c.tag || '', label: c.label || '', n: c.files.length, tpl: c.files.some(f => kindOf(f.p) === 'tpl'), docs: c.files.filter(f => kindOf(f.p) === 'doc').length, files: c.files.filter(f => ['img', 'idx'].includes(kindOf(f.p))).length })), more };
});
ipcMain.handle('historyShow', async (e, hash) => {
  if (!HASH.test(hash)) return null;
  const out = await gq('show', '--no-renames', '--name-status', PRETTY, hash); if (out === null) return null;
  const c = parseCommits(out)[0]; if (!c) return null;
  const tg = (await tagMap()).get(c.H) || {}; c.tag = tg.tag || ''; c.label = tg.label || '';
  const tplF = c.files.filter(f => kindOf(f.p) === 'tpl');                    // 範本被拆成很多 md 檔：在介面上合併成一筆「範本、區塊庫與 Word 格式」
  if (tplF.length) c.files = [{ s: tplF.some(f => f.p === 'templates.json' && f.s === 'A') && tplF.length === 1 ? 'A' : 'M', p: 'templates.json', n: tplF.length }, ...c.files.filter(f => kindOf(f.p) !== 'tpl')];
  c.files = await Promise.all(c.files.map(async f => { const k = kindOf(f.p); return { ...f, k, title: k === 'doc' ? await titleAt(f.s === 'D' ? hash + '^' : hash, f.p) : '' }; }));
  return c;
});
ipcMain.handle('historyBlob', async (e, ref, p) => {
  const t = p === 'templates.json' ? (d => d ? JSON.stringify(d) : null)(await tplAt(ref)) : await blob(ref, p);
  return t === null || t.length > 4e6 ? null : t;
});     // 差異由介面端計算
ipcMain.handle('docHistory', async (e, id) => {
  if (!okId(id)) return [];
  const o = await gq('log', '--no-renames', '-n', '100', PRETTY, '--', `documents/${id}.json`);
  const tags = await tagMap();
  return o === null ? [] : parseCommits(o).map(c => ({ h: c.h, d: c.d, s: c.s, tag: (tags.get(c.H) || {}).tag || '', label: (tags.get(c.H) || {}).label || '' }));
});
ipcMain.handle('docRestore', async (e, ref, id) => {
  if (!REF.test(ref) || !okId(id)) return null;
  const t = await blob(ref, `documents/${id}.json`); if (!t) return null;
  let d; try { d = JSON.parse(t); } catch { return null; }
  if (typeof d.md !== 'string') return null;
  const old = fs.existsSync(docPath(id)) ? JSON.parse(fs.readFileSync(docPath(id), 'utf8')) : null;
  const doc = { ...d, id, tags: cleanTags(d.tags), star: !!d.star, created: (old && old.created) || d.created || new Date().toISOString(), updated: new Date().toISOString() };
  fs.writeFileSync(docPath(id), JSON.stringify(doc, null, 2)); await commit(`還原文件：${doc.title}（版本 ${ref.replace('^', '')}）`); return meta(doc);
});
ipcMain.handle('docsDeleted', async () => {
  const o = await gq('log', '--diff-filter=D', '--no-renames', '--name-only', '-n', '300', '--pretty=format:%x1e%h%x1f%aI', '--', 'documents/'); if (o === null) return [];
  const seen = new Set(), out = [];
  for (const b of o.split('\x1e').filter(x => x.trim())) {
    const [head, ...rest] = b.split('\n'), [h, d] = head.split('\x1f');
    for (const p of rest.filter(l => /^documents\/[\w-]+\.json$/.test(l.trim())).map(l => l.trim())) {
      const id = path.basename(p, '.json'); if (seen.has(id) || fs.existsSync(docPath(id))) continue; seen.add(id);
      out.push({ id, ref: h + '^', h, d, title: (await titleAt(h + '^', p)) || id });
    }
  }
  return out;
});

// ---- 設定（機器專屬，存於 userData/settings.json，不進版本控管）：圖片 / 附件的儲存路徑 ----
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {}; } catch { return {}; } };
const writeSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
const writable = d => { try { fs.mkdirSync(d, { recursive: true }); const t = path.join(d, '.pb-write-test-' + process.pid); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); return true; } catch { return false; } };
function applyDirs() {                                   // 自訂路徑不可用（例如外接硬碟未接上）時退回預設，並提示
  settingsWarn = '';
  const pick = (custom, def, label) => { if (custom && path.isAbsolute(custom) && writable(custom)) return custom; if (custom) settingsWarn += `${label}資料夾無法使用（${custom}），已暫時改用預設位置。`; return def; };
  imgDir = pick(settings.imgDir, defImg, '圖片'); attDir = pick(settings.attDir, defAtt, '附件');
}
async function initData() {
  dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'templates.json'); idxFile = path.join(dir, 'files-index.json');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  defImg = path.join(dir, 'images'); defAtt = path.join(dir, 'attachments'); docDir = path.join(dir, 'documents');
  [defImg, defAtt, docDir].forEach(d => fs.mkdirSync(d, { recursive: true }));
  settings = readSettings(); applyDirs();
  const gi = path.join(dir, '.gitignore');                 // 附件可能很大，預設資料夾不納入 git
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'attachments/\n');
  if (!fs.existsSync(file)) write(defaults());
  const ga = path.join(dir, '.gitattributes');              // Markdown 一律 LF，跨 Windows / macOS 不會因換行被判成整檔變更
  if (!fs.existsSync(ga)) fs.writeFileSync(ga, '*.md text eol=lf\n*.json text eol=lf\n');
  if (!hasGit() && (await git('--version'))) { await git('init'); await commit('初始化內建範本（軟體開發案、維護案）'); }
  else if (hasGit()) await enqueue(backfillTags);           // 升級前的舊版本補上 Tag 編號
}
const fmtDate = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return isNaN(d) ? '' : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const stamp = () => new Date().toLocaleString('zh-TW', { hour12: false });

ipcMain.handle('load', () => read());
ipcMain.handle('save', async (e, d) => { write(d); await commit('更新範本 ' + stamp()); return { templates: d.templates, library: d.library }; });   // 回傳補上編號的資料，介面端沿用同一組檔名
ipcMain.handle('reset', async () => { const old = read(), d = defaults(); d.wordStyles = old.wordStyles; d.defaultWordStyle = old.defaultWordStyle; write(d); await commit('還原為內建預設範本'); return d; }); // 保留使用者的 Word 格式範本
ipcMain.handle('log', async () => {
  const o = await gq('log', '-n', '40', '--pretty=format:%h\t%aI\t%H\t%s', '--', 'templates.json', 'templates/', 'library/');
  if (o === null) return null;
  const tags = await tagMap();
  return o.split('\n').filter(Boolean).map(l => { const [h, d, H, ...s] = l.split('\t'), t = tags.get(H) || {}; return { h, d: fmtDate(d), s: s.join('\t'), tag: t.tag || '', label: t.label || '' }; });
});
ipcMain.handle('restore', async (e, hash) => {
  if (!REF.test(hash)) return null;                                   // 允許 <hash>^：還原到該次變更「之前」
  const d = await tplAt(hash); if (!d || !Array.isArray(d.templates)) return null;
  write(d);                                                          // 依該版本內容重寫索引與 md，並清掉多餘的 md
  await commit('還原至版本 ' + hash.replace('^', '（變更前）'));
  return read();
});
// 設定版本 Tag 的名稱（空字串 = 清除名稱，Tag 編號保留）
ipcMain.handle('tagSet', (e, hash, label) => {
  if (!HASH.test(hash)) return null;
  label = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return enqueue(async () => {
    const full = ((await git('rev-parse', '--verify', hash + '^{commit}')) || '').trim(); if (!full) return null;
    const cur = (await tagMap()).get(full);
    if (cur) await git(...IDENT, 'tag', '-f', '-a', cur.tag, '-m', label, full); else await tagRef(full, label);
    return (await tagMap()).get(full) || null;
  });
});

// ---- 匯出 / 匯入 ----
const safe = n => (n || '服務建議書').replace(/[\\/:*?"<>|]/g, '_');
async function saveAs(name, ext) {
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safe(name)}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  return r.canceled ? null : r.filePath;
}
// ---- 圖片：存於「圖片資料夾」（預設 data/images，可在設定變更），文件中以 ![說明](image:檔名) 引用 ----
const okImg = f => typeof f === 'string' && /^[\w-]+\.(png|jpe?g|gif|bmp)$/i.test(f);
const rawUrl = p => `data:image/${path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg')};base64,` + fs.readFileSync(p).toString('base64');
const thumb = p => { try { const n = nativeImage.createFromPath(p); if (!n.isEmpty()) return n.resize({ width: 160 }).toDataURL(); } catch {} return rawUrl(p); };
const imgRe = /!\[([^\]]*)\]\(image:([\w-]+\.\w+)\)/g;
const imgRoots = () => [...new Set([imgDir, defImg])];                       // 目前資料夾優先；預設資料夾作為後備，避免改路徑後舊圖片找不到
const findImg = f => { if (!okImg(f)) return null; for (const r of imgRoots()) { const p = path.join(r, f); if (fs.existsSync(p)) return p; } return null; };
const readIdx = () => { try { const d = JSON.parse(fs.readFileSync(idxFile, 'utf8')); d.images = d.images || {}; d.attachments = d.attachments || {}; d.tags = d.tags || {}; return d; } catch { return { images: {}, attachments: {}, tags: {} }; } };
const writeIdx = d => fs.writeFileSync(idxFile, JSON.stringify(d, null, 2));
function readImage(f) {
  const p = findImg(f); if (!p) return null;
  const s = nativeImage.createFromPath(p).getSize();
  return { data: fs.readFileSync(p), width: s.width || 400, height: s.height || 300, type: /jpe?g/i.test(f) ? 'jpg' : path.extname(f).slice(1).toLowerCase() };
}
function listImages() {
  const idx = readIdx().images, seen = new Set(), out = [];
  for (const r of imgRoots()) { let names = []; try { names = fs.readdirSync(r).filter(okImg); } catch {}
    for (const f of names) { if (seen.has(f)) continue; seen.add(f); const st = fs.statSync(path.join(r, f)); out.push({ f, name: (idx[f] && idx[f].name) || f, size: st.size, mtime: st.mtimeMs, legacy: r !== imgDir }); } }
  return out.sort((a, b) => b.mtime - a.mtime);
}
ipcMain.handle('imgList', () => listImages().map(x => ({ f: x.f, name: x.name, url: thumb(findImg(x.f)) })));
ipcMain.handle('imgGet', (e, f) => { const p = findImg(f); return p ? rawUrl(p) : null; });

// ---- 檔案庫：圖片 + 附件（附件保留原檔名，存於「附件資料夾」）----
const MAX_FILE = 100 * 1024 * 1024;
const DANGEROUS = /\.(exe|bat|cmd|com|msi|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|jar|sh|command|app|dmg|pkg|lnk|reg|hta|cpl|dll|appimage|deb|rpm)$/i;
const cleanName = n => {
  let b = path.basename(String(n || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (b.length > 150) { const e = path.extname(b).slice(0, 12); b = b.slice(0, 150 - e.length) + e; }
  return b || 'file';
};
const uniqueName = (d, name) => {
  if (!fs.existsSync(path.join(d, name))) return name;
  const e = path.extname(name), b = path.basename(name, e);
  for (let i = 2; ; i++) { const n = `${b} (${i})${e}`; if (!fs.existsSync(path.join(d, n))) return n; }
};
const okAtt = f => typeof f === 'string' && f && f.length <= 200 && !/[\\/\x00]/.test(f) && !f.startsWith('.') && fs.existsSync(path.join(attDir, f)) && fs.statSync(path.join(attDir, f)).isFile();
const listAtts = () => { try { return fs.readdirSync(attDir, { withFileTypes: true }).filter(e => e.isFile() && !e.name.startsWith('.'))
  .map(e => { const st = fs.statSync(path.join(attDir, e.name)); return { f: e.name, name: e.name, size: st.size, mtime: st.mtimeMs, ext: path.extname(e.name).slice(1).toLowerCase(), openable: !DANGEROUS.test(e.name) }; })
  .sort((a, b) => b.mtime - a.mtime); } catch { return []; } };
const fpath = (kind, f) => kind === 'img' ? findImg(f) : kind === 'att' && okAtt(f) ? path.join(attDir, f) : null;
const cleanTags = a => [...new Set((Array.isArray(a) ? a : []).map(t => String(t).trim().slice(0, 20)).filter(Boolean))].slice(0, 10);
function imageUses() {                                   // 圖片被幾份文件（+範本）引用；用來標示「未使用」
  const uses = {}, add = (raw, tag) => { for (const f of new Set([...raw.matchAll(/image:([\w-]+\.\w+)/g)].map(m => m[1]))) uses[f] = (uses[f] || 0) + 1; };
  try { for (const n of fs.readdirSync(docDir).filter(x => x.endsWith('.json'))) add(fs.readFileSync(path.join(docDir, n), 'utf8')); } catch {}
  try { add(fs.readFileSync(file, 'utf8')); } catch {}
  return uses;
}
ipcMain.handle('fileList', () => {
  const ix = readIdx(), uses = imageUses();
  return { images: listImages().map(x => ({ ...x, url: thumb(findImg(x.f)), tags: ix.tags['img:' + x.f] || [], uses: uses[x.f] || 0 })),
    attachments: listAtts().map(x => ({ ...x, tags: ix.tags['att:' + x.f] || [] })), dirs: { img: imgDir, att: attDir } };
});

async function importPaths(kind, paths) {
  const added = [], skipped = [], idx = readIdx();
  for (const src of paths) {
    const base = path.basename(src);
    try {
      const st = fs.statSync(src);
      if (!st.isFile()) throw new Error('不是檔案');
      if (st.size > MAX_FILE) throw new Error('超過 100 MB');
      if (kind === 'img') {
        const ext = path.extname(src).toLowerCase(); if (!/^\.(png|jpe?g|gif|bmp)$/.test(ext)) throw new Error('不支援的圖片格式');
        const f = Math.random().toString(36).slice(2, 10) + ext; fs.copyFileSync(src, path.join(imgDir, f));
        idx.images[f] = { name: path.basename(src, path.extname(src)) }; added.push({ f, name: idx.images[f].name, url: thumb(path.join(imgDir, f)) });
      } else {
        const f = uniqueName(attDir, cleanName(base)); fs.copyFileSync(src, path.join(attDir, f), fs.constants.COPYFILE_EXCL); idx.attachments[f] = 1; added.push({ f, name: f });
      }
    } catch (e) { skipped.push({ name: base, reason: e.message }); }
  }
  if (added.length) { writeIdx(idx); await commit(`新增${kind === 'img' ? '圖片' : '附件'} ${added.length} 個`); }
  return { added, skipped };
}
async function addFiles(kind) {
  const filters = kind === 'img' ? [{ name: '圖片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }] : [{ name: '所有檔案', extensions: ['*'] }];
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
  return r.canceled ? { added: [], skipped: [] } : importPaths(kind, r.filePaths);
}
ipcMain.handle('imgAdd', async () => (await addFiles('img')).added);            // 相容舊介面（製作頁的「插入圖片」對話框）
ipcMain.handle('fileAdd', (e, kind) => kind === 'img' || kind === 'att' ? addFiles(kind) : { added: [], skipped: [] });
ipcMain.handle('fileAddFolder', async (e, kind) => {                              // 從資料夾批次匯入（不含子資料夾，最多 500 個）
  if (kind !== 'img' && kind !== 'att') return { added: [], skipped: [], ignored: 0 };
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (r.canceled) return { added: [], skipped: [], ignored: 0 };
  let names = []; try { names = fs.readdirSync(r.filePaths[0], { withFileTypes: true }).filter(x => x.isFile() && !x.name.startsWith('.')).map(x => x.name); } catch {}
  const isImg = n => /\.(png|jpe?g|gif|bmp)$/i.test(n), pick = (kind === 'img' ? names.filter(isImg) : names).slice(0, 500);
  return { ...(await importPaths(kind, pick.map(n => path.join(r.filePaths[0], n)))), ignored: names.length - pick.length };
});
const items = a => (Array.isArray(a) ? a : []).filter(x => x && (x.kind === 'img' || x.kind === 'att') && fpath(x.kind, x.f)).slice(0, 2000);
ipcMain.handle('fileTags', async (e, list, add, remove) => {
  const ix = readIdx(), ad = cleanTags(add), rm = new Set(cleanTags(remove)), its = items(list);
  for (const x of its) { const k = x.kind + ':' + x.f, cur = ix.tags[k] || [], nx = cleanTags([...cur.filter(t => !rm.has(t)), ...ad]); if (nx.length) ix.tags[k] = nx; else delete ix.tags[k]; }
  if (its.length) { writeIdx(ix); await commit(`更新檔案標籤（${its.length} 個）`); }
  return its.length;
});
ipcMain.handle('fileUsageMany', (e, list) => {
  const its = items(list).filter(x => x.kind === 'img'), docs = []; let templates = 0;
  const has = raw => its.some(x => raw.includes(`image:${x.f}`));
  try { for (const n of fs.readdirSync(docDir).filter(x => x.endsWith('.json'))) { const raw = fs.readFileSync(path.join(docDir, n), 'utf8'); if (has(raw)) { try { docs.push(JSON.parse(raw).title); } catch {} } } } catch {}
  try { if (has(fs.readFileSync(file, 'utf8'))) templates = 1; } catch {}
  return { docs, templates };
});
ipcMain.handle('fileDeleteMany', async (e, list) => {
  const its = items(list), ix = readIdx(); let n = 0;
  for (const x of its) { try { fs.unlinkSync(fpath(x.kind, x.f)); delete (x.kind === 'img' ? ix.images : ix.attachments)[x.f]; delete ix.tags[x.kind + ':' + x.f]; n++; } catch {} }
  if (n) { writeIdx(ix); await commit(`批次刪除檔案 ${n} 個`); }
  return n;
});
ipcMain.handle('fileExportMany', async (e, list) => {
  const its = items(list); if (!its.length) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return null;
  const ix = readIdx(); let n = 0;
  for (const x of its) {
    const src = fpath(x.kind, x.f), nm = x.kind === 'img' ? cleanName(((ix.images[x.f] || {}).name || path.basename(x.f, path.extname(x.f))) + path.extname(x.f)) : x.f;
    try { fs.copyFileSync(src, path.join(r.filePaths[0], uniqueName(r.filePaths[0], nm)), fs.constants.COPYFILE_EXCL); n++; } catch {}
  }
  return { n, dir: r.filePaths[0] };
});
ipcMain.handle('fileOpen', async (e, kind, f) => {
  const p = fpath(kind, f); if (!p) return { ok: false, error: '找不到檔案' };
  if (DANGEROUS.test(f)) return { ok: false, error: '為安全起見，不直接開啟程式或腳本類檔案，請改用「在資料夾中顯示」' };
  const err = await shell.openPath(p); return err ? { ok: false, error: err } : { ok: true };
});
ipcMain.handle('fileReveal', (e, kind, f) => { const p = fpath(kind, f); if (p) shell.showItemInFolder(p); return !!p; });
ipcMain.handle('fileSaveAs', async (e, kind, f) => {
  const p = fpath(kind, f); if (!p) return null;
  const nm = kind === 'img' ? (((readIdx().images[f] || {}).name || path.basename(f, path.extname(f))) + path.extname(f)) : f;
  const r = await dialog.showSaveDialog(win, { defaultPath: cleanName(nm) }); if (r.canceled) return null;
  fs.copyFileSync(p, r.filePath); return r.filePath;
});
ipcMain.handle('fileRename', async (e, kind, f, name) => {
  const p = fpath(kind, f); if (!p) return { ok: false, error: '找不到檔案' };
  name = String(name || '').trim(); if (!name) return { ok: false, error: '名稱不可空白' };
  if (kind === 'img') { const idx = readIdx(); idx.images[f] = { name: name.slice(0, 100) }; writeIdx(idx); await commit('重新命名圖片'); return { ok: true, f }; }
  let n = cleanName(name); if (!path.extname(n) && path.extname(f)) n += path.extname(f);
  if (n === f) return { ok: true, f };
  if (fs.existsSync(path.join(attDir, n))) return { ok: false, error: '已有同名檔案' };
  fs.renameSync(p, path.join(attDir, n)); const idx = readIdx(); if (idx.attachments[f]) { delete idx.attachments[f]; idx.attachments[n] = 1; } if (idx.tags['att:' + f]) { idx.tags['att:' + n] = idx.tags['att:' + f]; delete idx.tags['att:' + f]; } writeIdx(idx); return { ok: true, f: n };
});
ipcMain.handle('fileUsage', (e, kind, f) => {                                    // 找出引用此圖片的文件 / 範本，刪除前提醒
  if (kind !== 'img' || !okImg(f)) return { docs: [], templates: 0 };
  const ref = `image:${f}`, docs = [];
  for (const n of fs.readdirSync(docDir).filter(x => x.endsWith('.json'))) { try { const d = JSON.parse(fs.readFileSync(path.join(docDir, n), 'utf8')); if (JSON.stringify(d).includes(ref)) docs.push(d.title); } catch {} }
  let templates = 0; try { templates = fs.readFileSync(file, 'utf8').includes(ref) ? 1 : 0; } catch {}
  return { docs, templates };
});
ipcMain.handle('fileDelete', async (e, kind, f) => {
  const p = fpath(kind, f); if (!p) return false;
  fs.unlinkSync(p); { const idx = readIdx(); delete (kind === 'img' ? idx.images : idx.attachments)[f]; delete idx.tags[kind + ':' + f]; writeIdx(idx); }
  await commit(`刪除${kind === 'img' ? '圖片' : '附件'}`); return true;
});

// ---- 設定：儲存路徑 ----
const info = () => ({ imgDir, attDir, imgDefault: defImg, attDefault: defAtt, imgCustom: imgDir !== defImg, attCustom: attDir !== defAtt, dataDir: dir, warn: settingsWarn });
ipcMain.handle('settingsGet', () => info());
ipcMain.handle('pickDir', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('openDir', async (e, which) => { const d = { data: dir, img: imgDir, att: attDir }[which]; if (!d) return false; fs.mkdirSync(d, { recursive: true }); await shell.openPath(d); return true; });
ipcMain.handle('settingsSet', async (e, kind, newPath, move) => {
  if (kind !== 'img' && kind !== 'att') return { ok: false, error: '未知的類別' };
  const cur = kind === 'img' ? imgDir : attDir, def = kind === 'img' ? defImg : defAtt, other = kind === 'img' ? attDir : imgDir;
  if (newPath && !path.isAbsolute(newPath)) return { ok: false, error: '請選擇完整路徑' };
  const target = newPath ? path.resolve(newPath) : def;
  if (target === cur) return { ok: true, moved: 0, noop: true };
  if (target === other) return { ok: false, error: '圖片與附件不能使用同一個資料夾' };
  if (!writable(target)) return { ok: false, error: '無法寫入此資料夾，請確認路徑與權限' };
  // 要搬移的檔案：只搬「本程式管理的」檔案，避免動到使用者自己放在資料夾裡的其他檔案
  let names = [];
  if (move) {
    try {
      const all = fs.readdirSync(cur, { withFileTypes: true }).filter(x => x.isFile() && !x.name.startsWith('.')).map(x => x.name);
      const ix = readIdx(), ours = new Set(Object.keys(kind === 'img' ? ix.images : ix.attachments));
      names = all.filter(n => (kind === 'img' ? okImg(n) : true) && (cur === (kind === 'img' ? defImg : defAtt) || ours.has(n)));
    } catch {}
  }
  const plan = [], conflicts = [];                       // 兩階段：先全部複製並驗證，成功後才刪除原檔；任何失敗都不切換路徑、不刪原檔
  for (const n of names) {
    const dn = kind === 'img' ? n : uniqueName(target, n), dest = path.join(target, dn);
    if (kind === 'img' && fs.existsSync(dest)) { if (fs.statSync(dest).size === fs.statSync(path.join(cur, n)).size) { plan.push({ src: path.join(cur, n), dest, done: true }); continue; } conflicts.push(n); continue; }
    plan.push({ src: path.join(cur, n), dest });
  }
  if (conflicts.length) return { ok: false, error: `新資料夾已有同名但內容不同的圖片（${conflicts.slice(0, 3).join('、')}${conflicts.length > 3 ? '…' : ''}），請改選其他資料夾或不搬移現有檔案` };
  try {
    for (const x of plan) if (!x.done) { fs.copyFileSync(x.src, x.dest, fs.constants.COPYFILE_EXCL); if (fs.statSync(x.dest).size !== fs.statSync(x.src).size) throw new Error('複製後檔案大小不符：' + path.basename(x.src)); }
  } catch (err) { return { ok: false, error: '搬移失敗，原檔案都還在原處：' + err.message }; }
  plan.forEach(x => { try { fs.unlinkSync(x.src); } catch {} });
  if (kind === 'att') { const ix = readIdx(); plan.forEach(x => { const a = path.basename(x.src), b = path.basename(x.dest); if (a !== b) { delete ix.attachments[a]; if (ix.tags['att:' + a]) { ix.tags['att:' + b] = ix.tags['att:' + a]; delete ix.tags['att:' + a]; } } ix.attachments[b] = 1; }); writeIdx(ix); }
  settings[kind === 'img' ? 'imgDir' : 'attDir'] = target === def ? '' : target; writeSettings(); applyDirs();
  return { ok: true, moved: plan.length };
});

// ---- 文件庫：data/documents/<id>.json（含標籤 tags、星號 star）----
const okId = id => /^[\w-]+$/.test(id || '');
const docPath = id => path.join(docDir, id + '.json');
const meta = d => ({ id: d.id, title: d.title, tpl: d.tpl, created: d.created, updated: d.updated, tags: cleanTags(d.tags), star: !!d.star });
const readDoc = id => { try { return okId(id) && fs.existsSync(docPath(id)) ? JSON.parse(fs.readFileSync(docPath(id), 'utf8')) : null; } catch { return null; } };
const writeDoc = d => fs.writeFileSync(docPath(d.id), JSON.stringify(d, null, 2));
const allDocs = () => { try { return fs.readdirSync(docDir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(docDir, f), 'utf8')); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const ids = a => [...new Set((Array.isArray(a) ? a : []).filter(okId))].slice(0, 2000);
ipcMain.handle('docList', () => allDocs().map(meta).sort((a, b) => b.updated.localeCompare(a.updated)));
ipcMain.handle('docGet', (e, id) => readDoc(id));
ipcMain.handle('docSave', async (e, d) => {
  const id = okId(d.id) ? d.id : newId(), old = readDoc(id), now = new Date().toISOString();
  const doc = { id, title: d.title || '未命名文件', tpl: d.tpl || '', md: d.md || '', meta: d.meta || {}, tags: cleanTags(d.tags !== undefined ? d.tags : old && old.tags), star: d.star !== undefined ? !!d.star : !!(old && old.star), created: old ? old.created : now, updated: now };
  writeDoc(doc); await commit('儲存文件：' + doc.title); return meta(doc);
});
ipcMain.handle('docDelete', async (e, id) => { if (readDoc(id)) { const t = readDoc(id).title; fs.unlinkSync(docPath(id)); await commit('刪除文件：' + t); } return true; });
ipcMain.handle('docDeleteMany', async (e, list) => {
  let n = 0; for (const id of ids(list)) if (fs.existsSync(docPath(id))) { fs.unlinkSync(docPath(id)); n++; }
  if (n) await commit(`批次刪除文件 ${n} 份`); return n;
});
ipcMain.handle('docDuplicate', async (e, id) => {
  const d = readDoc(id); if (!d) return null; const now = new Date().toISOString(), nd = { ...d, id: newId(), title: d.title + '（副本）', star: false, created: now, updated: now };
  writeDoc(nd); await commit('複製文件：' + d.title); return meta(nd);
});
ipcMain.handle('docMetaMany', async (e, list, patch = {}) => {          // 批次標籤 / 星號，只產生一筆版本紀錄
  const ad = cleanTags(patch.addTags), rm = new Set(cleanTags(patch.removeTags)); let n = 0;
  for (const id of ids(list)) { const d = readDoc(id); if (!d) continue; d.tags = cleanTags([...cleanTags(d.tags).filter(t => !rm.has(t)), ...ad]); if (typeof patch.star === 'boolean') d.star = patch.star; writeDoc(d); n++; }
  if (n) await commit(`更新文件標記（${n} 份）`); return n;
});
ipcMain.handle('docSearch', (e, q) => {                                 // 全文搜尋：標題 / 內文 / 標籤 / 範本
  q = String(q || '').trim().toLowerCase(); if (!q) return [];
  return allDocs().filter(d => [d.title, d.md, d.tpl, ...cleanTags(d.tags)].join('\n').toLowerCase().includes(q)).map(d => d.id);
});

// ---- 匯出（單份 / 批次共用）----
function writeExport(kind, p, md, style) {
  return kind === 'docx' ? mdToDocx(md, { readImage, style }).then(buf => fs.writeFileSync(p, buf)) : Promise.resolve().then(() => {
    const out = path.join(path.dirname(p), 'images');
    fs.writeFileSync(p, md.replace(imgRe, (m, alt, f) => {
      const src = findImg(f); if (!src) return m;
      fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(src, path.join(out, f));
      return `![${alt}](images/${f})`;
    }));
  });
}
ipcMain.handle('export', async (e, kind, name, md, style) => {
  const p = await saveAs(name, kind); if (!p) return null;
  await writeExport(kind, p, md, style); shell.showItemInFolder(p); return p;
});
const fillVars = (s, M = {}) => String(s || '').replace(/\{\{(.+?)\}\}/g, (m, k) => M[k.trim()] || '');
ipcMain.handle('docExportMany', async (e, list, kind, style) => {       // 批次匯出到資料夾；頁首頁尾變數用各文件自己的基本資料
  if (kind !== 'docx' && kind !== 'md') return null;
  const docs = ids(list).map(readDoc).filter(Boolean); if (!docs.length) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return null;
  const dest = r.filePaths[0], failed = []; let n = 0;
  for (const d of docs) {
    try {
      const st = style && typeof style === 'object' ? { ...style, header: fillVars(style.header, (d.meta || {}).M), footer: fillVars(style.footer, (d.meta || {}).M) } : style;
      await writeExport(kind, path.join(dest, uniqueName(dest, safe(d.title) + '.' + kind)), d.md, st); n++;
    } catch (err) { failed.push(d.title); }
  }
  shell.openPath(dest); return { n, failed, dir: dest };
});

// ---- 文件庫備份 / 匯入（含文件用到的圖片）----
ipcMain.handle('docBackup', async (e, list) => {
  const sel = ids(list), docs = sel.length ? sel.map(readDoc).filter(Boolean) : allDocs();
  if (!docs.length) return null;
  const p = await saveAs('文件庫備份_' + new Date().toISOString().slice(0, 10), 'json'); if (!p) return null;
  const images = {}, want = new Set(docs.flatMap(d => [...JSON.stringify(d).matchAll(/image:([\w-]+\.\w+)/g)].map(m => m[1])));
  for (const f of want) { const src = findImg(f); if (src) images[f] = { name: (readIdx().images[f] || {}).name || '', data: fs.readFileSync(src).toString('base64') }; }
  fs.writeFileSync(p, JSON.stringify({ app: 'proposal-maker', v: 1, exported: new Date().toISOString(), docs, images }));
  return { path: p, docs: docs.length, images: Object.keys(images).length };
});
ipcMain.handle('docImport', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); if (r.canceled) return null;
  let b; try { b = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { error: '檔案不是有效的 JSON' }; }
  if (!b || b.app !== 'proposal-maker' || !Array.isArray(b.docs)) return { error: '這不是本程式匯出的文件庫備份檔' };
  const rename = {}, ix = readIdx(); let nImg = 0;
  for (const [f, im] of Object.entries(b.images && typeof b.images === 'object' ? b.images : {})) {   // 先處理圖片；同名但內容不同 → 換新檔名並改寫引用
    if (!okImg(f) || !im || typeof im.data !== 'string') continue;
    let buf; try { buf = Buffer.from(im.data, 'base64'); } catch { continue; } if (!buf.length) continue;
    const ex = findImg(f);
    if (ex && fs.readFileSync(ex).equals(buf)) continue;
    let nf = f; if (ex) { nf = Math.random().toString(36).slice(2, 10) + path.extname(f).toLowerCase(); rename[f] = nf; }
    fs.writeFileSync(path.join(imgDir, nf), buf); if (im.name) ix.images[nf] = { name: String(im.name).slice(0, 100) }; nImg++;
  }
  let imported = 0, skipped = 0;
  for (const raw of b.docs.slice(0, 2000)) {
    if (!raw || typeof raw.md !== 'string' || typeof raw.title !== 'string' || raw.md.length > 5e6) { skipped++; continue; }
    let txt = JSON.stringify(raw); for (const [o, n] of Object.entries(rename)) txt = txt.split(`image:${o})`).join(`image:${n})`);
    const d = JSON.parse(txt), cur = okId(d.id) ? readDoc(d.id) : null;
    if (cur && cur.md === d.md && cur.title === d.title) { skipped++; continue; }        // 完全相同：略過
    const now = new Date().toISOString(), id = !cur && okId(d.id) ? d.id : newId();
    writeDoc({ id, title: String(d.title).slice(0, 200) + (cur ? '（匯入）' : ''), tpl: String(d.tpl || ''), md: d.md, meta: d.meta && typeof d.meta === 'object' ? d.meta : {}, tags: cleanTags(d.tags), star: !!d.star, created: d.created || now, updated: cur ? now : (d.updated || now) });
    imported++;
  }
  if (nImg) writeIdx(ix);
  if (imported || nImg) await commit(`匯入文件庫：${imported} 份文件、${nImg} 張圖片`);
  return { imported, skipped, images: nImg };
});

ipcMain.handle('exportJson', async (e, name, data) => {
  const p = await saveAs(name, 'json'); if (!p) return null;
  fs.writeFileSync(p, JSON.stringify(data, null, 2)); return p;
});
ipcMain.handle('importJson', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return null; }
});
ipcMain.handle('clip', (e, t) => clipboard.writeText(t));

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 360, minHeight: 520, autoHideMenuBar: true, title: '服務建議書製作器',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(async () => { await initData(); createWindow(); });
app.on('window-all-closed', () => app.quit());
