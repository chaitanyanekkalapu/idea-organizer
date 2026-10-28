// IndexedDB storage. Notes live in "notes"; photos, audio and files live in "blobs"
// so the note list stays light. Everything stays on this device.
const DB = (() => {
  const NAME = 'idea-organizer';
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('notes')) {
            db.createObjectStore('notes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
          }
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  return {
    uid,
    allNotes: () => tx('notes', 'readonly', s => s.getAll()).then(list =>
      (list || []).sort((a, b) => b.createdAt - a.createdAt)),
    getNote: id => tx('notes', 'readonly', s => s.get(id)),
    putNote: note => tx('notes', 'readwrite', s => s.put(note)),
    deleteNote: async note => {
      for (const a of note.attachments || []) await tx('blobs', 'readwrite', s => s.delete(a.blobId));
      return tx('notes', 'readwrite', s => s.delete(note.id));
    },
    putBlob: async blob => {
      const id = uid();
      await tx('blobs', 'readwrite', s => s.put({ id, blob }));
      return id;
    },
    getBlob: id => tx('blobs', 'readonly', s => s.get(id)).then(r => r && r.blob),
    allBlobs: () => tx('blobs', 'readonly', s => s.getAll()),
    putBlobWithId: (id, blob) => tx('blobs', 'readwrite', s => s.put({ id, blob })),
    getSetting: (key, fallback) => tx('settings', 'readonly', s => s.get(key)).then(r => (r ? r.value : fallback)),
    setSetting: (key, value) => tx('settings', 'readwrite', s => s.put({ key, value })),
    clearAll: async () => {
      for (const store of ['notes', 'blobs']) await tx(store, 'readwrite', s => s.clear());
    },
  };
})();
