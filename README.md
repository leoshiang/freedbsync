# 資料庫同步工具 (Database Sync Tool)

一個用於資料庫同步的 Node.js 工具，支援完整的資料庫結構和資料複製，並提供智慧差異比較功能。
> 敬請注意：此功能會永久刪除資料。為避免資料遺失，強烈建議您在操作前詳閱說明文件。使用者需自行承擔因使用此功能所造成的一切風險。

## 重要更新 (v2.0)

- **全新智慧比較模式**：支援完整的資料庫結構差異分析與增量同步
- **精確欄位比較**：自動檢測資料表欄位的新增、修改、刪除
- **約束與索引智慧比較**：完整比較主鍵、外鍵、索引的差異
- **物件定義比較**：智慧比較檢視表、函數、預存程序的定義差異
- **安全的相依性處理**：自動分析並處理物件間的相依關係
- 移除 .env 與 dotenv，相依配置全面改為命令列參數
- 清楚區分來源與目標參數：使用 `--src-*` 與 `--dst-*`
- 服務層不再自行讀取組態，改由主程式注入來源/目標連線

## 功能特色

### 核心功能
- **完整的資料庫同步**：包含 Schema、資料表、檢視表、函數、預存程序
- **相依性排序**：自動分析物件間的相依關係，確保正確的建立順序
- **約束和索引支援**：完整複製主鍵、外鍵和索引
- **資料複製**：支援所有資料型別，包含 IDENTITY 欄位
- **多種執行模式**：實際執行或產生 SQL 腳本
- **詳細日誌與偵錯模式**：完整的執行日誌和錯誤處理

### 智慧比較模式功能

#### **資料表結構完整比較**
- **欄位差異檢測**：
    - 自動檢測新增、修改、刪除的欄位
    - 比較資料型別、長度、精確度、NULL 約束
    - 處理 IDENTITY 屬性和預設約束差異
- **安全的欄位修改**：
    - 自動處理相依約束 (外鍵、索引、檢查約束)
    - 智慧處理預設約束的變更
    - 提供 IDENTITY 欄位修改警告

#### **約束與索引智慧比較**
- **主鍵比較**：
    - 檢測缺失、多餘、定義不同的主鍵
    - 自動重新建立有差異的主鍵約束
- **外鍵比較**：
    - 完整比較外鍵定義和參照關係
    - 安全處理外鍵的刪除與重建
- **索引比較**：
    - 比較所有非主鍵索引的定義
    - 處理唯一索引和複合索引差異

#### **資料庫物件智慧比較**
- **檢視表比較**：
    - 比較檢視表定義的差異
    - 自動處理檢視表的刪除與重建
- **函數比較**：
    - 支援純量函數、資料表函數、內嵌函數
    - 智慧比較函數定義和參數
- **預存程序比較**：
    - 完整比較程序定義和邏輯
    - 處理程序的版本差異

#### **安全的差異處理**
- **三階段處理邏輯**：
    1. 刪除目標端多餘的項目
    2. 新增來源端有但目標端沒有的項目
    3. 修改定義不同的項目
- **相依性安全處理**：
    - 自動分析物件間相依關係
    - 按照安全順序執行刪除和建立
    - 避免因相依性問題導致操作失敗

## 安裝
```bash
git clone https://github.com/leoshiang/dbsync
cd dbsync
npm install
```

## 參數與使用

所有連線資訊均以命令列參數提供，不再讀取 .env。

### 共用旗標
- `--dry-run`：產生 SQL 檔案（schema.sql, data.sql），不實際執行
- `--debug`：輸出詳細偵錯訊息和 SQL 語句
- `--compare-only`：**智慧比較模式**，僅針對「目標不存在」或「定義不同」的項目產生 SQL（略過清理與資料複製）

### 來源參數（必填）
- `--src-type`：來源資料庫型別（預設 `sqlserver`）
- `--src-server`：來源伺服器
- `--src-port`：來源連接埠（選填）
- `--src-db`：來源資料庫名稱
- `--src-user`：來源使用者
- `--src-pwd`：來源密碼

