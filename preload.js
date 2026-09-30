const { contextBridge, ipcRenderer: ipc } = require('electron');
const call = n => (...a) => ipc.invoke(n, ...a);
contextBridge.exposeInMainWorld('api', {
  load: call('load'), save: call('save'), reset: call('reset'), log: call('log'), restore: call('restore'),
  exportFile: call('export'), exportJson: call('exportJson'), importJson: call('importJson'), clip: call('clip'),
  imgList: call('imgList'), imgAdd: call('imgAdd'), imgGet: call('imgGet'),
  settingsGet: call('settingsGet'), settingsSet: call('settingsSet'), pickDir: call('pickDir'), openDir: call('openDir'),
  fileList: call('fileList'), fileAdd: call('fileAdd'), fileOpen: call('fileOpen'), fileReveal: call('fileReveal'),
  fileSaveAs: call('fileSaveAs'), fileRename: call('fileRename'), fileDelete: call('fileDelete'), fileUsage: call('fileUsage'),
  historyInfo: call('historyInfo'), historyList: call('historyList'), historyShow: call('historyShow'), historyBlob: call('historyBlob'),
  docHistory: call('docHistory'), docRestore: call('docRestore'), docsDeleted: call('docsDeleted'),
  docDeleteMany: call('docDeleteMany'), docDuplicate: call('docDuplicate'), docMetaMany: call('docMetaMany'), docSearch: call('docSearch'),
  docExportMany: call('docExportMany'), docBackup: call('docBackup'), docImport: call('docImport'),
  fileAddFolder: call('fileAddFolder'), fileTags: call('fileTags'), fileUsageMany: call('fileUsageMany'), fileDeleteMany: call('fileDeleteMany'), fileExportMany: call('fileExportMany'),
  docList: call('docList'), docGet: call('docGet'), docSave: call('docSave'), docDelete: call('docDelete')
});
