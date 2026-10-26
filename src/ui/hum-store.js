// My hums: every hum you record or upload, kept on this device (IndexedDB), with
// the notes, the beat and the chords as you left them. Nothing leaves the device.
//
// Two stores: `hums` holds the small part (name, summary and the saved-hum JSON from
// core/saved-hum.js), so the list opens quickly; `audio` holds each recording as a
// 16-bit WAV, which is only read when you open that hum.

const DB_NAME = 'surilo';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no-indexeddb')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('hums')) db.createObjectStore('hums', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

/** Run `fn(stores)` in one transaction; resolves with its result once the transaction is done. */
async function run(names, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    let result;
    Promise.resolve(fn(stores)).then((r) => { result = r; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

const ask = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** Can hums be kept on this device? (Not in some private windows.) */
export async function storeAvailable() {
  try { await open(); return true; } catch { return false; }
}

/** Every saved hum (without its audio), newest first. */
export async function listHums() {
  const all = await run(['hums'], 'readonly', (s) => ask(s.hums.getAll()));
  return all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Keep a new hum. `record` is {id, name, createdAt, updatedAt, duration, summary, meta}; `wav` the recording. */
export async function addHum(record, wav) {
  await run(['hums', 'audio'], 'readwrite', (s) => {
    s.hums.put({ ...record, size: wav.byteLength });
    s.audio.put({ id: record.id, wav });
  });
  // Ask the browser not to clear the history when space runs low (Chrome may say yes).
  navigator.storage?.persist?.().catch(() => {});
}

/** Change a kept hum (its name, or its notes and chords). Does nothing if it was deleted meanwhile. */
export async function updateHum(id, patch) {
  return run(['hums'], 'readwrite', async (s) => {
    const rec = await ask(s.hums.get(id));
    if (!rec) return false;
    s.hums.put({ ...rec, ...patch });
    return true;
  });
}

/** Give a kept hum a new name (in the list and in its saved JSON). */
export async function renameHum(id, name) {
  return run(['hums'], 'readwrite', async (s) => {
    const rec = await ask(s.hums.get(id));
    if (!rec) return false;
    s.hums.put({ ...rec, name, meta: { ...rec.meta, name } });
    return true;
  });
}

/** A kept hum and its recording (a WAV, as bytes), or null. */
export async function getHum(id) {
  return run(['hums', 'audio'], 'readonly', async (s) => {
    const [rec, audio] = await Promise.all([ask(s.hums.get(id)), ask(s.audio.get(id))]);
    return rec && audio ? { ...rec, wav: new Uint8Array(audio.wav) } : null;
  });
}

export async function deleteHum(id) {
  await run(['hums', 'audio'], 'readwrite', (s) => { s.hums.delete(id); s.audio.delete(id); });
}
