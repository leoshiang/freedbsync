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
const compareOnly = !!argv['compare-only'];

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

    // 在比較模式下，即使 dry-run 也必須提供目標連線
    const needDst = compareOnly ? true : !isDryRun;
    if (needDst) {
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
    if (needDst) {
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
    if (dstConfig) {
        console.log(`目標資料庫: ${dstConfig.server}/${dstConfig.database}`);
    }
    if (compareOnly) {
        console.log('比較模式：僅產生目標不存在或定義不同的變更 SQL（資料內容不比較）');
    }

    return { srcConfig, dstConfig };
}

async function main() {
    console.log('資料庫同步工具');
    console.log('================');

    const { srcConfig, dstConfig } = buildConfigFromArgs();
    const srcAdapter = DatabaseAdapterFactory.createAdapter(srcConfig.type, srcConfig, isDebug);
    const dstAdapter = dstConfig ? DatabaseAdapterFactory.createAdapter(dstConfig.type, dstConfig, isDebug) : null;

    if (isDryRun) {
        console.log('Dry-run 模式：產生 SQL 腳本');

        const schemaBuffer = [];
        const dataBuffer = [];

        try {
            // Schema/物件/約束/索引：支援比較模式
            const schemaService = new SchemaService(srcAdapter, dstAdapter, schemaBuffer, isDebug, compareOnly);
            const cleanupService = new CleanupService(srcAdapter, dstAdapter, schemaBuffer, isDebug, compareOnly);
            const objectService = new ObjectService(srcAdapter, dstAdapter, schemaBuffer, isDebug, compareOnly);
            const constraintService = new ConstraintService(srcAdapter, dstAdapter, schemaBuffer, isDebug, compareOnly);
            const indexService = new IndexService(srcAdapter, dstAdapter, schemaBuffer, isDebug, compareOnly);

            // Data：比較模式略過
            const dataService = new DataService(srcAdapter, dstAdapter, dataBuffer, isDebug, compareOnly);

            console.log('\n產生 Schema 腳本...');
            await schemaService.createSchemas();

            if (!compareOnly) {
                await cleanupService.cleanupExistingObjects();
            } else {
                console.log('比較模式：略過清理腳本產生');
            }

            const sortedObjects = await objectService.sortByDependency();
            await objectService.createObjects(sortedObjects);

            await constraintService.createPrimaryKeys();
            await constraintService.createForeignKeys();

            await indexService.createIndexes();

            if (!compareOnly) {
                console.log('\n產生 Data 腳本...');
                await dataService.copyData();
            } else {
                console.log('\n比較模式：略過資料複製');
            }

            if (schemaBuffer.length > 0) {
                const schemaFileName = 'schema.sql';
                const schemaSql = [
                    '-- =============================================',
                    '-- 資料庫 Schema 建立/變更腳本',
                    '-- 模式: ' + (compareOnly ? '比較模式' : '完整模式'),
                    '-- 產生時間: ' + new Date().toLocaleString('zh-TW'),
                    '-- =============================================',
                    '',
                    ...schemaBuffer
                ].join('\n');

                await fs.writeFile(schemaFileName, schemaSql, 'utf8');
                console.log(`\nSchema SQL 已寫入: ${schemaFileName} (${schemaBuffer.length} 個指令)`);
            } else {
                console.log('\n未產生任何 Schema 相關 SQL（可能目標已與來源一致）');
            }

            if (!compareOnly) {
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
            }

            if (schemaBuffer.length === 0 && (!compareOnly && dataBuffer.length === 0)) {
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
            const schemaService = new SchemaService(srcAdapter, dstAdapter, null, isDebug, compareOnly);
            const cleanupService = new CleanupService(srcAdapter, dstAdapter, null, isDebug, compareOnly);
            const objectService = new ObjectService(srcAdapter, dstAdapter, null, isDebug, compareOnly);
            const dataService = new DataService(srcAdapter, dstAdapter, null, isDebug, compareOnly);
            const constraintService = new ConstraintService(srcAdapter, dstAdapter, null, isDebug, compareOnly);
            const indexService = new IndexService(srcAdapter, dstAdapter, null, isDebug, compareOnly);

            console.log('\n步驟 1: 建立 Schema');
            await schemaService.createSchemas();

            console.log('\n步驟 2: 建立資料庫物件');
            if (!compareOnly) {
                await cleanupService.cleanupExistingObjects();
            } else {
                console.log('比較模式：略過清理步驟');
            }

            const sortedObjects = await objectService.sortByDependency();
            await objectService.createObjects(sortedObjects);

            console.log('\n步驟 3: 複製資料');
            if (!compareOnly) {
                await dataService.copyData();
            } else {
                console.log('比較模式：略過資料複製');
            }

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