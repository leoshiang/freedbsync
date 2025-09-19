const assert = require('assert');
const { escapeIdentifier, escapeValue } = require('../../Utils/SqlEscape');

module.exports = async function() {
  // escapeIdentifier
  assert.strictEqual(escapeIdentifier('dbo'), '[dbo]');
  assert.strictEqual(escapeIdentifier('MyTable'), '[MyTable]');
  assert.strictEqual(escapeIdentifier('weird]name'), '[weird]]name]');
  assert.strictEqual(escapeIdentifier(''), '[Unknown]');
  assert.strictEqual(escapeIdentifier(null), '[Unknown]');

  // escapeValue: null/undefined
  assert.strictEqual(escapeValue(null), 'NULL');
  assert.strictEqual(escapeValue(undefined), 'NULL');

  // numbers
  assert.strictEqual(escapeValue(0), '0');
  assert.strictEqual(escapeValue(123.45), '123.45');
  assert.strictEqual(escapeValue(NaN), 'NULL');
  assert.strictEqual(escapeValue(Infinity), 'NULL');

  // booleans
  assert.strictEqual(escapeValue(true), '1');
  assert.strictEqual(escapeValue(false), '0');

  // dates
  const d = new Date('2020-01-01T00:00:00.000Z');
  assert.strictEqual(escapeValue(d), `'${d.toISOString()}'`);

  // buffers
  assert.strictEqual(escapeValue(Buffer.from([])), 'NULL');
  assert.strictEqual(escapeValue(Buffer.from([0xDE,0xAD,0xBE,0xEF])), '0xDEADBEEF');

  // strings
  assert.strictEqual(escapeValue(''), "''");
  assert.strictEqual(escapeValue("O'Hara"), "N'O''Hara'");
  assert.strictEqual(escapeValue('hello'), "N'hello'");

  // objects -> toString()
  const obj = { toString() { return "x'y"; } };
  assert.strictEqual(escapeValue(obj), "N'x''y'");
};
