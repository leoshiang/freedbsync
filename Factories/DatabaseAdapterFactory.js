const SqlServerAdapter = require('../Adapters/SqlServerAdapter');
// 未來可以加入其他資料庫適配器
// const MySqlAdapter = require('../adapters/mysql-adapter');
// const PostgreSqlAdapter = require('../adapters/postgresql-adapter');

/**
 * 資料庫適配器工廠
 * 根據設定檔案建立對應的資料庫適配器實例
 */
class DatabaseAdapterFactory {
    /**
     * 建立資料庫適配器
     * @param {string} type - 資料庫類型 ('sqlserver', 'mysql', 'postgresql')
     * @param {object} config - 資料庫連線設定
     * @param {boolean} debug - 是否啟用除錯模式
     * @returns {DatabaseAdapter} 資料庫適配器實例
     */
    static createAdapter(type, config, debug = false) {
        switch (type.toLowerCase()) {
            case 'sqlserver':
            case 'mssql':
                return new SqlServerAdapter(config, debug);

            // 未來可以擴展其他資料庫類型
            // case 'mysql':
            //     return new MySqlAdapter(config, debug);
            //
            // case 'postgresql':
            // case 'postgres':
            //     return new PostgreSqlAdapter(config, debug);

            default:
                throw new Error(`不支援的資料庫類型: ${type}`);
        }
    }

    /**
     * 取得支援的資料庫類型列表
     * @returns {string[]} 支援的資料庫類型
     */
    static getSupportedTypes() {
        return ['sqlserver', 'mssql'];
        // 未來擴展: return ['sqlserver', 'mssql', 'mysql', 'postgresql', 'postgres'];
    }
}

module.exports = DatabaseAdapterFactory;