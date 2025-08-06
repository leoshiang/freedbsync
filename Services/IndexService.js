const DatabaseConfig = require('../Config/DatabaseConfig');

class IndexService {
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

	async readIndexes() {
		return await this.srcAdapter.readIndexes();
	}

	async createIndexes() {
		try {
			const indexes = await this.readIndexes();

			if (indexes.length === 0) {
				console.log('沒有 Index 需要建立');
				return;
			}

			console.log(`發現 ${indexes.length} 個 Index`);

			if (this.isDryRun) {
				this.pushSql(`-- 建立 Index\n`);
				this.pushSql(`-- =============================================\n\n`);
				indexes.forEach(idx => {
					this.pushSql(`-- Index: ${idx.schema_name}.${idx.table_name}.${idx.index_name}\n`);
					this.pushSql(`${idx.create_statement};\nGO\n\n`);
				});
			} else {
				let successCount = 0;
				let failureCount = 0;

				for (const idx of indexes) {
					const displayInfo = `${idx.schema_name}.${idx.table_name}.${idx.index_name}`;

					try {
						await this.dstAdapter.executeQuery(idx.create_statement);
						console.log(`  建立 Index: ${displayInfo} ✓`);
						successCount++;
					} catch (err) {
						console.log(`  建立 Index: ${displayInfo} ✗ 失敗: ${err.message}`);
						failureCount++;
					}
				}

				console.log(`\nIndex 建立完成 - 總計: ${indexes.length}, 成功: ${successCount}, 失敗: ${failureCount}`);
			}
		} catch (err) {
			console.error('讀取 Index 資訊失敗:', err.message);
			console.log('跳過 Index 建立步驟');
		}
	}
}

module.exports = IndexService;