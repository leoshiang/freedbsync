# FreeDbSync 重構與優化建議（2025-09-19）

本文檢視目前程式碼結構與實作，整理可重構或優化的重點，並提供可逐步採行的建議與風險/效益評估。目標是在「最小風險、最大回饋」的前提下提升可維護性、效能與穩定性。

---

## 摘要（TL;DR）
- 立即可做（低風險/高報酬）：
  - 移除全域變數 `global.DEBUG_MODE`，統一以相依注入或建構參數傳遞 debug 設定。
  - 統一錯誤處理與回報格式（CLI 退出碼、錯誤分類、使用者提示）。
  - 抽離 CLI 主程式（index.js）為可測試模組：`cli/parseArgs.js`、`cli/commands.js`。
  - 將重複 SQL 片段與字串處理集中於 `SqlBuilder` 與 `SqlEscape` 公用模組。
  - 在 SQL Server 連線層導入連線池與重試機制的明確包裝（含逾時、取消 token）。
  - 為大量資料讀取與寫入導入分頁/串流（可維持既有參數如 batchSize）。

- 中期規劃：
  - 導入設定來源（環境變數/.env/檔案），整合參數驗證 schema（zod/joi）。
  - 建立端對端 dry-run vs. exec 用例測試與 snapshot 測試（比對產生 SQL）。

- 長期規劃：
  - 介面抽象（Adapter）與業務服務（Service）分層更明確，支援多資料庫型別擴充。
  - 導入觀測性（結構化日誌、執行時間量測、關鍵指標）。

---

## 目錄
- 一、現況觀察
- 二、主要問題點與建議
- 三、檔案/模組層級建議
- 四、效能與穩定性
- 五、測試策略
- 六、漸進式落地計劃

---

## 一、現況觀察
- index.js（CLI 入口）同時負責：
  - 參數解析、說明/版本輸出
  - 設定組裝
  - 排程/流程協調（Schema/Object/Data/Constraint/Index/Cleanup）
  - I/O（寫出 SQL 檔案）
- Adapters：
  - `DatabaseAdapter` 為抽象介面，職責切分良好
  - `SqlServerAdapter` 體積較大（>800 行），涵蓋查詢、SQL 產生與執行細節，存在可抽離的共通行為（SQL 組字串、識別字/值的 escaping、批次插入組裝、重試機制）

---

## 二、主要問題點與建議

1) 全域狀態（global.DEBUG_MODE）
- 問題：
  - 增加隱性耦合與測試困難度。
- 建議：
  - 透過建構子/工廠將 `debug` 傳入 Service/Adapter；或提供 `Logger` 物件注入。

2) CLI 責任過多
- 問題：
  - `index.js` 包含流程控制與 I/O，難以單元測試。
- 建議：
  - 建立 `cli/parseArgs.js`（封裝 minimist/yargs 與預設值）
  - 建立 `cli/commands.js`（將主要流程 export 為可呼叫函式，CLI 僅呼叫）
  - 保持現行使用方式不變，但內部結構可測試。

3) SQL 組裝與 escaping 分散
- 問題：
  - `SqlServerAdapter` 內部重複處理 identifier/value escaping、drop/create 片段、批次 insert 組裝等。
- 建議：
  - 新增 `Utils/SqlEscape.js` 與 `Utils/SqlBuilder.js`：
    - `escapeIdentifier`、`escapeValue`、字串連接、括號處理
    - 批次 insert builder：支援 identityInsert on/off、batchSize、transaction 包裝

4) 錯誤處理與重試機制
- 問題：
  - 對資料庫暫時性錯誤的重試（例如 deadlock, connection reset）策略不明確。
- 建議：
  - 在 Adapter 層提供 `withPool`/`executeQuery` 的重試包裝（指數退避），可透過設定啟用/調整。
  - 一律提供逾時(TimeOut)與取消(AbortController)支援。

5) 大量資料處理
- 問題：
  - 單次抓取/寫入大量資料可能造成記憶體壓力。
- 建議：
  - 導入分頁/串流讀取（例如使用游標/READ_ONLY FORWARD_ONLY），保持既有介面不變但內部以 generator 或 callback 產出批次。

6) 設定與驗證
- 問題：
  - 參數驗證分散在 CLI 流程。
