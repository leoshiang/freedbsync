const DatabaseConfig = require('../Config/DatabaseConfig');
const {Graph, alg} = require('graphlib');

class ObjectService {
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

	async readObjects() {
		return await this.srcAdapter.readObjects();
	}

	async readObjectDependencies() {
		return await this.srcAdapter.readObjectDependencies();
	}

	async generateTableCreateStatement(schemaName, tableName) {
		return await this.srcAdapter.generateTableCreateStatement(schemaName, tableName);
	}

	/**
	 * 產生 DROP 語句 (用於 Dry-run 模式)
	 */
	generateDropStatement(schemaName, objectName, objectType) {
		// 可以委派給 adapter，或者保持通用邏輯
		return this.srcAdapter.generateDropObjectStatement(schemaName, objectName, objectType);
	}

	async sortByDependency() {
		// 讀取所有物件
		const objects = await this.readObjects();
		console.log(`發現 ${objects.length} 個資料庫物件`);

		// 統計各類型物件數量
		const typeCount = {};
		objects.forEach(o => {
			typeCount[o.type] = (typeCount[o.type] || 0) + 1;
		});
		console.log('物件統計:', typeCount);

		// 讀取相依關係
		const deps = await this.readObjectDependencies();

		// 建立圖形
		const graph = new Graph();
		objects.forEach(o => graph.setNode(o.object_id, o));
		deps.forEach(d => {
			if (graph.hasNode(d.referenced_id) && graph.hasNode(d.referencing_id)) {
				graph.setEdge(d.referenced_id, d.referencing_id);
			}
		});

		// 處理循環相依性
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

		// 拓樸排序
		const sortedIds = alg.topsort(graph);
		return sortedIds.map(id => graph.node(id));
	}

	async createObjects(sortedObjs) {
		const tables = sortedObjs.filter(o => o.type === 'U');
		const otherObjects = sortedObjs.filter(o => o.type !== 'U');

		console.log(`處理 ${tables.length} 個資料表，${otherObjects.length} 個其他物件`);

		if (this.isDryRun) {
			this.pushSql(`-- 建立資料庫物件 (不包含 Foreign Key 和 Index)\n`);
			this.pushSql(`-- =============================================\n\n`);

			// 先產生 DROP 語句（按相依性反向順序）
			this.pushSql(`-- DROP 現有物件 (依相依性反向順序)\n`);
			this.pushSql(`-- =============================================\n\n`);

			// 反向順序 DROP（依賴者先 DROP）
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

			// 先處理所有資料表
			if (tables.length > 0) {
				console.log('產生資料表 CREATE 語句...');
				for (const table of tables) {
					try {
						const tableCreateStatement = await this.generateTableCreateStatement(table.schema_name, table.name);
						if (tableCreateStatement) {
							this.pushSql(`-- 建立資料表 ${table.schema_name}.${table.name}\n`);
							this.pushSql(`${tableCreateStatement};\n`);
							this.pushSql(`GO\n\n`);
						} else {
							console.warn(`無法產生資料表 ${table.schema_name}.${table.name} 的 CREATE 語句`);
						}
					} catch (err) {
						console.error(`產生資料表 ${table.schema_name}.${table.name} CREATE 語句失敗:`, err.message);
					}
				}
			}

			// 再處理其他物件
			if (otherObjects.length > 0) {
				console.log('產生其他物件 CREATE 語句...');
				for (const obj of otherObjects) {
					if (obj.definition) {
						const typeNames = {
							'V': 'View', 'P': 'Procedure', 'FN': 'Function', 'TF': 'Function', 'IF': 'Function'
						};
						const typeName = typeNames[obj.type] || obj.type;

						this.pushSql(`-- 建立 ${obj.schema_name}.${obj.name} (${typeName})\n`);
						this.pushSql(`${obj.definition};\n`);
						this.pushSql(`GO\n\n`);
					} else {
						console.warn(`物件 ${obj.schema_name}.${obj.name} 沒有定義`);
					}
				}
			}
			return;
		}

		// 實際執行模式
		console.log('步驟 2b: CREATE 物件（依相依性正向順序）');

		let totalCount = sortedObjs.length;
		let successCount = 0;
		let failureCount = 0;

		for (const o of sortedObjs) {
			if (o.type === 'U') {
				// 資料表：CREATE TABLE
				console.log(`  建立資料表: ${o.schema_name}.${o.name}`);

				try {
					const tableCreateStatement = await this.generateTableCreateStatement(o.schema_name, o.name);
					if (tableCreateStatement) {
						this.debugLog(`執行 CREATE TABLE: ${o.schema_name}.${o.name}`, tableCreateStatement);
						await this.dstAdapter.executeBatch(tableCreateStatement);
						successCount++;
					} else {
						console.log(`    ✗ 無法產生 CREATE 語句`);
						failureCount++;
					}
				} catch (err) {
					console.log(`    ✗ 失敗: ${err.message}`);
					failureCount++;
				}
			} else {
				// 其他物件：CREATE
				const typeNames = {
					'V': '檢視表', 'P': '預存程序', 'FN': '函數', 'TF': '函數', 'IF': '函數'
				};
				const typeName = typeNames[o.type] || o.type;
				console.log(`  建立${typeName}: ${o.schema_name}.${o.name}`);

				if (o.definition) {
					try {
						this.debugLog(`執行 CREATE: ${o.schema_name}.${o.name}`, o.definition.substring(0, 200) + '...');
						await this.dstAdapter.executeBatch(o.definition);
						successCount++;
					} catch (err) {
						console.log(`    ✗ 失敗: ${err.message}`);
						failureCount++;
					}
				} else {
					console.log(`    ✗ 沒有定義`);
					failureCount++;
				}
			}
		}

		console.log(`\n物件建立完成 - 總計: ${totalCount}, 成功: ${successCount}, 失敗: ${failureCount}`);
	}
}

module.exports = ObjectService;