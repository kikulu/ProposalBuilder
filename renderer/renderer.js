const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mv = (a, i, d) => { const j = i + d; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; };
const kw = s => s.split(/[,，、]/).map(x => x.trim()).filter(Boolean);
const clone = o => JSON.parse(JSON.stringify(o));
const TABS = ['make', 'edit', 'lib', 'docs', 'wst', 'files', 'hist', 'set'];
let DB, cur, ed = null, sel = new Set(), libId = null, tab = 'make';
let pvSeen = false, lastSaved = null, isDirty = false;   // 進度列與儲存狀態用
let W = [], wTpl = null, wTouched = false;           // 本文件的章節/區塊（由範本複製，可自由調整，不影響範本）
let manual = false, docId = null, docTitle = '', pvOn = false;   // manual：右側文字已手動修改
let DOCS = [], vDoc = null, vEdit = false, wsId = null;
const M = { 案名: '', 機關: '', 公司: '', 日期: new Date().toISOString().slice(0, 10) };
const T = () => DB.templates.find(t => t.id === cur);
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2400); };
const dirty = () => setDirty(true);
const hit = b => { const r = $('#rfp').value; return r && (b.keywords || []).some(k => k && r.includes(k)); };
const fresh = t => { t.id = uid(); t.chapters.forEach(c => { c.id = uid(); c.blocks.forEach(b => b.id = uid()); }); return t; };
const pad = n => String(n).padStart(2, '0');
const fmt = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const vars = s => String(s || '').replace(/\{\{(.+?)\}\}/g, (m, k) => M[k.trim()] || '');
const wStyle = () => DB.wordStyles.find(s => s.id === DB.defaultWordStyle) || DB.wordStyles[0];
const exStyle = () => { const s = clone(wStyle()); s.header = vars(s.header); s.footer = vars(s.footer); return s; };   // 頁首頁尾可用 {{案名}} 等變數
const GNONE = '未分類', GALL = '（全部分類）';
const grp = b => b.group || GNONE;
const groupOpts = cur => [GALL, ...new Set(DB.library.map(grp))].map(g => `<option value="${esc(g)}"${g === cur ? ' selected' : ''}>${esc(g)}</option>`).join('');
const libMatch = (b, q, g) => (!q || (b.title + b.content + (b.keywords || []).join() + grp(b)).toLowerCase().includes(q)) && (g === GALL || grp(b) === g);
const groupedHtml = (items, row) => { let last = null; return items.map(b => (grp(b) !== last ? `<div class="gh">${esc(last = grp(b))}</div>` : '') + row(b)).join(''); };   // 依分類分組（分類首次出現的順序）
const byGroup = items => { const o = [...new Set(items.map(grp))]; return o.flatMap(g => items.filter(b => grp(b) === g)); };
const okDiscard = () => !(wTouched || manual) || confirm('這會捨棄「製作建議書」目前調整的內容（順序、新增區塊、手動修改）。確定嗎？');
const newSession = () => { sel.clear(); docId = null; docTitle = ''; manual = false; wTouched = false; lastSaved = null; pvSeen = false; };