### 目標參數
- 非 `--dry-run` 時：必填
- 在 `--compare-only` 下：即使是 `--dry-run` 也必填（需要比對目標）
- `--dst-type`：目標資料庫型別（預設 `sqlserver`）
- `--dst-server`：目標伺服器
- `--dst-port`：目標連接埠（選填）
- `--dst-db`：目標資料庫名稱
- `--dst-user`：目標使用者
- `--dst-pwd`：目標密碼

## 使用範例

### 1. 完整同步模式

**Dry-run（產生完整同步腳本）**
```bash
node index.js --dry-run \
  --src-server 127.0.0.1 --src-db SourceDb --src-user sa --src-pwd your_password
```

**實際同步（完整覆蓋）**
```bash
node index.js \
  --src-server 127.0.0.1 --src-db SourceDb --src-user sa --src-pwd your_password \
  --dst-server 10.0.0.2 --dst-db TargetDb --dst-user sa --dst-pwd your_password
```

### 2. 智慧比較模式 (建議使用)

**比較模式 Dry-run（產生差異同步腳本）**
```bash
node index.js --dry-run --compare-only \
  --src-server 127.0.0.1 --src-db SourceDb --src-user sa --src-pwd your_password \
  --dst-server 10.0.0.2 --dst-db TargetDb --dst-user sa --dst-pwd your_password
```

**比較模式實際執行（增量同步）**
```bash
node index.js --compare-only \
  --src-server 127.0.0.1 --src-db SourceDb --src-user sa --src-pwd your_password \
  --dst-server 10.0.0.2 --dst-db TargetDb --dst-user sa --dst-pwd your_password
```

### 3. 偵錯模式
```bash
node index.js --debug --dry-run --compare-only \
  --src-server 127.0.0.1 --src-db SourceDb --src-user sa --src-pwd your_password \
  --dst-server 10.0.0.2 --dst-db TargetDb --dst-user sa --dst-pwd your_password
```

## 同步流程

### 完整同步模式流程
1. **建立 Schema** - 建立自訂 schema
2. **清理目標** - 刪除目標資料庫現有物件（僅完整同步模式）
3. **建立物件** - 按相依性順序建立資料表、檢視表、函數、預存程序
4. **複製資料** - 複製所有資料表資料（支援 IDENTITY 欄位）
5. **建立約束** - 建立主鍵和外鍵約束
6. **建立索引** - 建立所有索引與唯一約束

### 智慧比較模式流程
1. **建立 Schema** - 建立缺失的 schema
2. **比較資料表結構**：
    - 刪除多餘的欄位及其相依約束
    - 新增缺失的欄位
    - 修改定義不同的欄位
3. **比較資料庫物件**：
    - 刪除多餘的檢視表、函數、預存程序
    - 新增缺失的物件
    - 重新建立定義不同的物件
4. **比較約束**：
    - 處理主鍵和外鍵差異
5. **比較索引**：
    - 處理索引的新增、刪除、修改

## 輸出檔案

在 `--dry-run` 模式下，將會輸出：

### 完整同步模式
- `schema.sql`：完整的 Schema 與物件建立腳本（包含清理腳本）
- `data.sql`：完整的資料插入腳本

### 比較模式
- `schema.sql`：**僅包含差異的增量同步腳本**
    - 詳細的比較結果註解
    - 安全的執行順序
    - 完整的錯誤處理提示

## 比較模式產生的 SQL 範例

