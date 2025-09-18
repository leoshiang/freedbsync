class SqlHelper {
    /**
     * 安全地轉義 SQL 值，處理各種資料類型和特殊字元
     * @param {*} v - 要轉義的值
     * @returns {string} - 轉義後的 SQL 字串
     */
    static escape(v) {
        // 處理 null 和 undefined
        if (v === null || v === undefined) {
            return 'NULL';
        }

        // 處理數字類型 (包含 NaN 和 Infinity)
        if (typeof v === 'number') {
            if (isNaN(v)) return 'NULL';
            if (!isFinite(v)) return 'NULL';
            return v.toString();
        }

        // 處理布林值
        if (typeof v === 'boolean') {
            return v ? '1' : '0';
        }

        // 處理日期時間
        if (v instanceof Date) {
            if (isNaN(v.getTime())) return 'NULL'; // 無效日期
            return `'${v.toISOString()}'`;
        }

        // 處理 Buffer (二進位資料)
        if (Buffer.isBuffer(v)) {
            if (v.length === 0) return 'NULL';
            return `0x${v.toString('hex').toUpperCase()}`;
        }

        // 處理字串和其他類型
        const str = v.toString();

        // 空字串處理
        if (str.length === 0) {
            return "''";
        }

        // 轉義單引號：將 ' 替換為 ''
        const escapedStr = str.replace(/'/g, "''");
        return `N'${escapedStr}'`; // 使用 N'' 支援 Unicode 字元
    }

    /**
     * 安全地轉義物件名稱 (Schema, Table, Column 等)
     * @param {string} name - 物件名稱
     * @returns {string} - 用方括號包圍的安全名稱
     */
    static escapeIdentifier(name) {
        if (!name) return '[Unknown]';
        // 將 ] 替換為 ]] (SQL Server 的方括號轉義方式)
        return `[${name.toString().replace(/]/g, ']]')}]`;
    }

    /**
     * 驗證並清理資料表名稱
     * @param {string} tableName - 資料表名稱 (schema.table 格式)
     * @returns {string} - 安全的資料表名稱
     */
    static escapeTableName(tableName) {
        if (!tableName || typeof tableName !== 'string') {
            throw new Error('無效的資料表名稱');
        }

        const parts = tableName.split('.');
        if (parts.length !== 2) {
            throw new Error(`資料表名稱格式錯誤: ${tableName}`);
        }

        const [schema, table] = parts;
        return `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`;
    }

    /**
     * 產生安全的批次 INSERT 語句（支援 IDENTITY 欄位）
     * @param {string} tableName - 資料表名稱
     * @param {Array} rows - 資料列陣列
     * @param {boolean} hasIdentityColumn - 是否有 IDENTITY 欄位
     * @param {number} batchSize - 批次大小
     * @returns {Array<string>} - INSERT 語句陣列
     */
    static generateBatchInserts(tableName, rows, hasIdentityColumn = false, batchSize = 1000) {
        if (!rows || rows.length === 0) return [];

        const safeTableName = this.escapeTableName(tableName);
        const columns = Object.keys(rows[0]);
        const columnList = columns.map(this.escapeIdentifier).join(', ');

        const batches = [];

        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);

            const valuesList = batch.map(row => {
                const values = columns.map(col => this.escape(row[col])).join(', ');
                return `(${values})`;
            }).join(',\n    ');

            let sql = '';

            // 如果有 IDENTITY 欄位，需要先設定 IDENTITY_INSERT
            if (hasIdentityColumn) {
                sql += `SET IDENTITY_INSERT ${safeTableName} ON;\n`;
            }

            sql += `INSERT INTO ${safeTableName} (${columnList})
                    VALUES ${valuesList};`;

            // 如果有 IDENTITY 欄位，需要關閉 IDENTITY_INSERT
            if (hasIdentityColumn) {
                sql += `\nSET IDENTITY_INSERT ${safeTableName} OFF;`;
            }

            batches.push(sql);
        }

        return batches;
    }
}

module.exports = SqlHelper;