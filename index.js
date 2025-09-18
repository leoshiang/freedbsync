const fs = require('fs').promises;
const minimist = require('minimist');
const SchemaService = require('./Services/SchemaService');
const ObjectService = require('./Services/ObjectService');
const DataService = require('./Services/DataService');
const ConstraintService = require('./Services/ConstraintService');
const IndexService = require('./Services/IndexService');
const CleanupService = require('./Services/CleanupService');
const DatabaseAdapterFactory = require('./Factories/DatabaseAdapterFactory');

const argv = minimist(process.argv.slice(2));
const isDryRun = !!argv['dry-run'];
const isDebug = !!argv['debug'];

// 全域 debug 設定
global.DEBUG_MODE = isDebug;

function buildConfigFromArgs() {
    const requiredSrc = ['src-server', 'src-db', 'src-user', 'src-pwd'];
    const missingSrc = requiredSrc.filter(k => !argv[k]);
    if (missingSrc.length > 0) {
        console.error('缺少必要的來源參數:');
        missingSrc.forEach(k => console.error(`  --${k}`));
        process.exit(1);
    }

    if (!isDryRun) {
        const requiredDst = ['dst-server', 'dst-db', 'dst-user', 'dst-pwd'];
        const missingDst = requiredDst.filter(k => !argv[k]);
        if (missingDst.length > 0) {
            console.error('缺少必要的目標參數:');
            missingDst.forEach(k => console.error(`  --${k}`));
            process.exit(1);
        }
    }

    const srcConfig = {
        type: (argv['src-type'] || 'sqlserver').toString(),
        user: argv['src-user'],
        password: argv['src-pwd'],
        server: argv['src-server'],
        database: argv['src-db'],
        options: { trustServerCertificate: true },
    };
    if (argv['src-port']) srcConfig.port = parseInt(argv['src-port'], 10);

    let dstConfig = null;
    if (!isDryRun) {
        dstConfig = {
            type: (argv['dst-type'] || 'sqlserver').toString(),
            user: argv['dst-user'],
            password: argv['dst-pwd'],
            server: argv['dst-server'],
            database: argv['dst-db'],
            options: { trustServerCertificate: true },
        };
        if (argv['dst-port']) dstConfig.port = parseInt(argv['dst-port'], 10);
    }

    console.log('參數驗證通過');
    if (isDebug) console.log('DEBUG 模式已開啟');
    console.log(`來源資料庫: ${srcConfig.server}/${srcConfig.database}`);
    if (!isDryRun && dstConfig) {
        console.log(`目標資料庫: ${dstConfig.server}/${dstConfig.database}`);
    }

    return { srcConfig, dstConfig };
}

