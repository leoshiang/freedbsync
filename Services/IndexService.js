function normalizeSql(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

class IndexService {
    constructor(srcAdapter, dstAdapter, sqlBuffer = null, debug = false, compareOnly = false) {
        this.srcAdapter = srcAdapter;
        this.dstAdapter = dstAdapter;
        this.sqlBuffer = sqlBuffer;
        this.isDryRun = sqlBuffer !== null;
        this.debug = debug;
        this.compareOnly = compareOnly;
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

            // 比較模式：建立目標端索引 map 以便判斷差異
            let dstIndexMap = null;
            let srcIndexMap = null;
            if (this.compareOnly) {
                if (!this.dstAdapter) throw new Error('比較模式需要目標連線');

                const dstIdx = await this.dstAdapter.readIndexes();
                dstIndexMap = new Map(
                    dstIdx
                        .filter(d => d.create_statement)
                        .map(d => [`${d.schema_name}|${d.table_name}|${d.index_name}`.toLowerCase(), d])
                );

                srcIndexMap = new Map(
                    indexes
                        .filter(s => s.create_statement)
                        .map(s => [`${s.schema_name}|${s.table_name}|${s.index_name}`.toLowerCase(), s])
                );
            }

            if (this.isDryRun) {
                const alterStatements = [];

                if (this.compareOnly) {
                    this.pushSql(`-- 比較模式：索引差異分析和處理\n`);
                    this.pushSql(`-- =============================================\n\n`);

                    // 第一階段：刪除目標端多餘的索引
                    const indexesToDelete = [];
                    for (const [key, dstIdx] of dstIndexMap.entries()) {
                        if (!srcIndexMap.has(key)) {
                            indexesToDelete.push(dstIdx);
                        }
                    }

                    if (indexesToDelete.length > 0) {
                        this.pushSql(`-- 刪除目標端多餘的索引\n`);
                        for (const idx of indexesToDelete) {
                            const dropStmt = this.dstAdapter.generateDropIndexStatement(
                                idx.schema_name, idx.table_name, idx.index_name
                            );
                            alterStatements.push(`-- 刪除多餘索引: ${idx.schema_name}.${idx.table_name}.${idx.index_name}`);
                            alterStatements.push(dropStmt);
                            this.debugLog(`刪除多餘索引: ${idx.schema_name}.${idx.table_name}.${idx.index_name}`);
                        }
                        alterStatements.push('');
                    }

                    // 第二階段：處理需要新增或修改的索引
                    for (const idx of indexes) {
                        if (!idx.create_statement) continue;

                        const key = `${idx.schema_name}|${idx.table_name}|${idx.index_name}`.toLowerCase();
                        const dst = dstIndexMap.get(key);
                        const isMissing = !dst;
                        const isDifferent = dst && normalizeSql(dst.create_statement) !== normalizeSql(idx.create_statement);

                        if (isMissing) {
                            alterStatements.push(`-- 新增索引: ${idx.schema_name}.${idx.table_name}.${idx.index_name}`);
                            alterStatements.push(idx.create_statement);
                        } else if (isDifferent) {
                            // 索引定義不同，需要先刪除再重新建立
                            const dropStmt = this.dstAdapter.generateDropIndexStatement(
                                dst.schema_name, dst.table_name, dst.index_name
                            );
                            alterStatements.push(`-- 重新建立索引（定義不同）: ${idx.schema_name}.${idx.table_name}.${idx.index_name}`);
                            alterStatements.push(dropStmt);
                            alterStatements.push(idx.create_statement);
                        }
                    }
                } else {
                    this.pushSql(`-- 建立索引\n`);
                    this.pushSql(`-- =============================================\n\n`);

                    for (const idx of indexes) {
                        if (!idx.create_statement) continue;
                        alterStatements.push(`-- 索引: ${idx.schema_name}.${idx.table_name}.${idx.index_name}`);
                        alterStatements.push(idx.create_statement);
                    }
                }

                // 輸出 SQL 語句
                alterStatements.forEach(stmt => {
                    if (stmt.trim().startsWith('--') || stmt.trim() === '') {
                        // 註解行或空行直接輸出
                        this.pushSql(`${stmt}\n`);
                    } else {
                        // SQL 語句加上 GO
                        this.pushSql(`${stmt};\n`);
                        this.pushSql(`GO\n\n`);
                    }
                });

            } else {
                // 實際執行模式
                let successCount = 0;
                let failureCount = 0;
                let totalOperations = 0;

                if (this.compareOnly) {
                    // 第一階段：刪除目標端多餘的索引
                    const indexesToDelete = [];
                    for (const [key, dstIdx] of dstIndexMap.entries()) {
                        if (!srcIndexMap.has(key)) {
                            indexesToDelete.push(dstIdx);
                        }
                    }

                    for (const idx of indexesToDelete) {
                        const displayInfo = `${idx.schema_name}.${idx.table_name}.${idx.index_name}`;
                        try {
                            const dropStmt = this.dstAdapter.generateDropIndexStatement(
                                idx.schema_name, idx.table_name, idx.index_name
                            );
                            this.debugLog(`刪除多餘索引: ${displayInfo}`, dropStmt);
                            await this.dstAdapter.executeQuery(dropStmt);
                            console.log(`  刪除多餘索引: ${displayInfo} ✓`);
                            successCount++;
                        } catch (err) {
                            console.log(`  刪除多餘索引: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }

                    // 第二階段：處理需要新增或修改的索引
                    for (const idx of indexes) {
                        if (!idx.create_statement) continue;

                        const displayInfo = `${idx.schema_name}.${idx.table_name}.${idx.index_name}`;
                        const key = `${idx.schema_name}|${idx.table_name}|${idx.index_name}`.toLowerCase();
                        const dst = dstIndexMap.get(key);
                        const isMissing = !dst;
                        const isDifferent = dst && normalizeSql(dst.create_statement) !== normalizeSql(idx.create_statement);

                        if (!isMissing && !isDifferent) continue;

                        try {
                            if (!this.dstAdapter) throw new Error('未提供目標連線');

                            if (isDifferent) {
                                // 先刪除舊索引
                                const dropStmt = this.dstAdapter.generateDropIndexStatement(
                                    dst.schema_name, dst.table_name, dst.index_name
                                );
                                this.debugLog(`刪除舊索引: ${displayInfo}`, dropStmt);
                                await this.dstAdapter.executeQuery(dropStmt);
                            }

                            // 建立新索引
                            this.debugLog(`建立索引: ${displayInfo}`, idx.create_statement);
                            await this.dstAdapter.executeQuery(idx.create_statement);

                            if (isMissing) {
                                console.log(`  新增索引: ${displayInfo} ✓`);
                            } else {
                                console.log(`  重新建立索引: ${displayInfo} ✓`);
                            }
                            successCount++;
                        } catch (err) {
                            console.log(`  建立索引: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }
                } else {
                    // 非比較模式，建立所有索引
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
                        totalOperations++;
                    }
                }

                console.log(`\n索引處理完成 - 總計: ${totalOperations}, 成功: ${successCount}, 失敗: ${failureCount}`);
            }
        } catch (err) {
            console.error('讀取索引資訊失敗:', err.message);
            console.log('跳過索引建立步驟');
        }
    }
}

module.exports = IndexService;