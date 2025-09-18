const DatabaseConfig = require('../Config/DatabaseConfig');

class DataService {
    constructor(sqlBuffer = null, debug = false) {
        this.srcAdapter = DatabaseConfig.createSrcAdapter(debug);
        this.dstAdapter = DatabaseConfig.createDstAdapter(debug);
        this.sqlBuffer = sqlBuffer;
        this.isDryRun = sqlBuffer !== null;
        this.debug = debug;
    }

    pushSql(sql) {
        if (this.isDryRun) this.sqlBuffer.push(sql);
    }

    debugLog(message, sql = null) {
        if (this.debug) {
            console.log(`[DEBUG] ${message}`);
            if (sql) {
                console.log(`[SQL] ${sql.trim()}`);
            }
        }
    }

    async readTables() {
        return await this.srcAdapter.readTables();
    }

    async readTableData(schemaName, tableName) {
        return await this.srcAdapter.readTableData(schemaName, tableName);
    }

    async readTableDataCount(schemaName, tableName) {
        return await this.srcAdapter.readTableDataCount(schemaName, tableName);
    }

    async readTableDataWithCount(schemaName, tableName) {
        try {
            // 先取得總筆數
            const totalRows = await this.readTableDataCount(schemaName, tableName);

            // 取得資料
            const data = await this.readTableData(schemaName, tableName);

            return {data, totalRows};
        } catch (err) {
            console.error(`\n讀取資料表 ${schemaName}.${tableName} 失敗:`, err.message);
            return {data: [], totalRows: 0};
        }
    }

    async checkIdentityColumn(schemaName, tableName) {
        try {
            return await this.srcAdapter.checkIdentityColumn(schemaName, tableName);
        } catch (err) {
            console.error(`檢查 IDENTITY 欄位失敗: ${schemaName}.${tableName}:`, err.message);
            return false;
        }
    }

    async copyData() {
        try {
            const tables = await this.readTables();

            if (tables.length === 0) {
                console.log('沒有資料表需要複製資料');
                return;
            }

            console.log(`發現 ${tables.length} 個資料表需要複製資料`);

            if (this.isDryRun) {
                this.pushSql(`-- 複製資料\n`);
                this.pushSql(`-- =============================================\n\n`);
            }

            // 逐表處理：在每一個表轉換時計算該表的數量
            let processedTables = 0;
            let successTables = 0;
            let failureTables = 0;
            let totalProcessedRows = 0;

            for (const table of tables) {
                const tableName = `${table.schema_name}.${table.table_name}`;
                processedTables++;

                try {
                    // 檢查是否有 IDENTITY 欄位
                    const hasIdentityColumn = await this.checkIdentityColumn(table.schema_name, table.table_name);

                    // 計算該表資料量
                    const totalRows = await this.readTableDataCount(table.schema_name, table.table_name);
                    const identityNote = hasIdentityColumn ? ' [含 IDENTITY 欄位]' : '';

                    if (totalRows === 0) {
                        console.log(`  ${tableName}: 沒有資料，跳過`);
                        successTables++;
                        continue;
                    }

                    // 讀取資料
                    const data = await this.readTableData(table.schema_name, table.table_name);

                    if (this.isDryRun) {
                        // Dry-run：輸出 SQL 腳本
                        this.pushSql(`-- 複製資料到 ${tableName} (${totalRows.toLocaleString()} 筆)${identityNote}\n`);
                        const batches = this.srcAdapter.generateBatchInserts(
                            tableName,
                            data,
                            hasIdentityColumn,
                            1000 // 批次大小
                        );
                        batches.forEach(batch => {
                            this.pushSql(`${batch}\nGO\n\n`);
                        });
                        console.log(`  ${tableName}: 預覽 ${totalRows.toLocaleString()} 筆資料${identityNote} ✓ 完成`);
                        successTables++;
                    } else {
                        // 實際執行：插入資料
                        const batches = this.srcAdapter.generateBatchInserts(
                            tableName,
                            data,
                            hasIdentityColumn,
                            1000 // 批次大小
                        );

                        for (const batch of batches) {
                            await this.dstAdapter.executeQuery(batch);
                        }

                        totalProcessedRows += data.length;
                        console.log(`  ${tableName}: 複製 ${totalRows.toLocaleString()} 筆資料${identityNote} ✓ 完成`);
                        successTables++;
                    }
                } catch (err) {
                    console.log(`  ${tableName}: ✗ 失敗: ${err.message}`);
                    failureTables++;
                }
            }

            console.log(`\n資料複製完成 - 總計: ${processedTables} 個資料表, 成功: ${successTables}, 失敗: ${failureTables}`);
            if (!this.isDryRun) {
                console.log(`總共複製了 ${totalProcessedRows.toLocaleString()} 筆資料`);
            }
        } catch (err) {
            console.error('複製資料失敗:', err.message);
            console.log('跳過資料複製步驟');
        }
    }
}

module.exports = DataService;