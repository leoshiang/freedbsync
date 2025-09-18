#!/usr/bin/env node

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
const showHelp = !!argv['help'] || !!argv['h'];
const showVersion = !!argv['version'] || !!argv['v'];

// 全域 debug 設定
global.DEBUG_MODE = isDebug;

function showVersionInfo() {
    const packageJson = require('./package.json');
    console.log(`FreeDbSync v${packageJson.version}`);
    console.log(`Node.js ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
}

function showHelpMessage() {
    const packageJson = require('./package.json');
    console.log(`
資料庫同步工具 (FreeDbSync) v${packageJson.version}
=======================================

使用方法:
  freedbsync [選項]
  node index.js [選項]
  npx freedbsync [選項]

必要參數:
  --src-server       來源資料庫伺服器位址
  --src-db          來源資料庫名稱
  --src-user        來源資料庫使用者名稱
  --src-pwd         來源資料庫密碼

目標資料庫參數（非 dry-run 模式必要）:
  --dst-server      目標資料庫伺服器位址
  --dst-db          目標資料庫名稱
  --dst-user        目標資料庫使用者名稱
  --dst-pwd         目標資料庫密碼

選用參數:
  --src-type        來源資料庫類型 (預設: sqlserver)
  --src-port        來源資料庫連接埠
  --dst-type        目標資料庫類型 (預設: sqlserver)
  --dst-port        目標資料庫連接埠

執行模式:
  --dry-run         預覽模式，產生 SQL 腳本而不執行
  --compare-only    比較模式，僅處理差異項目

其他選項:
  --debug           開啟除錯模式，顯示詳細執行資訊
  --help, -h        顯示此說明訊息
  --version, -v     顯示版本資訊

範例:
  # 顯示說明
  freedbsync --help

  # 顯示版本
  freedbsync --version

  # 預覽模式 - 產生 SQL 腳本
  freedbsync --dry-run \\
    --src-server=localhost --src-db=source_db \\
    --src-user=sa --src-pwd=password

  # 實際同步
  freedbsync \\
    --src-server=localhost --src-db=source_db --src-user=sa --src-pwd=password \\
    --dst-server=localhost --dst-db=target_db --dst-user=sa --dst-pwd=password

  # 比較模式 - 只處理差異項目
  freedbsync --compare-only --dry-run \\
    --src-server=localhost --src-db=source_db --src-user=sa --src-pwd=password \\
    --dst-server=localhost --dst-db=target_db --dst-user=sa --dst-pwd=password

  # 除錯模式
  freedbsync --debug --dry-run \\
    --src-server=localhost --src-db=source_db --src-user=sa --src-pwd=password

輸出檔案:
  schema.sql        Schema 相關 SQL 腳本
  data.sql          資料複製 SQL 腳本 (非比較模式)

注意事項:
  • 比較模式需要提供目標資料庫連線參數
  • 預覽模式會在當前目錄產生 SQL 檔案
  • 支援 SQL Server 資料庫同步
  • 建議先使用預覽模式檢查產生的 SQL

更多資訊請參考: ${packageJson.homepage || 'README.md'}
`);
}

function buildConfigFromArgs() {
    // 檢查是否要顯示版本資訊
    if (showVersion) {
        showVersionInfo();
        process.exit(0);
    }

    // 檢查是否要顯示說明
    if (showHelp) {
        showHelpMessage();
        process.exit(0);
    }

    // 驗證必要參數
    const requiredSrc = ['src-server', 'src-db', 'src-user', 'src-pwd'];
    const missingSrc = requiredSrc.filter(k => !argv[k]);
    if (missingSrc.length > 0) {
        console.error('ERROR: 缺少必要的來源參數:');
        missingSrc.forEach(k => console.error(`   --${k}`));
        console.error('\n使用 --help 查看完整說明');
        process.exit(1);
    }

    // 在比較模式下，即使 dry-run 也必須提供目標連線
    const needDst = compareOnly ? true : !isDryRun;
    if (needDst) {
        const requiredDst = ['dst-server', 'dst-db', 'dst-user', 'dst-pwd'];
        const missingDst = requiredDst.filter(k => !argv[k]);
        if (missingDst.length > 0) {
            console.error('ERROR: 缺少必要的目標參數:');
            missingDst.forEach(k => console.error(`   --${k}`));
            console.error('\n使用 --help 查看完整說明');
            process.exit(1);
        }
    }

    // 建立來源資料庫配置
    const srcConfig = {
        type: (argv['src-type'] || 'sqlserver').toString(),
        user: argv['src-user'],
        password: argv['src-pwd'],
        server: argv['src-server'],
        database: argv['src-db'],
        options: {trustServerCertificate: true},
    };
    if (argv['src-port']) srcConfig.port = parseInt(argv['src-port'], 10);

    // 建立目標資料庫配置
    let dstConfig = null;
    if (needDst) {
        dstConfig = {
            type: (argv['dst-type'] || 'sqlserver').toString(),
            user: argv['dst-user'],
            password: argv['dst-pwd'],
            server: argv['dst-server'],
            database: argv['dst-db'],
            options: {trustServerCertificate: true},
        };
        if (argv['dst-port']) dstConfig.port = parseInt(argv['dst-port'], 10);
    }

    // 顯示配置資訊
    console.log('參數驗證通過');
    if (isDebug) console.log('DEBUG 模式已開啟');
    console.log(`來源資料庫: ${srcConfig.server}/${srcConfig.database}`);
    if (dstConfig) {
        console.log(`目標資料庫: ${dstConfig.server}/${dstConfig.database}`);
    }
    if (compareOnly) {
        console.log('比較模式：僅產生目標不存在或定義不同的變更 SQL（資料內容不比較）');
    }
    if (isDryRun) {
        console.log('預覽模式：將產生 SQL 腳本檔案');
    }

    return {srcConfig, dstConfig};
}

async function main() {
    const packageJson = require('./package.json');
    console.log(`資料庫同步工具 v${packageJson.version}`);
    console.log('================================');

    const {srcConfig, dstConfig} = buildConfigFromArgs();
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

            // 寫入 Schema SQL 檔案
            if (schemaBuffer.length > 0) {
                const schemaFileName = 'schema.sql';
                const schemaSql = [
                    '-- =============================================',
                    '-- 資料庫 Schema 建立/變更腳本',
                    '-- 模式: ' + (compareOnly ? '比較模式' : '完整模式'),
                    '-- 產生時間: ' + new Date().toLocaleString('zh-TW'),
                    '-- 工具版本: ' + packageJson.version,
                    '-- =============================================',
                    '',
                    ...schemaBuffer
                ].join('\n');

                await fs.writeFile(schemaFileName, schemaSql, 'utf8');
                console.log(`\nSchema SQL 已寫入: ${schemaFileName} (${schemaBuffer.length} 個指令)`);
            } else {
                console.log('\n未產生任何 Schema 相關 SQL（可能目標已與來源一致）');
            }

            // 寫入 Data SQL 檔案
            if (!compareOnly) {
                if (dataBuffer.length > 0) {
                    const dataFileName = 'data.sql';
                    const dataSql = [
                        '-- =============================================',
                        '-- 資料複製腳本',
                        '-- 產生時間: ' + new Date().toLocaleString('zh-TW'),
                        '-- 工具版本: ' + packageJson.version,
                        '-- =============================================',
                        '',
                        ...dataBuffer
                    ].join('\n');

                    await fs.writeFile(dataFileName, dataSql, 'utf8');
                    console.log(`Data SQL 已寫入: ${dataFileName} (${dataBuffer.length} 個指令)`);
                } else {
                    console.log('未產生任何資料複製 SQL');
                }
            }

            if (schemaBuffer.length === 0 && (!compareOnly && dataBuffer.length === 0)) {
                console.log('沒有產生任何 SQL 指令');
            }

            console.log('\n腳本產生完成!');

        } catch (error) {
            console.error('ERROR: Dry-run 執行失敗:', error.message);
            if (isDebug) {
                console.error('詳細錯誤:', error);
            }
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
            console.error('ERROR: 同步執行失敗:', error.message);
            if (isDebug) {
                console.error('詳細錯誤:', error);
            }
            process.exit(1);
        }
    }
}

// 處理未捕獲的異常
process.on('unhandledRejection', (reason, promise) => {
    console.error('ERROR: 未處理的 Promise 拒絕:', reason);
    if (isDebug) {
        console.error('Promise:', promise);
    }
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('ERROR: 未捕獲的異常:', error.message);
    if (isDebug) {
        console.error('詳細錯誤:', error);
    }
    process.exit(1);
});

// 處理 SIGINT (Ctrl+C)
process.on('SIGINT', () => {
    console.log('\nWARNING: 收到中斷信號，正在退出...');
    process.exit(0);
});

// 處理 SIGTERM
process.on('SIGTERM', () => {
    console.log('\nWARNING: 收到終止信號，正在退出...');
    process.exit(0);
});

// 執行主函式
main().catch((error) => {
    console.error('ERROR: 執行失敗:', error.message);
    if (isDebug) {
        console.error('詳細錯誤:', error);
    }
    process.exit(1);
});