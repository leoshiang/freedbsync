const assert = require('assert');
const SqlBuilder = require('../../Utils/SqlBuilder');

module.exports = async function () {
  // qualifyTable
  assert.strictEqual(SqlBuilder.qualifyTable({ schema: 'dbo', table: 'Users' }), '[dbo].[Users]');
  assert.strictEqual(SqlBuilder.qualifyTable({ schema: undefined, table: 'Users' }), '[dbo].[Users]');

  // dropObject
  assert.strictEqual(
    SqlBuilder.dropObject({ schema: 'dbo', name: 'T1', objectType: 'U' }),
    "IF EXISTS (SELECT 1 FROM sys.objects WHERE name = N'T1' AND schema_id = SCHEMA_ID(N'dbo'))\n    DROP TABLE [dbo].[T1]"
  );
  assert.strictEqual(
    SqlBuilder.dropObject({ schema: 'dbo', name: 'V1', objectType: 'V' }),
    "IF EXISTS (SELECT 1 FROM sys.objects WHERE name = N'V1' AND schema_id = SCHEMA_ID(N'dbo'))\n    DROP VIEW [dbo].[V1]"
  );
  assert.strictEqual(
    SqlBuilder.dropObject({ schema: 'dbo', name: 'P1', objectType: 'P' }),
    "IF EXISTS (SELECT 1 FROM sys.objects WHERE name = N'P1' AND schema_id = SCHEMA_ID(N'dbo'))\n    DROP PROCEDURE [dbo].[P1]"
  );
  assert.strictEqual(
    SqlBuilder.dropObject({ schema: 'dbo', name: 'F1', objectType: 'FN' }),
    "IF EXISTS (SELECT 1 FROM sys.objects WHERE name = N'F1' AND schema_id = SCHEMA_ID(N'dbo'))\n    DROP FUNCTION [dbo].[F1]"
  );
  assert.strictEqual(
    SqlBuilder.dropObject({ schema: 'dbo', name: 'F2', objectType: 'TF' }),
    "IF EXISTS (SELECT 1 FROM sys.objects WHERE name = N'F2' AND schema_id = SCHEMA_ID(N'dbo'))\n    DROP FUNCTION [dbo].[F2]"
  );
  assert.strictEqual(
    SqlBuilder.dropObject({ schema: 'dbo', name: 'F3', objectType: 'IF' }),
    "IF EXISTS (SELECT 1 FROM sys.objects WHERE name = N'F3' AND schema_id = SCHEMA_ID(N'dbo'))\n    DROP FUNCTION [dbo].[F3]"
  );
  assert.strictEqual(SqlBuilder.dropObject({ schema: 'dbo', name: 'X', objectType: 'X' }), null);

  // dropForeignKey / dropIndex
  assert.strictEqual(
    SqlBuilder.dropForeignKey({ schema: 'dbo', table: 'T1', constraint: 'FK_T1_T2' }),
    'ALTER TABLE [dbo].[T1] DROP CONSTRAINT [FK_T1_T2]'
  );
  assert.strictEqual(
    SqlBuilder.dropIndex({ schema: 'dbo', table: 'T1', index: 'IX_T1_A' }),
    'DROP INDEX [IX_T1_A] ON [dbo].[T1]'
  );

  // batchInsert without identity
  const rows = [
    { id: 1, name: 'Alice' },
    { id: 2, name: "O'Hara" },
    { id: 3, name: '' },
  ];
  const sqls = SqlBuilder.batchInsert({ schema: 'dbo', table: 'People', rows, hasIdentity: false, batchSize: 2 });
  assert.strictEqual(sqls.length, 2);
  assert.strictEqual(sqls[0], [
    'INSERT INTO [dbo].[People] ([id], [name])',
    'VALUES',
    "    (1, N'Alice'),",
    "    (2, N'O''Hara');",
  ].join('\n'));
  assert.strictEqual(sqls[1], [
    'INSERT INTO [dbo].[People] ([id], [name])',
    'VALUES',
    "    (3, '')" + ';',
  ].join('\n'));

  // batchInsert with identity
  const sqls2 = SqlBuilder.batchInsert({ schema: 's', table: 'T', rows: [{ a: 10 }], hasIdentity: true, batchSize: 100 });
  assert.strictEqual(sqls2.length, 1);
  assert.strictEqual(sqls2[0], [
    'SET IDENTITY_INSERT [s].[T] ON;',
    'INSERT INTO [s].[T] ([a])',
    'VALUES',
    '    (10);',
    'SET IDENTITY_INSERT [s].[T] OFF;',
  ].join('\n'));
};
