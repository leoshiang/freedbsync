const DatabaseConfig = require('../Config/DatabaseConfig');

class CleanupService {
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

	async cleanupExistingObjects() {
		try {
			if (this.isDryRun) {
				// Dry-run 模式：產生清理腳本
				this.pushSql(`-- 清理現有物件\n`);
				this.pushSql(`-- =============================================\n\n`);

				// 產生通用的清理腳本
				this.pushSql(`-- 1. 刪除所有 Foreign Key 約束\n`);
				this.pushSql(`DECLARE @sql NVARCHAR(MAX) = ''  `);
				this.pushSql(`SELECT @sql = @sql + 'ALTER TABLE [' + SCHEMA_NAME(fk.schema_id) + '].[' + tp.name + '] DROP CONSTRAINT [' + fk.name + '];' + CHAR(13)\n`);
				this.pushSql(`FROM sys.foreign_keys fk\n`);
				this.pushSql(`INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id\n`);
				this.pushSql(`EXEC sp_executesql @sql\n`);
				this.pushSql(`GO\n\n`);

				this.pushSql(`-- 2. 刪除所有索引（非 Primary Key）\n`);
				this.pushSql(`DECLARE @sql NVARCHAR(MAX) = ''  `);
				this.pushSql(`SELECT @sql = @sql + 'DROP INDEX [' + i.name + '] ON [' + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '];' + CHAR(13)\n`);
				this.pushSql(`FROM sys.indexes i\n`);
				this.pushSql(`INNER JOIN sys.tables t ON i.object_id = t.object_id\n`);
				this.pushSql(`WHERE i.is_primary_key = 0 AND i.type > 0 AND i.name IS NOT NULL\n`);
				this.pushSql(`EXEC sp_executesql @sql\n`);
				this.pushSql(`GO\n\n`);

				this.pushSql(`-- 3. 刪除所有物件（函數、預存程序、檢視表、資料表）\n`);
				this.pushSql(`-- 刪除函數\n`);
				this.pushSql(`DECLARE @sql NVARCHAR(MAX) = ''  `);
				this.pushSql(`SELECT @sql = @sql + 'DROP FUNCTION [' + SCHEMA_NAME(schema_id) + '].[' + name + '];' + CHAR(13)\n`);
				this.pushSql(`FROM sys.objects WHERE type IN ('FN', 'TF', 'IF')\n`);
				this.pushSql(`EXEC sp_executesql @sql\n`);
				this.pushSql(`GO\n\n`);

				this.pushSql(`-- 刪除預存程序\n`);
				this.pushSql(`DECLARE @sql NVARCHAR(MAX) = ''  `);
				this.pushSql(`SELECT @sql = @sql + 'DROP PROCEDURE [' + SCHEMA_NAME(schema_id) + '].[' + name + '];' + CHAR(13)\n`);
				this.pushSql(`FROM sys.objects WHERE type = 'P'\n`);
				this.pushSql(`EXEC sp_executesql @sql\n`);
				this.pushSql(`GO\n\n`);

				this.pushSql(`-- 刪除檢視表\n`);
				this.pushSql(`DECLARE @sql NVARCHAR(MAX) = ''  `);
				this.pushSql(`SELECT @sql = @sql + 'DROP VIEW [' + SCHEMA_NAME(schema_id) + '].[' + name + '];' + CHAR(13)\n`);
				this.pushSql(`FROM sys.objects WHERE type = 'V'\n`);
				this.pushSql(`EXEC sp_executesql @sql\n`);
				this.pushSql(`GO\n\n`);

				this.pushSql(`-- 刪除資料表\n`);
				this.pushSql(`DECLARE @sql NVARCHAR(MAX) = ''  `);
				this.pushSql(`SELECT @sql = @sql + 'DROP TABLE [' + SCHEMA_NAME(schema_id) + '].[' + name + '];' + CHAR(13)\n`);
				this.pushSql(`FROM sys.objects WHERE type = 'U'\n`);
				this.pushSql(`EXEC sp_executesql @sql\n`);
				this.pushSql(`GO\n\n`);

				return;
			}

			// 實際執行模式：清理現有物件
			console.log('步驟 2a: 清理現有物件');

			let totalCount = 0;
			let successCount = 0;
			let failureCount = 0;

			// 1. 先刪除 Foreign Key 約束
			const foreignKeys = await this.dstAdapter.readExistingForeignKeys();
			if (foreignKeys.length > 0) {
				console.log(`刪除 ${foreignKeys.length} 個 Foreign Key 約束...`);
				totalCount += foreignKeys.length;

				for (const fk of foreignKeys) {
					const displayInfo = `${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`;

					try {
						const dropSql = this.dstAdapter.generateDropForeignKeyStatement(fk.schema_name, fk.parent_table, fk.constraint_name);
						this.debugLog(`刪除 Foreign Key: ${displayInfo}`, dropSql);
						await this.dstAdapter.executeQuery(dropSql);
						console.log(`  刪除 FK: ${displayInfo} ✓`);
						successCount++;
					} catch (err) {
						this.debugLog(`刪除 FK ${displayInfo} 失敗: ${err.message}`);
						console.log(`  刪除 FK: ${displayInfo} ✗ 失敗: ${err.message}`);
						failureCount++;
					}
				}
			}

			// 2. 刪除索引（非 Primary Key）
			const indexes = await this.dstAdapter.readExistingIndexes();
			if (indexes.length > 0) {
				console.log(`\n刪除 ${indexes.length} 個索引...`);
				totalCount += indexes.length;

				for (const idx of indexes) {
					const displayInfo = `${idx.schema_name}.${idx.table_name}.${idx.index_name}`;

					try {
						const dropSql = this.dstAdapter.generateDropIndexStatement(idx.schema_name, idx.table_name, idx.index_name);
						this.debugLog(`刪除索引: ${displayInfo}`, dropSql);
						await this.dstAdapter.executeQuery(dropSql);
						console.log(`  刪除索引: ${displayInfo} ✓`);
						successCount++;
					} catch (err) {
						this.debugLog(`刪除索引 ${displayInfo} 失敗: ${err.message}`);
						console.log(`  刪除索引: ${displayInfo} ✗ 失敗: ${err.message}`);
						failureCount++;
					}
				}
			}

			// 3. 刪除資料庫物件（函數 -> 預存程序 -> 檢視表 -> 資料表）
			const objects = await this.dstAdapter.readExistingObjects();
			if (objects.length > 0) {
				console.log(`\n刪除 ${objects.length} 個資料庫物件...`);
				totalCount += objects.length;

				for (const obj of objects) {
					const typeNames = {
						'U': '資料表',
						'V': '檢視表',
						'P': '預存程序',
						'FN': '函數',
						'TF': '函數',
						'IF': '函數'
					};
					const typeName = typeNames[obj.type] || obj.type;
					const displayInfo = `${obj.schema_name}.${obj.name}`;

					try {
						const dropStatement = this.dstAdapter.generateDropObjectStatement(obj.schema_name, obj.name, obj.type);
						if (dropStatement) {
							this.debugLog(`刪除物件: ${displayInfo}`, dropStatement);
							await this.dstAdapter.executeBatch(dropStatement);
							console.log(`  刪除${typeName}: ${displayInfo} ✓`);
							successCount++;
						}
					} catch (err) {
						this.debugLog(`刪除物件 ${displayInfo} 失敗: ${err.message}`);
						console.log(`  刪除${typeName}: ${displayInfo} ✗ 失敗: ${err.message}`);
						failureCount++;
					}
				}
			}

			console.log(`\n清理完成 - 總計: ${totalCount}, 成功: ${successCount}, 失敗: ${failureCount}`);

		} catch (err) {
			console.error('清理現有物件失敗:', err.message);
			throw err;
		}
	}
}

module.exports = CleanupService;