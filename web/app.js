class FreeDbSyncApp {
    constructor() {
        this.socket = io();
        this.setupSocketListeners();
        this.loadConfigFromStorage();

        // 自動儲存設定當輸入變更時
        this.setupAutoSave();

        // 定期更新連線狀態
        this.updateConnectionStatus();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            this.log('已連接到伺服器', 'success');
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            this.log('與伺服器斷線', 'error');
            this.updateConnectionStatus(false);
        });

        // 新增：接收 console 日誌
        this.socket.on('console-log', (data) => {
            this.log(data.message, data.type);
        });

        this.socket.on('sync-status', (data) => {
            this.log(`${this.getStatusIcon(data.type)} ${data.message}`, data.type);
            if (data.progress !== undefined) {
                this.updateProgress(data.progress);
            }
        });

        this.socket.on('preview-status', (data) => {
            this.log(`${this.getStatusIcon(data.type)} ${data.message}`, data.type);
            if (data.progress !== undefined) {
                this.updateProgress(data.progress);
            }
        });

        this.socket.on('preview-result', (data) => {
            document.getElementById('schema-preview').innerHTML = this.formatSQL(data.schema);
            document.getElementById('data-preview').innerHTML = this.formatSQL(data.data);

            // 切換到 Schema 標籤
            const schemaTab = new bootstrap.Tab(document.getElementById('schema-tab'));
            schemaTab.show();

            this.log('預覽 SQL 已產生，請查看上方標籤', 'success');
        });
    }

    setupAutoSave() {
        const inputs = [
            'src-server', 'src-port', 'src-db', 'src-user', 'src-pwd',
            'dst-server', 'dst-port', 'dst-db', 'dst-user', 'dst-pwd',
            'compare-only', 'debug-mode'
        ];

        inputs.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.saveConfigToStorage();
                });
                element.addEventListener('input', () => {
                    this.saveConfigToStorage();
                });
            }
        });
    }

    getStatusIcon(type) {
        switch (type) {
            case 'success': return '[成功]';
            case 'error': return '[錯誤]';
            case 'warning': return '[警告]';
            case 'info': return '[資訊]';
            default: return '[日誌]';
        }
    }

    log(message, type = 'info') {
        const logContainer = document.getElementById('log-container');
        const timestamp = new Date().toLocaleTimeString('zh-TW');
        const logEntry = document.createElement('div');
        logEntry.className = `status-${type}`;
        logEntry.innerHTML = `[${timestamp}] ${message}`;

        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    updateProgress(percent) {
        const progressBar = document.getElementById('progress-bar');
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${percent}%`;

        if (percent === 100) {
            progressBar.classList.add('bg-success');
        } else if (percent === 0) {
            progressBar.classList.remove('bg-success');
        }
    }

    updateConnectionStatus(connected = null) {
        const statusElement = document.getElementById('connection-status');
        if (connected === null) {
            connected = this.socket.connected;
        }

        if (connected) {
            statusElement.innerHTML = '<i class="fas fa-circle text-success"></i> 已連線';
        } else {
            statusElement.innerHTML = '<i class="fas fa-circle text-secondary"></i> 未連線';
        }
    }

    getConfig(prefix) {
        return {
            type: 'sqlserver',
            server: document.getElementById(`${prefix}-server`).value || 'localhost',
            port: parseInt(document.getElementById(`${prefix}-port`).value) || 1433,
            database: document.getElementById(`${prefix}-db`).value,
            user: document.getElementById(`${prefix}-user`).value,
            password: document.getElementById(`${prefix}-pwd`).value,
            options: { trustServerCertificate: true }
        };
    }

    getOptions() {
        return {
            compareOnly: document.getElementById('compare-only').checked,
            debug: document.getElementById('debug-mode').checked
        };
    }

    validateConfig(config, label) {
        if (!config.server || !config.database || !config.user || !config.password) {
            throw new Error(`${label}資料庫設定不完整，請檢查所有必填欄位`);
        }
    }

    async testConnection(type) {
        try {
            const config = this.getConfig(type);
            const label = type === 'src' ? '來源' : '目標';

            this.validateConfig(config, label);
            this.log(`測試${label}資料庫連線...`, 'info');

            const response = await fetch('/api/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config })
            });

            const result = await response.json();

            if (result.success) {
                this.log(`${label}資料庫連線成功！`, 'success');
            } else {
                this.log(`${label}資料庫連線失敗: ${result.message}`, 'error');
            }
        } catch (error) {
            this.log(`測試連線失敗: ${error.message}`, 'error');
        }
    }

    async startSync() {
        try {
            const srcConfig = this.getConfig('src');
            const dstConfig = this.getConfig('dst');
            const options = this.getOptions();

            this.validateConfig(srcConfig, '來源');
            this.validateConfig(dstConfig, '目標');

            this.log('開始資料庫同步...', 'info');
            this.updateProgress(0);

            this.socket.emit('start-sync', { srcConfig, dstConfig, options });

        } catch (error) {
            this.log(`開始同步失敗: ${error.message}`, 'error');
        }
    }

    async generatePreview() {
        try {
            const srcConfig = this.getConfig('src');
            const dstConfig = this.getConfig('dst');
            const options = this.getOptions();

            this.validateConfig(srcConfig, '來源');

            // 比較模式需要目標資料庫
            if (options.compareOnly) {
                this.validateConfig(dstConfig, '目標');
            }

            this.log('產生預覽 SQL...', 'info');
            this.updateProgress(0);

            this.socket.emit('generate-preview', { srcConfig, dstConfig, options });

        } catch (error) {
            this.log(`產生預覽失敗: ${error.message}`, 'error');
        }
    }

    formatSQL(sql) {
        if (!sql || sql.trim() === '') {
            return '<div class="text-muted">無 SQL 內容</div>';
        }

        // 基本的 SQL 語法高亮
        let formatted = sql
            .replace(/\n/g, '<br>')
            .replace(/(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|ON|GROUP BY|ORDER BY|HAVING)/gi,
                '<span style="color: #66d9ef; font-weight: bold;">$1</span>')
            .replace(/(TABLE|VIEW|PROCEDURE|FUNCTION|INDEX|CONSTRAINT)/gi,
                '<span style="color: #a6e22e;">$1</span>')
            .replace(/(INT|VARCHAR|NVARCHAR|DATETIME|BIT|DECIMAL|FLOAT)/gi,
                '<span style="color: #fd971f;">$1</span>')
            .replace(/(--[^\n]*)/g, '<span style="color: #75715e; font-style: italic;">$1</span>');

        return formatted;
    }

    saveConfig() {
        this.saveConfigToStorage();
        this.log('設定已儲存到瀏覽器', 'success');
    }

    loadConfig() {
        this.loadConfigFromStorage();
        this.log('設定已從瀏覽器載入', 'success');
    }

    clearConfig() {
        if (confirm('確定要清除所有儲存的設定嗎？')) {
            localStorage.removeItem('freedbsync-config');

            // 清空所有輸入欄位
            const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input[type="number"]');
            inputs.forEach(input => input.value = '');

            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => checkbox.checked = false);

            this.log('所有設定已清除', 'warning');
        }
    }

    saveConfigToStorage() {
        const config = {
            src: {
                server: document.getElementById('src-server').value,
                port: document.getElementById('src-port').value,
                database: document.getElementById('src-db').value,
                user: document.getElementById('src-user').value,
                password: document.getElementById('src-pwd').value
            },
            dst: {
                server: document.getElementById('dst-server').value,
                port: document.getElementById('dst-port').value,
                database: document.getElementById('dst-db').value,
                user: document.getElementById('dst-user').value,
                password: document.getElementById('dst-pwd').value
            },
            options: {
                compareOnly: document.getElementById('compare-only').checked,
                debug: document.getElementById('debug-mode').checked
            }
        };

        localStorage.setItem('freedbsync-config', JSON.stringify(config));
    }

    loadConfigFromStorage() {
        const stored = localStorage.getItem('freedbsync-config');
        if (!stored) return;

        try {
            const config = JSON.parse(stored);

            // 載入來源設定
            if (config.src) {
                document.getElementById('src-server').value = config.src.server || '';
                document.getElementById('src-port').value = config.src.port || '';
                document.getElementById('src-db').value = config.src.database || '';
                document.getElementById('src-user').value = config.src.user || '';
                document.getElementById('src-pwd').value = config.src.password || '';
            }

            // 載入目標設定
            if (config.dst) {
                document.getElementById('dst-server').value = config.dst.server || '';
                document.getElementById('dst-port').value = config.dst.port || '';
                document.getElementById('dst-db').value = config.dst.database || '';
                document.getElementById('dst-user').value = config.dst.user || '';
                document.getElementById('dst-pwd').value = config.dst.password || '';
            }

            // 載入選項設定
            if (config.options) {
                document.getElementById('compare-only').checked = config.options.compareOnly || false;
                document.getElementById('debug-mode').checked = config.options.debug || false;
            }

        } catch (error) {
            console.error('載入設定失敗:', error);
        }
    }
}

// 全域函數供 HTML 呼叫
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new FreeDbSyncApp();
});

function testConnection(type) {
    app.testConnection(type);
}

function startSync() {
    app.startSync();
}

function generatePreview() {
    app.generatePreview();
}

function saveConfig() {
    app.saveConfig();
}

function loadConfig() {
    app.loadConfig();
}

function clearConfig() {
    app.clearConfig();
}