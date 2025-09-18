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
                this.pushSql(`-- 比較模式：僅產生目標不存在或定義不同的物件 CREATE 語句\n`);
                this.pushSql(`-- =============================================\n\n`);
            }

            // 資料表
            if (tables.length > 0) {
                console.log('產生資料表 CREATE 語句...');
                for (const table of tables) {
                    try {
                        const srcCreate = await this.generateTableCreateStatement(table.schema_name, table.name);
                        if (!srcCreate) {
                            console.warn(`無法產生資料表 ${table.schema_name}.${table.name} 的 CREATE 語句`);
                            continue;
                        }

                        if (this.compareOnly) {
                            const key = `U|${table.schema_name}|${table.name}`.toLowerCase();
                            let shouldEmit = false;
                            if (!dstObjectMap.has(key)) {
                                shouldEmit = true; // 目標端不存在
                            } else {
                                // 目標端也生成 CREATE 再比對
                                const dstCreate = await this.dstAdapter.generateTableCreateStatement(table.schema_name, table.name);
                                if (!dstCreate) {
                                    shouldEmit = true;
                                } else if (normalizeSql(srcCreate) !== normalizeSql(dstCreate)) {
                                    shouldEmit = true;
                                }
                            }
                            if (!shouldEmit) continue;
                        }

                        this.pushSql(`-- 建立資料表 ${table.schema_name}.${table.name}\n`);
                        this.pushSql(`${srcCreate};\n`);
                        this.pushSql(`GO\n\n`);
                    } catch (err) {
                        console.error(`產生資料表 ${table.schema_name}.${table.name} CREATE 語句失敗:`, err.message);
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
                    const srcCreate = await this.generateTableCreateStatement(o.schema_name, o.name);
                    if (!srcCreate) {
                        console.log(`  建立資料表: ${o.schema_name}.${o.name} ✗ 無法產生 CREATE 語句`);
                        failureCount++;
                        continue;
                    }

                    if (this.compareOnly) {
                        if (!this.dstAdapter) throw new Error('比較模式需要目標連線');
                        const dstCreate = await this.dstAdapter.generateTableCreateStatement(o.schema_name, o.name);
                        const isMissing = !dstCreate;
                        const isDifferent = dstCreate && normalizeSql(dstCreate) !== normalizeSql(srcCreate);
                        if (!isMissing && !isDifferent) continue;
                    }

                    this.debugLog(`執行 CREATE TABLE: ${o.schema_name}.${o.name}`, srcCreate);
                    if (!this.dstAdapter) throw new Error('未提供目標連線');
                    await this.dstAdapter.executeBatch(srcCreate);
                    console.log(`  建立資料表: ${o.schema_name}.${o.name} ✓`);
                    successCount++;
                    totalCount++;
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
}

module.exports = ObjectService;