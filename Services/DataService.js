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

			// 計算總資料筆數（用於統計）
			console.log('計算總資料量...');
			let totalDataRows = 0;
			const tableStats = [];

			for (const table of tables) {
				const {totalRows} = await this.readTableDataWithCount(table.schema_name, table.table_name);
				const hasIdentityColumn = await this.checkIdentityColumn(table.schema_name, table.table_name);

				tableStats.push({
					...table,
					totalRows,
					hasIdentityColumn
				});
				totalDataRows += totalRows;
			}

			if (totalDataRows === 0) {
				console.log('所有資料表都沒有資料');
				return;
			}

			console.log(`總共需要複製 ${totalDataRows.toLocaleString()} 筆資料`);

			if (this.isDryRun) {
				// Dry-run 模式
				for (const tableStat of tableStats) {
					const tableName = `${tableStat.schema_name}.${tableStat.table_name}`;
					if (tableStat.totalRows === 0) continue;

					this.pushSql(`-- 複製資料到 ${tableName} (${tableStat.totalRows.toLocaleString()} 筆)${tableStat.hasIdentityColumn ? ' [含 IDENTITY 欄位]' : ''}\n`);
					const {data} = await this.readTableDataWithCount(tableStat.schema_name, tableStat.table_name);

					// 使用 adapter 的方法產生批次插入語句
					const batches = this.srcAdapter.generateBatchInserts(
						tableName,
						data,
						tableStat.hasIdentityColumn,
						1000 // 批次大小
					);

					batches.forEach(batch => {
						this.pushSql(`${batch}\nGO\n\n`);
					});
				}
			} else {
				// 實際執行模式
				let processedTables = 0;
				let successTables = 0;
				let failureTables = 0;
				let totalProcessedRows = 0;

				for (const tableStat of tableStats) {
					const tableName = `${tableStat.schema_name}.${tableStat.table_name}`;
					processedTables++;

					if (tableStat.totalRows === 0) {
						console.log(`  ${tableName}: 沒有資料，跳過`);
						successTables++;
						continue;
					}

					const identityNote = tableStat.hasIdentityColumn ? ' [含 IDENTITY 欄位]' : '';

					try {
						// 讀取資料
						const {data} = await this.readTableDataWithCount(tableStat.schema_name, tableStat.table_name);

						if (data.length > 0) {
							// 使用 adapter 的方法產生批次插入語句
							const batches = this.srcAdapter.generateBatchInserts(
								tableName,
								data,
								tableStat.hasIdentityColumn,
								1000 // 批次大小
							);

							// 執行所有批次
							for (const batch of batches) {
								await this.dstAdapter.executeQuery(batch);
							}

							totalProcessedRows += data.length;
							console.log(`  ${tableName}: 複製 ${tableStat.totalRows.toLocaleString()} 筆資料${identityNote} ✓ 完成 (${data.length.toLocaleString()} 筆)`);
							successTables++;
						} else {
							console.log(`  ${tableName}: 沒有資料 ✓ 完成`);
							successTables++;
						}
					} catch (err) {
						console.log(`  ${tableName}: 複製 ${tableStat.totalRows.toLocaleString()} 筆資料${identityNote} ✗ 失敗: ${err.message}`);
						failureTables++;
					}
				}

				console.log(`\n資料複製完成 - 總計: ${processedTables} 個資料表, 成功: ${successTables}, 失敗: ${failureTables}`);
				console.log(`總共複製了 ${totalProcessedRows.toLocaleString()} 筆資料`);
			}
		} catch (err) {
			console.error('複製資料失敗:', err.message);
			console.log('跳過資料複製步驟');
		}
	}
}

module.exports = DataService;