```sql
-- =============================================
-- 資料庫 Schema 建立/變更腳本
-- 模式: 比較模式
-- 產生時間: 2024/12/19 上午10:30:15
-- =============================================

-- 修改資料表 dbo.Users 結構
-- 刪除多餘欄位: OldColumn
ALTER TABLE [dbo].[Users] DROP COLUMN [OldColumn];
GO

-- 新增欄位: NewColumn
ALTER TABLE [dbo].[Users] ADD [NewColumn] [nvarchar](50) NULL;
GO

-- 修改欄位: Email (max_length)
ALTER TABLE [dbo].[Users] ALTER COLUMN [Email] [nvarchar](255) NOT NULL;
GO

-- 刪除多餘檢視表: dbo.OldUserView
DROP VIEW [dbo].[OldUserView];
GO

-- 新增檢視表: dbo.NewUserView
CREATE VIEW [dbo].[NewUserView] AS SELECT * FROM Users WHERE Active = 1;
GO

-- 重新建立索引（定義不同）: dbo.Users.IX_Users_Email
DROP INDEX [IX_Users_Email] ON [dbo].[Users];
GO

CREATE NONCLUSTERED INDEX [IX_Users_Email] ON [dbo].[Users] ([Email] ASC, [Active] ASC);
GO
```

## 進階功能

### 1. 欄位比較細節
- **資料型別差異**：varchar vs nvarchar, int vs bigint
- **長度差異**：varchar(50) vs varchar(100)
- **精確度差異**：decimal(10,2) vs decimal(18,4)
- **NULL 約束**：NULL vs NOT NULL
- **預設值**：預設約束的新增、修改、刪除
- **IDENTITY**：種子值和增量值的差異檢測

### 2. 約束處理
- **相依性分析**：自動檢測欄位的相依約束
- **安全刪除**：先刪除相依約束再刪除欄位
- **重建策略**：對於定義不同的約束，先刪除後重建

### 3. 物件比較演算法
- **SQL 標準化**：忽略空白、換行等格式差異
- **語義比較**：專注於實質的定義差異
- **版本控制友善**：適合用於 CI/CD 流程

## 注意事項

### 重要警告
- 實際執行模式將對目標資料庫進行變更，請務必先做好備份
- 比較模式仍可能刪除目標端的欄位、索引、約束等，請先使用 `--dry-run` 檢查

### 最佳實務
1. **開發階段**：使用比較模式進行增量同步
2. **正式部署**：先用 `--dry-run --compare-only` 檢查差異
3. **大型變更**：分階段執行，避免一次性大量變更
4. **備份策略**：執行前務必備份目標資料庫

### 效能考量
- 大量資料使用批次插入（預設 1000 筆/批）
- 比較模式會分析兩端資料庫結構，對於大型資料庫可能耗時較長
- 建議在非尖峰時段執行同步作業

### CI/CD 整合
```bash
# 在 CI/CD 流程中使用
node index.js --dry-run --compare-only \
  --src-server $SOURCE_SERVER --src-db $SOURCE_DB \
  --src-user $SOURCE_USER --src-pwd $SOURCE_PASSWORD \
  --dst-server $TARGET_SERVER --dst-db $TARGET_DB \
  --dst-user $TARGET_USER --dst-pwd $TARGET_PASSWORD

# 檢查產生的 schema.sql 是否符合預期
if [ -f "schema.sql" ]; then
  echo "Found database schema differences:"
  cat schema.sql
fi
```

## 支援的資料庫

- **SQL Server**：完整支援（2016 及以上版本）
- **未來計畫**：MySQL、PostgreSQL、Oracle

## 技術架構

- **Node.js**: 跨平台執行環境
- **mssql**: SQL Server 連線驅動程式
- **graphlib**: 相依性分析和拓撲排序
- **minimist**: 命令列參數解析

## 授權

MIT License - 詳見 LICENSE 檔案

## 貢獻

歡迎提交 Issue 和 Pull Request 來幫助改進這個專案。

## 更新日誌

### v2.0.0 (2024-12-19)
- 新增完整的智慧比較模式
- 支援資料表欄位的增量比較和修改
- 支援約束和索引的差異檢測
- 支援檢視表、函數、預存程序的定義比較
- 改善相依性處理和錯誤處理
- 完整的文件更新和使用範例

### v1.0.0 (2024-11-01)
- 初始版本發布
- 基本的資料庫完整同步功能
- 支援 SQL Server
- 命令列參數配置
