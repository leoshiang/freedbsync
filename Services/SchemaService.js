const DatabaseConfig = require('../Config/DatabaseConfig');

class SchemaService {
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

	async createSchemas() {
		// 從來源取得所有需要的 schema
		const schemas = await this.srcAdapter.readSchemas();

		if (schemas.length === 0) {
			console.log('沒有需要建立的自訂 schema');
			return;
		}

		console.log(`發現 ${schemas.length} 個自訂 schema：${schemas.join(', ')}`);

		if (this.isDryRun) {
			// Dry-run 模式：產生 CREATE SCHEMA 語句
			schemas.forEach(schemaName => {
				this.pushSql(`-- 建立 Schema: ${schemaName}\n`);
				this.pushSql(`IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schemaName}')\n`);
				this.pushSql(`    CREATE SCHEMA [${schemaName}];\n`);
				this.pushSql(`GO\n\n`);
			});
		} else {
			// 實際執行：在目的端建立 schema
			let successCount = 0;
			let failureCount = 0;

			for (const schemaName of schemas) {
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

			console.log(`\nSchema 建立完成 - 總計: ${schemas.length}, 成功: ${successCount}, 失敗: ${failureCount}`);
		}
	}
}

module.exports = SchemaService;