async function init() {
  DB = await api.load(); cur = DB.templates[0].id; wsId = DB.defaultWordStyle;
  document.querySelectorAll('[data-m]').forEach(i => { i.value = M[i.dataset.m]; i.oninput = () => { M[i.dataset.m] = i.value; gen(); }; });
  drawSel(); drawWsel(); refresh(); drawNav(); syncSave(); updFlow();
}
function drawSel() { $('#tsel').innerHTML = DB.templates.map(t => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join(''); }
function drawWsel() {
  const o = DB.wordStyles.map(s => `<option value="${s.id}"${s.id === DB.defaultWordStyle ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#wsel').innerHTML = o; const d = $('#dws'); if (d) d.innerHTML = o;
}
function syncW() {                                    // 沒有手動調整過時，隨範本更新；調整過就保留
  const t = T(); if (!t || (wTpl === cur && wTouched)) return;
  W = clone(t.chapters); wTpl = cur; wTouched = false;
}
function refresh() {
  if (tab === 'make') { syncW(); drawList(); gen(); }
  if (tab === 'edit') { drawTree(); drawEd(); }
  if (tab === 'lib') drawLib();
}
$('#tsel').onchange = e => {
  if (!okDiscard()) { e.target.value = cur; return; }
  cur = e.target.value; newSession(); ed = null; refresh();
};
/* ---------- 導覽：主導覽 4 群組 + 次導覽；儲存狀態 ---------- */
const GROUPS = [
  { g: 'make', tabs: [['make', '製作建議書']] },
  { g: 'docs', tabs: [['docs', '文件庫']] },
  { g: 'assets', tabs: [['edit', '範本'], ['lib', '區塊庫'], ['files', '檔案庫'], ['wst', 'Word 格式']] },
  { g: 'sys', tabs: [['hist', '版本歷史'], ['set', '設定']] }
];
const groupOf = t => GROUPS.find(x => x.tabs.some(y => y[0] === t)), lastIn = {};
function sizeHeader() { document.documentElement.style.setProperty('--hh', $('header').offsetHeight + 'px'); }
window.addEventListener('resize', sizeHeader); if (window.ResizeObserver) new ResizeObserver(sizeHeader).observe($('header'));   // 頁首高度會隨按鈕顯示／換行而變，次導覽的黏貼位置要跟著
function setDirty(on) { isDirty = on; syncSave(); }
function syncSave() {                                          // 有未儲存變更時才醒目；乾淨時只在「素材與範本」群組顯示已儲存
  const b = $('#save'), assets = ['edit', 'lib', 'wst'].includes(tab);
  b.textContent = isDirty ? '儲存變更 ●' : '已儲存'; b.classList.toggle('clean', !isDirty); b.hidden = !isDirty && !assets;
  $('#pnav .dot').hidden = !isDirty;
}
function drawNav() {
  const G = groupOf(tab), sn = $('#snav'), had = sn.contains(document.activeElement) ? document.activeElement.dataset.t : null;
  document.querySelectorAll('#pnav [data-g]').forEach(b => { const on = b.dataset.g === G.g; if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  sn.hidden = G.tabs.length < 2;
  sn.innerHTML = G.tabs.length < 2 ? '' : G.tabs.map(([t, l]) => `<button data-t="${t}"${t === tab ? ' aria-current="page"' : ''}>${l}</button>`).join('');
  if (had) { const f = sn.querySelector(`[data-t="${had}"]`); if (f) f.focus(); }
  sizeHeader();
}
function setTab(t) {
  tab = t; lastIn[groupOf(t).g] = t;
  TABS.forEach(id => $('#' + id).hidden = id !== t);
  $('#tsel').hidden = !['make', 'edit', 'lib'].includes(t);
  drawNav(); syncSave();
  refresh(); if (t === 'docs') loadDocs(); if (t === 'wst') drawWs(); if (t === 'files') loadFiles(); if (t === 'hist') drawHist(); if (t === 'set') drawSet();
}
$('#pnav').onclick = e => { const b = e.target.closest('[data-g]'); if (b) { const G = GROUPS.find(x => x.g === b.dataset.g); setTab(lastIn[G.g] || G.tabs[0][0]); } };   // 回到該群組上次停留的分頁
$('#snav').onclick = e => { const b = e.target.closest('[data-t]'); if (b) setTab(b.dataset.t); };
const roving = e => {                                            // 方向鍵在導覽項目間移動焦點
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const bs = [...e.currentTarget.querySelectorAll('button')], i = bs.indexOf(document.activeElement); if (i < 0) return; e.preventDefault();
  bs[e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length].focus();
};
$('#pnav').onkeydown = $('#snav').onkeydown = roving;
document.addEventListener('keydown', e => {                       // Ctrl/⌘+S：製作頁 → 存入文件庫；其他 → 儲存範本設定
  if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return; e.preventDefault();
  if (tab === 'make') saveDoc(false); else if (isDirty) $('#save').click(); else toast('沒有需要儲存的變更');
});
$('#save').onclick = async () => { await api.save(DB); setDirty(false); toast('已儲存範本設定，並建立一個版本'); if (tab === 'edit' && !ed) drawEd(); };

/* ---------- 對話框 ---------- */
function openModal(title, html, onOpen, act = '') {
  $('#mtitle').textContent = title; $('#mact').innerHTML = act; $('#mbody').innerHTML = html; $('#modal').hidden = false;
  if (onOpen) onOpen($('#mbody'));
}
function closeModal() { $('#modal').hidden = true; $('#mbody').innerHTML = ''; $('#mact').innerHTML = ''; }
$('#mcl').onclick = closeModal;
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

/* ---------- 製作建議書 ---------- */
// 右側文字若已手動修改，任何會「重新產生」的操作都先確認，避免默默覆蓋
const touch = () => { if (manual && !confirm('右側內容已手動修改，繼續操作會依左側設定重新產生並覆蓋這些修改。要繼續嗎？')) return false; manual = false; return true; };
const mutate = (fn, structural = true) => { if (!touch()) { drawList(); return; } fn(); if (structural) wTouched = true; drawList(); gen(true); };

function drawList() {
  $('#list').innerHTML = W.map((c, ci) => {
    const n = c.blocks.filter(b => sel.has(b.id)).length, all = n && n === c.blocks.length;
    return `<div class="ch" data-ci="${ci}"><div class="hd" draggable="true" data-dt="c" data-ci="${ci}">` +
      `<span class="grip" title="拖曳調整章節順序" aria-hidden="true">⠿</span>` +
      `<label class="lb"><input type="checkbox" data-cc="${ci}" ${all ? 'checked' : ''} ${n && !all ? 'data-part="1"' : ''}><span>${esc(c.title)}</span></label>` +
      `<button class="ic" data-a="cu" data-ci="${ci}" title="章節上移" aria-label="章節上移">▲</button><button class="ic" data-a="cd" data-ci="${ci}" title="章節下移" aria-label="章節下移">▼</button>` +
      `<button class="ic" data-a="ba" data-ci="${ci}" title="新增區塊" aria-label="新增區塊">＋</button><button class="ic" data-a="ce" data-ci="${ci}" title="修改章節名稱" aria-label="修改章節名稱">✎</button>` +
      `<button class="ic x" data-a="cx" data-ci="${ci}" title="從本文件移除章節" aria-label="移除章節">✕</button></div>` +
      (c.blocks.length ? c.blocks.map((b, bi) => `<div class="bk" draggable="true" data-dt="b" data-ci="${ci}" data-bi="${bi}">` +
        `<span class="grip" title="拖曳調整順序" aria-hidden="true">⠿</span>` +
        `<label class="lb"><input type="checkbox" data-bid="${b.id}" ${sel.has(b.id) ? 'checked' : ''}><span>${esc(b.title)}${hit(b) ? ' <span class="tag">RFP</span>' : ''}</span></label>` +
        `<button class="ic" data-a="bu" data-ci="${ci}" data-bi="${bi}" title="上移" aria-label="上移">▲</button><button class="ic" data-a="bd" data-ci="${ci}" data-bi="${bi}" title="下移" aria-label="下移">▼</button>` +
        `<button class="ic" data-a="be" data-ci="${ci}" data-bi="${bi}" title="編輯內容（僅本文件）" aria-label="編輯區塊">✎</button>` +
        `<button class="ic x" data-a="bx" data-ci="${ci}" data-bi="${bi}" title="從本文件移除區塊" aria-label="移除區塊">✕</button></div>`).join('')
        : '<div class="empty">沒有區塊：可把區塊拖到這裡，或按 ＋ 新增</div>') + '</div>';
  }).join('') || '<p class="mut">尚無章節，請按「＋章節」。</p>';
  $('#list').querySelectorAll('[data-part]').forEach(i => i.indeterminate = true);
}
const L = $('#list');
L.onchange = e => {
  const i = e.target;
  mutate(() => {
    if (i.dataset.bid) i.checked ? sel.add(i.dataset.bid) : sel.delete(i.dataset.bid);
    if (i.dataset.cc != null) W[i.dataset.cc].blocks.forEach(b => i.checked ? sel.add(b.id) : sel.delete(b.id));
  }, false);
};
L.onclick = e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, ci = +el.dataset.ci, bi = el.dataset.bi == null ? null : +el.dataset.bi, c = W[ci];
  if (a === 'ba') return openAdd(ci);
  if (a === 'ce') return openChapterEdit(ci);
  if (a === 'be') return openBlockEdit(ci, bi);
  if (a === 'cx' && !confirm(`從本文件移除章節「${c.title}」及其所有區塊？（範本不受影響）`)) return;
  if (a === 'bx' && !confirm('從本文件移除此區塊？（範本不受影響）')) return;
  mutate(() => {
    if (a === 'cu') mv(W, ci, -1);
    else if (a === 'cd') mv(W, ci, 1);
    else if (a === 'cx') { c.blocks.forEach(b => sel.delete(b.id)); W.splice(ci, 1); }
    else if (a === 'bx') { sel.delete(c.blocks[bi].id); c.blocks.splice(bi, 1); }
    else if (a === 'bu') { if (bi > 0) mv(c.blocks, bi, -1); else if (ci > 0) W[ci - 1].blocks.push(c.blocks.splice(bi, 1)[0]); }      // 到頂：移到上一章末
    else if (a === 'bd') { if (bi < c.blocks.length - 1) mv(c.blocks, bi, 1); else if (ci < W.length - 1) W[ci + 1].blocks.unshift(c.blocks.splice(bi, 1)[0]); } // 到底：移到下一章首
  });
};

/* 拖曳排序（HTML5 Drag & Drop；觸控裝置請用 ▲▼） */
let drag = null;
const clrDrop = () => L.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-in'));
function dropTarget(e) {
  if (!drag) return null;
  const ch = e.target.closest('.ch'); if (!ch) return null;
  const ci = +ch.dataset.ci;
  if (drag.t === 'c') { const r = ch.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2; return { el: ch, cls: before ? 'drop-before' : 'drop-after', ci, idx: ci + (before ? 0 : 1) }; }
  const bk = e.target.closest('.bk');
  if (bk) { const r = bk.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2, bi = +bk.dataset.bi; return { el: bk, cls: before ? 'drop-before' : 'drop-after', ci, idx: bi + (before ? 0 : 1) }; }
  const hd = e.target.closest('.hd');
  return hd ? { el: hd, cls: 'drop-in', ci, idx: 0 } : { el: ch, cls: 'drop-in', ci, idx: W[ci].blocks.length };
}
L.ondragstart = e => {
  const r = e.target.closest && e.target.closest('[data-dt]'); if (!r) return;
  drag = { t: r.dataset.dt, ci: +r.dataset.ci, bi: r.dataset.bi == null ? null : +r.dataset.bi };
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'move'); setTimeout(() => r.classList.add('dragging'), 0);
};
L.ondragend = () => { drag = null; clrDrop(); L.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); };
L.ondragover = e => { const t = dropTarget(e); if (!t) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; clrDrop(); t.el.classList.add(t.cls); };
L.ondrop = e => {
  e.preventDefault(); const t = dropTarget(e), d = drag; drag = null; clrDrop();
  if (!t || !d) return;
  let idx = t.idx;
  if (d.t === 'c') {
    if (d.ci < idx) idx--; if (idx === d.ci) return;
    mutate(() => { const [c] = W.splice(d.ci, 1); W.splice(idx, 0, c); });
  } else {
    if (d.ci === t.ci && d.bi < idx) idx--; if (d.ci === t.ci && idx === d.bi) return;
    mutate(() => { const [b] = W[d.ci].blocks.splice(d.bi, 1); W[t.ci].blocks.splice(idx, 0, b); });
  }
};

/* 新增 / 編輯區塊與章節（只改本文件的 W） */
function addBlock(ci, b) {
  if (!touch()) return null;
  b = { id: uid(), keywords: [], ...b }; W[ci].blocks.push(b); sel.add(b.id); wTouched = true; drawList(); gen(true);
  return W[ci].blocks.length - 1;
}
function openAdd(ci) {
  openModal(`新增區塊到「${W[ci].title}」`, `<div class="row"><button class="b" id="an">＋ 新增空白區塊</button></div><h2>從區塊庫插入（含內建範本的區塊，可連續插入多個）</h2><div class="row"><input type="text" id="aq" placeholder="搜尋區塊庫" style="flex:2 1 160px;width:auto"><select id="ag" aria-label="依分類篩選" style="flex:1 1 160px"></select></div><div id="al"></div>`, () => {
    $('#ag').innerHTML = groupOpts(GALL);
    const draw = () => {
      const q = $('#aq').value.trim().toLowerCase(), g = $('#ag').value;
      $('#al').innerHTML = groupedHtml(byGroup(DB.library.filter(b => libMatch(b, q, g))),
        b => `<div class="pick"><span><b>${esc(b.title)}</b><br><small class="mut">${esc(b.content.replace(/\s+/g, ' ').slice(0, 60))}</small></span><button class="b g" data-id="${b.id}">插入</button></div>`) || '<p class="mut">區塊庫沒有符合的區塊。</p>';
    };
    draw(); $('#aq').oninput = draw; $('#ag').onchange = draw;
    $('#al').onclick = e => {
      const lb = DB.library.find(x => x.id === e.target.dataset.id); if (!lb) return;
      if (addBlock(ci, { title: lb.title, content: lb.content, keywords: [...(lb.keywords || [])] }) != null) toast(`已插入「${lb.title}」`);
    };
    $('#an').onclick = () => { const bi = addBlock(ci, { title: '新區塊', content: '' }); if (bi != null) openBlockEdit(ci, bi); };
  });
}
function openBlockEdit(ci, bi) {
  const b = W[ci].blocks[bi];
  openModal('編輯區塊（只影響本文件）', `<label>區塊標題<input type="text" id="e1" value="${esc(b.title)}"></label>
    <label>內文（Markdown，可用 {{案名}} {{機關}} {{公司}} {{日期}}）<textarea id="e2" rows="14">${esc(b.content)}</textarea></label>
    <div class="row"><button class="b g" id="e3">存入區塊庫</button></div>`, () => {
    const set = (k, e) => { if (!touch()) { e.target.value = b[k]; return; } b[k] = e.target.value; wTouched = true; drawList(); gen(true); };
    $('#e1').oninput = e => set('title', e); $('#e2').oninput = e => set('content', e);
    $('#e3').onclick = () => { DB.library.push({ id: uid(), title: b.title, content: b.content, keywords: [...(b.keywords || [])], group: '自訂' }); dirty(); toast('已存入區塊庫（分類：自訂），記得按右上角「儲存」'); };
  });
}
function openChapterEdit(ci) {
  const c = W[ci];
  openModal('修改章節名稱（只影響本文件）', `<label>章節標題<input type="text" id="e1" value="${esc(c.title)}"></label>`, () => {
    $('#e1').oninput = e => { if (!touch()) { e.target.value = c.title; return; } c.title = e.target.value; wTouched = true; drawList(); gen(true); };
    $('#e1').focus();
  });
}
$('#wcadd').onclick = () => { if (!touch()) return; W.push({ id: uid(), title: '新章節', blocks: [] }); wTouched = true; drawList(); gen(true); openChapterEdit(W.length - 1); };
$('#wreset').onclick = () => {
  if (!confirm('從範本重新載入章節與區塊？本文件的排序、新增與修改都會捨棄，勾選也會清除。')) return;
  sel.clear(); manual = false; wTouched = false; syncW(); drawList(); gen(true); toast('已從範本重新載入');
};
$('#rfp').oninput = drawList;
$('#hitsel').onclick = () => mutate(() => W.forEach(c => c.blocks.forEach(b => hit(b) && sel.add(b.id))), false);
$('#all').onclick = () => mutate(() => W.forEach(c => c.blocks.forEach(b => sel.add(b.id))), false);
$('#none').onclick = () => mutate(() => sel.clear(), false);

function buildMd() {
  let md = `# ${M.案名 || '服務建議書'}\n\n> 招標機關：${M.機關 || '（未填）'}　提案單位：${M.公司 || '（未填）'}　日期：${M.日期}\n\n`, n = 0;
  W.forEach(c => {
    const bs = c.blocks.filter(b => sel.has(b.id)); if (!bs.length) return;
    n++; md += `## ${n}. ${c.title}\n\n`;
    bs.forEach((b, i) => md += `### ${n}.${i + 1} ${b.title}\n\n${b.content.trim()}\n\n`);
  });
  return md.replace(/\{\{(.+?)\}\}/g, (m, k) => M[k.trim()] || m);
}
function updInfo() {
  $('#dinfo').textContent = (docId ? `文件庫文件：${docTitle}` : '新文件（尚未儲存到文件庫）') + (manual ? '　⚠ 右側內容已手動修改，左側的勾選／排序暫不套用，可按「重新產生」' : '　右側內容可直接微調');
  $('#regen').hidden = !manual; $('#dsaveas').hidden = !docId;
  updFlow();
}
function gen(force) {
  if (manual && !force) return updInfo();
  $('#out').value = buildMd(); manual = false; updInfo(); if (pvOn) drawPv();
}
$('#out').oninput = () => { manual = true; updInfo(); if (pvOn) drawPv(); };
$('#regen').onclick = () => { if (confirm('依左側目前的勾選與順序重新產生，會覆蓋右側的手動修改。確定嗎？')) gen(true); };
async function drawPv() { const h = await renderMd($('#out').value); if (pvOn) $('#pv').innerHTML = h; }
function setPv(on) { pvOn = on; if (on) { pvSeen = true; updFlow(); } $('#out').hidden = on; $('#pv').hidden = !on; $('#pvt').textContent = on ? '編輯' : '預覽'; if (on) drawPv(); }
$('#pvt').onclick = () => setPv(!pvOn);
$('#copy').onclick = async () => { await api.clip($('#out').value); toast('已複製'); };
$('#exmd').onclick = async () => { const p = await api.exportFile('md', M.案名, $('#out').value); if (p) toast('已匯出：' + p); };
$('#exdocx').onclick = async () => {
  try { const p = await api.exportFile('docx', M.案名, $('#out').value, exStyle()); if (p) toast('已匯出：' + p); }
  catch (e) { toast('匯出失敗：' + e.message); }
};
$('#wsel').onchange = e => { DB.defaultWordStyle = e.target.value; drawWsel(); dirty(); };
function insertImage(f) {                             // 插入到游標位置（沒有游標時在文末）
  setPv(false);
  const ta = $('#out'), pos = ta.selectionStart == null ? ta.value.length : ta.selectionStart, pre = ta.value.slice(0, pos), post = ta.value.slice(pos);
  ta.value = pre + (pre && !pre.endsWith('\n\n') ? (pre.endsWith('\n') ? '\n' : '\n\n') : '') + `![圖說](image:${f})\n\n` + post;
  manual = true; updInfo();
}
$('#oimg').onclick = async () => {
  setPv(false);
  const imgs = await api.imgList(), tile = i => `<div class="thumb" data-f="${i.f}"><img src="${i.url}" alt=""><div class="mut">${esc(i.name || i.f)}</div></div>`;
  openModal('選擇圖片（點選即插入游標位置）', `<div id="grid">${imgs.map(tile).join('') || '<p class="mut">還沒有圖片，請先上傳。</p>'}</div>`, () => {
    $('#grid').onclick = e => {
      const f = (e.target.closest('[data-f]') || {}).dataset; if (!f) return;
      insertImage(f.f); closeModal(); toast('已插入圖片，可修改「圖說」文字');
    };
    $('#mup').onclick = async () => { const n = await api.imgAdd(); if (n.length) { $('#grid').insertAdjacentHTML('afterbegin', n.map(tile).join('')); toast(`已上傳 ${n.length} 張`); } };
  }, '<button class="b" id="mup">＋上傳新圖片</button>');
};

/* ---------- 製作進度列（引導使用流程）與使用說明 ---------- */
const guideSeen = () => { try { return localStorage.getItem('pb.guide') === '1'; } catch { return true; } };
const guideDismiss = () => { try { localStorage.setItem('pb.guide', '1'); } catch {} };
let flowSig = '';
function flowSteps() {
  const s1 = !!(M.案名 || '').trim(), s2 = sel.size > 0, s3 = pvSeen || manual, saved = !!docId && lastSaved === $('#out').value, s4 = saved;
  return [
    { t: '基本資料', d: s1, h: s1 ? '' : '先填寫案名（也建議填機關與公司）', b: '填寫案名', go: () => $('[data-m=案名]').focus() },
    { t: '選擇內容', d: s2, h: s2 ? '' : '貼上 RFP 讓系統標示相關區塊，或直接勾選／全選', b: '貼上 RFP', go: () => $('#rfp').focus() },
    { t: '檢查微調', d: s3, h: '預覽成果；可拖曳調整順序、直接修改右側文字、插入圖片', b: '預覽', go: () => setPv(true) },
    { t: '儲存匯出', d: s4, h: docId && !saved ? '有尚未儲存的修改' : '存入文件庫，再匯出 Word', b: '儲存到文件庫', go: () => saveDoc(false) }
  ];
}
function updFlow() {
  const el = $('#flow'); if (!el) return;
  const st = flowSteps(), cur = st.findIndex(x => !x.d), welcome = !guideSeen(), sig = JSON.stringify([st.map(x => x.d), cur, welcome, sel.size, docId, isDirty && 0]);
  if (sig === flowSig) return; flowSig = sig;
  el.innerHTML = `<ol>${st.map((x, i) => `<li><button class="stp${x.d ? ' done' : i === cur ? ' cur' : ''}" data-i="${i}"${i === cur ? ' aria-current="step"' : ''}>${x.d ? '✓' : i + 1} ${x.t}</button></li>`).join('')}</ol>` +
    `<div class="nx">${cur < 0 ? '<span>✓ 已完成，可匯出 Word，或到「文件庫」管理。</span><button class="b" data-x="exp">匯出 Word</button>' : `<span>下一步：${esc(st[cur].h)}</span><button class="b" data-x="next">${esc(st[cur].b)}</button>`}</div>` +
    (welcome ? '<div class="welcome"><span>👋 第一次使用？看看 1 分鐘的使用流程，了解從建立範本到匯出 Word 的建議做法。</span><button class="b" data-x="guide">查看</button><button class="b g" data-x="dismiss">不再顯示</button></div>' : '');
  el._st = st; el._cur = cur;
}
$('#flow').onclick = e => {
  const el = $('#flow'), b = e.target.closest('button'); if (!b) return;
  if (b.dataset.i != null) el._st[+b.dataset.i].go();
  else if (b.dataset.x === 'next') el._st[el._cur].go();
  else if (b.dataset.x === 'exp') $('#exdocx').click();
  else if (b.dataset.x === 'guide') openGuide();
  else if (b.dataset.x === 'dismiss') { guideDismiss(); flowSig = ''; updFlow(); }
};
function openGuide() {
  const it = (t, d, go, lb = '前往') => `<li><span class="tx"><b>${t}</b><small>${d}</small></span>${go ? `<button class="b g" data-go="${go}">${lb}</button>` : ''}</li>`;
  guideDismiss(); flowSig = ''; updFlow();
  openModal('使用流程', `<div class="gd">
    <h2>① 製作一份建議書</h2><ol>
      ${it('1. 填基本資料', '選好範本，填案名、機關、公司；可貼上 RFP，命中關鍵字的區塊會標示「RFP」。', 'make', '開始製作')}
      ${it('2. 選擇內容', '勾選章節與區塊；拖曳 ⠿ 或按 ▲▼ 調整順序，＋ 新增區塊。調整只影響這一份文件。', '')}
      ${it('3. 檢查與微調', '預覽成果，右側文字可直接修改，也能插入圖片。', '')}
      ${it('4. 儲存與匯出', '「儲存到文件庫」保留整份文件（之後可再修改），再選 Word 格式匯出。', '')}</ol>
    <h2>② 初次設定（只需做一次）</h2><ol>
      ${it('指定儲存路徑', '圖片與附件要放哪裡（可指定公司共用資料夾）。', 'set')}
      ${it('設定 Word 格式', '字型、字級、頁首頁尾、頁碼、每章換頁，可存成多組格式。', 'wst')}
      ${it('整理範本與區塊庫', '維護各類案件的章節架構與常用內容，讓下次製作只需勾選。', 'edit')}
      ${it('上傳常用圖片與附件', '公司 logo、證照、實績簡介等，可加標籤方便查找。', 'files')}</ol>
    <h2>③ 日常整理與保險</h2><ol>
      ${it('整理文件庫', '用標籤、星號釘選分類；多選後可批次匯出。建議定期「備份文件庫」。', 'docs')}
      ${it('改壞了或誤刪？', '版本歷史可對照差異、還原任何版本，也能找回已刪除的文件。', 'hist')}</ol>
    <p class="mut">快捷鍵：<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> 儲存（製作頁＝存入文件庫，其他頁＝儲存範本設定）；<kbd>Esc</kbd> 關閉視窗；導覽列可用 ← → 方向鍵移動。</p></div>`,
    () => { $('#mbody').onclick = e => { const g = (e.target.closest('[data-go]') || {}).dataset; if (g) { closeModal(); setTab(g.go); } }; });
}
$('#help').onclick = openGuide;

/* ---------- 共用：文字差異、標籤輸入 ---------- */
function lineDiff(a, b) {                                   // 行級差異（LCS；先剪掉相同的頭尾；太大時退化為整段取代）
  const n = a.length, m = b.length; let i = 0; while (i < n && i < m && a[i] === b[i]) i++;
  let j = 0; while (j < n - i && j < m - i && a[n - 1 - j] === b[m - 1 - j]) j++;
  const A = a.slice(i, n - j), B = b.slice(i, m - j), ops = a.slice(0, i).map(t => ['=', t]), p = A.length, q = B.length;
  if (!p || !q || p * q > 4e6) { A.forEach(t => ops.push(['-', t])); B.forEach(t => ops.push(['+', t])); }
  else {
    const W = q + 1, T = new Uint32Array((p + 1) * W);
    for (let x = p - 1; x >= 0; x--) for (let y = q - 1; y >= 0; y--) T[x * W + y] = A[x] === B[y] ? T[(x + 1) * W + y + 1] + 1 : Math.max(T[(x + 1) * W + y], T[x * W + y + 1]);
    let x = 0, y = 0;
    while (x < p && y < q) { if (A[x] === B[y]) { ops.push(['=', A[x]]); x++; y++; } else if (T[(x + 1) * W + y] >= T[x * W + y + 1]) ops.push(['-', A[x++]]); else ops.push(['+', B[y++]]); }
    while (x < p) ops.push(['-', A[x++]]); while (y < q) ops.push(['+', B[y++]]);
  }
  a.slice(n - j).forEach(t => ops.push(['=', t]));
  return ops;
}
function diffHtml(ops, ctx = 2) {                            // 只顯示變更行與前後各 ctx 行，其餘折疊
  const keep = ops.map(() => false); let add = 0, del = 0;
  ops.forEach((o, k) => { if (o[0] === '+') add++; if (o[0] === '-') del++; if (o[0] !== '=') for (let t = Math.max(0, k - ctx); t <= Math.min(ops.length - 1, k + ctx); t++) keep[t] = true; });
  let out = '', skip = 0; const cls = { '=': '', '+': 'a', '-': 'd' }, mk = { '=': '  ', '+': '+ ', '-': '- ' }, gap = () => { if (skip) { out += `<div class="s">… 省略 ${skip} 行相同內容 …</div>`; skip = 0; } };
  ops.forEach((o, k) => { if (!keep[k]) { skip++; return; } gap(); out += `<div class="${cls[o[0]]}">${mk[o[0]]}${esc(o[1])}</div>`; }); gap();
  return { html: `<div class="df">${out || '<div class="s">沒有差異</div>'}</div>`, add, del };
}
function docDiffView(bf, af, lb = '之前', la = '之後') {
  const notes = [];
  if (bf && af) {
    if (bf.title !== af.title) notes.push(`標題：「${esc(bf.title)}」→「${esc(af.title)}」`);
    if ((bf.tpl || '') !== (af.tpl || '')) notes.push(`範本：${esc(bf.tpl || '—')} → ${esc(af.tpl || '—')}`);
    const t1 = (bf.tags || []).join('、'), t2 = (af.tags || []).join('、'); if (t1 !== t2) notes.push(`標籤：${esc(t1 || '無')} → ${esc(t2 || '無')}`);
  }
  const d = diffHtml(lineDiff(bf ? String(bf.md).split('\n') : [], af ? String(af.md).split('\n') : []));
  return `<p class="dh">${esc(lb)} → ${esc(la)}${!bf ? '（新增）' : !af ? '（已刪除）' : ''}　<b>＋${d.add}</b> 行 / <b>－${d.del}</b> 行</p>${notes.map(n => `<p class="dh">${n}</p>`).join('')}${d.html}`;
}
function tplItems(json) {                                    // 把 templates.json 攤平成項目：p=顯示路徑、n=自己的名稱、c=內容（改父層名稱不會讓子項目被誤判為修改）
  const m = new Map(); let d; try { d = JSON.parse(json); } catch { return m; }
  const cont = b => (b.content || '') + '\u0000' + (b.keywords || []).join(',') + '\u0000' + (b.group || '');
  (d.templates || []).forEach(t => { m.set('t:' + t.id, { p: `範本「${t.name}」`, n: t.name, c: '' });
    (t.chapters || []).forEach(c => { m.set(`c:${t.id}/${c.id}`, { p: `${t.name} › 章節「${c.title}」`, n: c.title, c: '' });
      (c.blocks || []).forEach(b => m.set(`b:${t.id}/${c.id}/${b.id}`, { p: `${t.name} › ${c.title} › 區塊「${b.title}」`, n: b.title, c: cont(b) })); }); });
  (d.library || []).forEach(b => m.set('l:' + b.id, { p: `區塊庫 › ${b.group ? b.group + ' › ' : ''}「${b.title}」`, n: b.title, c: cont(b) }));
  (d.wordStyles || []).forEach(w => m.set('w:' + w.id, { p: `Word 格式「${w.name}」`, n: w.name, c: JSON.stringify(w) }));
  return m;
}
function tplDiffView(bj, aj) {
  const B = tplItems(bj || '{}'), A = tplItems(aj || '{}'), add = [], del = [], mod = [];
  A.forEach((v, k) => { const o = B.get(k); if (!o) add.push(v.p); else if (o.n !== v.n || o.c !== v.c) mod.push(v.p + (o.n !== v.n ? `（原名「${o.n}」）` : '') + (o.c !== v.c ? '（內容變更）' : '')); });
  B.forEach((v, k) => { if (!A.has(k)) del.push(v.p); });
  const sec = (t, l, c) => l.length ? `<p class="dh"><span class="st ${c}">${t}</span> ${l.length} 項</p><div class="df">${l.slice(0, 60).map(x => `<div class="${{ A: 'a', D: 'd', M: '' }[c]}">${esc(x)}</div>`).join('')}${l.length > 60 ? `<div class="s">…另有 ${l.length - 60} 項</div>` : ''}</div>` : '';
  return sec('新增', add, 'A') + sec('刪除', del, 'D') + sec('修改', mod, 'M') || '<p class="mut">內容沒有實質差異（可能只是排序或格式變動）。</p>';
}
function askText(title, label, value, okText, cb) {
  openModal(title, `<label>${label}<input type="text" id="at" value="${esc(value)}"></label><div class="row"><button class="b" id="aok">${okText}</button></div>`, () => {
    $('#at').focus(); const go = () => { const v = $('#at').value; closeModal(); cb(v); };
    $('#aok').onclick = go; $('#at').onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}
const parseTags = v => kw(String(v).replace(/[;；]/g, ','));
const chips = (a, c = '') => (a || []).map(t => `<span class="chip ${c}">${esc(t)}</span>`).join('');
const ALLT = '（全部範本）', ALLG = '（全部標籤）', STARG = '★ 已釘選';
const optHtml = (list, cur) => list.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');

/* ---------- 文件庫 ---------- */
async function saveDoc(asNew) {
  const r = await api.docSave({
    id: asNew ? null : docId, title: M.案名 || '未命名建議書', tpl: T().name, md: $('#out').value,
    meta: { M: { ...M }, rfp: $('#rfp').value, sel: [...sel], chapters: W, tplId: cur }
  });
  docId = r.id; docTitle = r.title; lastSaved = $('#out').value; updInfo(); toast(asNew ? '已另存為新文件' : '已儲存到文件庫');
}
$('#dsave').onclick = () => saveDoc(false);
$('#dsaveas').onclick = () => saveDoc(true);
async function openDoc(id) {
  const d = vDoc && vDoc.id === id ? vDoc : await api.docGet(id); if (!d) return toast('找不到此文件');
  if ((wTouched || manual) && !confirm('載入文件會取代「製作建議書」目前編輯中的內容。確定嗎？')) return;
  const m = d.meta || {}, t = DB.templates.find(x => x.id === m.tplId) || DB.templates.find(x => x.name === d.tpl) || DB.templates[0];
  cur = t.id; drawSel();
  Object.assign(M, m.M || {}); document.querySelectorAll('[data-m]').forEach(i => i.value = M[i.dataset.m] || '');
  $('#rfp').value = m.rfp || '';
  if (Array.isArray(m.chapters)) { W = clone(m.chapters); wTpl = cur; wTouched = true; } else { wTouched = false; wTpl = null; syncW(); }
  sel = new Set(m.sel || []); docId = d.id; docTitle = d.title;
  setTab('make');
  $('#out').value = d.md; lastSaved = d.md; pvSeen = true; manual = d.md !== buildMd();     // 與依設定產生的結果不同，代表存檔前有手動修改
  updInfo(); if (pvOn) drawPv(); toast('已載入文件');
}
let DMULTI = false, DSEL = new Set(), DCONTENT = null;
async function loadDocs() {
  DOCS = await api.docList(); if (vDoc && !DOCS.some(d => d.id === vDoc.id)) vDoc = null;
  DSEL = new Set([...DSEL].filter(id => DOCS.some(d => d.id === id)));
  $('#dtpl').innerHTML = optHtml([ALLT, ...new Set(DOCS.map(d => d.tpl).filter(Boolean))], $('#dtpl').value || ALLT);
  $('#dtag').innerHTML = optHtml([ALLG, STARG, ...[...new Set(DOCS.flatMap(d => d.tags || []))].sort()], $('#dtag').value || ALLG);
  drawDocList(); drawDocView();
}
function docsShown() {
  const q = $('#dq').value.trim().toLowerCase(), tp = $('#dtpl').value || ALLT, tg = $('#dtag').value || ALLG, tm = $('#dtime').value, so = $('#dsort').value;
  const since = tm === 'all' ? 0 : tm === '1' ? new Date().setHours(0, 0, 0, 0) : Date.now() - (+tm) * 864e5;
  const cmp = { 'upd-desc': (a, b) => b.updated.localeCompare(a.updated), 'upd-asc': (a, b) => a.updated.localeCompare(b.updated), 'cre-desc': (a, b) => (b.created || '').localeCompare(a.created || ''), title: (a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant') }[so];
  return DOCS.filter(d => (!q || ((d.title || '') + ' ' + (d.tpl || '') + ' ' + (d.tags || []).join(' ')).toLowerCase().includes(q) || (DCONTENT && DCONTENT.has(d.id)))
    && (tp === ALLT || d.tpl === tp) && (tg === ALLG || (tg === STARG ? d.star : (d.tags || []).includes(tg))) && (!since || new Date(d.updated).getTime() >= since))
    .sort((a, b) => (+!!b.star - +!!a.star) || cmp(a, b));                       // 釘選的永遠在最上面
}
function updDBar() {
  $('#dbar').hidden = !DMULTI; $('#dmulti').textContent = DMULTI ? '結束多選' : '多選';
  $('#dcnt').textContent = `已選 ${DSEL.size} 份`; $('#dbk').textContent = DSEL.size ? `備份所選（${DSEL.size}）` : '備份文件庫';
  ['dstar', 'dtadd', 'dtrm', 'dbx', 'dbm', 'dbdel'].forEach(id => $('#' + id).disabled = !DSEL.size);
}
function drawDocList() {
  $('#doclist').innerHTML = docsShown().map(d => `<div class="tr doc${vDoc && vDoc.id === d.id ? ' on' : ''}" data-id="${d.id}" tabindex="0"><span style="display:block">${DMULTI ? `<input type="checkbox" class="mk" data-dc="${d.id}" ${DSEL.has(d.id) ? 'checked' : ''} aria-label="選取">` : ''}${d.star ? '<span class="star">★</span> ' : ''}${esc(d.title)}</span><small>${esc(d.tpl || '')} ・ 更新 ${fmt(d.updated)}</small>${(d.tags || []).length ? `<div>${chips(d.tags)}</div>` : ''}</div>`).join('')
    || (DOCS.length ? '<p class="mut">沒有符合篩選條件的文件。</p>' : '<p class="mut">文件庫還是空的。做好的建議書按「儲存到文件庫」就會收藏在這裡。</p><div class="row"><button class="b" data-go="make">前往製作建議書</button></div>');
  updDBar();
}
const pickDoc = async r => { if (!r) return; vDoc = await api.docGet(r.dataset.id); vEdit = false; drawDocList(); drawDocView(); };
$('#doclist').onclick = e => { if (e.target.closest('[data-go]')) return setTab('make'); const cb = e.target.closest('[data-dc]'); if (cb) { cb.checked ? DSEL.add(cb.dataset.dc) : DSEL.delete(cb.dataset.dc); return updDBar(); } pickDoc(e.target.closest('[data-id]')); };
$('#doclist').onkeydown = e => { if (e.key === 'Enter' && !e.target.closest('[data-dc]')) pickDoc(e.target.closest('[data-id]')); };
let dqT;
$('#dq').oninput = () => {                                                  // 標題／標籤／範本即時比對；內文交給主程序全文搜尋（防抖）
  DCONTENT = null; drawDocList(); clearTimeout(dqT); const q = $('#dq').value.trim();
  dqT = setTimeout(async () => { const r = q ? await api.docSearch(q) : null; if ($('#dq').value.trim() !== q) return; DCONTENT = r ? new Set(r) : null; drawDocList(); }, 200);
};
$('#dsort').onchange = $('#dtpl').onchange = $('#dtag').onchange = $('#dtime').onchange = drawDocList;
$('#dmulti').onclick = () => { DMULTI = !DMULTI; if (!DMULTI) DSEL.clear(); drawDocList(); };
$('#dall').onclick = () => { docsShown().forEach(d => DSEL.add(d.id)); drawDocList(); };
$('#dnone').onclick = () => { DSEL.clear(); drawDocList(); };
$('#dstar').onclick = async () => { const star = !DOCS.filter(d => DSEL.has(d.id)).every(d => d.star); await api.docMetaMany([...DSEL], { star }); await loadDocs(); toast(star ? '已釘選' : '已取消釘選'); };
$('#dtadd').onclick = () => askText('批次加標籤', '標籤（以逗號或頓號分隔）', '', '加入', async v => { const t = parseTags(v); if (!t.length) return; await api.docMetaMany([...DSEL], { addTags: t }); await loadDocs(); toast('已加入標籤'); });
$('#dtrm').onclick = () => askText('批次移除標籤', '要移除的標籤（以逗號或頓號分隔）', '', '移除', async v => { const t = parseTags(v); if (!t.length) return; await api.docMetaMany([...DSEL], { removeTags: t }); await loadDocs(); toast('已移除標籤'); });
$('#dbdel').onclick = async () => {
  const list = [...DSEL]; if (!confirm(`刪除選取的 ${list.length} 份文件？\n（之後可從「版本歷史 › 已刪除的文件」找回）`)) return;
  await api.docDeleteMany(list); if (list.includes(docId)) { docId = null; docTitle = ''; updInfo(); } DSEL.clear(); await loadDocs(); toast(`已刪除 ${list.length} 份`);
};
const bexp = kind => async () => {
  const r = await api.docExportMany([...DSEL], kind, kind === 'docx' ? clone(wStyle()) : null); if (!r) return;
  toast(`已匯出 ${r.n} 份到 ${r.dir}`); if (r.failed.length) alert('以下文件匯出失敗：\n' + r.failed.map(t => '・' + t).join('\n'));
};
$('#dbx').onclick = bexp('docx'); $('#dbm').onclick = bexp('md');
$('#dbk').onclick = async () => { const r = await api.docBackup([...DSEL]); toast(r ? `已備份 ${r.docs} 份文件、${r.images} 張圖片：${r.path}` : '已取消，或沒有可備份的文件'); };
$('#dimp').onclick = async () => {
  const r = await api.docImport(); if (!r) return; if (r.error) return alert('匯入失敗：' + r.error);
  await loadDocs(); toast(`匯入 ${r.imported} 份文件，略過 ${r.skipped} 份（內容相同或格式不正確），圖片 ${r.images} 張`);
};
async function openDocHistory(id) {
  const vs = await api.docHistory(id); if (!vs || !vs.length) return toast('沒有版本紀錄（可能未安裝 git）');
  openModal('文件版本歷史', `<p class="mut">每次儲存都會留下一個版本。還原會建立新版本，不會刪除任何紀錄。</p><div id="vhl">${vs.map((v, i) =>
    `<div class="fl"><span class="nm">${esc(fmt(v.d))}　${esc(v.s)}${i === 0 ? ' <span class="chip g">最新</span>' : ''}</span><button class="b g" data-a="pv" data-i="${i}">預覽</button>${i < vs.length - 1 ? `<button class="b g" data-a="df" data-i="${i}">與上一版差異</button>` : ''}${i > 0 ? `<button class="b g" data-a="dc" data-i="${i}">與目前差異</button><button class="b" data-a="rs" data-i="${i}">還原</button>` : ''}</div>`).join('')}</div><div id="vhv"></div>`, () => {
    const get = async h => { try { return JSON.parse(await api.historyBlob(h, `documents/${id}.json`)); } catch { return null; } };
    $('#vhl').onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const i = +b.dataset.i, v = vs[i], a = b.dataset.a, out = $('#vhv');
      if (a === 'pv') { const d = await get(v.h); out.innerHTML = d ? `<h2>${esc(d.title)}（${esc(fmt(v.d))}）</h2><div class="md">${await renderMd(d.md)}</div>` : '<p class="mut">無法讀取此版本</p>'; }
      else if (a === 'df') out.innerHTML = docDiffView(await get(vs[i + 1].h), await get(v.h), fmt(vs[i + 1].d), fmt(v.d));
      else if (a === 'dc') out.innerHTML = docDiffView(await get(v.h), await api.docGet(id), fmt(v.d), '目前');
      else if (a === 'rs') {
        if (!confirm(`還原到「${fmt(v.d)}」的版本？\n目前內容會被取代（仍可從版本歷史還原回來）。`)) return;
        const r = await api.docRestore(v.h, id); if (!r) return toast('還原失敗');
        closeModal(); vDoc = await api.docGet(id); await loadDocs(); toast('已還原');
      }
    };
  });
}
async function drawDocView() {
  const box = $('#docview'), d = vDoc;
  if (!d) { box.innerHTML = '<p class="mut">選擇左側文件即可檢視內容。</p>'; return; }
  box.innerHTML = `<h2>${d.star ? '<span class="star">★</span> ' : ''}${esc(d.title)}</h2><p class="mut">範本：${esc(d.tpl || '—')} ・ 建立 ${fmt(d.created)} ・ 更新 ${fmt(d.updated)}</p>${(d.tags || []).length ? `<div>${chips(d.tags, 'g')}</div>` : ''}
    <div class="row"><button class="b" id="dopen">載入到編輯器繼續修改</button><button class="b g" id="ded">${vEdit ? '預覽' : '直接編輯文字'}</button>${vEdit ? '<button class="b" id="dsv">儲存修改</button>' : ''}</div>
    <div class="row"><button class="b g" id="dstr">${d.star ? '★ 取消釘選' : '☆ 釘選'}</button><button class="b g" id="dtg">標籤</button><button class="b g" id="ddup">複製</button><button class="b g" id="dren">重新命名</button><button class="b g" id="dhis">版本歷史</button></div>
    <div class="row"><select id="dws" aria-label="Word 格式範本"></select><button class="b g" id="dxw">匯出 Word</button><button class="b g" id="dxm">匯出 Markdown</button><button class="b g" id="dcp">複製內容</button><button class="b d" id="ddel">刪除</button></div>
    ${vEdit ? '<textarea id="dta" spellcheck="false"></textarea>' : '<div id="dpv" class="md">載入中…</div>'}`;
  drawWsel();
  if (vEdit) $('#dta').value = d.md; else { const h = await renderMd(d.md); if (vDoc === d && $('#dpv')) $('#dpv').innerHTML = h; }
  const refresh = async () => { vDoc = await api.docGet(d.id); await loadDocs(); };
  $('#dws').onchange = e => { DB.defaultWordStyle = e.target.value; drawWsel(); dirty(); };
  $('#dopen').onclick = () => openDoc(d.id);
  $('#ded').onclick = () => { vEdit = !vEdit; drawDocView(); };
  if (vEdit) $('#dsv').onclick = async () => { await api.docSave({ ...d, md: $('#dta').value }); vDoc = await api.docGet(d.id); DOCS = await api.docList(); drawDocList(); toast('已儲存修改'); };
  $('#dstr').onclick = async () => { await api.docMetaMany([d.id], { star: !d.star }); await refresh(); };
  $('#dtg').onclick = () => askText('文件標籤', '標籤（以逗號或頓號分隔，留空代表清除）', (d.tags || []).join('、'), '儲存', async v => { await api.docMetaMany([d.id], { removeTags: d.tags || [], addTags: parseTags(v) }); await refresh(); toast('已更新標籤'); });
  $('#ddup').onclick = async () => { const m = await api.docDuplicate(d.id); if (!m) return toast('複製失敗'); vDoc = await api.docGet(m.id); await loadDocs(); toast('已複製為「' + m.title + '」'); };
  $('#dren').onclick = () => askText('重新命名', '文件標題', d.title, '確定', async v => { v = v.trim(); if (!v) return; await api.docSave({ ...d, title: v }); if (docId === d.id) { docTitle = v; updInfo(); } await refresh(); toast('已重新命名'); });
  $('#dhis').onclick = () => openDocHistory(d.id);
  $('#dxw').onclick = async () => { try { const p = await api.exportFile('docx', d.title, vEdit ? $('#dta').value : d.md, exStyle()); if (p) toast('已匯出：' + p); } catch (e) { toast('匯出失敗：' + e.message); } };
  $('#dxm').onclick = async () => { const p = await api.exportFile('md', d.title, vEdit ? $('#dta').value : d.md); if (p) toast('已匯出：' + p); };
  $('#dcp').onclick = async () => { await api.clip(vEdit ? $('#dta').value : d.md); toast('已複製'); };
  $('#ddel').onclick = async () => {
    if (!confirm(`刪除文件「${d.title}」？\n（之後可從「版本歷史 › 已刪除的文件」找回）`)) return;
    await api.docDelete(d.id); if (docId === d.id) { docId = null; docTitle = ''; updInfo(); } vDoc = null; loadDocs(); toast('已刪除');
  };
}

/* ---------- 維護範本 ---------- */
function drawTree() {
  const t = T(); if (!t) return;
  $('#tree').innerHTML = t.chapters.map((c, ci) => {
    const on = ed && ed.c === ci && ed.b == null ? ' on' : '';
    return `<div class="tr c${on}" data-a="sel" data-c="${ci}"><span>${esc(c.title)}</span><i data-a="cu" data-c="${ci}" title="上移">▲</i><i data-a="cd" data-c="${ci}" title="下移">▼</i><i data-a="ba" data-c="${ci}" title="新增區塊">＋</i><i data-a="cx" data-c="${ci}" title="刪除">✕</i></div>` +
      c.blocks.map((b, bi) => `<div class="tr k${ed && ed.c === ci && ed.b === bi ? ' on' : ''}" data-a="sel" data-c="${ci}" data-b="${bi}"><span>${esc(b.title)}</span><i data-a="bu" data-c="${ci}" data-b="${bi}">▲</i><i data-a="bd" data-c="${ci}" data-b="${bi}">▼</i><i data-a="bx" data-c="${ci}" data-b="${bi}">✕</i></div>`).join('');
  }).join('') || '<p class="mut">尚無章節，請按「＋章節」。</p>';
}
async function drawEd() {
  const box = $('#ed'), t = T();
  if (!ed || !t.chapters[ed.c]) {
    box.innerHTML = `<h2>範本管理：${esc(t.name)}</h2><label>範本名稱<input type="text" id="tname" value="${esc(t.name)}"></label>
      <div class="row"><button class="b g" id="texp">匯出此範本</button><button class="b g" id="texpall">匯出全部</button><button class="b g" id="timp">匯入範本</button></div>
      <p class="mut">從左側選擇章節或區塊編輯。內文使用 Markdown，可用變數 {{案名}} {{機關}} {{公司}} {{日期}}。</p>
      <h2>版本紀錄</h2><p class="mut">每次按「儲存」都會以 git 建立一個版本，可隨時還原。</p><div id="tplhist">載入中…</div>`;
    $('#tname').oninput = e => { t.name = e.target.value; drawSel(); dirty(); };
    $('#texp').onclick = async () => { const p = await api.exportJson(t.name, { templates: [t] }); if (p) toast('已匯出：' + p); };
    $('#texpall').onclick = async () => { const p = await api.exportJson('全部範本', DB); if (p) toast('已匯出：' + p); };
    $('#timp').onclick = async () => {
      const d = await api.importJson(); if (!d) return; if (!okDiscard()) return;
      const ts = d.templates || (d.chapters ? [d] : null);
      if (!ts) return toast('檔案格式不正確');
      ts.forEach(x => DB.templates.push(fresh(x)));
      (d.library || []).forEach(b => DB.library.push({ ...b, id: uid() }));
      cur = DB.templates[DB.templates.length - 1].id; newSession(); dirty(); drawSel(); refresh(); toast(`已匯入 ${ts.length} 個範本，記得按「儲存」`);
    };
    const l = await api.log(), h = $('#tplhist'); if (!h) return;
    h.innerHTML = l === null ? '<p class="mut">未偵測到 git，無法使用版本紀錄。</p>' : !l.length ? '<p class="mut">尚無版本。</p>'
      : l.map(x => `<div class="hv"><span>${esc(x.d)}　${esc(x.s)}</span><button class="b g" data-h="${x.h}">還原</button></div>`).join('');
    h.onclick = async e => {
      const hh = e.target.dataset.h; if (!hh || !confirm('還原到此版本？目前未儲存的變更會遺失。')) return;
      if (!okDiscard()) return; const d = await api.restore(hh); if (!d) return toast('還原失敗');
      DB = d; if (!DB.templates.some(x => x.id === cur)) cur = DB.templates[0].id;
      newSession(); ed = null; setDirty(false); drawSel(); refresh(); toast('已還原');
    };
    return;
  }
  const c = t.chapters[ed.c];
  if (ed.b == null) {
    box.innerHTML = `<h2>章節</h2><label>章節標題<input type="text" id="f1" value="${esc(c.title)}"></label>
      <h2>從區塊庫插入</h2><div class="row"><select id="f2" style="flex:1;width:auto">${byGroup(DB.library).map(b => `<option value="${b.id}">${esc(grp(b) + '｜' + b.title)}</option>`).join('')}</select><button class="b g" id="f3">插入到此章節</button></div>`;
    $('#f1').oninput = e => { c.title = e.target.value; drawTree(); dirty(); };
    $('#f3').onclick = () => {
      const lb = DB.library.find(x => x.id === $('#f2').value); if (!lb) return toast('區塊庫是空的');
      c.blocks.push({ id: uid(), title: lb.title, content: lb.content, keywords: [...(lb.keywords || [])] });
      ed = { c: ed.c, b: c.blocks.length - 1 }; dirty(); drawTree(); drawEd();
    };
    return;
  }
  const b = c.blocks[ed.b];
  box.innerHTML = `<h2>區塊（${esc(c.title)}）</h2><label>區塊標題<input type="text" id="f1" value="${esc(b.title)}"></label>
    <label>RFP 關鍵字（以逗號分隔）<input type="text" id="f2" value="${esc((b.keywords || []).join(','))}"></label>
    <label>內文（Markdown）<textarea id="f3" rows="18">${esc(b.content)}</textarea></label>
    <div class="row"><button class="b g" id="f4">存入區塊庫</button></div>`;
  $('#f1').oninput = e => { b.title = e.target.value; drawTree(); dirty(); };
  $('#f2').oninput = e => { b.keywords = kw(e.target.value); dirty(); };
  $('#f3').oninput = e => { b.content = e.target.value; dirty(); };
  $('#f4').onclick = () => { DB.library.push({ id: uid(), title: b.title, content: b.content, keywords: [...(b.keywords || [])], group: '自訂' }); dirty(); toast('已存入區塊庫（分類：自訂）'); };
}
$('#tree').onclick = e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, c = +el.dataset.c, b = el.dataset.b == null ? null : +el.dataset.b, t = T(), ch = t.chapters[c];
  if (a === 'sel') ed = { c, b };
  else if (a === 'cu') { mv(t.chapters, c, -1); ed = null; dirty(); }
  else if (a === 'cd') { mv(t.chapters, c, 1); ed = null; dirty(); }
  else if (a === 'cx') { if (!confirm(`刪除章節「${ch.title}」及其所有區塊？`)) return; t.chapters.splice(c, 1); ed = null; dirty(); }
  else if (a === 'ba') { ch.blocks.push({ id: uid(), title: '新區塊', content: '', keywords: [] }); ed = { c, b: ch.blocks.length - 1 }; dirty(); }
  else if (a === 'bu') { mv(ch.blocks, b, -1); ed = null; dirty(); }
  else if (a === 'bd') { mv(ch.blocks, b, 1); ed = null; dirty(); }
  else if (a === 'bx') { if (!confirm('刪除此區塊？')) return; ch.blocks.splice(b, 1); ed = null; dirty(); }
  drawTree(); drawEd();
};
$('#cadd').onclick = () => { const t = T(); t.chapters.push({ id: uid(), title: '新章節', blocks: [] }); ed = { c: t.chapters.length - 1, b: null }; dirty(); drawTree(); drawEd(); };
$('#tnew').onclick = () => { if (!okDiscard()) return; const t = { id: uid(), name: '新範本', chapters: [] }; DB.templates.push(t); cur = t.id; ed = null; newSession(); dirty(); drawSel(); refresh(); };
$('#tcopy').onclick = () => { if (!okDiscard()) return;
  const t = fresh(JSON.parse(JSON.stringify(T()))); t.name += '（副本）';
  DB.templates.push(t); cur = t.id; ed = null; newSession(); dirty(); drawSel(); refresh();
};
$('#tdel').onclick = () => { if (!okDiscard()) return;
  if (DB.templates.length < 2) return toast('至少保留一個範本');
  if (!confirm(`刪除範本「${T().name}」？`)) return;
  DB.templates = DB.templates.filter(t => t.id !== cur); cur = DB.templates[0].id; ed = null; newSession(); dirty(); drawSel(); refresh();
};
$('#reset').onclick = async () => {
  if (!confirm('將所有範本與區塊庫還原為內建預設？自訂內容會被覆蓋（仍可從版本紀錄還原）。Word 格式範本不受影響。') || !okDiscard()) return;
  DB = await api.reset(); cur = DB.templates[0].id; ed = null; newSession(); setDirty(false); drawSel(); refresh(); toast('已還原預設');
};

/* ---------- 區塊庫 ---------- */
function drawLib() { const g = $('#lg').value || GALL; $('#lg').innerHTML = groupOpts(g); if ($('#lg').value !== g) $('#lg').value = GALL; drawLibList(); drawLibEd(); }
function drawLibList() {
  const q = $('#q').value.trim().toLowerCase(), g = $('#lg').value || GALL;
  const items = byGroup(DB.library.filter(b => libMatch(b, q, g)));
  $('#liblist').innerHTML = groupedHtml(items, b => `<div class="tr${b.id === libId ? ' on' : ''}" data-id="${b.id}"><span>${esc(b.title)}</span></div>`) || '<p class="mut">沒有符合的區塊。</p>';
}
function drawLibEd() {
  const box = $('#libed'), b = DB.library.find(x => x.id === libId);
  if (!b) { box.innerHTML = '<p class="mut">選擇左側區塊進行編輯，或按「新增」建立共用區塊。</p>'; return; }
  box.innerHTML = `<h2>共用區塊</h2><label>標題<input type="text" id="l1" value="${esc(b.title)}"></label>
    <label>分類<input type="text" id="l0" list="lgl" value="${esc(b.group || '')}" placeholder="例如：自訂"></label><datalist id="lgl">${[...new Set(DB.library.map(x => x.group).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <label>RFP 關鍵字（以逗號分隔）<input type="text" id="l2" value="${esc((b.keywords || []).join(','))}"></label>
    <label>內文（Markdown）<textarea id="l3" rows="14">${esc(b.content)}</textarea></label>
    <div class="row"><select id="l4" style="width:auto">${T().chapters.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join('')}</select>
    <button class="b g" id="l5">插入到「${esc(T().name)}」此章節</button><button class="b d" id="l6">刪除區塊</button></div>`;
  $('#l1').oninput = e => { b.title = e.target.value; drawLibList(); dirty(); };
  $('#l0').onchange = e => { b.group = e.target.value.trim(); dirty(); drawLib(); };
  $('#l2').oninput = e => { b.keywords = kw(e.target.value); dirty(); };
  $('#l3').oninput = e => { b.content = e.target.value; dirty(); };
  $('#l5').onclick = () => {
    const c = T().chapters[+$('#l4').value]; if (!c) return toast('此範本尚無章節');
    c.blocks.push({ id: uid(), title: b.title, content: b.content, keywords: [...(b.keywords || [])] }); dirty(); toast(`已插入「${c.title}」`); drawList();
  };
  $('#l6').onclick = () => { if (!confirm('刪除此共用區塊？（已插入範本的內容不受影響）')) return; DB.library = DB.library.filter(x => x !== b); libId = null; dirty(); drawLib(); };
}
$('#liblist').onclick = e => { const r = e.target.closest('[data-id]'); if (r) { libId = r.dataset.id; drawLib(); } };
$('#q').oninput = drawLibList; $('#lg').onchange = drawLibList;
$('#ladd').onclick = () => { const g = $('#lg').value, b = { id: uid(), title: '新共用區塊', content: '', keywords: [], group: g && g !== GALL && g !== GNONE ? g : '自訂' }; DB.library.push(b); libId = b.id; dirty(); drawLib(); };

/* ---------- Word 格式範本 ---------- */
const curWs = () => DB.wordStyles.find(s => s.id === wsId) || (wsId = DB.wordStyles[0].id, DB.wordStyles[0]);
const getP = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const setP = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k] = a[k] || {}, o)[last] = v; };
const SAMPLE_MD = `# 服務建議書範例\n\n> 招標機關：範例機關　提案單位：範例公司　日期：${M.日期}\n\n## 1. 公司簡介與提案緣起\n\n### 1.1 提案緣起\n\n這是內文範例，包含**粗體**與\`行內程式碼\`，用來檢查字型、字級、行距與段落間距。\n\n### 1.2 服務項目\n\n- 系統開發與整合\n- 維運與教育訓練\n  - 二線技術支援\n\n| 年度 | 客戶 | 專案名稱 |\n|---|---|---|\n| 2025 | 範例客戶 | 範例專案 |\n\n## 2. 專案組織與人力\n\n### 2.1 組織架構\n\n第二章的內容。若啟用「每章換頁」，這裡會從新的一頁開始。\n`;
const FLEX = { left: 'flex-start', center: 'center', right: 'flex-end' };

function drawWsList() {
  $('#wslist').innerHTML = DB.wordStyles.map(s => `<div class="tr${s.id === wsId ? ' on' : ''}" data-id="${s.id}" tabindex="0"><span>${esc(s.name)}</span>${s.id === DB.defaultWordStyle ? '<span class="tag" style="flex:none">使用中</span>' : ''}</div>`).join('');
}
function drawWs() {
  drawWsList();
  const s = curWs(), f = (label, p, type = 'text', ex = '') => `<label>${label}<input type="${type}" data-p="${p}" value="${esc(type === 'color' ? '#' + getP(s, p) : getP(s, p) ?? '')}" ${ex}></label>`;
  const n = (label, p, min, max, step) => f(label, p, 'number', `min="${min}" max="${max}" step="${step}"`);
  const sl = (label, p, opts) => `<label>${label}<select data-p="${p}">${opts.map(([v, t]) => `<option value="${v}"${String(getP(s, p)) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const al = [['left', '靠左'], ['center', '置中'], ['right', '靠右']];
  $('#wsed').innerHTML = `<h2>Word 格式：${esc(s.name)}</h2>
    <div class="row"><button class="b${s.id === DB.defaultWordStyle ? ' g' : ''}" id="wsuse">${s.id === DB.defaultWordStyle ? '✓ 目前使用中' : '設為匯出時使用'}</button><button class="b g" id="wstest">用範例內容匯出 Word 試看</button></div>
    ${f('格式名稱', 'name')}
    <h2>字型</h2><div class="fg">${f('中文字型', 'fontEastAsia', 'text', 'list="fe"')}${f('英數字型', 'fontAscii', 'text', 'list="fa"')}</div>
    <datalist id="fe"><option>Microsoft JhengHei</option><option>標楷體</option><option>新細明體</option><option>細明體</option><option>Noto Sans TC</option><option>PingFang TC</option></datalist>
    <datalist id="fa"><option>Calibri</option><option>Arial</option><option>Times New Roman</option><option>Cambria</option><option>Consolas</option></datalist>
    <h2>字級（pt）</h2><div class="fg">${n('內文', 'sizes.body', 8, 20, 0.5)}${n('主標題', 'sizes.title', 12, 48, 1)}${n('章（標題 2）', 'sizes.h1', 10, 36, 1)}${n('節（標題 3）', 'sizes.h2', 9, 30, 1)}${n('小節（標題 4）', 'sizes.h3', 8, 24, 1)}</div>
    <h2>顏色</h2><div class="fg">${f('主標題', 'colors.title', 'color')}${f('章', 'colors.h1', 'color')}${f('節', 'colors.h2', 'color')}${f('小節', 'colors.h3', 'color')}${f('表格表頭底色', 'colors.tableHead', 'color')}${f('引言左線', 'colors.quote', 'color')}</div>
    <h2>段落</h2><div class="fg">${n('行距（倍）', 'lineSpacing', 1, 3, 0.05)}${n('段落後距（pt）', 'paraAfter', 0, 36, 1)}</div>
    <label class="chk"><input type="checkbox" data-p="chapterPageBreak" ${s.chapterPageBreak ? 'checked' : ''}>每個章節從新的一頁開始（第一章前的標題區會成為封面頁）</label>
    <h2>紙張與邊界</h2><div class="fg">${sl('紙張', 'page.size', [['A4', 'A4'], ['A3', 'A3'], ['Letter', 'Letter'], ['Legal', 'Legal']])}${sl('方向', 'page.landscape', [[false, '直式'], [true, '橫式']])}
      ${n('上邊界（cm）', 'page.margin.top', 0.5, 6, 0.1)}${n('下邊界（cm）', 'page.margin.bottom', 0.5, 6, 0.1)}${n('左邊界（cm）', 'page.margin.left', 0.5, 6, 0.1)}${n('右邊界（cm）', 'page.margin.right', 0.5, 6, 0.1)}</div>
    <h2>頁首 / 頁尾</h2><p class="mut">文字可用 {{案名}} {{機關}} {{公司}} {{日期}}，匯出時自動帶入。</p>
    <div class="fg">${f('頁首文字', 'header')}${sl('頁首對齊', 'headerAlign', al)}${f('頁尾文字', 'footer')}${sl('頁尾對齊', 'footerAlign', al)}${sl('頁碼', 'pageNumber', [['full', '第 X 頁 / 共 Y 頁'], ['num', '只顯示數字'], ['none', '不顯示']])}</div>
    <h2>預覽（示意）</h2><div id="wsp"></div><p class="mut">預覽僅供參考，實際排版以 Word 開啟為準；字型需已安裝在電腦上。</p>`;
  drawWsPv();
  $('#wsuse').onclick = () => { DB.defaultWordStyle = s.id; drawWsel(); dirty(); drawWs(); };
  $('#wstest').onclick = async () => { try { const p = await api.exportFile('docx', '格式範例_' + s.name, SAMPLE_MD, { ...clone(s), header: vars(s.header), footer: vars(s.footer) }); if (p) toast('已匯出：' + p); } catch (e) { toast('匯出失敗：' + e.message); } };
}
function drawWsPv() {
  const s = curWs(), z = s.sizes, c = s.colors, m = s.page.margin, sz = s.page.size + (s.page.landscape ? ' 橫式' : ' 直式');
  const hd = (t, size, col, mt = 10) => `<div style="font-size:${size}pt;font-weight:700;color:#${col};margin:${mt}pt 0 4pt;line-height:1.3">${t}</div>`;
  const pn = { full: '第 1 頁 / 共 3 頁', num: '1', none: '' }[s.pageNumber];
  $('#wsp').innerHTML = `<div class="pg" style="font-family:'${esc(s.fontAscii)}','${esc(s.fontEastAsia)}',sans-serif;font-size:${z.body}pt;line-height:${s.lineSpacing}">` +
    (s.header ? `<div class="hf" style="justify-content:${FLEX[s.headerAlign]};margin-bottom:6pt">${esc(vars(s.header))}</div>` : '') +
    hd('服務建議書範例', z.title, c.title, 0) +
    `<div style="border-left:3px solid #${c.quote};padding-left:8px;color:#555;margin:4pt 0 ${s.paraAfter}pt">招標機關：範例機關　提案單位：範例公司</div>` +
    hd('1. 公司簡介與提案緣起', z.h1, c.h1) + hd('1.1 提案緣起', z.h2, c.h2, 6) +
    `<p style="margin:0 0 ${s.paraAfter}pt">這是內文範例，包含<b>粗體</b>，用來檢查字型、字級與行距。第二行文字用來觀察段落間距。</p>` +
    `<table><tr><th style="background:#${c.tableHead}">年度</th><th style="background:#${c.tableHead}">客戶</th></tr><tr><td>2025</td><td>範例客戶</td></tr></table>` +
    hd('1.2 服務項目', z.h3, c.h3, 6) + `<p style="margin:0">• 項目一　• 項目二</p>` +
    ((s.footer || pn) ? `<div class="hf" style="justify-content:${FLEX[s.footerAlign]};margin-top:12pt;gap:1em">${esc(vars(s.footer))}${pn ? `<span>${pn}</span>` : ''}</div>` : '') +
    `</div><p class="mut" style="text-align:center;margin:6px 0 0">${sz}・邊界 上${m.top} 下${m.bottom} 左${m.left} 右${m.right} cm</p>`;
}
$('#wsed').oninput = $('#wsed').onchange = e => {
  const el = e.target, p = el.dataset.p; if (!p) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'color') v = el.value.slice(1).toUpperCase();
  else if (el.type === 'number') { v = parseFloat(el.value); if (!Number.isFinite(v)) return; }
  else if (p === 'page.landscape') v = el.value === 'true';
  else v = el.value;
  setP(curWs(), p, v); dirty();
  if (p === 'name') { drawWsList(); drawWsel(); $('#wsed h2').textContent = 'Word 格式：' + v; }
  drawWsPv();
};
const pickWs = r => { if (r) { wsId = r.dataset.id; drawWs(); } };
$('#wslist').onclick = e => pickWs(e.target.closest('[data-id]'));
$('#wslist').onkeydown = e => { if (e.key === 'Enter') pickWs(e.target.closest('[data-id]')); };
$('#wsnew').onclick = () => { const s = { ...clone(DB.wordStyles[0]), id: 'ws' + uid(), name: '新格式' }; DB.wordStyles.push(s); wsId = s.id; dirty(); drawWsel(); drawWs(); };
$('#wscopy').onclick = () => { const s = { ...clone(curWs()), id: 'ws' + uid() }; s.name += '（副本）'; DB.wordStyles.push(s); wsId = s.id; dirty(); drawWsel(); drawWs(); };
$('#wsdel').onclick = () => {
  if (DB.wordStyles.length < 2) return toast('至少保留一個 Word 格式');
  if (!confirm(`刪除格式「${curWs().name}」？`)) return;
  DB.wordStyles = DB.wordStyles.filter(s => s.id !== wsId);
  if (!DB.wordStyles.some(s => s.id === DB.defaultWordStyle)) DB.defaultWordStyle = DB.wordStyles[0].id;
  wsId = DB.defaultWordStyle; dirty(); drawWsel(); drawWs();
};
$('#wsexp').onclick = async () => { const s = curWs(), p = await api.exportJson('Word格式_' + s.name, { wordStyles: [s] }); if (p) toast('已匯出：' + p); };
$('#wsimp').onclick = async () => {
  const d = await api.importJson(); if (!d) return;
  const list = d.wordStyles || (d.sizes && d.page ? [d] : null);
  if (!list || !list.length) return toast('檔案格式不正確');
  list.forEach(x => DB.wordStyles.push({ ...x, id: 'ws' + uid() }));
  wsId = DB.wordStyles[DB.wordStyles.length - 1].id; dirty(); drawWsel(); drawWs(); toast(`已匯入 ${list.length} 個格式，記得按「儲存」`);
};

/* ---------- 檔案庫（圖片 + 附件） ---------- */
let FILES = { images: [], attachments: [], dirs: {} }, fSel = null;    // fSel = { kind: 'img' | 'att', f }
const sizeTxt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fAll = () => [...FILES.images.map(x => ({ ...x, kind: 'img' })), ...FILES.attachments.map(x => ({ ...x, kind: 'att' }))];
const fCur = () => fSel && fAll().find(x => x.kind === fSel.kind && x.f === fSel.f);
let FMULTI = false, FSELS = new Set();
const fKey = x => x.kind + ':' + x.f, extOf = x => (x.ext || x.f.split('.').pop() || '').toLowerCase();
async function loadFiles() {
  FILES = await api.fileList(); if (fSel && !fCur()) fSel = null;
  const keys = new Set(fAll().map(fKey)); FSELS = new Set([...FSELS].filter(k => keys.has(k)));
  $('#ftag').innerHTML = optHtml([ALLG, ...[...new Set(fAll().flatMap(x => x.tags || []))].sort()], $('#ftag').value || ALLG);
  drawFiles();
}
function filesShown() {
  const q = $('#fq').value.trim().toLowerCase(), k = $('#fk').value, tg = $('#ftag').value || ALLG, so = $('#fsort').value;
  const cmp = { time: (a, b) => b.mtime - a.mtime, name: (a, b) => a.name.localeCompare(b.name, 'zh-Hant'), size: (a, b) => b.size - a.size,
    type: (a, b) => a.kind === b.kind ? extOf(a).localeCompare(extOf(b)) || a.name.localeCompare(b.name, 'zh-Hant') : a.kind.localeCompare(b.kind) }[so];
  return fAll().filter(x => (k === 'all' || (k === 'unused' ? x.kind === 'img' && !x.uses : x.kind === k)) && (!q || (x.name + ' ' + (x.tags || []).join(' ')).toLowerCase().includes(q)) && (tg === ALLG || (x.tags || []).includes(tg))).sort(cmp);
}
const fItems = () => [...FSELS].map(k => { const i = k.indexOf(':'); return { kind: k.slice(0, i), f: k.slice(i + 1) }; });
function updFBar() {
  $('#fbar').hidden = !FMULTI; $('#fmulti').textContent = FMULTI ? '結束多選' : '多選'; $('#fcnt').textContent = `已選 ${FSELS.size} 個`;
  ['ftadd', 'ftrm', 'fexp', 'fbdel'].forEach(id => $('#' + id).disabled = !FSELS.size);
}
function drawFiles() {
  const items = filesShown();
  $('#fdirs').innerHTML = `圖片：${esc(FILES.dirs.img || '')}<br>附件：${esc(FILES.dirs.att || '')}　<span class="mut">（可在「設定」變更）</span>`;
  $('#filelist').innerHTML = items.map(x => `<div class="fi${fSel && fSel.kind === x.kind && fSel.f === x.f ? ' on' : ''}" data-k="${x.kind}" data-f="${esc(x.f)}" tabindex="0">` +
    (FMULTI ? `<input type="checkbox" class="mk" data-fc="${esc(fKey(x))}" ${FSELS.has(fKey(x)) ? 'checked' : ''} aria-label="選取">` : '') +
    `<div class="th">${x.kind === 'img' ? `<img src="${x.url}" alt="">` : esc((x.ext || '檔').slice(0, 4))}</div>` +
    `<div class="t"><b>${esc(x.name)}</b><small>${x.kind === 'img' ? '圖片' : '附件'} ・ ${sizeTxt(x.size)} ・ ${fmt(new Date(x.mtime).toISOString())}</small>` +
    `<div>${chips(x.tags)}${x.kind === 'img' ? (x.uses ? `<span class="chip g">用於 ${x.uses}</span>` : '<span class="chip w">未使用</span>') : ''}</div></div></div>`).join('')
    || '<p class="mut">沒有符合的檔案。按上方「＋上傳圖片」「＋上傳附件」或「從資料夾匯入」加入檔案。</p>';
  updFBar(); drawFileView();
}
const pickFile = r => { if (r) { fSel = { kind: r.dataset.k, f: r.dataset.f }; drawFiles(); } };
$('#filelist').onclick = e => { const cb = e.target.closest('[data-fc]'); if (cb) { cb.checked ? FSELS.add(cb.dataset.fc) : FSELS.delete(cb.dataset.fc); return updFBar(); } pickFile(e.target.closest('[data-f]')); };
$('#filelist').onkeydown = e => { if (e.key === 'Enter' && !e.target.closest('[data-fc]')) pickFile(e.target.closest('[data-f]')); };
$('#fq').oninput = $('#fk').onchange = $('#fsort').onchange = $('#ftag').onchange = drawFiles;
$('#fmulti').onclick = () => { FMULTI = !FMULTI; if (!FMULTI) FSELS.clear(); drawFiles(); };
$('#fall').onclick = () => { filesShown().forEach(x => FSELS.add(fKey(x))); drawFiles(); };
$('#fnone').onclick = () => { FSELS.clear(); drawFiles(); };
$('#ftadd').onclick = () => askText('批次加標籤', '標籤（以逗號或頓號分隔）', '', '加入', async v => { const t = parseTags(v); if (!t.length) return; await api.fileTags(fItems(), t, []); await loadFiles(); toast('已加入標籤'); });
$('#ftrm').onclick = () => askText('批次移除標籤', '要移除的標籤（以逗號或頓號分隔）', '', '移除', async v => { const t = parseTags(v); if (!t.length) return; await api.fileTags(fItems(), [], t); await loadFiles(); toast('已移除標籤'); });
$('#fexp').onclick = async () => { const r = await api.fileExportMany(fItems()); if (r) toast(`已匯出 ${r.n} 個檔案到 ${r.dir}`); };
$('#fbdel').onclick = async () => {
  const list = fItems(), u = await api.fileUsageMany(list);
  const used = u.docs.length ? `\n\n⚠ 以下文件正在使用其中的圖片，刪除後會顯示「找不到圖片」：\n${u.docs.slice(0, 5).map(t => '・' + t).join('\n')}${u.docs.length > 5 ? `\n…等 ${u.docs.length} 份` : ''}` : (u.templates ? '\n\n⚠ 範本或區塊中有引用其中的圖片。' : '');
  if (!confirm(`刪除選取的 ${list.length} 個檔案？此動作無法復原。${used}`)) return;
  const n = await api.fileDeleteMany(list); FSELS.clear(); fSel = null; await loadFiles(); toast(`已刪除 ${n} 個檔案`);
};
$('#fq').oninput = $('#fk').onchange = drawFiles;
async function afterAdd(kind, r) {
  if (r.added.length) fSel = { kind, f: r.added[0].f };
  await loadFiles();
  if (r.skipped.length) alert('以下檔案未加入：\n' + r.skipped.map(x => `・${x.name}（${x.reason}）`).join('\n'));
  if (r.added.length) toast(`已加入 ${r.added.length} 個${kind === 'img' ? '圖片' : '附件'}` + (r.ignored ? `，另有 ${r.ignored} 個非圖片檔已略過` : ''));
}
const upload = async kind => afterAdd(kind, await api.fileAdd(kind));
$('#fupdir').onclick = () => openModal('從資料夾匯入', `<p class="mut">選擇一個資料夾，把裡面的檔案（不含子資料夾，最多 500 個）一次加入檔案庫。</p><div class="row"><button class="b" data-k="img">匯入圖片</button><button class="b" data-k="att">匯入附件（所有檔案）</button></div>`, () => {
  $('#mbody').onclick = async e => { const k = (e.target.closest('[data-k]') || {}).dataset; if (!k) return; closeModal(); afterAdd(k.k, await api.fileAddFolder(k.k)); };
});
$('#fupimg').onclick = () => upload('img'); $('#fupatt').onclick = () => upload('att');
async function drawFileView() {
  const box = $('#fview'), x = fCur();
  if (!x) { box.innerHTML = '<p class="mut">選擇左側檔案即可預覽與管理。圖片可插入目前編輯中的建議書；附件可開啟、另存、重新命名。</p>'; return; }
  const img = x.kind === 'img';
  box.innerHTML = `<h2>${esc(x.name)}</h2>
    <dl class="kv"><dt>類型</dt><dd>${img ? '圖片' : '附件'}</dd><dt>大小</dt><dd>${sizeTxt(x.size)}</dd><dt>更新</dt><dd>${fmt(new Date(x.mtime).toISOString())}</dd>
    <dt>檔案</dt><dd>${esc(x.f)}${x.legacy ? '（位於預設資料夾，非目前的圖片資料夾）' : ''}</dd><dt>標籤</dt><dd>${(x.tags || []).length ? chips(x.tags, 'g') : '無'}</dd>${img ? `<dt>使用</dt><dd>${x.uses ? `${x.uses} 份文件／範本使用中` : '未被任何文件使用'}</dd>` : ''}</dl>
    <div class="row">${img ? '<button class="b" id="fins">插入到目前建議書</button>' : `<button class="b" id="fopen">開啟</button>`}<button class="b g" id="fsave">另存副本</button><button class="b g" id="freveal">在資料夾中顯示</button></div>
    <div class="row"><button class="b g" id="fren">重新命名</button><button class="b g" id="ftg">標籤</button><button class="b d" id="fdel">刪除</button></div>
    ${!img && x.openable === false ? '<p class="warn">此類型（程式／腳本）為安全起見不會直接開啟，請用「在資料夾中顯示」。</p>' : ''}
    ${img ? '<div id="fprev"><p class="mut">載入預覽…</p></div>' : '<p class="mut">附件會保存在附件資料夾，不會嵌入 Word 匯出檔。</p>'}`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  if (img) api.imgGet(x.f).then(u => { if (fCur() === x || (fSel && fSel.f === x.f)) { const p = $('#fprev'); if (p) p.innerHTML = u ? `<img class="bigimg" src="${u}" alt="${esc(x.name)}">` : '<p class="mut">無法預覽</p>'; } });
  on('#fins', () => { setTab('make'); insertImage(x.f); toast('已插入到建議書（文末或游標處），可修改「圖說」'); });
  on('#fopen', async () => { const r = await api.fileOpen(x.kind, x.f); if (!r.ok) toast(r.error || '無法開啟'); });
  on('#fsave', async () => { const p = await api.fileSaveAs(x.kind, x.f); if (p) toast('已另存：' + p); });
  on('#freveal', () => api.fileReveal(x.kind, x.f));
  on('#ftg', () => askText('檔案標籤', '標籤（以逗號或頓號分隔，留空代表清除）', (x.tags || []).join('、'), '儲存', async v => { await api.fileTags([{ kind: x.kind, f: x.f }], parseTags(v), x.tags || []); await loadFiles(); toast('已更新標籤'); }));
  on('#fren', () => openModal('重新命名', `<label>${img ? '顯示名稱（不會改動實際檔名，文件中的引用不受影響）' : '檔名'}<input type="text" id="rn" value="${esc(x.name)}"></label><div class="row"><button class="b" id="rok">確定</button></div>`, () => {
    $('#rn').focus(); $('#rn').select();
    const go = async () => { const r = await api.fileRename(x.kind, x.f, $('#rn').value); if (!r.ok) return toast(r.error || '失敗'); fSel = { kind: x.kind, f: r.f }; closeModal(); await loadFiles(); toast('已重新命名'); };
    $('#rok').onclick = go; $('#rn').onkeydown = e => { if (e.key === 'Enter') go(); };
  }));
  on('#fdel', async () => {
    const u = await api.fileUsage(x.kind, x.f);
    const used = u.docs.length ? `\n\n⚠ 以下文件正在使用此圖片，刪除後會顯示「找不到圖片」：\n${u.docs.slice(0, 5).map(t => '・' + t).join('\n')}${u.docs.length > 5 ? `\n…等 ${u.docs.length} 份` : ''}` : (u.templates ? '\n\n⚠ 範本或區塊中有引用此圖片。' : '');
    if (!confirm(`刪除「${x.name}」？此動作無法復原。${used}`)) return;
    await api.fileDelete(x.kind, x.f); fSel = null; await loadFiles(); toast('已刪除');
  });
}

/* ---------- 版本歷史（git） ---------- */
let HL = [], HMORE = false, HSEL = null, HDEL = [], hqT;
async function drawHist() {
  const info = await api.historyInfo();
  if (!info || !info.enabled) { $('#hlist').innerHTML = '<p class="mut">未偵測到 git，無法使用版本歷史。安裝 git 並重新啟動程式後，之後的每次儲存都會留下版本。</p>'; $('#hview').innerHTML = ''; return; }
  await loadHist(true);
}
async function loadHist(reset) {
  const k = $('#hk').value, q = $('#hq').value.trim();
  if (k === 'deleted') { HDEL = (await api.docsDeleted()) || []; HL = []; HMORE = false; }
  else {
    const r = await api.historyList({ kind: k === 'all' ? '' : k, q, skip: reset ? 0 : HL.length, limit: 40 });
    if (!r) { $('#hlist').innerHTML = '<p class="mut">讀取版本紀錄失敗。</p>'; return; }
    HL = reset ? r.items : [...HL, ...r.items]; HMORE = r.more;
  }
  if (reset) { HSEL = null; $('#hview').innerHTML = '<p class="mut">選擇左側的紀錄可查看內容、差異，並還原。</p>'; }
  drawHistList();
}
function drawHistList() {
  const k = $('#hk').value, q = $('#hq').value.trim().toLowerCase();
  if (k === 'deleted') {
    $('#hlist').innerHTML = HDEL.filter(x => !q || x.title.toLowerCase().includes(q)).map(x => `<div class="cm${HSEL && HSEL.del === x.id ? ' on' : ''}" data-del="${x.id}" tabindex="0"><b>${esc(x.title)}</b><small>刪除於 ${esc(fmt(x.d))}</small></div>`).join('') || '<p class="mut">沒有可找回的已刪除文件。</p>';
    return;
  }
  $('#hlist').innerHTML = HL.map(x => `<div class="cm${HSEL && HSEL.h === x.h ? ' on' : ''}" data-h="${x.h}" tabindex="0"><b>${esc(x.s)}</b><small>${esc(fmt(x.d))} ・ ${x.h}${x.tpl ? ' ・ 範本' : ''}${x.docs ? ` ・ ${x.docs} 份文件` : ''}${x.files ? ` ・ ${x.files} 個檔案` : ''}</small></div>`).join('')
    + (HMORE ? '<div class="row"><button class="b g" id="hmore">載入更多</button></div>' : '') || '<p class="mut">沒有符合的紀錄。</p>';
}
const pickHist = r => { if (!r) return; if (r.dataset.del) showDeleted(r.dataset.del); else if (r.dataset.h) showCommit(r.dataset.h); };
$('#hlist').onclick = e => { if (e.target.id === 'hmore') return loadHist(false); pickHist(e.target.closest('[data-h],[data-del]')); };
$('#hlist').onkeydown = e => { if (e.key === 'Enter') pickHist(e.target.closest('[data-h],[data-del]')); };
$('#hk').onchange = () => loadHist(true);
$('#hq').oninput = () => { if ($('#hk').value === 'deleted') return drawHistList(); clearTimeout(hqT); hqT = setTimeout(() => loadHist(true), 250); };
const fileLabel = f => f.k === 'doc' ? `文件「${esc(f.title || f.p)}」` : f.k === 'tpl' ? '範本、區塊庫、Word 格式' : f.k === 'idx' ? '檔案名稱與標籤索引' : f.k === 'img' ? '圖片 ' + esc(f.p.replace(/^images\//, '')) : esc(f.p);
async function showCommit(h) {
  HSEL = { h }; drawHistList(); const c = await api.historyShow(h), box = $('#hview');
  if (!c) { box.innerHTML = '<p class="mut">無法讀取此版本。</p>'; return; }
  const lab = { A: '新增', M: '修改', D: '刪除' };
  box.innerHTML = `<h2>${esc(c.s)}</h2><p class="mut">${esc(fmt(c.d))} ・ 版本 ${c.h}</p>` +
    (c.files.map((f, i) => `<div class="fl"><span class="st ${f.s}">${lab[f.s] || f.s}</span><span class="nm">${fileLabel(f)}</span>` +
      (f.k === 'doc' ? `<button class="b g" data-a="pv" data-i="${i}">預覽</button><button class="b g" data-a="df" data-i="${i}">差異</button><button class="b" data-a="rs" data-i="${i}">${f.s === 'D' ? '找回此文件' : '還原到此版本'}</button>${f.s === 'M' ? `<button class="b g" data-a="rb" data-i="${i}" title="還原成這次儲存之前的內容">還原到變更前</button>` : ''}`
        : f.k === 'tpl' && f.s !== 'D' ? `<button class="b g" data-a="df" data-i="${i}">差異摘要</button><button class="b" data-a="rs" data-i="${i}">還原到此版本</button>${f.s === 'M' ? `<button class="b g" data-a="rb" data-i="${i}" title="還原成這次儲存之前的狀態">還原到變更前</button>` : ''}` : '') + '</div>').join('') || '<p class="mut">此版本沒有檔案變更。</p>') + '<div id="hdiff"></div>';
  box.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const f = c.files[+b.dataset.i], a = b.dataset.a, out = $('#hdiff'), after = f.s !== 'D' ? c.h : null, before = f.s !== 'A' ? c.h + '^' : null;
    const get = async ref => ref ? api.historyBlob(ref, f.p) : null, json = async ref => { try { return JSON.parse(await get(ref)); } catch { return null; } };
    if (f.k === 'doc') {
      const id = f.p.replace(/^documents\//, '').replace(/\.json$/, '');
      if (a === 'pv') { const d = await json(after || before); out.innerHTML = d ? `<h2>${esc(d.title)}</h2><div class="md">${await renderMd(d.md)}</div>` : '<p class="mut">無法讀取內容。</p>'; }
      else if (a === 'df') out.innerHTML = docDiffView(await json(before), await json(after), '前一版', '此版本');
      else if (a === 'rs' || a === 'rb') {
        const ref = a === 'rb' ? before : (after || before);
        if (!confirm(f.s === 'D' ? `找回文件「${f.title}」？` : `把「${f.title}」還原到${a === 'rb' ? '這次變更之前' : '這個版本（含這次變更）'}的內容？\n目前內容會被取代（仍可從版本歷史還原回來）。`)) return;
        const r = await api.docRestore(ref, id); if (!r) return toast('還原失敗');
        vDoc = null; toast(f.s === 'D' ? '已找回文件，請到「文件庫」查看' : '已還原文件');
      }
    } else if (f.k === 'tpl') {
      if (a === 'df') out.innerHTML = tplDiffView(await get(before), await get(after));
      else if (a === 'rs' || a === 'rb') {
        if (!confirm(`把範本、區塊庫與 Word 格式還原到${a === 'rb' ? '這次變更之前' : '這個版本（含這次變更）'}的狀態？\n目前未儲存的變更會遺失。`) || !okDiscard()) return;
        const d = await api.restore(a === 'rb' ? before : c.h); if (!d) return toast('還原失敗');
        DB = d; if (!DB.templates.some(x => x.id === cur)) cur = DB.templates[0].id; wsId = DB.defaultWordStyle; newSession(); ed = null; setDirty(false); drawSel(); drawWsel(); toast('已還原範本');
      }
    }
  };
}
async function showDeleted(id) {
  HSEL = { del: id }; drawHistList(); const x = HDEL.find(t => t.id === id), box = $('#hview'); if (!x) return;
  box.innerHTML = `<h2>${esc(x.title)}</h2><p class="mut">刪除於 ${esc(fmt(x.d))}（版本 ${x.h}）</p><div class="row"><button class="b" id="hrec">找回此文件</button></div><div id="hdiff"><p class="mut">載入預覽…</p></div>`;
  let d = null; try { d = JSON.parse(await api.historyBlob(x.ref, `documents/${id}.json`)); } catch {}
  if (HSEL && HSEL.del === id && $('#hdiff')) $('#hdiff').innerHTML = d ? `<div class="md">${await renderMd(d.md)}</div>` : '<p class="mut">無法讀取內容。</p>';
  $('#hrec').onclick = async () => {
    if (!confirm(`找回文件「${x.title}」？`)) return; const r = await api.docRestore(x.ref, id); if (!r) return toast('找回失敗');
    vDoc = null; toast('已找回，請到「文件庫」查看'); await loadHist(true);
  };
}

/* ---------- 設定（儲存路徑） ---------- */
let moveOld = true;
async function drawSet() {
  const S = await api.settingsGet();
  const card = (k, title, desc, cur, def, custom) => `<div class="card"><h2>${title}</h2><p class="mut">${desc}</p>
    <div class="pathbox"><input type="text" readonly value="${esc(cur)}" aria-label="${title}路徑"></div>
    <div class="pathbox"><button class="b" data-k="${k}" data-a="pick">選擇資料夾…</button><button class="b g" data-k="${k}" data-a="reset" ${custom ? '' : 'disabled'}>恢復預設</button><button class="b g" data-k="${k}" data-a="open">開啟資料夾</button></div>
    <p class="mut">${custom ? '目前使用自訂路徑。預設位置：' + esc(def) : '目前使用預設位置。'}</p></div>`;
  $('#setv').innerHTML = `<h2>儲存設定</h2><p class="mut">這些是這台電腦的設定，變更後立即生效，不需按右上角「儲存」，也不會寫入範本的版本紀錄。</p>
    ${S.warn ? `<p class="warn">${esc(S.warn)}</p>` : ''}
    <label class="chk"><input type="checkbox" id="smove" ${moveOld ? 'checked' : ''}>變更路徑時，同時把現有檔案搬到新資料夾（建議）</label>
    <p class="mut">搬移會先複製並驗證，全部成功後才刪除原檔；只搬本程式上傳的檔案，不會動到資料夾裡其他檔案。不搬移的話，舊附件會留在原資料夾（檔案庫看不到），舊圖片則仍可從預設資料夾讀取。</p>
    ${card('img', '圖片儲存路徑', '上傳到檔案庫的圖片（建議書中以圖片引用）存放的位置。', S.imgDir, S.imgDefault, S.imgCustom)}
    ${card('att', '附件儲存路徑', '上傳到檔案庫的附件（PDF、Office 檔等）存放的位置，保留原檔名。也可指定為公司共用資料夾。', S.attDir, S.attDefault, S.attCustom)}
    <div class="card"><h2>資料位置</h2><p class="mut">範本、區塊庫、文件庫與版本紀錄的存放位置（不可變更）。</p>
      <div class="pathbox"><input type="text" readonly value="${esc(S.dataDir)}" aria-label="資料位置"><button class="b g" data-k="data" data-a="open">開啟資料夾</button></div></div>`;
}
async function applyDir(k, path) {
  const label = k === 'img' ? '圖片' : '附件', mv = $('#smove').checked; moveOld = mv;
  if (!confirm(`${label}儲存路徑將改為：\n${path || '（預設位置）'}\n\n${mv ? '現有檔案會一併搬移到新資料夾。' : '現有檔案不會搬移。'}\n確定嗎？`)) return;
  const r = await api.settingsSet(k, path, mv);
  if (!r.ok) { alert('未變更：' + r.error); return; }
  toast(r.noop ? '路徑相同，未變更' : `已變更${label}路徑` + (r.moved ? `，搬移 ${r.moved} 個檔案` : ''));
  await drawSet();
}
$('#setv').onclick = async e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const k = b.dataset.k, a = b.dataset.a;
  if (a === 'open') { if (!(await api.openDir(k))) toast('無法開啟資料夾'); }
  else if (a === 'pick') { const p = await api.pickDir(); if (p) applyDir(k, p); }
  else if (a === 'reset') applyDir(k, '');
};

init();
