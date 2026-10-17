import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const config = JSON.parse(await readFile('partykit.json', 'utf8'));
delete config.domain;
config.main = path.resolve(config.main);
config.parties = Object.fromEntries(Object.entries(config.parties).map(([name, file]) => [name, path.resolve(file)]));
config.persist = '/data/realtime';
config.vars = {
  APP_API_URL: process.env.APP_API_URL || 'http://127.0.0.1:5174',
  INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN
};
if (!config.vars.INTERNAL_API_TOKEN) throw new Error('INTERNAL_API_TOKEN is required');
const configFile = '/tmp/tableslayer-partykit.json';
await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
const child = spawn(
  'pnpm',
  [
    'exec',
    'partykit',
    'dev',
    '--config',
    configFile,
    '--persist',
    '/data/realtime',
    '--port',
    '1999',
    '--no-hotkeys',
    '--disable-request-cf-fetch'
  ],
  {
    stdio: 'inherit'
  }
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
