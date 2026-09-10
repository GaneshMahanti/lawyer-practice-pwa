const DB_NAME = 'vakildesk_workspace';
const DB_VERSION = 1;
const STORE = 'snapshots';

export type WorkspaceSnapshot = {
  ownerId: string;
  clients: unknown[];
  matters: unknown[];
  bookings: unknown[];
  fees: unknown[];
  notes: unknown[];
  documents: unknown[];
  reminders: unknown[];
  reminderPreferences: { offsets_minutes: number[]; in_app_enabled: boolean } | null;
  updatedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'ownerId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readSnapshot(ownerId: string): Promise<WorkspaceSnapshot | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(ownerId);
    req.onsuccess = () => resolve((req.result as WorkspaceSnapshot) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function writeSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
