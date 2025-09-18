const DatabaseAdapterFactory = require('../Factories/DatabaseAdapterFactory');

class DatabaseConfig {
    static getSrcConfig() {
        const baseConfig = {
            user: process.env.SRC_USER,
            password: process.env.SRC_PWD,
            server: process.env.SRC_SERVER,
            database: process.env.SRC_DB,
            options: {trustServerCertificate: true}
        };

        // 檢查是否有指定 port
        if (process.env.SRC_PORT) {
            baseConfig.port = parseInt(process.env.SRC_PORT);
        }

        return {
            type: process.env.SRC_DB_TYPE || 'sqlserver',
            ...baseConfig
        };
    }

    static getDstConfig() {
        const baseConfig = {
            user: process.env.DST_USER,
            password: process.env.DST_PWD,
            server: process.env.DST_SERVER,
            database: process.env.DST_DB,
            options: {trustServerCertificate: true}
        };

        // 檢查是否有指定 port
        if (process.env.DST_PORT) {
            baseConfig.port = parseInt(process.env.DST_PORT);
        }

        return {
            type: process.env.DST_DB_TYPE || 'sqlserver',
            ...baseConfig
        };
    }

    /**
     * 建立來源資料庫適配器
     * @param {boolean} debug - 是否啟用除錯模式
     * @returns {DatabaseAdapter} 資料庫適配器實例
     */
    static createSrcAdapter(debug = false) {
        const config = this.getSrcConfig();
        const {type, ...dbConfig} = config;
        return DatabaseAdapterFactory.createAdapter(type, dbConfig, debug);
    }

    /**
     * 建立目標資料庫適配器
     * @param {boolean} debug - 是否啟用除錯模式
     * @returns {DatabaseAdapter} 資料庫適配器實例
     */
    static createDstAdapter(debug = false) {
        const config = this.getDstConfig();
        const {type, ...dbConfig} = config;
        return DatabaseAdapterFactory.createAdapter(type, dbConfig, debug);
    }

    // 保持向後相容性的舊方法
    static async withPool(config, fn) {
        // 如果 config 已經包含 type，則使用新的適配器
        if (config.type) {
            const {type, ...dbConfig} = config;
            const adapter = DatabaseAdapterFactory.createAdapter(type, dbConfig);
            return await adapter.withPool(fn);
        } else {
            // 向後相容：直接使用舊的 mssql 方式
            const mssql = require('mssql');
            const pool = new mssql.ConnectionPool(config);
            await pool.connect();
            try {
                return await fn(pool);
            } finally {
                await pool.close();
            }
        }
    }
}

module.exports = DatabaseConfig;