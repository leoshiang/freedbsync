const { Graph, alg } = require('graphlib');

function normalizeSql(text) {
    if (!text) return '';
    // 基本化簡：移除連續空白、換行差異；不處理語意等價
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

class ObjectService {
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

    async readObjects() {
        return await this.srcAdapter.readObjects();
    }

    async readObjectDependencies() {
        return await this.srcAdapter.readObjectDependencies();
    }

    async generateTableCreateStatement(schemaName, tableName) {
        return await this.srcAdapter.generateTableCreateStatement(schemaName, tableName);
    }

    generateDropStatement(schemaName, objectName, objectType) {
        return this.srcAdapter.generateDropObjectStatement(schemaName, objectName, objectType);
    }

    async sortByDependency() {
        const objects = await this.readObjects();
        console.log(`發現 ${objects.length} 個資料庫物件`);

        const typeCount = {};
        objects.forEach(o => {
            typeCount[o.type] = (typeCount[o.type] || 0) + 1;
        });
        console.log('物件統計:', typeCount);

        const deps = await this.readObjectDependencies();

        const graph = new Graph();
        objects.forEach(o => graph.setNode(o.object_id, o));
        deps.forEach(d => {
            if (graph.hasNode(d.referenced_id) && graph.hasNode(d.referencing_id)) {
                graph.setEdge(d.referenced_id, d.referencing_id);
            }
        });

        if (!alg.isAcyclic(graph)) {
            const cycles = alg.findCycles(graph);
            console.warn(`警告：偵測到 ${cycles.length} 個循環相依性，將移除循環邊緣`);
            cycles.forEach(cycle => {
                for (let i = 0; i < cycle.length; i++) {
                    const from = cycle[i];
                    const to = cycle[(i + 1) % cycle.length];
                    if (graph.hasEdge(from, to)) {
                        graph.removeEdge(from, to);
                    }
                }
            });
        }

        const sortedIds = alg.topsort(graph);
        return sortedIds.map(id => graph.node(id));
    }

    async createObjects(sortedObjs) {
        // 目標端物件快取（比較模式需要）
        let dstObjectMap = null;
        if (this.compareOnly) {
            if (!this.dstAdapter) throw new Error('比較模式需要目標連線');
            const dstObjects = await this.dstAdapter.readObjects();
            dstObjectMap = new Map();
            dstObjects.forEach(o => {
                const key = `${o.type}|${o.schema_name}|${o.name}`.toLowerCase();
                dstObjectMap.set(key, o);
            });
        }

        const tables = sortedObjs.filter(o => o.type === 'U');
        const otherObjects = sortedObjs.filter(o => o.type !== 'U');

        console.log(`處理 ${tables.length} 個資料表，${otherObjects.length} 個其他物件`);

        if (this.isDryRun) {
            if (!this.compareOnly) {
                this.pushSql(`-- 建立資料庫物件 (不包含 Foreign Key 和 Index)\n`);
                this.pushSql(`-- =============================================\n\n`);

                this.pushSql(`-- DROP 現有物件 (依相依性反向順序)\n`);
                this.pushSql(`-- =============================================\n\n`);

                const reversedObjects = [...sortedObjs].reverse();

                for (const obj of reversedObjects) {
                    const typeNames = {
                        'U': 'Table',
                        'V': 'View',
                        'P': 'Procedure',
                        'FN': 'Function',
                        'TF': 'Function',
                        'IF': 'Function'
                    };
                    const typeName = typeNames[obj.type] || obj.type;

                    this.pushSql(`-- DROP ${obj.schema_name}.${obj.name} (${typeName})\n`);

                    const dropStatement = this.generateDropStatement(obj.schema_name, obj.name, obj.type);
                    if (dropStatement) {
                        this.pushSql(`${dropStatement};\n`);
                        this.pushSql(`GO\n\n`);
                    }
                }

                this.pushSql(`-- CREATE 物件 (依相依性正向順序)\n`);
                this.pushSql(`-- =============================================\n\n`);
            } else {
                this.pushSql(`-- 比較模式：僅產生目標不存在或定義不同的物件 CREATE/ALTER 語句\n`);
                this.pushSql(`-- =============================================\n\n`);
            }

            // 資料表
            if (tables.length > 0) {
                console.log('產生資料表 CREATE/ALTER 語句...');
                for (const table of tables) {
                    try {
                        if (this.compareOnly) {
                            const key = `U|${table.schema_name}|${table.name}`.toLowerCase();
                            if (!dstObjectMap.has(key)) {
                                // 表格不存在，建立完整表格
                                const srcCreate = await this.generateTableCreateStatement(table.schema_name, table.name);
                                if (srcCreate) {
                                    this.pushSql(`-- 建立新資料表 ${table.schema_name}.${table.name}\n`);
                                    this.pushSql(`${srcCreate};\n`);
                                    this.pushSql(`GO\n\n`);
                                }
                            } else {
                                // 表格存在，比較欄位差異
                                const alterStatements = await this.generateTableAlterStatements(table.schema_name, table.name);
                                if (alterStatements.length > 0) {
                                    this.pushSql(`-- 修改資料表 ${table.schema_name}.${table.name} 結構\n`);
                                    alterStatements.forEach(stmt => {
                                        if (stmt.trim().startsWith('--')) {
                                            // 註解行直接輸出
                                            this.pushSql(`${stmt}\n`);
                                        } else {
                                            // SQL 語句加上分號和 GO
                                            this.pushSql(`${stmt};\n`);
                                            this.pushSql(`GO\n\n`);
                                        }
                                    });
                                }
                            }
                        } else {
                            const srcCreate = await this.generateTableCreateStatement(table.schema_name, table.name);
                            if (!srcCreate) {
                                console.warn(`無法產生資料表 ${table.schema_name}.${table.name} 的 CREATE 語句`);
                                continue;
                            }

                            this.pushSql(`-- 建立資料表 ${table.schema_name}.${table.name}\n`);
                            this.pushSql(`${srcCreate};\n`);
                            this.pushSql(`GO\n\n`);
                        }
                    } catch (err) {
                        console.error(`產生資料表 ${table.schema_name}.${table.name} CREATE/ALTER 語句失敗:`, err.message);
                    }
                }
            }

            // 其他物件
            if (otherObjects.length > 0) {
                console.log('產生其他物件 CREATE 語句...');
                for (const obj of otherObjects) {
                    if (!obj.definition) {
                        console.warn(`物件 ${obj.schema_name}.${obj.name} 沒有定義`);
                        continue;
                    }

                    if (this.compareOnly) {
                        const key = `${obj.type}|${obj.schema_name}|${obj.name}`.toLowerCase();
                        const dstObj = dstObjectMap.get(key);
                        let shouldEmit = false;
                        if (!dstObj) {
                            shouldEmit = true;
                        } else {
                            const srcDef = normalizeSql(obj.definition);
                            const dstDef = normalizeSql(dstObj.definition);
                            if (srcDef !== dstDef) shouldEmit = true;
                        }
                        if (!shouldEmit) continue;
                    }

                    const typeNames = {
                        'V': 'View', 'P': 'Procedure', 'FN': 'Function', 'TF': 'Function', 'IF': 'Function'
                    };
                    const typeName = typeNames[obj.type] || obj.type;

                    this.pushSql(`-- 建立 ${obj.schema_name}.${obj.name} (${typeName})\n`);
                    this.pushSql(`${obj.definition};\n`);
                    this.pushSql(`GO\n\n`);
                }
            }
            return;
        }

        // 實際執行模式
        console.log(this.compareOnly
            ? '步驟 2b: 比較模式 - 只建立不存在或不同的物件'
            : '步驟 2b: CREATE 物件（依相依性正向順序）');

        let totalCount = 0;
        let successCount = 0;
        let failureCount = 0;

        for (const o of sortedObjs) {
            try {
                if (o.type === 'U') {
                    if (this.compareOnly) {
                        const key = `U|${o.schema_name}|${o.name}`.toLowerCase();
                        if (!dstObjectMap.has(key)) {
                            // 表格不存在，建立完整表格
                            const srcCreate = await this.generateTableCreateStatement(o.schema_name, o.name);
                            if (!srcCreate) {
                                console.log(`  建立資料表: ${o.schema_name}.${o.name} ✗ 無法產生 CREATE 語句`);
                                failureCount++;
                                continue;
                            }

                            this.debugLog(`執行 CREATE TABLE: ${o.schema_name}.${o.name}`, srcCreate);
                            if (!this.dstAdapter) throw new Error('未提供目標連線');
                            await this.dstAdapter.executeBatch(srcCreate);
                            console.log(`  建立資料表: ${o.schema_name}.${o.name} ✓`);
                            successCount++;
                            totalCount++;
                        } else {
                            // 表格存在，執行增量修改
                            const alterStatements = await this.generateTableAlterStatements(o.schema_name, o.name);
                            if (alterStatements.length > 0) {
                                let actualStatements = 0;
                                for (const stmt of alterStatements) {
                                    // 跳過註解行
                                    if (!stmt.trim().startsWith('--')) {
                                        this.debugLog(`執行 ALTER TABLE: ${o.schema_name}.${o.name}`, stmt);
                                        await this.dstAdapter.executeBatch(stmt);
                                        actualStatements++;
                                    }
                                }
                                if (actualStatements > 0) {
                                    console.log(`  修改資料表: ${o.schema_name}.${o.name} ✓ (${actualStatements} 個變更)`);
                                    successCount++;
                                    totalCount++;
                                }
                            }
                        }
                    } else {
                        const srcCreate = await this.generateTableCreateStatement(o.schema_name, o.name);
                        if (!srcCreate) {
                            console.log(`  建立資料表: ${o.schema_name}.${o.name} ✗ 無法產生 CREATE 語句`);
                            failureCount++;
                            continue;
                        }

                        this.debugLog(`執行 CREATE TABLE: ${o.schema_name}.${o.name}`, srcCreate);
                        if (!this.dstAdapter) throw new Error('未提供目標連線');
                        await this.dstAdapter.executeBatch(srcCreate);
                        console.log(`  建立資料表: ${o.schema_name}.${o.name} ✓`);
                        successCount++;
                        totalCount++;
                    }
                } else {
                    if (!o.definition) {
                        console.log(`  建立物件: ${o.schema_name}.${o.name} ✗ 沒有定義`);
                        failureCount++;
                        totalCount++;
                        continue;
                    }

                    if (this.compareOnly) {
                        if (!dstObjectMap) {
                            const dstObjects = await this.dstAdapter.readObjects();
                            dstObjectMap = new Map(dstObjects.map(d => [`${d.type}|${d.schema_name}|${d.name}`.toLowerCase(), d]));
                        }
                        const key = `${o.type}|${o.schema_name}|${o.name}`.toLowerCase();
                        const dstObj = dstObjectMap.get(key);
                        const isMissing = !dstObj;
                        const isDifferent = dstObj && normalizeSql(dstObj.definition) !== normalizeSql(o.definition);
                        if (!isMissing && !isDifferent) continue;
                    }

                    this.debugLog(`執行 CREATE: ${o.schema_name}.${o.name}`, o.definition.substring(0, 200) + '...');
                    if (!this.dstAdapter) throw new Error('未提供目標連線');
                    await this.dstAdapter.executeBatch(o.definition);
                    console.log(`  建立物件: ${o.schema_name}.${o.name} ✓`);
                    successCount++;
                    totalCount++;
                }
            } catch (err) {
                console.log(`  建立 ${o.schema_name}.${o.name} ✗ 失敗: ${err.message}`);
                failureCount++;
                totalCount++;
            }
        }

        console.log(`\n物件建立完成 - 觸及: ${totalCount}, 成功: ${successCount}, 失敗: ${failureCount}`);
    }

    // 修改：產生表格修改語句，加入刪除多餘欄位的邏輯
    async generateTableAlterStatements(schemaName, tableName) {
        const statements = [];

        try {
            // 取得來源和目標的欄位資訊
            const srcColumns = await this.srcAdapter.getTableColumns(schemaName, tableName);
            const dstColumns = await this.dstAdapter.getTableColumns(schemaName, tableName);

            if (!srcColumns || srcColumns.length === 0) {
                return statements;
            }

            // 建立來源欄位的對照表
            const srcColumnMap = new Map();
            srcColumns.forEach(col => {
                srcColumnMap.set(col.column_name.toLowerCase(), col);
            });

            // 建立目標欄位的對照表
            const dstColumnMap = new Map();
            if (dstColumns) {
                dstColumns.forEach(col => {
                    dstColumnMap.set(col.column_name.toLowerCase(), col);
                });
            }

            // 第一階段：處理需要刪除的欄位（目標有但來源沒有）
            const columnsToDelete = [];
            for (const dstCol of dstColumns || []) {
                const colName = dstCol.column_name.toLowerCase();
                if (!srcColumnMap.has(colName)) {
                    columnsToDelete.push(dstCol);
                }
            }

            // 刪除欄位及其相依約束
            for (const dstCol of columnsToDelete) {
                try {
                    // 檢查該欄位的相依約束
                    const dependencies = await this.dstAdapter.getColumnDependencies(
                        schemaName, tableName, dstCol.column_name
                    );

                    // 先刪除相依約束
                    for (const dep of dependencies) {
                        statements.push(`-- 刪除相依${dep.dependency_type}: ${dep.dependency_name}`);
                        statements.push(dep.drop_statement);
                        this.debugLog(`刪除相依約束: ${dep.dependency_type} - ${dep.dependency_name}`);
                    }

                    // 刪除預設約束（如果有）
                    if (dstCol.default_constraint_name) {
                        const dropDefaultStmt = this.dstAdapter.generateDropDefaultConstraintStatement(
                            schemaName, tableName, dstCol.default_constraint_name
                        );
                        statements.push(`-- 刪除預設約束: ${dstCol.default_constraint_name}`);
                        statements.push(dropDefaultStmt);
                    }

                    // 最後刪除欄位
                    const dropColumnStmt = this.dstAdapter.generateDropColumnStatement(
                        schemaName, tableName, dstCol.column_name
                    );
                    statements.push(`-- 刪除欄位: ${dstCol.column_name}`);
                    statements.push(dropColumnStmt);

                    this.debugLog(`刪除欄位: ${schemaName}.${tableName}.${dstCol.column_name}`);
                } catch (err) {
                    console.error(`分析欄位 ${dstCol.column_name} 相依性失敗: ${err.message}`);
                    // 仍然嘗試刪除欄位，但會在註解中標註警告
                    statements.push(`-- 警告：無法分析相依性，強制刪除欄位: ${dstCol.column_name}`);
                    const dropColumnStmt = this.dstAdapter.generateDropColumnStatement(
                        schemaName, tableName, dstCol.column_name
                    );
                    statements.push(dropColumnStmt);
                }
            }

            // 第二階段：處理需要新增的欄位（來源有但目標沒有）
            for (const srcCol of srcColumns) {
                const colName = srcCol.column_name.toLowerCase();
                const dstCol = dstColumnMap.get(colName);

                if (!dstCol) {
                    // 欄位不存在，需要新增
                    const colDef = this.srcAdapter.formatColumnDefinition(srcCol);
                    const addStmt = this.srcAdapter.generateAddColumnStatement(schemaName, tableName, colDef);
                    statements.push(`-- 新增欄位: ${srcCol.column_name}`);
                    statements.push(addStmt);

                    this.debugLog(`新增欄位: ${schemaName}.${tableName}.${srcCol.column_name}`);
                }
            }

            // 第三階段：處理需要修改的欄位（兩邊都有但定義不同）
            for (const srcCol of srcColumns) {
                const colName = srcCol.column_name.toLowerCase();
                const dstCol = dstColumnMap.get(colName);

                if (dstCol) {
                    // 欄位存在，比較是否需要修改
                    const differences = this.getColumnDifferences(srcCol, dstCol);
                    if (differences.length > 0) {
                        // 處理預設約束的變更
                        if (differences.includes('default_constraint')) {
                            // 先刪除舊的預設約束
                            if (dstCol.default_constraint_name) {
                                const dropDefaultStmt = this.srcAdapter.generateDropDefaultConstraintStatement(
                                    schemaName, tableName, dstCol.default_constraint_name
                                );
                                statements.push(`-- 刪除舊預設約束: ${dstCol.default_constraint_name}`);
                                statements.push(dropDefaultStmt);
                            }
                        }

                        // 注意：IDENTITY 欄位無法用 ALTER COLUMN 修改，可能需要特殊處理
                        if (srcCol.is_identity || dstCol.is_identity) {
                            if (differences.includes('identity')) {
                                statements.push(`-- 警告：IDENTITY 欄位 ${srcCol.column_name} 無法直接修改，請手動處理`);
                                console.warn(`警告：IDENTITY 欄位 ${schemaName}.${tableName}.${srcCol.column_name} 無法直接修改，請手動處理`);
                            } else {
                                // 只是其他屬性變更，仍可嘗試修改
                                const alterStmt = this.srcAdapter.generateAlterColumnStatement(schemaName, tableName, srcCol);
                                statements.push(`-- 修改欄位: ${srcCol.column_name} (${differences.join(', ')})`);
                                statements.push(alterStmt);
                            }
                        } else {
                            const alterStmt = this.srcAdapter.generateAlterColumnStatement(schemaName, tableName, srcCol);
                            statements.push(`-- 修改欄位: ${srcCol.column_name} (${differences.join(', ')})`);
                            statements.push(alterStmt);
                        }

                        // 處理預設約束的新增
                        if (differences.includes('default_constraint') && srcCol.default_constraint) {
                            const addDefaultStmt = this.srcAdapter.generateAddDefaultConstraintStatement(
                                schemaName, tableName, srcCol.column_name, srcCol.default_constraint
                            );
                            statements.push(`-- 新增預設約束: ${srcCol.column_name}`);
                            statements.push(addDefaultStmt);
                        }

                        this.debugLog(`修改欄位: ${schemaName}.${tableName}.${srcCol.column_name}，差異: ${differences.join(', ')}`);
                    }
                }
            }

            return statements;
        } catch (err) {
            console.error(`產生表格 ${schemaName}.${tableName} ALTER 語句失敗:`, err.message);
            return statements;
        }
    }

    // 新增：比較兩個欄位的差異並返回差異類型
    getColumnDifferences(srcCol, dstCol) {
        const differences = [];

        // 比較資料類型
        if (srcCol.data_type !== dstCol.data_type) {
            differences.push('data_type');
        }

        // 比較長度
        if (srcCol.max_length !== dstCol.max_length) {
            differences.push('max_length');
        }

        // 比較精度和小數位數
        if (srcCol.precision !== dstCol.precision) {
            differences.push('precision');
        }
        if (srcCol.scale !== dstCol.scale) {
            differences.push('scale');
        }

        // 比較是否允許 NULL
        if (srcCol.is_nullable !== dstCol.is_nullable) {
            differences.push('nullable');
        }

        // 比較 IDENTITY 設定
        if (srcCol.is_identity !== dstCol.is_identity) {
            differences.push('identity');
        }
        if (srcCol.is_identity && dstCol.is_identity) {
            if (srcCol.seed_value !== dstCol.seed_value || srcCol.increment_value !== dstCol.increment_value) {
                differences.push('identity');
            }
        }

        // 比較預設約束（簡單比較，可能需要更精密的處理）
        const srcDefault = normalizeSql(srcCol.default_constraint || '');
        const dstDefault = normalizeSql(dstCol.default_constraint || '');
        if (srcDefault !== dstDefault) {
            differences.push('default_constraint');
        }

        return differences;
    }

    // 新增：比較兩個欄位是否不同（保留原有方法以確保相容性）
    isColumnDifferent(srcCol, dstCol) {
        return this.getColumnDifferences(srcCol, dstCol).length > 0;
    }
}

module.exports = ObjectService;