import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('v1.3 Runtime implementation keeps legacy imports behind compatibility boundary', () => {
  const files = fs.readdirSync(__dirname)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\.\/core\//, `${file} imports core directly`);
    assert.doesNotMatch(source, /better-sqlite3/, `${file} imports better-sqlite3 directly`);
    assert.doesNotMatch(source, /from ['"]\.\.\/commands\//, `${file} imports commands directly`);
    assert.doesNotMatch(source, /from ['"]\.\.\/types['"]/, `${file} imports legacy domain types directly`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8'), /compatibility\/|\.\.\/core\//);
});
