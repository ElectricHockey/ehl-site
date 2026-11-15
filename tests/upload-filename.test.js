const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('uploads reject path separators and traversal before writing', async () => {
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  const start = source.indexOf('async function uploadToStorage(');
  const end = source.indexOf('/**', start);
  const writes = [];
  const context = vm.createContext({
    path, __dirname: '/app',
    getSupabaseClient: () => null,
    fs: { existsSync: () => true, writeFileSync: (...args) => writes.push(args) },
  });
  vm.runInContext(source.slice(start, end), context);
  for (const filename of ['../outside.png', '..\\outside.png', '.', '..', 'award-bad/name.png']) {
    await assert.rejects(context.uploadToStorage(Buffer.from('test'), filename, 'image/png'), /Invalid upload filename/);
  }
  assert.equal(writes.length, 0);
  assert.equal(await context.uploadToStorage(Buffer.from('test'), 'award-rocket_richard-123.png', 'image/png'),
    '/uploads/award-rocket_richard-123.png');
  assert.equal(writes.length, 1);
});
