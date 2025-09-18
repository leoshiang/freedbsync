# 資料庫同步工具 (FreeDbSync)

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![License](https://img.shields.io/badge/License-MIT-blue)
![Version](https://img.shields.io/badge/Version-2.0.0-orange)

一個強大的資料庫同步工具，支援 Schema、物件、資料、約束和索引的完整同步。專為 SQL Server 設計，提供預覽模式和比較模式，確保安全可靠的資料庫遷移。

## 特色功能

- **完整同步**: 支援 Schema、資料表、檢視表、預存程序、函數、約束、索引
- **預覽模式**: 產生 SQL 腳本而不實際執行，可先檢查再應用
- **比較模式**: 只處理目標與來源不同的項目，提高效率
- **相依性排序**: 自動處理物件間的相依關係
- **除錯支援**: 詳細的執行日誌和錯誤訊息
- **安全設計**: 支援 IDENTITY 欄位處理和資料完整性檢查

## 安裝方式

### 方式1: 使用 npx (推薦)
```

bash npx freedbsync --help

```
### 方式2: 全域安裝
```

bash npm install -g . freedbsync --help

```
### 方式3: 本地開發
```

bash

# 複製專案

git clone https://github.com/leoshiang/freedbsync
cd freedbsync

# 安裝相依套件

npm install

# 建立全域連結

npm link

# 現在可以使用

freedbsync --help

```
## 系統需求

- **Node.js**: >= 18.0.0
- **npm**: >= 8.0.0
- **資料庫**: SQL Server (支援 SQL Server 2016 以上版本)

## 使用方法

### 基本語法
```bash
freedbsync [選項]

```
### 必要參數
| 參數 | 說明 | 範例 |
|------|------|------|
| `--src-server` | 來源資料庫伺服器位址 | `localhost` |
| `--src-db` | 來源資料庫名稱 | `source_db` |
| `--src-user` | 來源資料庫使用者名稱 | `sa` |
| `--src-pwd` | 來源資料庫密碼 | `password123` |

### 目標資料庫參數 (非 dry-run 模式必要)
| 參數 | 說明 | 範例 |
|------|------|------|
| `--dst-server` | 目標資料庫伺服器位址 | `localhost` |
| `--dst-db` | 目標資料庫名稱 | `target_db` |
| `--dst-user` | 目標資料庫使用者名稱 | `sa` |
| `--dst-pwd` | 目標資料庫密碼 | `password123` |

### 選用參數
| 參數 | 說明 | 預設值 |
|------|------|--------|
| `--src-type` | 來源資料庫類型 | `sqlserver` |
| `--src-port` | 來源資料庫連接埠 | `1433` |
| `--dst-type` | 目標資料庫類型 | `sqlserver` |
| `--dst-port` | 目標資料庫連接埠 | `1433` |

### 執行模式
| 參數 | 說明 |
|------|------|
| `--dry-run` | 預覽模式，產生 SQL 腳本而不執行 |
| `--compare-only` | 比較模式，僅處理差異項目 |

### 其他選項
| 參數 | 說明 |
|------|------|
| `--debug` | 開啟除錯模式，顯示詳細執行資訊 |
| `--help`, `-h` | 顯示說明訊息 |
| `--version`, `-v` | 顯示版本資訊 |

## 使用範例

### 1. 顯示說明
```bash
freedbsync --help
```
### 2. 顯示版本

```bash
freedbsync --version
```
### 3. 預覽模式 - 產生 SQL 腳本
```bash
freedbsync --dry-run
  --src-server=localhost
  --src-db=source_db
  --src-user=sa
  --src-pwd=password123

```
### 4. 實際同步

```bash
freedbsync
  --src-server=localhost
  --src-db=source_db
  --src-user=sa
  --src-pwd=password123
  --dst-server=localhost
  --dst-db=target_db
  --dst-user=sa
  --dst-pwd=password123

```
### 5. 比較模式 - 只處理差異項目

```bash
freedbsync --compare-only --dry-run
  --src-server=localhost
  --src-db=source_db
  --src-user=sa
  --src-pwd=password123
  --dst-server=localhost
  --dst-db=target_db
  --dst-user=sa
  --dst-pwd=password123

```
### 6. 除錯模式
```bash
freedbsync --debug --dry-run
  --src-server=localhost
  --src-db=source_db
  --src-user=sa
  --src-pwd=password123

````
### 7. 跨伺服器同步

```bash
freedbsync \
  --src-server=prod-server.company.com \
  --src-port=1433 \
  --src-db=production_db \
  --src-user=sync_user \
  --src-pwd=secure_password \
  --dst-server=dev-server.company.com \
  --dst-port=1433 \
  --dst-db=development_db \
  --dst-user=dev_user \
  --dst-pwd=dev_password
```

## 輸出檔案

### schema.sql

包含所有 Schema 相關的 SQL 指令：

- Schema 建立
- 資料表結構
- 檢視表、預存程序、函數
- 主鍵、外鍵約束
- 索引

### data.sql (僅在非比較模式)

包含所有資料複製的 SQL 指令：

- INSERT 語句
- IDENTITY 欄位處理
- 批次處理最佳化

## 進階功能

### 比較模式詳解

比較模式會分析來源和目標資料庫的差異，只產生必要的變更：

- **新增**: 目標不存在的物件
- **修改**: 定義不同的物件
- **刪除**: 目標多餘的物件

### 相依性處理

工具會自動分析物件間的相依關係：

- 資料表會依照外鍵關係排序
- 檢視表會依照相依的資料表排序
- 預存程序和函數會依照相依關係排序

### 批次處理

- 資料複製採用批次處理 (預設 1000 筆一批)
- 大型資料表會顯示進度資訊
- 支援 IDENTITY 欄位的正確處理

## 安全注意事項

### 預覽模式優先

- **建議**：總是先使用 `--dry-run` 預覽要執行的 SQL
- **檢查**：仔細檢查產生的 schema.sql 和 data.sql
- **測試**：在測試環境先驗證腳本

### 備份重要性

- **執行前**：務必備份目標資料庫
- **大型變更**：建議分階段執行
- **監控**：執行時監控資料庫效能

### 權限需求

- 來源資料庫：需要 `SELECT` 權限和系統檢視表存取權
- 目標資料庫：需要 `CREATE`、`ALTER`、`INSERT` 權限

## 疑難排解

### 常見問題

#### 1. 連線失敗

```
# 檢查連線參數
freedbsync --debug --dry-run --src-server=... --src-db=... --src-user=... --src-pwd=...
```

#### 2. 權限不足

確保資料庫使用者擁有適當權限：

```
-- 來源資料庫 (最小權限)
GRANT SELECT ON SCHEMA::dbo TO [sync_user];
GRANT VIEW DEFINITION ON SCHEMA::dbo TO [sync_user];

-- 目標資料庫
GRANT CREATE TABLE, CREATE VIEW, CREATE PROCEDURE TO [sync_user];
```

#### 3. 大型資料庫效能

```
# 使用比較模式減少不必要的操作
freedbsync --compare-only --dst-server=... --dst-db=...
```

#### 4. 字元編碼問題

確保資料庫的 Collation 設定相容：

```
SELECT name, collation_name FROM sys.databases;
```

### 除錯技巧

#### 開啟除錯模式

```
freedbsync --debug [其他參數]
```

#### 檢查產生的 SQL

```bash
# 使用預覽模式產生檔案
freedbsync --dry-run [其他參數]

# 檢查檔案內容
cat schema.sql
cat data.sql
```

#### 分段執行

```bash
# 先只處理 Schema
freedbsync --compare-only --dry-run [參數] > schema_only.sql

# 手動執行並驗證
sqlcmd -S server -d database -i schema_only.sql
```

## 效能考量

### 最佳化建議

- **索引**: 在資料複製完成後才建立索引
- **約束**: 主鍵和外鍵在最後階段建立
- **批次大小**: 預設 1000 筆，可根據記憶體調整
- **並行處理**: 大型資料表考慮分割處理

### 資源監控

- **CPU**: 複雜查詢可能消耗大量 CPU
- **記憶體**: 大型結果集需要足夠記憶體
- **網路**: 跨網路同步注意頻寬限制
- **磁碟**: SQL 檔案可能很大

## 開發與貢獻

### 專案結構

```
freedbsync/
├── index.js              # 主程式入口
├── bin/                  # CLI 工具
├── Services/             # 核心服務
│   ├── SchemaService.js
│   ├── ObjectService.js
│   ├── DataService.js
│   ├── ConstraintService.js
│   └── IndexService.js
├── Adapters/             # 資料庫介面卡
│   └── SqlServerAdapter.js
├── Factories/            # 工廠模式
│   └── DatabaseAdapterFactory.js
├── Utils/                # 工具函數
└── package.json
```

### 本地開發

```bash
# 複製專案
git clone https://github.com/leoshiang/freedbsync
cd freedbsync

# 安裝相依套件
npm install

# 執行測試
npm test

# 建立連結
npm link
```


## 授權

MIT License - 詳見 [LICENSE](LICENSE) 檔案