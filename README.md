# 資料庫同步工具 (Database Sync Tool)

一個用於資料庫同步的 Node.js 工具，支援完整的資料庫結構和資料複製。
> 敬請注意： 此功能會永久刪除資料。為避免資料遺失，強烈建議您在操作前詳閱說明文件。使用者需自行承擔因使用此功能所造成的一切風險。

## 功能特色

- 完整的資料庫同步：包含 Schema、資料表、檢視表、函數、預存程序
- 相依性排序：自動分析物件間的相依關係，確保正確的建立順序
- 約束和索引支援：完整複製 Primary Key、Foreign Key 和索引
- 資料複製：支援所有資料類型，包含 IDENTITY 欄位
- 多種執行模式：實際執行或產生 SQL 腳本
- 清理模式：可選擇是否清理目標資料庫現有物件
- 詳細日誌：提供完整的執行狀態和錯誤資訊
- Debug 模式：協助問題診斷和除錯

## 安裝

```bash
git clone https://github.com/leoshiang/db-sync.git
cd db-sync
npm install
```

## 設定

建立 檔案並設定資料庫連線資訊： `.env`

``` env
# 來源資料庫
SRC_DB_TYPE=sqlserver
SRC_SERVER=localhost
SRC_DB=source_database
SRC_USER=your_username
SRC_PWD=your_password
SRC_PORT=1433

# 目標資料庫
DST_DB_TYPE=sqlserver
DST_SERVER=localhost
DST_DB=target_database
DST_USER=your_username
DST_PWD=your_password
DST_PORT=1433
```

## 使用方法

### 基本命令

``` bash
# 標準同步（不清理現有物件）
npm run sync

# 清理模式同步（先刪除現有物件）
npm run sync:clean

# 產生 SQL 腳本（預覽模式）
npm run preview

# 產生 SQL 腳本（包含清理步驟）
npm run preview:clean

# 除錯模式
npm run debug
```

### 進階參數

``` bash
# 使用原始 node 命令
node index.js [options]

# 參數說明：
# --dry-run    產生 SQL 腳本而不實際執行
# --clean      在建立新物件前先清理現有物件
# --debug      啟用詳細的除錯輸出
```

### 使用範例

``` bash
# 標準同步
node index.js

# 完全重建目標資料庫
node index.js --clean

# 產生清理+建立的完整 SQL 腳本
node index.js --dry-run --clean

# 除錯模式執行清理同步
node index.js --debug --clean
```

## 同步流程

### 標準模式流程

1. 建立 Schema - 建立自訂 schema
2. 建立物件 - 按相依性順序建立資料表、檢視表、函數、預存程序
3. 複製資料 - 複製所有資料表資料（支援 IDENTITY 欄位）
4. 建立約束 - 建立 Primary Key 和 Foreign Key 約束
5. 建立索引 - 建立所有索引和唯一約束

### 清理模式流程

1. 建立 Schema - 建立自訂 schema
2. 清理現有物件 - 依序刪除 Foreign Key、索引、物件
3. 建立物件 - 按相依性順序建立新物件
4. 複製資料 - 複製所有資料
5. 建立約束 - 建立約束
6. 建立索引 - 建立索引

## 輸出檔案

在 模式下，工具會產生以下檔案： `--dry-run`

- 包含 Schema 和物件建立的 SQL 腳本 `schema.sql`
- 包含資料複製的 SQL 腳本 `data.sql`

## 支援的資料庫物件

| 物件類型              | 支援狀態 | 說明                            |
|-------------------|:----:|-------------------------------|
| 資料表 (Tables)      |  ✅   | 包含所有欄位、資料類型、IDENTITY 設定       |
| 檢視表 (Views)       |  ✅   | 完整的檢視表定義                      |
| 函數 (Functions)    |  ✅   | Scalar、Table-valued、Inline 函數 |
| 預存程序 (Procedures) |  ✅   | 完整的預存程序定義                     |
| Primary Key       |  ✅   | 叢集和非叢集主鍵                      |
| Foreign Key       |  ✅   | 包含參照關係                        |
| 索引 (Indexes)      |  ✅   | 叢集、非叢集、唯一索引                   |
| 自訂 Schema         |  ✅   | 非系統 schema                    |

## 錯誤處理

工具有完善的錯誤處理機制：

- 連線錯誤：自動檢查資料庫連線狀態
- 相依性錯誤：處理物件間的相依關係
- 資料類型錯誤：支援所有 SQL Server 資料類型
- 約束衝突：自動處理約束建立順序

## 日誌和除錯

### 標準輸出

``` 
資料庫同步工具
================
環境變數驗證通過
來源資料庫: localhost/source_db
目標資料庫: localhost/target_db

步驟 1: 建立 Schema
發現 2 個自訂 schema：hr, sales
  建立 Schema: hr ✓
  建立 Schema: sales ✓

步驟 2: 建立資料庫物件
發現 15 個資料庫物件
  建立資料表: dbo.Users ✓
  建立檢視表: hr.EmployeeView ✓
  ...

資料庫同步完成!
```

### Debug 模式輸出

啟用 參數時，會顯示詳細的 SQL 語句和執行資訊。 `--debug`

## 效能考量

- 批次處理：資料複製使用批次插入（預設 1000 筆/批次）
- 連線池：使用連線池管理資料庫連線
- 記憶體管理：大型資料表分批處理，避免記憶體溢出
- 相依性最佳化：最佳化物件建立順序，減少執行時間

## 限制

- 目前僅支援 SQL Server
- 不支援 CLR 物件
- 不支援全文索引
- 不支援分割區

## 授權

MIT License

## 常見問題 (FAQ)

### Q: 如何處理大型資料庫？

A: 工具使用批次處理和連線池，可以處理大型資料庫。建議先使用 模式檢視 SQL 腳本。 `--dry-run`

### Q: 是否支援其他資料庫？

A: 目前僅支援 SQL Server，但架構設計支援擴展到其他資料庫。

### Q: 如何確保資料一致性？

A: 工具會按照正確的相依性順序建立物件，並在最後階段建立約束，確保資料一致性。

### Q: 執行失敗如何處理？

A: 工具提供詳細的錯誤資訊，建議使用 模式查看詳細日誌，或使用 模式重新執行。 `--debug``--clean`

### Q: 可以只同步特定物件嗎？

A: 目前版本同步整個資料庫，未來版本將支援選擇性同步。
