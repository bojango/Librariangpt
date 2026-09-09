import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function files(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else out.push(path);
  }
  return out;
}

const runtime = (await files('src')).filter(path => path.endsWith('.js'));
const text = (await Promise.all(runtime.map(path => readFile(path, 'utf8')))).join('\n');
const assertions = [
  ['MutationObserver', 0],
  ['location.reload', 0],
  ['createClient(', 1]
];
for (const [needle, expected] of assertions) {
  const found = text.split(needle).length - 1;
  if (found !== expected) throw new Error(`${needle}: expected ${expected}, found ${found}`);
}
console.log(`Runtime architecture check passed (${runtime.length} modules).`);
