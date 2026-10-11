// Connects the UI to the in-browser data engine.
import { IndexedDbPersistence } from './persistence';
import { LocalServer, type Response } from './server';

let server: LocalServer | null = null;

export function localServer(): LocalServer {
  if (!server) {
    if (typeof indexedDB === 'undefined') throw new Error('This browser does not allow local storage. Open the file in Chrome, Edge or Firefox (not a private window).');
    server = new LocalServer(new IndexedDbPersistence(), { autoSnapshot: true });
    // Ask Chrome not to evict the data when disk space runs low.
    navigator.storage?.persist?.().catch(() => undefined);
  }
  return server;
}

export function localRequest(method: string, url: string, body?: unknown): Promise<Response> {
  return localServer().request(method, url, body);
}
