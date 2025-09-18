class SchemaService {
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

    async createSchemas() {
        const schemas = await this.srcAdapter.readSchemas();

        if (schemas.length === 0) {
            console.log('沒有需要建立的自訂 schema');
            return;
        }

        let targetExisting = new Set();
        if (this.compareOnly) {
            if (!this.dstAdapter) throw new Error('比較模式需要目標連線');
            // 檢查目標是否存在
            for (const s of schemas) {
                const exists = await this.dstAdapter.checkSchemaExists(s);
                if (exists) targetExisting.add(s);
            }
        }

        const candidates = this.compareOnly
            ? schemas.filter(s => !targetExisting.has(s))
            : schemas;

        if (candidates.length === 0) {
            console.log('比較模式：所有 schema 於目標端皆存在，無需產生');
            return;
        }

        console.log(`需要建立的 schema：${candidates.join(', ')}`);

        if (this.isDryRun) {
            candidates.forEach(schemaName => {
                this.pushSql(`-- 建立 Schema: ${schemaName}\n`);
                this.pushSql(`IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')\n`);
                this.pushSql(`    CREATE SCHEMA [${schemaName}];\n`);
                this.pushSql(`GO\n\n`);
            });
        } else {
            let successCount = 0;
            let failureCount = 0;

            for (const schemaName of candidates) {
                try {
                    const exists = await this.dstAdapter.checkSchemaExists(schemaName);
                    if (!exists) {
                        console.log(`  建立 Schema: ${schemaName} ✓`);
                        await this.dstAdapter.createSchema(schemaName);
                        successCount++;
                    } else {
                        console.log(`  Schema: ${schemaName} 已存在 ✓`);
                        successCount++;
                    }
                } catch (err) {
                    console.log(`  建立 Schema: ${schemaName} ✗ 失敗: ${err.message}`);
                    failureCount++;
                }
            }

            console.log(`\nSchema 建立完成 - 總計: ${candidates.length}, 成功: ${successCount}, 失敗: ${failureCount}`);
        }
    }
}

module.exports = SchemaService;