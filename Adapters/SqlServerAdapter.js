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

    // 新增：取得表格欄位資訊用於比較
    async getTableColumns(schemaName, tableName) {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT c.name                        AS column_name,
                       t.name                        AS data_type,
                       c.max_length,
                       c.precision,
                       c.scale,
                       c.is_nullable,
                       c.is_identity,
                       c.column_id,
                       ISNULL(ic.seed_value, 1)      AS seed_value,
                       ISNULL(ic.increment_value, 1) AS increment_value,
                       dc.definition                 AS default_constraint,
                       dc.name                       AS default_constraint_name
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

            const {recordset} = await pool.request()
                .input('schemaName', mssql.NVarChar, schemaName)
                .input('tableName', mssql.NVarChar, tableName)
                .query(sql);

            return recordset || [];
        });
    }

    // 新增：產生欄位的完整定義字串用於比較
    formatColumnDefinition(col) {
        let def = `[${col.column_name}] [${col.data_type}]`;

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
    }

    // 新增：產生 ALTER TABLE 語句來添加欄位
    generateAddColumnStatement(schemaName, tableName, columnDefinition) {
        return `ALTER TABLE [${schemaName}].[${tableName}] ADD ${columnDefinition}`;
    }

    // 新增：產生 ALTER TABLE 語句來修改欄位
    generateAlterColumnStatement(schemaName, tableName, col) {
        let def = `[${col.data_type}]`;

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

        def += col.is_nullable ? ' NULL' : ' NOT NULL';

        return `ALTER TABLE [${schemaName}].[${tableName}] ALTER COLUMN [${col.column_name}] ${def}`;
    }

    // 新增：產生 ALTER TABLE 語句來刪除欄位
    generateDropColumnStatement(schemaName, tableName, columnName) {
        return `ALTER TABLE [${schemaName}].[${tableName}] DROP COLUMN [${columnName}]`;
    }

    // 新增：產生刪除預設約束語句
    generateDropDefaultConstraintStatement(schemaName, tableName, constraintName) {
        return `ALTER TABLE [${schemaName}].[${tableName}] DROP CONSTRAINT [${constraintName}]`;
    }

    // 新增：產生添加預設約束語句
    generateAddDefaultConstraintStatement(schemaName, tableName, columnName, defaultValue) {
        const constraintName = `DF_${tableName}_${columnName}`;
        return `ALTER TABLE [${schemaName}].[${tableName}] ADD CONSTRAINT [${constraintName}] DEFAULT ${defaultValue} FOR [${columnName}]`;
    }

    // 新增：檢查欄位是否有相依約束或索引
    async getColumnDependencies(schemaName, tableName, columnName) {
        return this.withPool(async (pool) => {
            const sql = `
                -- 檢查 Foreign Key 約束
                SELECT 'FOREIGN_KEY' AS dependency_type, 
                       fk.name AS dependency_name,
                       'ALTER TABLE [' + SCHEMA_NAME(fk.schema_id) + '].[' + tp.name + '] DROP CONSTRAINT [' + fk.name + ']' AS drop_statement
                FROM sys.foreign_keys fk
                INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
                WHERE tp.schema_id = SCHEMA_ID(@schemaName)
                  AND tp.name = @tableName 
                  AND c.name = @columnName
                
                UNION ALL
                
                -- 檢查 Check 約束
                SELECT 'CHECK_CONSTRAINT' AS dependency_type,
                       cc.name AS dependency_name,
                       'ALTER TABLE [' + @schemaName + '].[' + @tableName + '] DROP CONSTRAINT [' + cc.name + ']' AS drop_statement
                FROM sys.check_constraints cc
                INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
                WHERE t.schema_id = SCHEMA_ID(@schemaName)
                  AND t.name = @tableName
                  AND cc.definition LIKE '%[' + @columnName + ']%'
                
                UNION ALL
                
                -- 檢查索引（包含該欄位的索引）
                SELECT 'INDEX' AS dependency_type,
                       i.name AS dependency_name,
                       'DROP INDEX [' + i.name + '] ON [' + @schemaName + '].[' + @tableName + ']' AS drop_statement
                FROM sys.indexes i
                INNER JOIN sys.tables t ON i.object_id = t.object_id
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE t.schema_id = SCHEMA_ID(@schemaName)
                  AND t.name = @tableName
                  AND c.name = @columnName
                  AND i.is_primary_key = 0
                  AND i.type > 0
                
                UNION ALL
                
                -- 檢查 Primary Key 約束
                SELECT 'PRIMARY_KEY' AS dependency_type,
                       i.name AS dependency_name,
                       'ALTER TABLE [' + @schemaName + '].[' + @tableName + '] DROP CONSTRAINT [' + i.name + ']' AS drop_statement
                FROM sys.indexes i
                INNER JOIN sys.tables t ON i.object_id = t.object_id
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE t.schema_id = SCHEMA_ID(@schemaName)
                  AND t.name = @tableName
                  AND c.name = @columnName
                  AND i.is_primary_key = 1
                
                UNION ALL
                
                -- 檢查 Unique 約束
                SELECT 'UNIQUE_CONSTRAINT' AS dependency_type,
                       kc.name AS dependency_name,
                       'ALTER TABLE [' + @schemaName + '].[' + @tableName + '] DROP CONSTRAINT [' + kc.name + ']' AS drop_statement
                FROM sys.key_constraints kc
                INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
                INNER JOIN sys.indexes i ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE t.schema_id = SCHEMA_ID(@schemaName)
                  AND t.name = @tableName
                  AND c.name = @columnName
                  AND kc.type = 'UQ'
            `;

            const {recordset} = await pool.request()
                .input('schemaName', mssql.NVarChar, schemaName)
                .input('tableName', mssql.NVarChar, tableName)
                .input('columnName', mssql.NVarChar, columnName)
                .query(sql);

            return recordset || [];
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
				GROUP BY i.object_id, i.name, t.schema_id, t.name, i.type
				ORDER BY SCHEMA_NAME(t.schema_id), t.name, i.name
            `;

            this.debugLog('讀取主鍵約束', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    async readForeignKeys() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT fk.name COLLATE DATABASE_DEFAULT                                     AS constraint_name,
                       SCHEMA_NAME(fk.schema_id) COLLATE DATABASE_DEFAULT                  AS schema_name,
                       tp.name COLLATE DATABASE_DEFAULT                                    AS parent_table,
                       tr.name COLLATE DATABASE_DEFAULT                                    AS referenced_table,
                       SCHEMA_NAME(tr.schema_id) COLLATE DATABASE_DEFAULT                  AS referenced_schema,
                       STRING_AGG(cp.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS parent_columns,
                       STRING_AGG(cr.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS referenced_columns,
                    'ALTER TABLE [' + SCHEMA_NAME (fk.schema_id) + '].[' + tp.name + '] ADD CONSTRAINT [' + fk.name + '] FOREIGN KEY (' +
                    STRING_AGG(cp.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) + ') REFERENCES [' +
                    SCHEMA_NAME(tr.schema_id) + '].[' + tr.name + '] (' +
                    STRING_AGG(cr.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) + ')' AS create_statement
                FROM sys.foreign_keys fk
                    INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
                    INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
                    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                    INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
                    INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
                GROUP BY fk.object_id, fk.name, fk.schema_id, tp.name, tr.name, tr.schema_id
                ORDER BY SCHEMA_NAME(fk.schema_id), tp.name, fk.name
            `;

            this.debugLog('讀取外鍵約束', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    async readUniqueConstraints() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT kc.name COLLATE DATABASE_DEFAULT                       AS constraint_name,
                       SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT      AS schema_name,
                       t.name COLLATE DATABASE_DEFAULT                        AS table_name,
                       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS column_list,
                               'ALTER TABLE [' + SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT + '].[' +
                               t.name COLLATE DATABASE_DEFAULT + '] ADD CONSTRAINT [' +
                               kc.name COLLATE DATABASE_DEFAULT + '] UNIQUE (' +
                               STRING_AGG(c.name COLLATE DATABASE_DEFAULT +
                                          CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ')
                                          WITHIN GROUP (ORDER BY ic.key_ordinal) + ')' AS create_statement
                FROM sys.key_constraints kc
                    INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
                    INNER JOIN sys.indexes i ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id
                    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE kc.type = 'UQ'
                GROUP BY kc.object_id, kc.name, t.schema_id, t.name
                ORDER BY SCHEMA_NAME(t.schema_id), t.name, kc.name
            `;

            this.debugLog('讀取唯一約束', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    // 索引相關操作
    async readIndexes() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT i.name COLLATE DATABASE_DEFAULT                      AS index_name,
                       SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT    AS schema_name,
                       t.name COLLATE DATABASE_DEFAULT                      AS table_name,
                       CASE i.type
                           WHEN 1 THEN 'CLUSTERED'
                           WHEN 2 THEN 'NONCLUSTERED'
                           ELSE 'OTHER' END                                  AS index_type,
                       i.is_unique,
                       STRING_AGG(c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ')
                           WITHIN GROUP (ORDER BY ic.key_ordinal) AS column_list,
                       'CREATE ' + CASE WHEN i.is_unique = 1 THEN 'UNIQUE ' ELSE '' END +
                       CASE i.type WHEN 1 THEN 'CLUSTERED' WHEN 2 THEN 'NONCLUSTERED' ELSE '' END +
                       ' INDEX [' + i.name + '] ON [' + SCHEMA_NAME(t.schema_id) + '].[' + t.name + '] (' +
                       STRING_AGG(c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END, ', ')
                                    WITHIN GROUP (ORDER BY ic.key_ordinal) + ')' AS create_statement
                FROM sys.indexes i
                         INNER JOIN sys.tables t ON i.object_id = t.object_id
                         INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                         INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.is_primary_key = 0
                  AND i.is_unique_constraint = 0
                  AND i.type > 0
                  AND i.name IS NOT NULL
                GROUP BY i.object_id, i.name, t.schema_id, t.name, i.type, i.is_unique
                ORDER BY SCHEMA_NAME(t.schema_id), t.name, i.name
            `;

            this.debugLog('讀取索引', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    // 清理相關操作 - 讀取現有物件以便刪除
    async readExistingObjects() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT RTRIM(o.type) AS type,
                       RTRIM(s.name) AS schema_name,
                       RTRIM(o.name) AS name
                FROM sys.objects o
                         JOIN sys.schemas s ON s.schema_id = o.schema_id
                WHERE RTRIM(o.type) IN ('FN', 'TF', 'IF', 'P', 'V', 'U')
                ORDER BY CASE RTRIM(o.type)
                             WHEN 'FN' THEN 1
                             WHEN 'TF' THEN 1
                             WHEN 'IF' THEN 1
                             WHEN 'P' THEN 2
                             WHEN 'V' THEN 3
                             WHEN 'U' THEN 4
                             END, s.name, o.name
            `;

            this.debugLog('讀取現有物件', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    async readExistingForeignKeys() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT fk.name COLLATE DATABASE_DEFAULT                    AS constraint_name,
                       SCHEMA_NAME(fk.schema_id) COLLATE DATABASE_DEFAULT AS schema_name,
                       tp.name COLLATE DATABASE_DEFAULT                   AS parent_table
                FROM sys.foreign_keys fk
                         INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
                ORDER BY SCHEMA_NAME(fk.schema_id), tp.name, fk.name
            `;

            this.debugLog('讀取現有外鍵約束', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    async readExistingIndexes() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT i.name COLLATE DATABASE_DEFAULT                   AS index_name,
                       SCHEMA_NAME(t.schema_id) COLLATE DATABASE_DEFAULT AS schema_name,
                       t.name COLLATE DATABASE_DEFAULT                   AS table_name
                FROM sys.indexes i
                         INNER JOIN sys.tables t ON i.object_id = t.object_id
                WHERE i.is_primary_key = 0
                  AND i.is_unique_constraint = 0
                  AND i.type > 0
                  AND i.name IS NOT NULL
                ORDER BY SCHEMA_NAME(t.schema_id), t.name, i.name
            `;

            this.debugLog('讀取現有索引', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    // 資料相關操作 - 這些是關鍵的缺失方法！
    async readTables() {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT SCHEMA_NAME(schema_id) AS schema_name,
                       name                   AS table_name
                FROM sys.tables
                ORDER BY SCHEMA_NAME(schema_id), name
            `;

            this.debugLog('讀取資料表清單', sql);
            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    async readTableDataCount(schemaName, tableName) {
        return this.withPool(async (pool) => {
            const sql = `SELECT COUNT(*) AS total_count FROM [${schemaName}].[${tableName}]`;

            this.debugLog(`讀取資料表資料筆數: ${schemaName}.${tableName}`, sql);

            const {recordset} = await pool.request().query(sql);
            return recordset[0].total_count;
        });
    }

    async checkIdentityColumn(schemaName, tableName) {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT COUNT(*) AS identity_count
                FROM sys.identity_columns ic
                INNER JOIN sys.objects o ON ic.object_id = o.object_id
                INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
                WHERE s.name = @schemaName
                  AND o.name = @tableName
            `;

            this.debugLog(`檢查 IDENTITY 欄位: ${schemaName}.${tableName}`, sql);

            const {recordset} = await pool.request()
                .input('schemaName', mssql.NVarChar, schemaName)
                .input('tableName', mssql.NVarChar, tableName)
                .query(sql);

            return recordset[0].identity_count > 0;
        });
    }

    generateBatchInserts(tableName, rows, hasIdentityColumn, batchSize = 1000) {
        if (!rows || rows.length === 0) {
            return [];
        }

        const batches = [];

        // 獲取欄位名稱
        const columns = Object.keys(rows[0]);
        const columnList = columns.map(col => `[${col}]`).join(', ');

        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);

            const valuesList = batch.map(row => {
                const values = columns.map(col => {
                    const value = row[col];
                    return this.escapeValue(value);
                }).join(', ');

                return `(${values})`;
            }).join(',\n    ');

            let sql = '';

            if (hasIdentityColumn) {
                sql += `SET IDENTITY_INSERT ${tableName} ON;\n`;
            }

            sql += `INSERT INTO ${tableName} (${columnList})
VALUES
    ${valuesList};`;

            if (hasIdentityColumn) {
                sql += `\nSET IDENTITY_INSERT ${tableName} OFF;`;
            }

            batches.push(sql);
        }

        return batches;
    }

    async readTableData(schemaName, tableName) {
        return this.withPool(async (pool) => {
            const sql = `SELECT * FROM [${schemaName}].[${tableName}]`;

            this.debugLog(`讀取資料表資料: ${schemaName}.${tableName}`, sql);

            const {recordset} = await pool.request().query(sql);
            return recordset;
        });
    }

    async readTableColumns(schemaName, tableName) {
        return this.withPool(async (pool) => {
            const sql = `
                SELECT c.name AS column_name,
                       c.is_identity
                FROM sys.columns c
                         INNER JOIN sys.objects o ON c.object_id = o.object_id
                         INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
                WHERE s.name = @schemaName
                  AND o.name = @tableName
                ORDER BY c.column_id
            `;

            this.debugLog(`讀取資料表欄位: ${schemaName}.${tableName}`, sql);

            const {recordset} = await pool.request()
                .input('schemaName', mssql.NVarChar, schemaName)
                .input('tableName', mssql.NVarChar, tableName)
                .query(sql);

            return recordset;
        });
    }

    // DROP 語句產生
    generateDropObjectStatement(schemaName, objectName, objectType) {
        const typeMap = {
            'U': 'TABLE',
            'V': 'VIEW',
            'P': 'PROCEDURE',
            'FN': 'FUNCTION',
            'TF': 'FUNCTION',
            'IF': 'FUNCTION'
        };

        const dropType = typeMap[objectType];
        if (!dropType) {
            console.warn(`未知的物件類型: ${objectType}`);
            return null;
        }

        return `IF EXISTS (SELECT 1 FROM sys.objects WHERE name = '${objectName}' AND schema_id = SCHEMA_ID('${schemaName}'))
    DROP ${dropType} [${schemaName}].[${objectName}]`;
    }

    generateDropForeignKeyStatement(schemaName, tableName, constraintName) {
        return `ALTER TABLE [${schemaName}].[${tableName}] DROP CONSTRAINT [${constraintName}]`;
    }

    generateDropIndexStatement(schemaName, tableName, indexName) {
        return `DROP INDEX [${indexName}] ON [${schemaName}].[${tableName}]`;
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