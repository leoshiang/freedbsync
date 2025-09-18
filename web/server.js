const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const SchemaService = require('../Services/SchemaService');
const ObjectService = require('../Services/ObjectService');
const DataService = require('../Services/DataService');
const ConstraintService = require('../Services/ConstraintService');
const IndexService = require('../Services/IndexService');
const CleanupService = require('../Services/CleanupService');
const DatabaseAdapterFactory = require('../Factories/DatabaseAdapterFactory');

class WebServer {
    constructor(port = 3000) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname)));
    }

    setupRoutes() {
        // 提供主頁面
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        // API 路由
        this.app.post('/api/test-connection', async (req, res) => {
            try {
                const { config } = req.body;
                const adapter = DatabaseAdapterFactory.createAdapter(config.type, config, false);

                // 測試連線
                await adapter.connect();
                await adapter.disconnect();

                res.json({ success: true, message: '連線成功！' });
            } catch (error) {
                res.status(400).json({ success: false, message: error.message });
            }
        });

        // 獲取資料庫物件列表
        this.app.post('/api/get-objects', async (req, res) => {
            try {
                const { config } = req.body;
                const adapter = DatabaseAdapterFactory.createAdapter(config.type, config, false);
                const objectService = new ObjectService(adapter, null, null, false, false);

                const objects = await objectService.readObjects();
                res.json({ success: true, objects });
            } catch (error) {
                res.status(400).json({ success: false, message: error.message });
            }
        });
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log('客戶端已連接:', socket.id);

            // 攔截 console.log 並發送到客戶端
            const originalConsoleLog = console.log;
            const originalConsoleError = console.error;
            const originalConsoleWarn = console.warn;

            const logToSocket = (type, ...args) => {
                const message = args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                ).join(' ');

                socket.emit('console-log', {
                    type: type,
                    message: message,
                    timestamp: new Date().toLocaleTimeString('zh-TW')
                });
            };

            // 重新定義 console 方法
            console.log = (...args) => {
                originalConsoleLog(...args);
                logToSocket('info', ...args);
            };

            console.error = (...args) => {
                originalConsoleError(...args);
                logToSocket('error', ...args);
            };

            console.warn = (...args) => {
                originalConsoleWarn(...args);
                logToSocket('warning', ...args);
            };

            // 處理同步請求
            socket.on('start-sync', async (data) => {
                try {
                    const { srcConfig, dstConfig, options } = data;

                    socket.emit('sync-status', {
                        type: 'info',
                        message: '開始資料庫同步...',
                        progress: 0
                    });

                    await this.performSync(srcConfig, dstConfig, options, socket);

                    socket.emit('sync-status', {
                        type: 'success',
                        message: '同步完成！',
                        progress: 100
                    });

                } catch (error) {
                    socket.emit('sync-status', {
                        type: 'error',
                        message: `同步失敗: ${error.message}`
                    });
                }
            });

            // 處理預覽請求
            socket.on('generate-preview', async (data) => {
                try {
                    const { srcConfig, dstConfig, options } = data;

                    socket.emit('preview-status', {
                        type: 'info',
                        message: '產生預覽 SQL...',
                        progress: 0
                    });

                    const result = await this.generatePreviewSQL(srcConfig, dstConfig, options, socket);

                    socket.emit('preview-result', result);

                } catch (error) {
                    socket.emit('preview-status', {
                        type: 'error',
                        message: `產生預覽失敗: ${error.message}`
                    });
                }
            });

            socket.on('disconnect', () => {
                console.log('客戶端已斷線:', socket.id);

                // 恢復原始的 console 方法
                console.log = originalConsoleLog;
                console.error = originalConsoleError;
                console.warn = originalConsoleWarn;
            });
        });
    }

    async performSync(srcConfig, dstConfig, options, socket) {
        const srcAdapter = DatabaseAdapterFactory.createAdapter(srcConfig.type, srcConfig, options.debug);
        const dstAdapter = dstConfig ? DatabaseAdapterFactory.createAdapter(dstConfig.type, dstConfig, options.debug) : null;

        // 建立服務實例
        const schemaService = new SchemaService(srcAdapter, dstAdapter, null, options.debug, options.compareOnly);
        const cleanupService = new CleanupService(srcAdapter, dstAdapter, null, options.debug, options.compareOnly);
        const objectService = new ObjectService(srcAdapter, dstAdapter, null, options.debug, options.compareOnly);
        const dataService = new DataService(srcAdapter, dstAdapter, null, options.debug, options.compareOnly);
        const constraintService = new ConstraintService(srcAdapter, dstAdapter, null, options.debug, options.compareOnly);
        const indexService = new IndexService(srcAdapter, dstAdapter, null, options.debug, options.compareOnly);

        // 執行同步步驟
        socket.emit('sync-status', { type: 'info', message: '步驟 1: 建立 Schema', progress: 10 });
        await schemaService.createSchemas();

        socket.emit('sync-status', { type: 'info', message: '步驟 2: 建立資料庫物件', progress: 20 });
        if (!options.compareOnly) {
            await cleanupService.cleanupExistingObjects();
        }

        const sortedObjects = await objectService.sortByDependency();
        await objectService.createObjects(sortedObjects);

        socket.emit('sync-status', { type: 'info', message: '步驟 3: 複製資料', progress: 50 });
        if (!options.compareOnly) {
            await dataService.copyData();
        }

        socket.emit('sync-status', { type: 'info', message: '步驟 4: 建立約束', progress: 80 });
        await constraintService.createPrimaryKeys();
        await constraintService.createForeignKeys();

        socket.emit('sync-status', { type: 'info', message: '步驟 5: 建立索引', progress: 90 });
        await indexService.createIndexes();
    }

    async generatePreviewSQL(srcConfig, dstConfig, options, socket) {
        const srcAdapter = DatabaseAdapterFactory.createAdapter(srcConfig.type, srcConfig, options.debug);
        const dstAdapter = dstConfig ? DatabaseAdapterFactory.createAdapter(dstConfig.type, dstConfig, options.debug) : null;

        const schemaBuffer = [];
        const dataBuffer = [];

        // 建立服務實例
        const schemaService = new SchemaService(srcAdapter, dstAdapter, schemaBuffer, options.debug, options.compareOnly);
        const cleanupService = new CleanupService(srcAdapter, dstAdapter, schemaBuffer, options.debug, options.compareOnly);
        const objectService = new ObjectService(srcAdapter, dstAdapter, schemaBuffer, options.debug, options.compareOnly);
        const dataService = new DataService(srcAdapter, dstAdapter, dataBuffer, options.debug, options.compareOnly);
        const constraintService = new ConstraintService(srcAdapter, dstAdapter, schemaBuffer, options.debug, options.compareOnly);
        const indexService = new IndexService(srcAdapter, dstAdapter, schemaBuffer, options.debug, options.compareOnly);

        // 產生 SQL
        socket.emit('preview-status', { type: 'info', message: '產生 Schema 腳本...', progress: 10 });
        await schemaService.createSchemas();

        if (!options.compareOnly) {
            await cleanupService.cleanupExistingObjects();
        }

        socket.emit('preview-status', { type: 'info', message: '產生物件腳本...', progress: 30 });
        const sortedObjects = await objectService.sortByDependency();
        await objectService.createObjects(sortedObjects);

        await constraintService.createPrimaryKeys();
        await constraintService.createForeignKeys();

        await indexService.createIndexes();

        if (!options.compareOnly) {
            socket.emit('preview-status', { type: 'info', message: '產生資料腳本...', progress: 70 });
            await dataService.copyData();
        }

        socket.emit('preview-status', { type: 'success', message: '預覽產生完成！', progress: 100 });

        return {
            schema: schemaBuffer.join('\n'),
            data: dataBuffer.join('\n')
        };
    }

    start() {
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                console.log(`網頁介面已啟動: http://localhost:${this.port}`);
                console.log(`   請在瀏覽器開啟上述網址來設定和執行資料庫同步`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.server.close(() => {
                resolve();
            });
        });
    }
}

module.exports = WebServer;