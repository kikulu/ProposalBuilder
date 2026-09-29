const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');
const { mdToDocx } = require('./mdToDocx');

const defaults = () => JSON.parse(JSON.stringify(require('./defaults')));
let win, dir, file;

// ---- 資料與 git 版本控管（範本資料存於使用者資料夾 /data，自帶獨立 git repo）----
const git = (...a) => new Promise(r => execFile('git', a, { cwd: dir, maxBuffer: 20e6 }, (e, o) => r(e ? null : o)));
const read = () => { const d = JSON.parse(fs.readFileSync(file, 'utf8')); d.library = d.library || defaults().library; return d; };
const write = d => fs.writeFileSync(file, JSON.stringify(d, null, 2));
const hasGit = () => fs.existsSync(path.join(dir, '.git'));
async function commit(msg) {
  if (!hasGit()) return;
  await git('add', 'templates.json');
  await git('-c', 'user.name=ProposalBuilder', '-c', 'user.email=pb@local', 'commit', '-m', msg);
}
async function initData() {
  dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'templates.json');
  if (!fs.existsSync(file)) write(defaults());
  if (!hasGit() && (await git('--version'))) { await git('init'); await commit('初始化內建範本（軟體開發案、維護案）'); }
}
const stamp = () => new Date().toLocaleString('zh-TW', { hour12: false });

ipcMain.handle('load', () => read());
ipcMain.handle('save', async (e, d) => { write(d); await commit('更新範本 ' + stamp()); return true; });
ipcMain.handle('reset', async () => { const d = defaults(); write(d); await commit('還原為內建預設範本'); return d; });
ipcMain.handle('log', async () => {
  const o = await git('log', '-n', '40', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%h\t%ad\t%s');
  return o === null ? null : o.split('\n').filter(Boolean).map(l => { const [h, d, ...s] = l.split('\t'); return { h, d, s: s.join('\t') }; });
});
ipcMain.handle('restore', async (e, hash) => {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) return null;
  const o = await git('show', `${hash}:templates.json`);
  if (!o) return null;
  fs.writeFileSync(file, o);
  await commit('還原至版本 ' + hash);
  return read();
});

// ---- 匯出 / 匯入 ----
const safe = n => (n || '服務建議書').replace(/[\\/:*?"<>|]/g, '_');
async function saveAs(name, ext) {
  const r = await dialog.showSaveDialog(win, { defaultPath: `${safe(name)}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  return r.canceled ? null : r.filePath;
}
ipcMain.handle('export', async (e, kind, name, md) => {
  const p = await saveAs(name, kind); if (!p) return null;
  fs.writeFileSync(p, kind === 'docx' ? await mdToDocx(md) : md);
  shell.showItemInFolder(p); return p;
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
    width: 1320, height: 880, autoHideMenuBar: true, title: '服務建議書製作器',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(async () => { await initData(); createWindow(); });
app.on('window-all-closed', () => app.quit());
