const DatabaseConfig = require('../Config/DatabaseConfig');

class ConstraintService {
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

    async readPrimaryKeys() {
        return await this.srcAdapter.readPrimaryKeys();
    }

    async readForeignKeys() {
        return await this.srcAdapter.readForeignKeys();
    }

    async createPrimaryKeys() {
        try {
            const primaryKeys = await this.readPrimaryKeys();

            if (primaryKeys.length === 0) {
                console.log('沒有 Primary Key 需要建立');
                return;
            }

            console.log(`發現 ${primaryKeys.length} 個 Primary Key`);

            if (this.isDryRun) {
                this.pushSql(`-- 建立 Primary Key 約束\n`);
                this.pushSql(`-- =============================================\n\n`);
                primaryKeys.forEach(pk => {
                    this.pushSql(`-- Primary Key: ${pk.schema_name}.${pk.table_name}.${pk.constraint_name}\n`);
                    this.pushSql(`${pk.create_statement};\nGO\n\n`);
                });
            } else {
                let successCount = 0;
                let failureCount = 0;

                for (const pk of primaryKeys) {
                    const displayInfo = `${pk.schema_name}.${pk.table_name}.${pk.constraint_name}`;

                    try {
                        await this.dstAdapter.executeQuery(pk.create_statement);
                        console.log(`  建立 Primary Key: ${displayInfo} ✓`);
                        successCount++;
                    } catch (err) {
                        console.log(`  建立 Primary Key: ${displayInfo} ✗ 失敗: ${err.message}`);
                        failureCount++;
                    }
                }

                console.log(`\nPrimary Key 建立完成 - 總計: ${primaryKeys.length}, 成功: ${successCount}, 失敗: ${failureCount}`);
            }
        } catch (err) {
            console.error('讀取 Primary Key 資訊失敗:', err.message);
            console.log('跳過 Primary Key 建立步驟');
        }
    }

    async createForeignKeys() {
        try {
            const foreignKeys = await this.readForeignKeys();

            if (foreignKeys.length === 0) {
                console.log('沒有 Foreign Key 需要建立');
                return;
            }

            console.log(`發現 ${foreignKeys.length} 個 Foreign Key`);

            if (this.isDryRun) {
                this.pushSql(`-- 建立 Foreign Key 約束\n`);
                this.pushSql(`-- =============================================\n\n`);
                foreignKeys.forEach(fk => {
                    this.pushSql(`-- Foreign Key: ${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}\n`);
                    this.pushSql(`${fk.create_statement};\nGO\n\n`);
                });
            } else {
                let successCount = 0;
                let failureCount = 0;

                for (const fk of foreignKeys) {
                    const displayInfo = `${fk.schema_name}.${fk.parent_table}.${fk.constraint_name}`;

                    try {
                        await this.dstAdapter.executeQuery(fk.create_statement);
                        console.log(`  建立 Foreign Key: ${displayInfo} ✓`);
                        successCount++;
                    } catch (err) {
                        console.log(`  建立 Foreign Key: ${displayInfo} ✗ 失敗: ${err.message}`);
                        failureCount++;
                    }
                }

                console.log(`\nForeign Key 建立完成 - 總計: ${foreignKeys.length}, 成功: ${successCount}, 失敗: ${failureCount}`);
            }
        } catch (err) {
            console.error('讀取 Foreign Key 資訊失敗:', err.message);
            console.log('跳過 Foreign Key 建立步驟');
        }
    }
}

module.exports = ConstraintService;