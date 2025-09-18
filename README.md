# 資料庫同步工具 (Database Sync Tool)

一個用於資料庫同步的 Node.js 工具，支援完整的資料庫結構和資料複製。
> 敬請注意：此功能會永久刪除資料。為避免資料遺失，強烈建議您在操作前詳閱說明文件。使用者需自行承擔因使用此功能所造成的一切風險。

## 重要更新

- 移除 .env 與 dotenv，相依配置全面改為命令列參數。
- 清楚區分來源與目標參數：使用 `--src-*` 與 `--dst-*`。
- 新增比較模式 `--compare-only`：僅產生「目標不存在或定義不同」的物件 SQL（不包含資料）。
- 服務層不再自行讀取組態，改由主程式注入來源/目標連線。

## 功能特色

- 完整的資料庫同步：包含 Schema、資料表、檢視表、函數、預存程序
- 相依性排序：自動分析物件間的相依關係，確保正確的建立順序
- 約束和索引支援：完整複製 Primary Key、Foreign Key 和索引
- 資料複製：支援所有資料類型，包含 IDENTITY 欄位
- 多種執行模式：實際執行或產生 SQL 腳本
- 清理模式（腳本預覽）：可選擇是否清理目標資料庫現有物件（於 dry-run 產生清理腳本）
- 比較模式：僅產生差異物件的 SQL，省略資料與清理步驟
- 詳細日誌與 Debug 模式

## 安裝
```bash
git clone https://github.com/leoshiang/dbsync
cd dbsync npm install
``` 

## 參數與使用

所有連線資訊均以命令列參數提供，不再讀取 .env。

共用旗標
- `--dry-run`：產生 SQL 檔案（schema.sql, data.sql），不連線目標
- `--debug`：輸出詳細除錯訊息
- `--compare-only`：比較模式，僅針對「目標不存在」或「定義不同」的物件產生 SQL（略過清理與資料）

來源參數（必填）
- `--src-type`：來源資料庫類型（預設 `sqlserver`）
- `--src-server`：來源伺服器
- `--src-port`：來源連接埠（選填）
- `--src-db`：來源資料庫名稱
- `--src-user`：來源使用者
- `--src-pwd`：來源密碼

目標參數
- 非 `--dry-run` 時：必填
- 在 `--compare-only` 下：即使是 `--dry-run` 也必填（需要比對目標）
- `--dst-type`：目標資料庫類型（預設 `sqlserver`）
- `--dst-server`：目標伺服器
- `--dst-port`：目標連接埠（選填）
- `--dst-db`：目標資料庫名稱
- `--dst-user`：目標使用者
- `--dst-pwd`：目標密碼

### 使用範例

Dry-run（只讀來源、產生完整腳本）
```
bash node index.js
--dry-run
--src-server 127.0.0.1
--src-db SourceDb
--src-user sa
--src-pwd your_password
``` 

實際同步（來源 => 目標）
```
bash node index.js
--src-server 127.0.0.1
--src-db SourceDb
--src-user sa
--src-pwd your_password
--dst-server 10.0.0.2
--dst-db TargetDb
--dst-user sa
--dst-pwd your_password
``` 

比較模式（僅產生差異物件 SQL，不含資料與清理）
- 乾跑（需要提供目標連線以便比對）
```
bash node index.js
--dry-run
--compare-only
--src-server 127.0.0.1
--src-db SourceDb
--src-user sa
--src-pwd your_password
--dst-server 10.0.0.2
--dst-db TargetDb
--dst-user sa
--dst-pwd your_password
``` 

- 實際執行（只對差異物件下 CREATE；不清理、不搬資料）
```
bash node index.js
--compare-only
--src-server 127.0.0.1
--src-db SourceDb
--src-user sa
--src-pwd your_password
--dst-server 10.0.0.2
--dst-db TargetDb
--dst-user sa
--dst-pwd your_password
``` 

## 同步流程

1. 建立 Schema - 建立自訂 schema
2. 建立物件 - 按相依性順序建立資料表、檢視表、函數、預存程序
3. 複製資料 - 複製所有資料表資料（支援 IDENTITY 欄位）
4. 建立約束 - 建立 Primary Key 和 Foreign Key 約束
5. 建立索引 - 建立所有索引與唯一約束

在 `--dry-run` 模式下，將會輸出：
- `schema.sql`：Schema 與物件建立腳本（比較模式下僅輸出差異）
- `data.sql`：資料插入腳本（比較模式下不產生）

## 注意事項

- 實際執行模式將對目標資料庫進行變更，請務必先做好備份。
- 大量資料會使用批次插入（預設 1000 筆/批），以平衡效能與穩定性。
- 目前支援 SQL Server；架構可延伸至其他資料庫。

## 清理不必要的相依性

- 請從 `package.json` 的 dependencies 中移除 `dotenv`（本工具已不再使用）。
- 可移除舊的設定檔與相依，保持專案精簡。

## 授權

MIT License
