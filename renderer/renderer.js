const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mv = (a, i, d) => { const j = i + d; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; };
const kw = s => s.split(/[,，、]/).map(x => x.trim()).filter(Boolean);
let DB, cur, ed = null, sel = new Set(), libId = null, tab = 'make';
const M = { 案名: '', 機關: '', 公司: '', 日期: new Date().toISOString().slice(0, 10) };
const T = () => DB.templates.find(t => t.id === cur);
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); };
const dirty = () => { $('#save').textContent = '儲存 ●'; };
const hit = b => { const r = $('#rfp').value; return r && (b.keywords || []).some(k => k && r.includes(k)); };
const fresh = t => { t.id = uid(); t.chapters.forEach(c => { c.id = uid(); c.blocks.forEach(b => b.id = uid()); }); return t; };

async function init() {
  DB = await api.load(); cur = DB.templates[0].id;
  document.querySelectorAll('[data-m]').forEach(i => { i.value = M[i.dataset.m]; i.oninput = () => { M[i.dataset.m] = i.value; gen(); }; });
  drawSel(); refresh();
}
function drawSel() { $('#tsel').innerHTML = DB.templates.map(t => `<option value="${t.id}"${t.id === cur ? ' selected' : ''}>${esc(t.name)}</option>`).join(''); }
function refresh() { drawList(); gen(); if (tab === 'edit') { drawTree(); drawEd(); } if (tab === 'lib') drawLib(); }
$('#tsel').onchange = e => { cur = e.target.value; sel.clear(); ed = null; refresh(); };
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  tab = b.dataset.t;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  ['make', 'edit', 'lib'].forEach(id => $('#' + id).hidden = id !== tab);
  refresh();
});
$('#save').onclick = async () => { await api.save(DB); $('#save').textContent = '儲存'; toast('已儲存，並建立一個版本'); if (tab === 'edit' && !ed) drawEd(); };

