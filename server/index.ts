import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { Store } from './store';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(root, process.env.DATA_DIR ?? 'data');
const password = process.env.APP_PASSWORD || undefined;

const store = new Store(dataDir);
const app = createApp({ store, password, staticDir: process.env.NODE_ENV === 'production' ? path.join(root, 'dist') : undefined });

const runBackup = () => store.autoBackup().catch((e) => console.error('Automatic backup failed:', e));
runBackup();
setInterval(runBackup, 60 * 60 * 1000).unref();

app.listen(port, host, () => {
  console.log(`Holding Company OS running at http://${host}:${port}`);
  console.log(`Data: ${store.file}`);
  if (host !== '127.0.0.1' && host !== 'localhost' && !password) {
    console.warn('WARNING: listening on a non-local interface without APP_PASSWORD set.');
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.db.close();
    process.exit(0);
  });
}
