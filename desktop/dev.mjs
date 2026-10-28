/**
 * Desktop development launcher.
 * Starts the Vite dev server, waits until it is ready, then launches Electron
 * pointed at that server. Ctrl+C stops both.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = 5180;
const DEV_URL = `http://localhost:${PORT}`;

function waitUntilListening(port, host = '127.0.0.1', timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ port, host }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite on ${host}:${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

const children = [];

function killAll() {
  for (const child of children) {
    try {
      if (!child.killed) child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  killAll();
  process.exit(0);
});

console.log('[desktop] Starting Vite dev server…');
const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(PORT), '--strictPort'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
    shell: process.platform === 'win32',
  }
);
children.push(vite);

vite.on('exit', (code) => {
  if (code && code !== 0) {
    console.error('[desktop] Vite exited with code', code);
    killAll();
    process.exit(code);
  }
});

try {
  await waitUntilListening(PORT);
  console.log('[desktop] Vite ready — launching Electron…');
} catch (err) {
  console.error(err.message);
  killAll();
  process.exit(1);
}

const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js');

const electronEnv = { ...process.env };
delete electronEnv.ELECTRON_RUN_AS_NODE;
electronEnv.YUMERISE_DESKTOP_DEV = '1';
electronEnv.VITE_DEV_SERVER_URL = DEV_URL;

const electron = spawn(process.execPath, [electronCli, path.join(root, 'desktop', 'main.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: electronEnv,
});
children.push(electron);

electron.on('exit', (code) => {
  console.log('[desktop] Electron closed');
  killAll();
  process.exit(code ?? 0);
});
