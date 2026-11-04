/*
 * Хранилище заметок в файловой системе устройства.
 * Каждая заметка - отдельный файл <id>.json в папке notes/ приватной
 * файловой системы приложения (Origin Private File System).
 * Если OPFS недоступна, файлы хранятся в IndexedDB под теми же именами.
 */
const FileStorage = (() => {
  const FOLDER = 'notes';
  let dir = null;
  let cache = [];

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('notes-files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbCall(mode, fn) {
    return idbOpen().then(idb => new Promise((resolve, reject) => {
      const tx = idb.transaction('files', mode);
      const res = fn(tx.objectStore('files'));
      tx.oncomplete = () => resolve(res && res.result);
      tx.onerror = () => reject(tx.error);
    }));
  }

  const fileName = id => id + '.json';

  async function init() {
    try {
      if (!('createWritable' in FileSystemFileHandle.prototype)) throw new Error('no createWritable');
      const root = await navigator.storage.getDirectory();
      dir = await root.getDirectoryHandle(FOLDER, { create: true });
    } catch (e) {
      dir = null;
    }
    cache = await readAll();
  }

  async function readAll() {
    const notes = [];
    if (dir) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
        try {
          const text = await (await handle.getFile()).text();
          notes.push(JSON.parse(text));
        } catch (e) { /* повреждённый файл пропускается */ }
      }
    } else {
      const values = await idbCall('readonly', s => s.getAll());
      (values || []).forEach(t => { try { notes.push(JSON.parse(t)); } catch (e) {} });
    }
    return notes;
  }

  async function writeFile(note) {
    const text = JSON.stringify(note, null, 2);
    if (dir) {
      const fh = await dir.getFileHandle(fileName(note.id), { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    } else {
      await idbCall('readwrite', s => s.put(text, fileName(note.id)));
    }
  }

  async function deleteFile(id) {
    if (dir) {
      try { await dir.removeEntry(fileName(id)); } catch (e) {}
    } else {
      await idbCall('readwrite', s => s.delete(fileName(id)));
    }
  }

  function matches(n, f) {
    if (f.text) {
      const q = f.text.toLowerCase();
      if (!n.title.toLowerCase().includes(q) && !n.content.toLowerCase().includes(q)) return false;
    }
    if (f.dateFrom && n.date < f.dateFrom) return false;
    if (f.dateTo && n.date > f.dateTo) return false;
    if (f.timeFrom && n.time < f.timeFrom) return false;
    if (f.timeTo && n.time > f.timeTo) return false;
    if (f.category && n.category !== f.category) return false;
    return true;
  }

  function list(f) {
    return cache
      .filter(n => matches(n, f))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }

  function get(id) {
    return cache.find(n => n.id === id) || null;
  }

  async function save(note) {
    await writeFile(note);
    const i = cache.findIndex(n => n.id === note.id);
    if (i >= 0) cache[i] = note; else cache.push(note);
  }

  async function remove(id) {
    await deleteFile(id);
    cache = cache.filter(n => n.id !== id);
  }

  return {
    name: 'files',
    label: 'Файлы',
    init, list, get, save, remove,
    all: () => list({}),
    where: () => 'Папка ' + FOLDER + '/ (' + (dir ? 'OPFS' : 'IndexedDB') + '), ' +
      cache.length + ' файл(ов) .json'
  };
})();
