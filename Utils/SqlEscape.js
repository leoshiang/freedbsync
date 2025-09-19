/**
 * SQL escaping helpers for SQL Server.
 * Centralizes identifier and value escaping to avoid duplication.
 */
const SqlEscape = {
  /**
   * Escape SQL Server identifiers using brackets and doubling any closing bracket.
   * @param {string} identifier
   * @returns {string}
   */
  escapeIdentifier(identifier) {
    if (!identifier) return '[Unknown]';
    return `[${identifier.toString().replace(/]/g, ']]')}]`;
  },

  /**
   * Escape a JS value into a SQL literal for SQL Server.
   * @param {*} value
   * @returns {string}
   */
  escapeValue(value) {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'NULL';
      if (!Number.isFinite(value)) return 'NULL';
      return value.toString();
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return 'NULL';
      return `'${value.toISOString()}'`;
    }

    if (Buffer.isBuffer(value)) {
      if (value.length === 0) return 'NULL';
      return `0x${value.toString('hex').toUpperCase()}`;
    }

    const str = value.toString();
    if (str.length === 0) {
      return "''";
    }
    const escapedStr = str.replace(/'/g, "''");
    return `N'${escapedStr}'`;
  }
};

module.exports = SqlEscape;
