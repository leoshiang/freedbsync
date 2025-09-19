/**
 * SQL string builders for SQL Server.
 * Focus on reusable DDL/DML fragments and batch insert assembly.
 */
const { escapeIdentifier, escapeValue } = require('./SqlEscape');

const SqlBuilder = {
  /**
   * Build a fully qualified [schema].[table] using proper escaping.
   * Defaults schema to dbo if omitted.
   */
  qualifyTable({ schema, table }) {
    if (!table || typeof table !== 'string') {
      throw new Error('無效的資料表名稱');
    }
    const sch = (schema && typeof schema === 'string') ? schema : 'dbo';
    return `${escapeIdentifier(sch)}.${escapeIdentifier(table)}`;
  },

  /**
   * DROP object by type and names.
   * objectType: 'U' | 'V' | 'P' | 'FN' | 'TF' | 'IF'
   */
  dropObject({ schema, name, objectType }) {
    const typeMap = {
      U: 'TABLE',
      V: 'VIEW',
      P: 'PROCEDURE',
      FN: 'FUNCTION',
      TF: 'FUNCTION',
      IF: 'FUNCTION'
    };
    const dropType = typeMap[objectType];
    if (!dropType) return null;
    const s = schema;
    const n = name;
    return `IF EXISTS (SELECT 1 FROM sys.objects WHERE name = ${escapeValue(n)} AND schema_id = SCHEMA_ID(${escapeValue(s)}))\n    DROP ${dropType} ${escapeIdentifier(s)}.${escapeIdentifier(n)}`;
  },

  dropForeignKey({ schema, table, constraint }) {
    return `ALTER TABLE ${escapeIdentifier(schema)}.${escapeIdentifier(table)} DROP CONSTRAINT ${escapeIdentifier(constraint)}`;
  },

  dropIndex({ schema, table, index }) {
    return `DROP INDEX ${escapeIdentifier(index)} ON ${escapeIdentifier(schema)}.${escapeIdentifier(table)}`;
  },

  /**
   * Batch INSERT builder.
   * @param {Object} opts
   * @param {string} opts.schema
   * @param {string} opts.table
   * @param {Array<Object>} opts.rows
   * @param {boolean} opts.hasIdentity
   * @param {number} opts.batchSize
   * @returns {string[]} array of SQL statements
   */
  batchInsert({ schema, table, rows, hasIdentity = false, batchSize = 1000 }) {
    if (!rows || rows.length === 0) return [];
    const fq = this.qualifyTable({ schema, table });
    const columns = Object.keys(rows[0]);
    const columnList = columns.map(c => escapeIdentifier(c)).join(', ');

    const batches = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valuesList = batch.map(row => {
        const values = columns.map(c => escapeValue(row[c])).join(', ');
        return `(${values})`;
      }).join(',\n    ');

      let sql = '';
      if (hasIdentity) sql += `SET IDENTITY_INSERT ${fq} ON;\n`;
      sql += `INSERT INTO ${fq} (${columnList})\nVALUES\n    ${valuesList};`;
      if (hasIdentity) sql += `\nSET IDENTITY_INSERT ${fq} OFF;`;
      batches.push(sql);
    }
    return batches;
  }
};

module.exports = SqlBuilder;
