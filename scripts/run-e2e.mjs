import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const node = process.execPath;
const server = spawn(node, ['scripts/serve.mjs'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});

let serverReady = false;
server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('Reading Room test server')) serverReady = true;
});

async function stopServer() {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(2000),
    ]);
  }
}

for (let attempt = 0; attempt < 40 && !serverReady; attempt += 1) {
  if (server.exitCode !== null) throw new Error(`Test server exited with code ${server.exitCode}`);
  await delay(100);
}
if (!serverReady) {
  await stopServer();
  throw new Error('Timed out waiting for the test server');
}

const playwright = spawn(node, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, READING_ROOM_EXTERNAL_SERVER: '1' },
});

const signals = ['SIGINT', 'SIGTERM'];
for (const signal of signals) process.once(signal, async () => {
  playwright.kill(signal);
  await stopServer();
  process.exit(130);
});

const exitCode = await new Promise((resolve) => playwright.once('exit', (code) => resolve(code ?? 1)));
await stopServer();
process.exitCode = exitCode;
