const DatabaseAdapter = require('./DatabaseAdapter');
const mssql = require('mssql');

/**
 * SQL Server 資料庫適配器
 */
class SqlServerAdapter extends DatabaseAdapter {
	constructor(config, debug = false) {
		super(config, debug);
	}

	async withPool(fn) {
		const pool = new mssql.ConnectionPool(this.config);
		await pool.connect();
		try {
			return await fn(pool);
		} finally {
			await pool.close();
		}
	}

	// Schema 相關操作
	async readSchemas() {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(`
                SELECT DISTINCT s.name AS schema_name
                FROM sys.schemas s
                WHERE s.schema_id IN (SELECT DISTINCT o.schema_id
                                      FROM sys.objects o
                                      WHERE o.type IN ('U', 'V', 'P', 'FN', 'TF', 'IF'))
                  AND s.name NOT IN ('dbo', 'sys', 'information_schema', 'guest')
			`);
			return recordset.map(r => r.schema_name);
		});
	}

	async createSchema(schemaName) {
		return this.withPool(async (pool) => {
			await pool.request().query(`CREATE SCHEMA [${schemaName}]`);
		});
	}

	async checkSchemaExists(schemaName) {
		return this.withPool(async (pool) => {
			const {recordset} = await pool
				.request()
				.input('schemaName', mssql.NVarChar, schemaName)
				.query(`SELECT 1
                        FROM sys.schemas
                        WHERE name = @schemaName`);
			return recordset.length > 0;
		});
	}

	// 物件相關操作
	async readObjects() {
		return this.withPool(async (pool) => {
			const sql = `
                SELECT o.object_id,
                       RTRIM(o.type) AS type,
                       RTRIM(s.name) AS schema_name,
                       RTRIM(o.name) AS name,
                       CASE
                           WHEN o.type = 'U' THEN NULL
                           ELSE OBJECT_DEFINITION(o.object_id)
                           END       AS definition
                FROM sys.objects o
                         JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE RTRIM(o.type) IN ('U', 'V', 'P', 'FN', 'TF', 'IF')
                ORDER BY s.name, o.name
			`;

			this.debugLog('讀取資料庫物件', sql);
			const {recordset} = await pool.request().query(sql);
			return recordset;
		});
	}

	async readObjectDependencies() {
		return this.withPool(async (pool) => {
			const sql = `
                SELECT referencing_id, referenced_id
                FROM sys.sql_expression_dependencies d
                WHERE EXISTS (SELECT 1
                              FROM sys.objects o
                              WHERE o.object_id = d.referencing_id
                                AND o.type IN ('U', 'V', 'P', 'FN', 'TF', 'IF'))
                  AND EXISTS (SELECT 1
                              FROM sys.objects o
                              WHERE o.object_id = d.referenced_id
                                AND o.type IN ('U', 'V', 'P', 'FN', 'TF', 'IF'))
			`;

			this.debugLog('讀取相依關係', sql);
			const {recordset} = await pool.request().query(sql);
			return recordset;
		});
	}

	async generateTableCreateStatement(schemaName, tableName) {
		return this.withPool(async (pool) => {
			const sql = `
                SELECT c.name                        AS column_name,
                       t.name                        AS data_type,
                       c.max_length,
                       c.precision,
                       c.scale,
                       c.is_nullable,
                       c.is_identity,
                       ISNULL(ic.seed_value, 1)      AS seed_value,
                       ISNULL(ic.increment_value, 1) AS increment_value,
                       dc.definition                 AS default_constraint
                FROM sys.columns c
                         INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
                         INNER JOIN sys.objects o ON c.object_id = o.object_id
                         INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
                         LEFT JOIN sys.identity_columns ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                         LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
                WHERE s.name = @schemaName
                  AND o.name = @tableName
                ORDER BY c.column_id
			`;

			this.debugLog(`產生資料表 ${schemaName}.${tableName} CREATE 語句`, sql);

			const {recordset: columns} = await pool.request()
				.input('schemaName', mssql.NVarChar, schemaName)
				.input('tableName', mssql.NVarChar, tableName)
				.query(sql);

			if (columns.length === 0) {
				console.warn(`警告: 資料表 ${schemaName}.${tableName} 沒有找到欄位定義`);
				return null;
			}

			const columnDefinitions = columns.map(col => {
				let def = `    [${col.column_name}] [${col.data_type}]`;

				// 處理資料類型長度/精度
				if (['varchar', 'nvarchar', 'char', 'nchar'].includes(col.data_type)) {
					if (col.max_length === -1) {
						def += '(MAX)';
					} else {
						const length = col.data_type.startsWith('n') ? col.max_length / 2 : col.max_length;
						def += `(${length})`;
					}
				} else if (['decimal', 'numeric'].includes(col.data_type)) {
					def += `(${col.precision},${col.scale})`;
				} else if (['float'].includes(col.data_type) && col.precision !== 53) {
					def += `(${col.precision})`;
				} else if (['varbinary', 'binary'].includes(col.data_type) && col.max_length !== -1) {
					def += col.max_length === -1 ? '(MAX)' : `(${col.max_length})`;
				}

				if (col.is_identity) {
					def += ` IDENTITY(${col.seed_value},${col.increment_value})`;
				}

				def += col.is_nullable ? ' NULL' : ' NOT NULL';

				if (col.default_constraint) {
					def += ` DEFAULT ${col.default_constraint}`;
				}

				return def;
			});

			const createStatement =
				`CREATE TABLE [${schemaName}].[${tableName}]
                 (  ` +
				columnDefinitions.join(',\n') +
				'\n)';

			this.debugLog(`資料表 ${schemaName}.${tableName} CREATE 語句`, createStatement);
			return createStatement;
		});
	}

	// 約束相關操作
	async readPrimaryKeys() {
		return this.withPool(async (pool) => {
			const sql = `
                SELECT i.name                                                      AS constraint_name,
                       SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT           AS schema_name,
                       t.name COLLATE DATABASE_DEFAULT                             AS table_name,
                       CASE i.type WHEN 1 THEN 'CLUSTERED' ELSE 'NONCLUSTERED' END AS index_type,
                       STRING_AGG(c.name COLLATE DATABASE_DEFAULT +
                                  CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ')
                                                                                      WITHIN GROUP (ORDER BY ic.key_ordinal) AS column_list,
					'ALTER TABLE [' + SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT + '].[' + 
					t.name COLLATE DATABASE_DEFAULT + '] ADD CONSTRAINT [' + 
					i.name COLLATE DATABASE_DEFAULT + '] PRIMARY KEY ' +
					CASE i.type WHEN 1 THEN 'CLUSTERED' ELSE 'NONCLUSTERED'
                END
                + ' (' +
					STRING_AGG(c.name COLLATE DATABASE_DEFAULT + 
						CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ') 
						WITHIN GROUP (ORDER BY ic.key_ordinal) + ')' AS create_statement
				FROM sys.indexes i
				INNER JOIN sys.tables t ON i.object_id = t.object_id
				INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
				INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
				WHERE i.is_primary_key = 1
				GROUP BY 
					i.object_id, i.index_id, i.name, i.type_desc, i.type,
					t.schema_id, t.name
				ORDER BY 
					SCHEMA_NAME(t.schema_id), t.name, i.name
			`;

			this.debugLog('讀取 Primary Key 約束', sql);
			const {recordset} = await pool.request().query(sql);
			return recordset;
		});
	}

	async readForeignKeys() {
		return this.withPool(async (pool) => {
			const sql = `
                SELECT fk.name                   AS          constraint_name,
                       SCHEMA_NAME(fk.schema_id) AS          schema_name,
                       tp.name                   AS          parent_table,
                       tr.name                   AS          referenced_table,
                       SCHEMA_NAME(tr.schema_id) AS          referenced_schema,
                       STRING_AGG('[' + cp.name + ']', ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS parent_columns,
					STRING_AGG('[' + cr.name + ']', ', ') WITHIN
                GROUP (ORDER BY fkc.constraint_column_id) AS referenced_columns,
                    'ALTER TABLE [' + SCHEMA_NAME (fk.schema_id) + '].[' + tp.name + '] ADD CONSTRAINT [' + fk.name + '] FOREIGN KEY (' +
                    STRING_AGG('[' + cp.name + ']', ', ') WITHIN
                GROUP (ORDER BY fkc.constraint_column_id) +
                    ') REFERENCES [' + SCHEMA_NAME (tr.schema_id) + '].[' + tr.name + '] (' +
                    STRING_AGG('[' + cr.name + ']', ', ') WITHIN
                GROUP (ORDER BY fkc.constraint_column_id) + ')' AS create_statement
                FROM sys.foreign_keys fk
                    INNER JOIN sys.tables tp
                ON fk.parent_object_id = tp.object_id
                    INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
                    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                    INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
                    INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
                GROUP BY fk.object_id, fk.name, fk.schema_id, tp.name, tr.name, tr.schema_id
                ORDER BY SCHEMA_NAME (fk.schema_id), tp.name, fk.name
			`;

			this.debugLog('讀取 Foreign Key 約束', sql);
			const {recordset} = await pool.request().query(sql);
			return recordset;
		});
	}

	// 索引相關操作
	async readIndexes() {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(`
                SELECT i.name                                            AS index_name,
                       SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT AS schema_name,
                       t.name COLLATE DATABASE_DEFAULT                   AS table_name,
                       i.type_desc,
                       i.is_unique,
                       i.is_primary_key,
                       i.is_unique_constraint,
                       CASE
                           WHEN i.is_primary_key = 1 THEN NULL
                           WHEN i.is_unique_constraint = 1 THEN
                               'ALTER TABLE [' + SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT + '].[' +
                               t.name COLLATE DATABASE_DEFAULT + '] ADD CONSTRAINT [' +
                               i.name COLLATE DATABASE_DEFAULT + '] UNIQUE ' +
                               CASE i.type WHEN 1 THEN 'CLUSTERED' ELSE 'NONCLUSTERED' END + ' (' +
                               STRING_AGG(c.name COLLATE DATABASE_DEFAULT +
                                          CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ')
                               WITHIN
                GROUP (ORDER BY ic.key_ordinal) + ')'
                    ELSE
                    'CREATE ' +
                    CASE WHEN i.is_unique = 1 THEN 'UNIQUE ' ELSE ''
                END
                +
						   CASE i.type WHEN 1 THEN 'CLUSTERED' ELSE 'NONCLUSTERED'
                END
                + 
						   ' INDEX [' + i.name COLLATE DATABASE_DEFAULT + '] ON [' + 
						   SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT + '].[' + 
						   t.name COLLATE DATABASE_DEFAULT + '] (' +
						   STRING_AGG(c.name COLLATE DATABASE_DEFAULT + 
							   CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ') 
							   WITHIN GROUP (ORDER BY ic.key_ordinal) + ')'
                END
                AS create_statement
				FROM sys.indexes i
				INNER JOIN sys.tables t ON i.object_id = t.object_id
				INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
				INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
				WHERE i.type > 0 AND i.is_hypothetical = 0 AND i.is_disabled = 0 AND i.is_primary_key = 0
				GROUP BY 
					i.object_id, i.index_id, i.name, i.type_desc, i.type,
					i.is_unique, i.is_primary_key, i.is_unique_constraint,
					t.schema_id, t.name
				ORDER BY 
					SCHEMA_NAME(t.schema_id), t.name, 
					CASE WHEN i.is_unique_constraint = 1 THEN 1 ELSE 2
                END
                ,
					i.name
			`);
			return recordset.filter(r => r.create_statement !== null);
		});
	}

	// 資料相關操作
	async readTables() {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(`
                SELECT s.name AS schema_name, t.name AS table_name
                FROM sys.tables t
                         JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name NOT IN ('sys', 'information_schema')
                ORDER BY s.name, t.name
			`);
			return recordset;
		});
	}

	async readTableData(schemaName, tableName) {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(
				`SELECT *
                 FROM [${schemaName}].[${tableName}]`
			);
			return recordset;
		});
	}

	async readTableDataCount(schemaName, tableName) {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(
				`SELECT COUNT(*) as total
                 FROM [${schemaName}].[${tableName}]`
			);
			return recordset[0].total;
		});
	}

	async checkIdentityColumn(schemaName, tableName) {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request()
				.input('schemaName', mssql.NVarChar, schemaName)
				.input('tableName', mssql.NVarChar, tableName)
				.query(`
                    SELECT COUNT(*) as identity_count
                    FROM sys.columns c
                             INNER JOIN sys.objects o ON c.object_id = o.object_id
                             INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
                    WHERE s.name = @schemaName
                      AND o.name = @tableName
                      AND c.is_identity = 1
				`);

			return recordset[0].identity_count > 0;
		});
	}

	// 清理相關操作
	async readExistingForeignKeys() {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(`
                SELECT fk.name                   AS constraint_name,
                       SCHEMA_NAME(fk.schema_id) AS schema_name,
                       tp.name                   AS parent_table
                FROM sys.foreign_keys fk
                         INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
                ORDER BY SCHEMA_NAME(fk.schema_id), tp.name, fk.name
			`);
			return recordset;
		});
	}

	async readExistingIndexes() {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(`
                SELECT i.name                   AS index_name,
                       SCHEMA_NAME(t.schema_id) AS schema_name,
                       t.name                   AS table_name
                FROM sys.indexes i
                         INNER JOIN sys.tables t ON i.object_id = t.object_id
                WHERE i.is_primary_key = 0
                  AND i.type > 0
                  AND i.name IS NOT NULL
                ORDER BY SCHEMA_NAME(t.schema_id), t.name, i.name
			`);
			return recordset;
		});
	}

	async readExistingObjects() {
		return this.withPool(async (pool) => {
			const {recordset} = await pool.request().query(`
                SELECT o.object_id,
                       RTRIM(o.type) AS type,
                       RTRIM(s.name) AS schema_name,
                       RTRIM(o.name) AS name
                FROM sys.objects o
                         JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE RTRIM(o.type) IN ('U', 'V', 'P', 'FN', 'TF', 'IF')
                ORDER BY CASE RTRIM(o.type)
                             WHEN 'FN' THEN 1
                             WHEN 'TF' THEN 1
                             WHEN 'IF' THEN 1
                             WHEN 'P' THEN 2
                             WHEN 'V' THEN 3
                             WHEN 'U' THEN 4
                             END DESC,
                         s.name, o.name
			`);
			return recordset;
		});
	}

	// SQL 語句產生
	generateDropForeignKeyStatement(schemaName, tableName, constraintName) {
		return `ALTER TABLE [${schemaName}].[${tableName}] DROP CONSTRAINT [${constraintName}]`;
	}

	generateDropIndexStatement(schemaName, tableName, indexName) {
		return `DROP INDEX [${indexName}] ON [${schemaName}].[${tableName}]`;
	}

	generateDropObjectStatement(schemaName, objectName, objectType) {
		const fullName = `[${schemaName}].[${objectName}]`;

		switch (objectType.trim()) {
			case 'U':
				return `IF OBJECT_ID('${schemaName}.${objectName}', 'U') IS NOT NULL DROP TABLE ${fullName}`;
			case 'V':
				return `IF OBJECT_ID('${schemaName}.${objectName}', 'V') IS NOT NULL DROP VIEW ${fullName}`;
			case 'P':
				return `IF OBJECT_ID('${schemaName}.${objectName}', 'P') IS NOT NULL DROP PROCEDURE ${fullName}`;
			case 'FN':
				return `IF OBJECT_ID('${schemaName}.${objectName}', 'FN') IS NOT NULL DROP FUNCTION ${fullName}`;
			case 'TF':
				return `IF OBJECT_ID('${schemaName}.${objectName}', 'TF') IS NOT NULL DROP FUNCTION ${fullName}`;
			case 'IF':
				return `IF OBJECT_ID('${schemaName}.${objectName}', 'IF') IS NOT NULL DROP FUNCTION ${fullName}`;
			default:
				return null;
		}
	}

	generateBatchInserts(tableName, rows, hasIdentityColumn = false, batchSize = 1000) {
		if (!rows || rows.length === 0) return [];

		const safeTableName = this.escapeTableName(tableName);
		const columns = Object.keys(rows[0]);
		const columnList = columns.map(col => this.escapeIdentifier(col)).join(', ');

		const batches = [];

		for (let i = 0; i < rows.length; i += batchSize) {
			const batch = rows.slice(i, i + batchSize);

			const valuesList = batch.map(row => {
				const values = columns.map(col => this.escapeValue(row[col])).join(', ');
				return `(${values})`;
			}).join(',\n    ');

			let sql = '';

			if (hasIdentityColumn) {
				sql += `SET IDENTITY_INSERT ${safeTableName} ON;\n`;
			}

			sql += `INSERT INTO ${safeTableName} (${columnList})
                    VALUES
                        ${valuesList};`;

			if (hasIdentityColumn) {
				sql += `\nSET IDENTITY_INSERT ${safeTableName} OFF;`;
			}

			batches.push(sql);
		}

		return batches;
	}

	// 執行 SQL
	async executeQuery(sql) {
		return this.withPool(async (pool) => {
			return await pool.request().query(sql);
		});
	}

	async executeBatch(sql) {
		return this.withPool(async (pool) => {
			return await pool.request().batch(sql);
		});
	}

	// SQL 輔助方法
	escapeValue(value) {
		if (value === null || value === undefined) {
			return 'NULL';
		}

		if (typeof value === 'number') {
			if (isNaN(value)) return 'NULL';
			if (!isFinite(value)) return 'NULL';
			return value.toString();
		}

		if (typeof value === 'boolean') {
			return value ? '1' : '0';
		}

		if (value instanceof Date) {
			if (isNaN(value.getTime())) return 'NULL';
			return `'${value.toISOString()}'`;
		}

		if (Buffer.isBuffer(value)) {
			if (value.length === 0) return 'NULL';
			return `0x${value.toString('hex').toUpperCase()}`;
		}

		// 字串處理
		const str = value.toString();
		if (str.length === 0) {
			return "''";
		}

		const escapedStr = str.replace(/'/g, "''");
		return `N'${escapedStr}'`;
	}

	escapeIdentifier(identifier) {
		if (!identifier) return '[Unknown]';
		return `[${identifier.toString().replace(/]/g, ']]')}]`;
	}

	escapeTableName(tableName) {
		if (!tableName || typeof tableName !== 'string') {
			throw new Error('無效的資料表名稱');
		}

		// 如果已經是完整的 schema.table 格式
		if (tableName.includes('.')) {
			const parts = tableName.split('.');
			if (parts.length !== 2) {
				throw new Error(`資料表名稱格式錯誤: ${tableName}`);
			}

			const [schema, table] = parts;
			return `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`;
		}

		// 如果只有表名，假設使用 dbo schema
		return `[dbo].${this.escapeIdentifier(tableName)}`;
	}
}

module.exports = SqlServerAdapter;