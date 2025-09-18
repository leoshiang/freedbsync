function normalizeSql(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

class ConstraintService {
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

    async readPrimaryKeys() {
        return await this.srcAdapter.readPrimaryKeys();
    }

    async readForeignKeys() {
        return await this.srcAdapter.readForeignKeys();
    }

    async createPrimaryKeys() {
        try {
            const primaryKeys = await this.readPrimaryKeys();

            if (primaryKeys.length === 0) {
                console.log('沒有 Primary Key 需要建立');
                return;
            }

            console.log(`發現 ${primaryKeys.length} 個 Primary Key`);

            // 比較模式：讀取目標端 PK
            let dstPkMap = null;
            let srcPkMap = null;
            if (this.compareOnly) {
                if (!this.dstAdapter) throw new Error('比較模式需要目標連線');

                const dstPks = await this.dstAdapter.readPrimaryKeys();
                dstPkMap = new Map(
                    dstPks.map(p => [`${p.schema_name}|${p.table_name}|${p.constraint_name}`.toLowerCase(), p])
                );

                srcPkMap = new Map(
                    primaryKeys.map(p => [`${p.schema_name}|${p.table_name}|${p.constraint_name}`.toLowerCase(), p])
                );
            }

            if (this.isDryRun) {
                const alterStatements = [];

                if (this.compareOnly) {
                    this.pushSql(`-- 比較模式：Primary Key 差異分析和處理\n`);
                    this.pushSql(`-- =============================================\n\n`);

                    // 第一階段：刪除目標端多餘的 Primary Key
                    const pksToDelete = [];
                    for (const [key, dstPk] of dstPkMap.entries()) {
                        if (!srcPkMap.has(key)) {
                            pksToDelete.push(dstPk);
                        }
                    }

                    if (pksToDelete.length > 0) {
                        this.pushSql(`-- 刪除目標端多餘的 Primary Key\n`);
                        for (const pk of pksToDelete) {
                            const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                pk.schema_name, pk.table_name, pk.constraint_name
                            );
                            alterStatements.push(`-- 刪除多餘主鍵: ${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`);
                            alterStatements.push(dropStmt);
                            this.debugLog(`刪除多餘主鍵: ${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`);
                        }
                        alterStatements.push('');
                    }

                    // 第二階段：處理需要新增或修改的 Primary Key
                    for (const pk of primaryKeys) {
                        const key = `${pk.schema_name}|${pk.table_name}|${pk.constraint_name}`.toLowerCase();
                        const dst = dstPkMap.get(key);
                        const isMissing = !dst;
                        const isDifferent = dst && normalizeSql(dst.create_statement) !== normalizeSql(pk.create_statement);

                        if (isMissing) {
                            alterStatements.push(`-- 新增主鍵: ${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`);
                            alterStatements.push(pk.create_statement);
                        } else if (isDifferent) {
                            // 主鍵定義不同，需要先刪除再重新建立
                            const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                dst.schema_name, dst.table_name, dst.constraint_name
                            );
                            alterStatements.push(`-- 重新建立主鍵（定義不同）: ${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`);
                            alterStatements.push(dropStmt);
                            alterStatements.push(pk.create_statement);
                        }
                    }
                } else {
                    this.pushSql(`-- 建立 Primary Key 約束\n`);
                    this.pushSql(`-- =============================================\n\n`);

                    for (const pk of primaryKeys) {
                        alterStatements.push(`-- Primary Key: ${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`);
                        alterStatements.push(pk.create_statement);
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
                    // 第一階段：刪除目標端多餘的 Primary Key
                    const pksToDelete = [];
                    for (const [key, dstPk] of dstPkMap.entries()) {
                        if (!srcPkMap.has(key)) {
                            pksToDelete.push(dstPk);
                        }
                    }

                    for (const pk of pksToDelete) {
                        const displayInfo = `${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`;
                        try {
                            const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                pk.schema_name, pk.table_name, pk.constraint_name
                            );
                            this.debugLog(`刪除多餘主鍵: ${displayInfo}`, dropStmt);
                            await this.dstAdapter.executeQuery(dropStmt);
                            console.log(`  刪除多餘主鍵: ${displayInfo} ✓`);
                            successCount++;
                        } catch (err) {
                            console.log(`  刪除多餘主鍵: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }

                    // 第二階段：處理需要新增或修改的 Primary Key
                    for (const pk of primaryKeys) {
                        const displayInfo = `${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`;
                        const key = `${pk.schema_name}|${pk.table_name}|${pk.constraint_name}`.toLowerCase();
                        const dst = dstPkMap.get(key);
                        const isMissing = !dst;
                        const isDifferent = dst && normalizeSql(dst.create_statement) !== normalizeSql(pk.create_statement);

                        if (!isMissing && !isDifferent) continue;

                        try {
                            if (!this.dstAdapter) throw new Error('未提供目標連線');

                            if (isDifferent) {
                                // 先刪除舊主鍵
                                const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                    dst.schema_name, dst.table_name, dst.constraint_name
                                );
                                this.debugLog(`刪除舊主鍵: ${displayInfo}`, dropStmt);
                                await this.dstAdapter.executeQuery(dropStmt);
                            }

                            // 建立新主鍵
                            this.debugLog(`建立主鍵: ${displayInfo}`, pk.create_statement);
                            await this.dstAdapter.executeQuery(pk.create_statement);

                            if (isMissing) {
                                console.log(`  新增 Primary Key: ${displayInfo} ✓`);
                            } else {
                                console.log(`  重新建立 Primary Key: ${displayInfo} ✓`);
                            }
                            successCount++;
                        } catch (err) {
                            console.log(`  建立 Primary Key: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }
                } else {
                    // 非比較模式，建立所有主鍵
                    for (const pk of primaryKeys) {
                        const displayInfo = `${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`;

                        try {
                            if (!this.dstAdapter) throw new Error('未提供目標連線');
                            await this.dstAdapter.executeQuery(pk.create_statement);
                            console.log(`  建立 Primary Key: ${displayInfo} ✓`);
                            successCount++;
                        } catch (err) {
                            console.log(`  建立 Primary Key: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }
                }

                console.log(`\nPrimary Key 處理完成 - 總計: ${totalOperations}, 成功: ${successCount}, 失敗: ${failureCount}`);
            }
        } catch (err) {
            console.error('讀取 Primary Key 資訊失敗:', err.message);
            console.log('跳過 Primary Key 建立步驟');
        }
    }

    async createForeignKeys() {
        try {
            const foreignKeys = await this.readForeignKeys();

            if (foreignKeys.length === 0) {
                console.log('沒有 Foreign Key 需要建立');
                return;
            }

            console.log(`發現 ${foreignKeys.length} 個 Foreign Key`);

            // 比較模式：讀取目標端 FK
            let dstFkMap = null;
            let srcFkMap = null;
            if (this.compareOnly) {
                if (!this.dstAdapter) throw new Error('比較模式需要目標連線');

                const dstFks = await this.dstAdapter.readForeignKeys();
                dstFkMap = new Map(
                    dstFks.map(f => [`${f.schema_name}|${f.parent_table}|${f.constraint_name}`.toLowerCase(), f])
                );

                srcFkMap = new Map(
                    foreignKeys.map(f => [`${f.schema_name}|${f.parent_table}|${f.constraint_name}`.toLowerCase(), f])
                );
            }

            if (this.isDryRun) {
                const alterStatements = [];

                if (this.compareOnly) {
                    this.pushSql(`-- 比較模式：Foreign Key 差異分析和處理\n`);
                    this.pushSql(`-- =============================================\n\n`);

                    // 第一階段：刪除目標端多餘的 Foreign Key
                    const fksToDelete = [];
                    for (const [key, dstFk] of dstFkMap.entries()) {
                        if (!srcFkMap.has(key)) {
                            fksToDelete.push(dstFk);
                        }
                    }

                    if (fksToDelete.length > 0) {
                        this.pushSql(`-- 刪除目標端多餘的 Foreign Key\n`);
                        for (const fk of fksToDelete) {
                            const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                fk.schema_name, fk.parent_table, fk.constraint_name
                            );
                            alterStatements.push(`-- 刪除多餘外鍵: ${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`);
                            alterStatements.push(dropStmt);
                            this.debugLog(`刪除多餘外鍵: ${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`);
                        }
                        alterStatements.push('');
                    }

                    // 第二階段：處理需要新增或修改的 Foreign Key
                    for (const fk of foreignKeys) {
                        const key = `${fk.schema_name}|${fk.parent_table}|${fk.constraint_name}`.toLowerCase();
                        const dst = dstFkMap.get(key);
                        const isMissing = !dst;
                        const isDifferent = dst && normalizeSql(dst.create_statement) !== normalizeSql(fk.create_statement);

                        if (isMissing) {
                            alterStatements.push(`-- 新增外鍵: ${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`);
                            alterStatements.push(fk.create_statement);
                        } else if (isDifferent) {
                            // 外鍵定義不同，需要先刪除再重新建立
                            const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                dst.schema_name, dst.parent_table, dst.constraint_name
                            );
                            alterStatements.push(`-- 重新建立外鍵（定義不同）: ${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`);
                            alterStatements.push(dropStmt);
                            alterStatements.push(fk.create_statement);
                        }
                    }
                } else {
                    this.pushSql(`-- 建立 Foreign Key 約束\n`);
                    this.pushSql(`-- =============================================\n\n`);

                    for (const fk of foreignKeys) {
                        alterStatements.push(`-- Foreign Key: ${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`);
                        alterStatements.push(fk.create_statement);
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
                    // 第一階段：刪除目標端多餘的 Foreign Key
                    const fksToDelete = [];
                    for (const [key, dstFk] of dstFkMap.entries()) {
                        if (!srcFkMap.has(key)) {
                            fksToDelete.push(dstFk);
                        }
                    }

                    for (const fk of fksToDelete) {
                        const displayInfo = `${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`;
                        try {
                            const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                fk.schema_name, fk.parent_table, fk.constraint_name
                            );
                            this.debugLog(`刪除多餘外鍵: ${displayInfo}`, dropStmt);
                            await this.dstAdapter.executeQuery(dropStmt);
                            console.log(`  刪除多餘外鍵: ${displayInfo} ✓`);
                            successCount++;
                        } catch (err) {
                            console.log(`  刪除多餘外鍵: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }

                    // 第二階段：處理需要新增或修改的 Foreign Key
                    for (const fk of foreignKeys) {
                        const displayInfo = `${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`;
                        const key = `${fk.schema_name}|${fk.parent_table}|${fk.constraint_name}`.toLowerCase();
                        const dst = dstFkMap.get(key);
                        const isMissing = !dst;
                        const isDifferent = dst && normalizeSql(dst.create_statement) !== normalizeSql(fk.create_statement);

                        if (!isMissing && !isDifferent) continue;

                        try {
                            if (!this.dstAdapter) throw new Error('未提供目標連線');

                            if (isDifferent) {
                                // 先刪除舊外鍵
                                const dropStmt = this.dstAdapter.generateDropForeignKeyStatement(
                                    dst.schema_name, dst.parent_table, dst.constraint_name
                                );
                                this.debugLog(`刪除舊外鍵: ${displayInfo}`, dropStmt);
                                await this.dstAdapter.executeQuery(dropStmt);
                            }

                            // 建立新外鍵
                            this.debugLog(`建立外鍵: ${displayInfo}`, fk.create_statement);
                            await this.dstAdapter.executeQuery(fk.create_statement);

                            if (isMissing) {
                                console.log(`  新增 Foreign Key: ${displayInfo} ✓`);
                            } else {
                                console.log(`  重新建立 Foreign Key: ${displayInfo} ✓`);
                            }
                            successCount++;
                        } catch (err) {
                            console.log(`  建立 Foreign Key: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }
                } else {
                    // 非比較模式，建立所有外鍵
                    for (const fk of foreignKeys) {
                        const displayInfo = `${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`;

                        try {
                            if (!this.dstAdapter) throw new Error('未提供目標連線');
                            await this.dstAdapter.executeQuery(fk.create_statement);
                            console.log(`  建立 Foreign Key: ${displayInfo} ✓`);
                            successCount++;
                        } catch (err) {
                            console.log(`  建立 Foreign Key: ${displayInfo} ✗ 失敗: ${err.message}`);
                            failureCount++;
                        }
                        totalOperations++;
                    }
                }

                console.log(`\nForeign Key 處理完成 - 總計: ${totalOperations}, 成功: ${successCount}, 失敗: ${failureCount}`);
            }
        } catch (err) {
            console.error('讀取 Foreign Key 資訊失敗:', err.message);
            console.log('跳過 Foreign Key 建立步驟');
        }
    }
}

module.exports = ConstraintService;