// Almacenamiento local en IndexedDB. Si el navegador no lo permite (ej. modo privado), cae a memoria.
type StoreName = 'notes' | 'folders' | 'images' | 'kv';
const NAMES: StoreName[] = ['notes', 'folders', 'images', 'kv'];
const KEYS: Record<StoreName, string> = { notes: 'id', folders: 'id', images: 'name', kv: 'key' };

let dbp: Promise<IDBDatabase | null> | null = null;
const mem: Record<StoreName, Map<string, unknown>> = { notes: new Map(), folders: new Map(), images: new Map(), kv: new Map() };

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open('apunte', 1);
      req.onupgradeneeded = () => {
        for (const n of NAMES) if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n, { keyPath: KEYS[n] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  if (!db) return [...mem[store].values()] as T[];
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return mem[store].get(key) as T | undefined;
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function put(store: StoreName, value: object): Promise<void> {
  const db = await open();
  if (!db) {
    mem[store].set((value as Record<string, string>)[KEYS[store]], value);
    return;
  }
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

export async function del(store: StoreName, key: string): Promise<void> {
  const db = await open();
  if (!db) {
    mem[store].delete(key);
    return;
  }
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function keys(store: StoreName): Promise<string[]> {
  const db = await open();
  if (!db) return [...mem[store].keys()];
  return (await wrap(db.transaction(store).objectStore(store).getAllKeys())) as string[];
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await get<{ key: string; value: T }>('kv', key))?.value;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await put('kv', { key, value });
}