- 建議：
  - 導入 schema 驗證（zod/joi/yup），在 buildConfig 時即回報清楚錯誤與建議。
  - 支援 .env 與環境變數覆寫（利於 CI/CD 與安全）。

7) 日誌與觀測性
- 問題：
  - log 主要為 console，格式不一且不易過濾。
- 建議：
  - 封裝 Logger（支援等級、JSON/文字雙模式），包含：開始/完成、耗時、逐步階段、SQL 片段摘要。

---

## 三、檔案/模組層級建議

- index.js
  - 拆分：
    - `cli/parseArgs.js`：參數解析、預設值、--help/--version 輸出。
    - `cli/commands.js`：核心指令執行（dry-run、比較模式、實際執行）。
  - 輸出檔案 I/O 抽成 `Utils/FileWriter.js`，集中處理路徑、覆寫策略、檔名慣例。

- Adapters/DatabaseAdapter.js
  - 保持抽象介面單純，補齊 JSDoc 註解與回傳型別說明。

- Adapters/SqlServerAdapter.js
  - 抽出：
    - `Utils/SqlEscape.js`：identifier/value escaping。
    - `Utils/SqlBuilder.js`：DDL/DML 片段、批次 insert。
  - 連線與重試：
    - `Services/DbExecutor.js`：封裝 `withPool`、重試、逾時與取消。

- Services/*
  - 確認各服務只處理單一職責（Schema/Object/Data/Constraint/Index/Cleanup）。
  - 將日誌與 debug 維度改為注入式。

---

## 四、效能與穩定性
- 連線池：
  - 明確設定 `max`、`idleTimeout`、`connectionTimeout`。
- 重試策略：
  - 針對暫時性錯誤碼（如 deadlock 1205、連線中斷）採用退避重試。
- 資料搬移：
  - 分頁/串流避免一次性載入全部資料；批次寫入保留 `batchSize`。
- SQL 產生：
  - 減少動態字串拼接時的重複與錯誤風險，使用集中 builder 與單元測試覆蓋。

---

## 五、測試策略
- 單元測試：
  - `SqlEscape` 與 `SqlBuilder` 邏輯。
  - `parseArgs` 與設定驗證。
- 快照測試：
  - dry-run 產生的 `schema.sql`/`data.sql` 與比對模式輸出。
- 端對端（可選）：
  - 使用 dockerized SQL Server，跑小型 schema、物件、資料案例。

---

## 六、漸進式落地計劃（建議執行順序）
1. 先導入 Logger 與移除 `global.DEBUG_MODE`，改為注入式傳遞。低風險，高可讀性回饋。
2. 抽出 `SqlEscape` 與 `SqlBuilder`，將 `SqlServerAdapter` 內重複片段移轉。以不改對外介面為原則。
3. 拆分 CLI：`parseArgs` 與 `commands`，並保留原執行行為。
4. 在 Adapter/Executor 導入逾時與重試，並加入最小覆蓋的單元測試。
5. 規劃分頁/串流資料路徑，於資料量大的路徑逐步切換，觀察效能。
6. 導入設定驗證 schema 與 .env 支援。

---

## 附錄：可參考的介面雛形

```js
// Utils/Logger.js
class Logger {
  constructor(level = 'info', json = false) { this.level = level; this.json = json; }
  info(msg, meta) { this._log('info', msg, meta); }
  debug(msg, meta) { this._log('debug', msg, meta); }
  warn(msg, meta) { this._log('warn', msg, meta); }
  error(msg, meta) { this._log('error', msg, meta); }
  _log(level, msg, meta) { /* ... */ }
}
module.exports = Logger;
```

```js
// Utils/SqlEscape.js
module.exports = {
  escapeIdentifier(id) { /* 方括號處理/雙右括號轉義 */ },
  escapeValue(v) { /* 單引號轉義、NULL 處理 */ }
};
```

```js
// Utils/SqlBuilder.js
module.exports = {
  createTable({ schema, table, columns }) { /* ... */ },
  dropIndex({ schema, table, name }) { /* ... */ },
  batchInsert({ schema, table, rows, hasIdentity, batchSize }) { /* ... */ }
};
```

---

如需我將以上步驟中的「第一步」直接套用（移除 global debug 與加入 Logger 骨架），請告知，我可以在不影響現有行為的前提下，以最小改動直接提交修改。
