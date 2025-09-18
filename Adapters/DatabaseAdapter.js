/**
 * 資料庫適配器抽象基類
 * 定義所有資料庫操作的統一介面
 */
class DatabaseAdapter {
    constructor(config, debug = false) {
        this.config = config;
        this.debug = debug;
    }

    debugLog(message, sql = null) {
        if (this.debug) {
            console.log(`[DEBUG] ${message}`);
            if (sql) {
                console.log(`[SQL] ${sql.trim()}`);
            }
        }
    }

    // 連接池管理
    async withPool(fn) {
        throw new Error('withPool method must be implemented');
    }

    // Schema 相關操作
    async readSchemas() {
        throw new Error('readSchemas method must be implemented');
    }

    async createSchema(schemaName) {
        throw new Error('createSchema method must be implemented');
    }

    async checkSchemaExists(schemaName) {
        throw new Error('checkSchemaExists method must be implemented');
    }

    // 物件相關操作
    async readObjects() {
        throw new Error('readObjects method must be implemented');
    }

    async readObjectDependencies() {
        throw new Error('readObjectDependencies method must be implemented');
    }

    async generateTableCreateStatement(schemaName, tableName) {
        throw new Error('generateTableCreateStatement method must be implemented');
    }

    // 約束相關操作
    async readPrimaryKeys() {
        throw new Error('readPrimaryKeys method must be implemented');
    }

    async readForeignKeys() {
        throw new Error('readForeignKeys method must be implemented');
    }

    // 索引相關操作
    async readIndexes() {
        throw new Error('readIndexes method must be implemented');
    }

    // 資料相關操作
    async readTables() {
        throw new Error('readTables method must be implemented');
    }

    async readTableData(schemaName, tableName) {
        throw new Error('readTableData method must be implemented');
    }

    async readTableDataCount(schemaName, tableName) {
        throw new Error('readTableDataCount method must be implemented');
    }

    async checkIdentityColumn(schemaName, tableName) {
        throw new Error('checkIdentityColumn method must be implemented');
    }

    // 清理相關操作
    async readExistingForeignKeys() {
        throw new Error('readExistingForeignKeys method must be implemented');
    }

    async readExistingIndexes() {
        throw new Error('readExistingIndexes method must be implemented');
    }

    async readExistingObjects() {
        throw new Error('readExistingObjects method must be implemented');
    }

    // SQL 語句產生
    generateDropForeignKeyStatement(schemaName, tableName, constraintName) {
        throw new Error('generateDropForeignKeyStatement method must be implemented');
    }

    generateDropIndexStatement(schemaName, tableName, indexName) {
        throw new Error('generateDropIndexStatement method must be implemented');
    }

    generateDropObjectStatement(schemaName, objectName, objectType) {
        throw new Error('generateDropObjectStatement method must be implemented');
    }

    generateBatchInserts(tableName, rows, hasIdentityColumn, batchSize) {
        throw new Error('generateBatchInserts method must be implemented');
    }

    // 執行 SQL
    async executeQuery(sql) {
        throw new Error('executeQuery method must be implemented');
    }

    async executeBatch(sql) {
        throw new Error('executeBatch method must be implemented');
    }

    // SQL 輔助方法
    escapeValue(value) {
        throw new Error('escapeValue method must be implemented');
    }

    escapeIdentifier(identifier) {
        throw new Error('escapeIdentifier method must be implemented');
    }
}

module.exports = DatabaseAdapter;