class IndexService {
    constructor(srcAdapter, dstAdapter, sqlBuffer = null, debug = false) {
        this.srcAdapter = srcAdapter;
        this.dstAdapter = dstAdapter;
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

    async readIndexes() {
        // 從來源讀取索引（不包含 Primary Key）
        return await this.srcAdapter.readIndexes();
    }

    async createIndexes() {
        try {
            const indexes = await this.readIndexes();

            if (indexes.length === 0) {
                console.log('沒有索引需要建立');
                return;
            }

            console.log(`發現 ${indexes.length} 個索引（不含主鍵與主鍵衍生唯一約束）`);

            if (this.isDryRun) {
                this.pushSql(`-- 建立索引\n`);
                this.pushSql(`-- =============================================\n\n`);
                indexes.forEach(idx => {
                    if (!idx.create_statement) return;
                    this.pushSql(`-- 索引: ${idx.schema_name}.${idx.table_name}.${idx.index_name}\n`);
                    this.pushSql(`${idx.create_statement};\nGO\n\n`);
                });
            } else {
                let successCount = 0;
                let failureCount = 0;

                for (const idx of indexes) {
                    if (!idx.create_statement) continue;
                    const displayInfo = `${idx.schema_name}.${idx.table_name}.${idx.index_name}`;

                    try {
                        if (!this.dstAdapter) throw new Error('未提供目標連線');
                        await this.dstAdapter.executeQuery(idx.create_statement);
                        console.log(`  建立索引: ${displayInfo} ✓`);
                        successCount++;
                    } catch (err) {
                        console.log(`  建立索引: ${displayInfo} ✗ 失敗: ${err.message}`);
                        failureCount++;
                    }
                }

                console.log(`\n索引建立完成 - 總計: ${indexes.length}, 成功: ${successCount}, 失敗: ${failureCount}`);
            }
        } catch (err) {
            console.error('讀取索引資訊失敗:', err.message);
            console.log('跳過索引建立步驟');
        }
    }
}

module.exports = IndexService;