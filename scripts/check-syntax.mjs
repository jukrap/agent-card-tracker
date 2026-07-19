import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = ['src', 'scripts', 'test'];
const files = [];

for (const root of roots) {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.mjs')) {
        files.push(path.join(entry.parentPath ?? entry.path, entry.name));
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

files.sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  process.stdout.write(`Syntax OK (${files.length} files)\n`);
}
