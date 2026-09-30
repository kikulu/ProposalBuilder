// 預覽用的簡易 Markdown → HTML（語法與 mdToDocx.js 一致：標題、表格、清單、引言、圖片、分隔線、粗體、行內程式碼）
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inl = s => escH(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const IMG = /^!\[([^\]]*)\]\(image:([\w-]+\.\w+)\)\s*$/;
const imgCache = {};

async function renderMd(md, opts = {}) {
  const L = String(md).replace(/\r/g, '').split('\n');
  for (const l of L) {                                   // 先取得用到的圖片（IPC 為非同步）
    const m = l.match(IMG);
    if (m && !(m[2] in imgCache)) imgCache[m[2]] = window.api && window.api.imgGet ? await window.api.imgGet(m[2]) : null;
  }
  const out = []; let i = 0, m;
  while (i < L.length) {
    const s = L[i];
    if (!s.trim()) { i++; continue; }
    if ((m = s.match(/^(#{1,4})\s+(.*)/))) { const n = m[1].length; out.push(`<h${n}>${inl(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*\|/.test(s)) {
      const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const rs = rows.filter(r => !(/^\s*\|[\s:|-]+\|\s*$/.test(r) && r.includes('-'))).map(cells);
      out.push('<table>' + rs.map((r, ri) => '<tr>' + r.map(c => ri ? `<td>${inl(c)}</td>` : `<th>${inl(c)}</th>`).join('') + '</tr>').join('') + '</table>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(s)) { const it = []; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*[-*]\s+/, '')); out.push('<ul>' + it.map(x => `<li>${inl(x)}</li>`).join('') + '</ul>'); continue; }
    if (/^\d+\.\s+/.test(s)) { const it = []; while (i < L.length && /^\d+\.\s+/.test(L[i])) it.push(L[i++].replace(/^\d+\.\s+/, '')); out.push('<ol>' + it.map(x => `<li>${inl(x)}</li>`).join('') + '</ol>'); continue; }
    if (/^>/.test(s)) { const q = []; while (i < L.length && /^>/.test(L[i])) q.push(inl(L[i++].replace(/^>\s?/, ''))); out.push(`<blockquote>${q.join('<br>')}</blockquote>`); continue; }
    if ((m = s.match(IMG))) {
      const u = imgCache[m[2]];
      out.push(u ? `<figure><img src="${u}" alt="${escH(m[1])}">${m[1] ? `<figcaption>${escH(m[1])}</figcaption>` : ''}</figure>` : `<p class="miss">[找不到圖片：${escH(m[2])}]</p>`);
      i++; continue;
    }
    if (/^-{3,}$/.test(s.trim())) { out.push('<hr>'); i++; continue; }
    out.push(`<p>${inl(s)}</p>`); i++;
  }
  return out.join('\n');
}