/* ---------- 製作建議書 ---------- */
function drawList() {
  const t = T(); if (!t) return;
  $('#list').innerHTML = t.chapters.map((c, ci) => {
    const n = c.blocks.filter(b => sel.has(b.id)).length;
    return `<div class="ch"><label><input type="checkbox" data-c="${ci}" ${n && n === c.blocks.length ? 'checked' : ''} ${n && n < c.blocks.length ? 'data-part="1"' : ''}>${esc(c.title)}</label>` +
      c.blocks.map(b => `<label class="bk"><input type="checkbox" data-b="${b.id}" ${sel.has(b.id) ? 'checked' : ''}>${esc(b.title)}${hit(b) ? '<span class="tag">RFP</span>' : ''}</label>`).join('') + '</div>';
  }).join('');
  $('#list').querySelectorAll('[data-part]').forEach(i => i.indeterminate = true);
}
$('#list').onchange = e => {
  const i = e.target;
  if (i.dataset.b) i.checked ? sel.add(i.dataset.b) : sel.delete(i.dataset.b);
  if (i.dataset.c) T().chapters[i.dataset.c].blocks.forEach(b => i.checked ? sel.add(b.id) : sel.delete(b.id));
  drawList(); gen();
};
$('#rfp').oninput = drawList;
$('#hitsel').onclick = () => { T().chapters.forEach(c => c.blocks.forEach(b => hit(b) && sel.add(b.id))); drawList(); gen(); };
$('#all').onclick = () => { T().chapters.forEach(c => c.blocks.forEach(b => sel.add(b.id))); drawList(); gen(); };
$('#none').onclick = () => { sel.clear(); drawList(); gen(); };
function gen() {
  const t = T(); if (!t) return;
  let md = `# ${M.案名 || '服務建議書'}\n\n> 招標機關：${M.機關 || '（未填）'}　提案單位：${M.公司 || '（未填）'}　日期：${M.日期}\n\n`, n = 0;
  t.chapters.forEach(c => {
    const bs = c.blocks.filter(b => sel.has(b.id)); if (!bs.length) return;
    n++; md += `## ${n}. ${c.title}\n\n`;
    bs.forEach((b, i) => md += `### ${n}.${i + 1} ${b.title}\n\n${b.content.trim()}\n\n`);
  });
  $('#out').value = md.replace(/\{\{(.+?)\}\}/g, (m, k) => M[k.trim()] || m);
}
$('#copy').onclick = async () => { await api.clip($('#out').value); toast('已複製'); };
$('#exmd').onclick = async () => { const p = await api.exportFile('md', M.案名, $('#out').value); if (p) toast('已匯出：' + p); };
$('#exdocx').onclick = async () => {
  try { const p = await api.exportFile('docx', M.案名, $('#out').value); if (p) toast('已匯出：' + p); }
  catch (e) { toast('匯出失敗：' + e.message); }
};

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
      <h2>版本紀錄</h2><p class="mut">每次按「儲存」都會以 git 建立一個版本，可隨時還原。</p><div id="hist">載入中…</div>`;
    $('#tname').oninput = e => { t.name = e.target.value; drawSel(); dirty(); };
    $('#texp').onclick = async () => { const p = await api.exportJson(t.name, { templates: [t] }); if (p) toast('已匯出：' + p); };
    $('#texpall').onclick = async () => { const p = await api.exportJson('全部範本', DB); if (p) toast('已匯出：' + p); };
    $('#timp').onclick = async () => {
      const d = await api.importJson(); if (!d) return;
      const ts = d.templates || (d.chapters ? [d] : null);
      if (!ts) return toast('檔案格式不正確');
      ts.forEach(x => DB.templates.push(fresh(x)));
      (d.library || []).forEach(b => DB.library.push({ ...b, id: uid() }));
      cur = DB.templates[DB.templates.length - 1].id; sel.clear(); dirty(); drawSel(); refresh(); toast(`已匯入 ${ts.length} 個範本，記得按「儲存」`);
    };
    const l = await api.log(), h = $('#hist'); if (!h) return;
    h.innerHTML = l === null ? '<p class="mut">未偵測到 git，無法使用版本紀錄。</p>' : !l.length ? '<p class="mut">尚無版本。</p>'
      : l.map(x => `<div class="hv"><span>${esc(x.d)}　${esc(x.s)}</span><button class="b g" data-h="${x.h}">還原</button></div>`).join('');
    h.onclick = async e => {
      const hh = e.target.dataset.h; if (!hh || !confirm('還原到此版本？目前未儲存的變更會遺失。')) return;
      const d = await api.restore(hh); if (!d) return toast('還原失敗');
      DB = d; if (!DB.templates.some(x => x.id === cur)) cur = DB.templates[0].id;
      sel.clear(); ed = null; $('#save').textContent = '儲存'; drawSel(); refresh(); toast('已還原');
    };
    return;
  }
  const c = t.chapters[ed.c];
  if (ed.b == null) {
    box.innerHTML = `<h2>章節</h2><label>章節標題<input type="text" id="f1" value="${esc(c.title)}"></label>
      <h2>從區塊庫插入</h2><div class="row"><select id="f2" style="flex:1;width:auto">${DB.library.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select><button class="b g" id="f3">插入到此章節</button></div>`;
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
  $('#f4').onclick = () => { DB.library.push({ id: uid(), title: b.title, content: b.content, keywords: [...(b.keywords || [])] }); dirty(); toast('已存入區塊庫'); };
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
$('#tnew').onclick = () => { const t = { id: uid(), name: '新範本', chapters: [] }; DB.templates.push(t); cur = t.id; ed = null; sel.clear(); dirty(); drawSel(); refresh(); };
$('#tcopy').onclick = () => {
  const t = fresh(JSON.parse(JSON.stringify(T()))); t.name += '（副本）';
  DB.templates.push(t); cur = t.id; ed = null; sel.clear(); dirty(); drawSel(); refresh();
};
$('#tdel').onclick = () => {
  if (DB.templates.length < 2) return toast('至少保留一個範本');
  if (!confirm(`刪除範本「${T().name}」？`)) return;
  DB.templates = DB.templates.filter(t => t.id !== cur); cur = DB.templates[0].id; ed = null; sel.clear(); dirty(); drawSel(); refresh();
};
$('#reset').onclick = async () => {
  if (!confirm('將所有範本與區塊庫還原為內建預設？自訂內容會被覆蓋（仍可從版本紀錄還原）。')) return;
  DB = await api.reset(); cur = DB.templates[0].id; ed = null; sel.clear(); $('#save').textContent = '儲存'; drawSel(); refresh(); toast('已還原預設');
};

/* ---------- 區塊庫 ---------- */
function drawLib() { drawLibList(); drawLibEd(); }
function drawLibList() {
  const q = $('#q').value.trim().toLowerCase();
  const items = DB.library.filter(b => !q || (b.title + b.content + (b.keywords || []).join()).toLowerCase().includes(q));
  $('#liblist').innerHTML = items.map(b => `<div class="tr${b.id === libId ? ' on' : ''}" data-id="${b.id}"><span>${esc(b.title)}</span></div>`).join('') || '<p class="mut">沒有符合的區塊。</p>';
}
function drawLibEd() {
  const box = $('#libed'), b = DB.library.find(x => x.id === libId);
  if (!b) { box.innerHTML = '<p class="mut">選擇左側區塊進行編輯，或按「新增」建立共用區塊。</p>'; return; }
  box.innerHTML = `<h2>共用區塊</h2><label>標題<input type="text" id="l1" value="${esc(b.title)}"></label>
    <label>RFP 關鍵字（以逗號分隔）<input type="text" id="l2" value="${esc((b.keywords || []).join(','))}"></label>
    <label>內文（Markdown）<textarea id="l3" rows="14">${esc(b.content)}</textarea></label>
    <div class="row"><select id="l4" style="width:auto">${T().chapters.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join('')}</select>
    <button class="b g" id="l5">插入到「${esc(T().name)}」此章節</button><button class="b d" id="l6">刪除區塊</button></div>`;
  $('#l1').oninput = e => { b.title = e.target.value; drawLibList(); dirty(); };
  $('#l2').oninput = e => { b.keywords = kw(e.target.value); dirty(); };
  $('#l3').oninput = e => { b.content = e.target.value; dirty(); };
  $('#l5').onclick = () => {
    const c = T().chapters[+$('#l4').value]; if (!c) return toast('此範本尚無章節');
    c.blocks.push({ id: uid(), title: b.title, content: b.content, keywords: [...(b.keywords || [])] }); dirty(); toast(`已插入「${c.title}」`); drawList();
  };
  $('#l6').onclick = () => { if (!confirm('刪除此共用區塊？（已插入範本的內容不受影響）')) return; DB.library = DB.library.filter(x => x !== b); libId = null; dirty(); drawLib(); };
}
$('#liblist').onclick = e => { const r = e.target.closest('[data-id]'); if (r) { libId = r.dataset.id; drawLib(); } };
$('#q').oninput = drawLibList;
$('#ladd').onclick = () => { const b = { id: uid(), title: '新共用區塊', content: '', keywords: [] }; DB.library.push(b); libId = b.id; dirty(); drawLib(); };

init();
