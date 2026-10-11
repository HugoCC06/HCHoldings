// Where the app keeps its data. In the browser this is IndexedDB (inside Chrome's own
// storage, never sent anywhere). Tests use the in-memory implementation.

export type Row = Record<string, unknown> & { id: number };

export interface State {
  app_id: string;
  version: number;
  nextId: Record<string, number>;
  settings: Record<string, unknown>;
  meta: { lastBackupAt?: string | null };
  tables: Record<string, Row[]>;
}

export interface Snapshot { key: string; created: string; reason: string; state: State }

export interface Persistence {
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  getFile(id: number): Promise<Blob | null>;
  putFile(id: number, blob: Blob): Promise<void>;
  deleteFile(id: number): Promise<void>;
  listFileIds(): Promise<number[]>;
  putSnapshot(s: Snapshot): Promise<void>;
  listSnapshots(): Promise<Omit<Snapshot, 'state'>[]>;
  getSnapshot(key: string): Promise<Snapshot | null>;
  deleteSnapshot(key: string): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  state: State | null = null;
  files = new Map<number, Blob>();
  snapshots = new Map<string, Snapshot>();
  async load() { return this.state ? structuredClone(this.state) : null; }
  async save(s: State) { this.state = structuredClone(s); }
  async getFile(id: number) { return this.files.get(id) ?? null; }
  async putFile(id: number, b: Blob) { this.files.set(id, b); }
  async deleteFile(id: number) { this.files.delete(id); }
  async listFileIds() { return [...this.files.keys()]; }
  async putSnapshot(s: Snapshot) { this.snapshots.set(s.key, structuredClone(s)); }
  async listSnapshots() { return [...this.snapshots.values()].map(({ key, created, reason }) => ({ key, created, reason })).sort((a, b) => b.created.localeCompare(a.created)); }
  async getSnapshot(key: string) { return this.snapshots.get(key) ?? null; }
  async deleteSnapshot(key: string) { this.snapshots.delete(key); }
}

const DB_NAME = 'holding-company-os';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export class IndexedDbPersistence implements Persistence {
  private dbp: Promise<IDBDatabase>;
  constructor(private factory: IDBFactory = indexedDB, name = DB_NAME) {
    this.dbp = new Promise((resolve, reject) => {
      const open = this.factory.open(name, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('state');
        db.createObjectStore('files');
        db.createObjectStore('snapshots');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('Storage is blocked by another open copy of the app. Close other tabs and reload.'));
    });
  }
  private async store(name: string, mode: IDBTransactionMode) {
    return (await this.dbp).transaction(name, mode).objectStore(name);
  }
  private async write(name: string, fn: (s: IDBObjectStore) => void) {
    const db = await this.dbp;
    const tx = db.transaction(name, 'readwrite');
    fn(tx.objectStore(name));
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error ?? new Error('Storage write aborted (is the disk full?)'));
    });
  }
  async load() { return ((await req((await this.store('state', 'readonly')).get('current'))) as State | undefined) ?? null; }
  async save(s: State) { await this.write('state', (st) => st.put(s, 'current')); }
  async getFile(id: number) { return ((await req((await this.store('files', 'readonly')).get(id))) as Blob | undefined) ?? null; }
  async putFile(id: number, b: Blob) { await this.write('files', (st) => st.put(b, id)); }
  async deleteFile(id: number) { await this.write('files', (st) => st.delete(id)); }
  async listFileIds() { return (await req((await this.store('files', 'readonly')).getAllKeys())) as number[]; }
  async putSnapshot(s: Snapshot) { await this.write('snapshots', (st) => st.put(s, s.key)); }
  async listSnapshots() {
    const all = (await req((await this.store('snapshots', 'readonly')).getAll())) as Snapshot[];
    return all.map(({ key, created, reason }) => ({ key, created, reason })).sort((a, b) => b.created.localeCompare(a.created));
  }
  async getSnapshot(key: string) { return ((await req((await this.store('snapshots', 'readonly')).get(key))) as Snapshot | undefined) ?? null; }
  async deleteSnapshot(key: string) { await this.write('snapshots', (st) => st.delete(key)); }
}
