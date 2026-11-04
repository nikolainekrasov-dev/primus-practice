/*
 * Хранилище заметок в базе данных SQLite.
 * Движок SQLite подключён через sql.js (WebAssembly). Файл базы notes.sqlite
 * записывается в приватную файловую систему приложения (OPFS),
 * а если браузер её не поддерживает, - в IndexedDB.
 */
const SqliteStorage = (() => {
  const DB_FILE = 'notes.sqlite';
  let db = null;
  let backend = '';

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      note_date  TEXT NOT NULL,
      note_time  TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT 'Другое',
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(note_date, note_time);
  `;

  /* ---------- чтение и запись файла базы ---------- */

  async function opfsDir() {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    // запись через createWritable есть не во всех браузерах (например, в старых Safari)
    if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) return null;
    try { return await navigator.storage.getDirectory(); } catch (e) { return null; }
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('notes-sqlite', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function readBytes() {
    const dir = await opfsDir();
    if (dir) {
      backend = 'OPFS';
      try {
        const fh = await dir.getFileHandle(DB_FILE);
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (e) { return null; }
    }
    backend = 'IndexedDB';
    const idb = await idbOpen();
    return new Promise(resolve => {
      const req = idb.transaction('files').objectStore('files').get(DB_FILE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function writeBytes(bytes) {
    if (backend === 'OPFS') {
      const dir = await opfsDir();
      const fh = await dir.getFileHandle(DB_FILE, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      return;
    }
    const idb = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = idb.transaction('files', 'readwrite');
      tx.objectStore('files').put(bytes, DB_FILE);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function persist() {
    await writeBytes(db.export());
  }

  /* ---------- работа с данными ---------- */

  function rows(sql, params) {
    const stmt = db.prepare(sql);
    stmt.bind(params || []);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out.map(fromRow);
  }

  function fromRow(r) {
    return {
      id: r.id, title: r.title, date: r.note_date, time: r.note_time,
      category: r.category, content: r.content,
      createdAt: r.created_at, updatedAt: r.updated_at
    };
  }

  /*
   * Оператор LIKE в SQLite без расширения ICU не различает регистр только у латиницы,
   * поэтому слова на русском ищет своя функция: она приводит текст к нижнему регистру
   * и сравнивает его с запросом буквально, символы % и _ в запросе не считаются шаблоном.
   */
  function containsText(text, query) {
    return String(text).toLowerCase().includes(String(query).toLowerCase()) ? 1 : 0;
  }

  async function init() {
    if (db) return;
    const SQL = await initSqlJs({ locateFile: f => 'lib/' + f });
    const bytes = await readBytes();
    db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
    db.create_function('contains_text', containsText);
    db.exec(SCHEMA);
    await persist();
  }

  function list(f) {
    const where = [];
    const p = [];
    if (f.text) {
      where.push('(contains_text(title, ?) OR contains_text(content, ?))');
      p.push(f.text, f.text);
    }
    if (f.dateFrom) { where.push('note_date >= ?'); p.push(f.dateFrom); }
    if (f.dateTo)   { where.push('note_date <= ?'); p.push(f.dateTo); }
    if (f.timeFrom) { where.push('note_time >= ?'); p.push(f.timeFrom); }
    if (f.timeTo)   { where.push('note_time <= ?'); p.push(f.timeTo); }
    if (f.category) { where.push('category = ?'); p.push(f.category); }
    const sql = 'SELECT * FROM notes' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY note_date DESC, note_time DESC';
    return rows(sql, p);
  }

  function get(id) {
    return rows('SELECT * FROM notes WHERE id = ?', [id])[0] || null;
  }

  async function save(n) {
    db.run(
      `INSERT INTO notes (id, title, note_date, note_time, category, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, note_date = excluded.note_date, note_time = excluded.note_time,
         category = excluded.category, content = excluded.content, updated_at = excluded.updated_at`,
      [n.id, n.title, n.date, n.time, n.category, n.content, n.createdAt, n.updatedAt]
    );
    await persist();
  }

  async function remove(id) {
    db.run('DELETE FROM notes WHERE id = ?', [id]);
    await persist();
  }

  function exportDb() {
    return db.export();
  }

  return {
    name: 'sqlite',
    label: 'SQLite',
    init, list, get, save, remove, exportDb,
    all: () => list({}),
    where: () => 'База данных ' + DB_FILE + ' (' + backend + '), таблица notes'
  };
})();