async function main() {
    console.log('資料庫同步工具');
    console.log('================');

    // 參數 -> adapter
    const { srcConfig, dstConfig } = buildConfigFromArgs();
    const srcAdapter = DatabaseAdapterFactory.createAdapter(srcConfig.type, srcConfig, isDebug);
    const dstAdapter = isDryRun ? null : DatabaseAdapterFactory.createAdapter(dstConfig.type, dstConfig, isDebug);

    if (isDryRun) {
        console.log('Dry-run 模式：產生 SQL 腳本');

        // 建立兩個 SQL buffer，分別用於 schema 和 data
        const schemaBuffer = [];
        const dataBuffer = [];

        try {
            // Schema 相關服務
            const schemaService = new SchemaService(srcAdapter, dstAdapter, schemaBuffer, isDebug);
            const cleanupService = new CleanupService(srcAdapter, dstAdapter, schemaBuffer, isDebug);
            const objectService = new ObjectService(srcAdapter, dstAdapter, schemaBuffer, isDebug);
            const constraintService = new ConstraintService(srcAdapter, dstAdapter, schemaBuffer, isDebug);
            const indexService = new IndexService(srcAdapter, dstAdapter, schemaBuffer, isDebug);

            // Data 相關服務
            const dataService = new DataService(srcAdapter, dstAdapter, dataBuffer, isDebug);

            console.log('\n產生 Schema 腳本...');

            // 1. 建立 Schema
            await schemaService.createSchemas();

            // 2. 清理現有物件 (Dry-run 模式只產生註解)
            await cleanupService.cleanupExistingObjects();

            // 3. 建立物件（資料表、檢視表、函數、預存程序）
            const sortedObjects = await objectService.sortByDependency();
            await objectService.createObjects(sortedObjects);

            // 4. 建立約束
            await constraintService.createPrimaryKeys();
            await constraintService.createForeignKeys();

            // 5. 建立索引
            await indexService.createIndexes();

            console.log('\n產生 Data 腳本...');

            // 6. 複製資料
            await dataService.copyData();

            // 寫入 Schema SQL 檔案
            if (schemaBuffer.length > 0) {
                const schemaFileName = 'schema.sql';
                const schemaSql = [
                    '-- =============================================',
                    '-- 資料庫 Schema 建立腳本',
                    '-- 產生時間: ' + new Date().toLocaleString('zh-TW'),
                    '-- =============================================',
                    '',
                    ...schemaBuffer
                ].join('\n');

                await fs.writeFile(schemaFileName, schemaSql, 'utf8');
                console.log(`\nSchema SQL 已寫入: ${schemaFileName} (${schemaBuffer.length} 個指令)`);
            }

            // 寫入 Data SQL 檔案
            if (dataBuffer.length > 0) {
                const dataFileName = 'data.sql';
                const dataSql = [
                    '-- =============================================',
                    '-- 資料複製腳本',
                    '-- 產生時間: ' + new Date().toLocaleString('zh-TW'),
                    '-- =============================================',
                    '',
                    ...dataBuffer
                ].join('\n');

                await fs.writeFile(dataFileName, dataSql, 'utf8');
                console.log(`Data SQL 已寫入: ${dataFileName} (${dataBuffer.length} 個指令)`);
            }

            if (schemaBuffer.length === 0 && dataBuffer.length === 0) {
                console.log('沒有產生任何 SQL 指令');
            }

        } catch (error) {
            console.error('Dry-run 執行失敗:', error.message);
            console.error('詳細錯誤:', error);
            process.exit(1);
        }

    } else {
        console.log('實際執行模式：直接同步到目標資料庫');

        try {
            // 實際執行服務
            const schemaService = new SchemaService(srcAdapter, dstAdapter, null, isDebug);
            const cleanupService = new CleanupService(srcAdapter, dstAdapter, null, isDebug);
            const objectService = new ObjectService(srcAdapter, dstAdapter, null, isDebug);
            const dataService = new DataService(srcAdapter, dstAdapter, null, isDebug);
            const constraintService = new ConstraintService(srcAdapter, dstAdapter, null, isDebug);
            const indexService = new IndexService(srcAdapter, dstAdapter, null, isDebug);

            console.log('\n步驟 1: 建立 Schema');
            await schemaService.createSchemas();

            console.log('\n步驟 2: 建立資料庫物件');
            // 2a. 清理現有物件 (Foreign Key -> 索引 -> 物件)
            await cleanupService.cleanupExistingObjects();

            // 2b. 建立新物件
            const sortedObjects = await objectService.sortByDependency();
            await objectService.createObjects(sortedObjects);

            console.log('\n步驟 3: 複製資料');
            await dataService.copyData();

            console.log('\n步驟 4: 建立約束');
            await constraintService.createPrimaryKeys();
            await constraintService.createForeignKeys();

            console.log('\n步驟 5: 建立索引');
            await indexService.createIndexes();

            console.log('\n資料庫同步完成!');

        } catch (error) {
            console.error('同步執行失敗:', error.message);
            console.error('詳細錯誤:', error);
            process.exit(1);
        }
    }
}

main().catch(console.error);