const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');

function runNode(args, opts = {}) {
  return new Promise((resolve) => {
    const node = process.execPath;
    const child = spawn(node, args, { cwd: opts.cwd || process.cwd(), env: opts.env || process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

module.exports = async function () {
  const indexPath = path.join(__dirname, '..', '..', 'index.js');

  // --help should exit 0 and contain title
  let r = await runNode([indexPath, '--help']);
  assert.strictEqual(r.code, 0);
  assert.ok(/FreeDbSync|資料庫同步工具/i.test(r.stdout), 'help should print title');

  // --version should exit 0 and show version
  r = await runNode([indexPath, '--version']);
  assert.strictEqual(r.code, 0);
  assert.ok(/FreeDbSync v\d+\.\d+\.\d+/.test(r.stdout), 'version should print');

  // missing src args should exit 1
  r = await runNode([indexPath]);
  assert.strictEqual(r.code, 1);
  assert.ok(/缺少必要的來源參數/.test(r.stderr) || /缺少必要的來源參數/.test(r.stdout));

  // needDst validation when not dry-run: provide src but no dst -> exit 1
  r = await runNode([
    indexPath,
    '--src-server=localhost',
    '--src-db=source',
    '--src-user=sa',
    '--src-pwd=pass'
  ]);
  // buildConfigFromArgs should fail before any DB call
  assert.strictEqual(r.code, 1);
  assert.ok(/缺少必要的目標參數/.test(r.stderr) || /缺少必要的目標參數/.test(r.stdout));

  // dry-run with only src should pass validation and then fail later due to missing DB (we won't run that here)
  // Instead ensure it gets past validation by checking initial lines and then likely exits non-zero; we skip to avoid flaky
};
