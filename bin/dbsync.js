#!/usr/bin/env node

/**
 * FreeDbSync CLI 工具入口點
 * 支援作為全域工具使用
 */

const path = require('path');

// 引入主程式
require(path.join(__dirname, '..', 'index.js'));