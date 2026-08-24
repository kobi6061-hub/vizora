/**
 * Local persistence for the current phase of the product.
 *
 * Project/user metadata lives in localStorage (JSON, namespaced under
 * `vizora:`); uploaded image blobs live in IndexedDB. Both sit behind these
 * helpers so a cloud storage provider can replace them without touching UI.
 */

const NAMESPACE = "vizora";

function storageAvailable() {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function readJson<T>(key: string, fallback: T): T {
  if (!storageAvailable()) return fallback;
  try {
    const raw = window.localStorage.getItem(`${NAMESPACE}:${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T) {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(`${NAMESPACE}:${key}`, JSON.stringify(value));
  } catch {
    /* Quota exceeded or privacy mode — the UI treats storage as best-effort. */
  }
}

export function removeKey(key: string) {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(`${NAMESPACE}:${key}`);
}

/* ----------------------------- IndexedDB blobs ----------------------------- */

const DB_NAME = "vizora-assets";
const STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const objectUrlCache = new Map<string, string>();

export const blobStore = {
  async put(id: string, blob: Blob): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },

  async get(id: string): Promise<Blob | null> {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as Blob) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return blob;
  },

  async delete(id: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const cached = objectUrlCache.get(id);
    if (cached) {
      URL.revokeObjectURL(cached);
      objectUrlCache.delete(id);
    }
  },

  /** Resolve a blob id to a display URL (cached object URL). */
  async resolveUrl(id: string): Promise<string | null> {
    const cached = objectUrlCache.get(id);
    if (cached) return cached;
    try {
      const blob = await this.get(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      objectUrlCache.set(id, url);
      return url;
    } catch {
      return null;
    }
  },
};

/**
 * Asset `src` resolution: bundled art ships as plain paths, uploads as
 * `idb:` references handled by `useAssetUrl`.
 */
export const IDB_PREFIX = "idb:";
