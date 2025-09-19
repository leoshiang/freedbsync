/**
 * Minimal Logger utility with level filtering.
 * Levels: error < warn < info < debug
 *
 * Usage:
 *   const Logger = require('./Utils/Logger');
 *   const logger = new Logger(process.env.LOG_LEVEL || 'info');
 *   logger.info('message', {meta: 'data'});
 */
class Logger {
  constructor(level = 'info', json = false) {
    this.level = (level || 'info').toLowerCase();
    this.json = !!json;
    this.levelRank = { error: 0, warn: 1, info: 2, debug: 3 };
  }

  setLevel(level) { this.level = (level || 'info').toLowerCase(); }
  enableJson(v = true) { this.json = !!v; }

  error(msg, meta) { this._log('error', msg, meta); }
  warn(msg, meta) { this._log('warn', msg, meta); }
  info(msg, meta) { this._log('info', msg, meta); }
  debug(msg, meta) { this._log('debug', msg, meta); }

  _log(level, msg, meta) {
    if (this.levelRank[level] > this.levelRank[this.level]) return;
    const time = new Date().toISOString();
    if (this.json) {
      const payload = { time, level, msg };
      if (meta !== undefined) payload.meta = meta;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(payload));
    } else {
      const head = `[${time}] [${level.toUpperCase()}]`;
      // eslint-disable-next-line no-console
      if (level === 'error') return console.error(`${head} ${msg}`, meta ?? '');
      // eslint-disable-next-line no-console
      console.log(`${head} ${msg}`, meta ?? '');
    }
  }
}

module.exports = Logger;
