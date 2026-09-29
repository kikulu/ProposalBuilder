# 服務建議書製作器（Electron）

依 RFP 勾選章節與區塊，產生 Markdown / Word（.docx）服務建議書；可維護範本、共用區塊庫，並以 git 保存範本版本。

## 執行
```bash
npm install
npm start          # 啟動桌面程式
npm run dist       # 打包安裝檔（electron-builder）
```

## 功能
- 製作建議書：勾選章節/區塊、RFP 關鍵字標示、匯出 .docx / .md
- 維護範本：章節與區塊的新增、排序、刪除、編輯；範本複製、匯入、匯出
- 區塊庫：跨範本共用的區塊，可搜尋、編輯、插入任一章節
- 版本紀錄：每次「儲存」自動 git commit，可還原（需安裝 git）

範本資料存放於使用者資料夾的 `data/templates.json`（Windows：`%APPDATA%/proposal-builder/data`）。
