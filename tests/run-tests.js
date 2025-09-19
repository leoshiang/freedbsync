const fs = require('fs');
const path = require('path');

async function findTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...await findTests(p));
    } else if (e.isFile() && e.name.endsWith('.test.js')) {
      out.push(p);
    }
  }
  return out;
}

async function run() {
  const root = path.join(__dirname);
  const testFiles = await findTests(root);
  if (testFiles.length === 0) {
    console.error('No tests found.');
    process.exit(1);
  }
  let passed = 0;
  let failed = 0;
  for (const file of testFiles) {
    const rel = path.relative(process.cwd(), file);
    const start = Date.now();
    try {
      const fn = require(file);
      if (typeof fn !== 'function') throw new Error('Test file must export a function');
      await fn();
      const dur = Date.now() - start;
      console.log(`✓ ${rel} (${dur} ms)`);
      passed++;
    } catch (err) {
      const dur = Date.now() - start;
      console.error(`✗ ${rel} (${dur} ms)`);
      console.error(err && err.stack || err);
      failed++;
    }
  }
  console.log(`\nTest results: ${passed} passed, ${failed} failed, ${passed+failed} total`);
  process.exit(failed ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
