/*
 * Деловые заметки: создание, редактирование, удаление и поиск заметок
 * о совещаниях, собраниях, конференциях и деловых встречах.
 */
(() => {
  const CATEGORIES = ['Совещание', 'Планёрка', 'Собрание', 'Конференция', 'Деловая встреча', 'Другое'];
  const STORAGES = { sqlite: SqliteStorage, files: FileStorage };

  const $ = id => document.getElementById(id);
  let store = null;
  let currentId = null;
  let editingId = null;
  let screenStack = ['screenList'];

  /* ---------- вспомогательные функции ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d + '.' + m + '.' + y;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const re = new RegExp('(' + escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function confirmAction(text, yesLabel = 'Удалить', noLabel = 'Отмена') {
    return new Promise(resolve => {
      const dlg = $('confirmDialog');
      $('confirmText').textContent = text;
      $('confirmYes').textContent = yesLabel;
      $('confirmNo').textContent = noLabel;
      const done = v => { dlg.close(); $('confirmYes').onclick = $('confirmNo').onclick = null; resolve(v); };
      $('confirmYes').onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
      dlg.showModal();
    });
  }

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- навигация между экранами ---------- */

  const TITLES = {
    screenList: 'Мои заметки',
    screenView: 'Заметка',
    screenEdit: 'Новая заметка',
    screenSettings: 'Настройки'
  };

  function show(id, push = true) {
    $('toast').classList.remove('show');
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (push) screenStack.push(id);
    $('screenTitle').textContent = id === 'screenEdit' && editingId ? 'Редактирование' : TITLES[id];
    $('btnBack').hidden = id === 'screenList';
    $('btnSettings').hidden = id !== 'screenList';
    window.scrollTo(0, 0);
  }

  async function back() {
    const top = screenStack[screenStack.length - 1];
    if (top === 'screenEdit' && editorChanged()) {
      const leave = await confirmAction('В заметке есть несохранённые изменения. Выйти без сохранения?', 'Выйти', 'Остаться');
      if (!leave) return;
    }
    if (top === 'screenEdit') editingId = null;
    if (screenStack.length > 1) screenStack.pop();
    const prev = screenStack[screenStack.length - 1];
    if (prev === 'screenList') renderList();
    if (prev === 'screenView') renderView(currentId);
    show(prev, false);
  }

  function goHome() {
    screenStack = ['screenList'];
    renderList();
    show('screenList', false);
  }

  /* ---------- список и поиск ---------- */

  function currentFilter() {
    return {
      text: $('searchText').value.trim(),
      dateFrom: $('fDateFrom').value,
      dateTo: $('fDateTo').value,
      timeFrom: $('fTimeFrom').value,
      timeTo: $('fTimeTo').value,
      category: $('fCategory').value
    };
  }

  function renderList() {
    const f = currentFilter();
    const notes = store.list(f);
    const filtered = Object.values(f).some(Boolean);
    const extra = ['dateFrom', 'dateTo', 'timeFrom', 'timeTo', 'category'].filter(k => f[k]).length;
    $('filterCount').textContent = extra;
    $('filterCount').hidden = extra === 0;
    $('btnClearAll').hidden = !filtered;
    const ul = $('noteList');
    ul.innerHTML = '';
    notes.forEach(n => {
      const li = document.createElement('li');
      li.dataset.id = n.id;
      li.innerHTML =
        '<p class="title">' + highlight(n.title, f.text) + '</p>' +
        '<div class="meta">' + formatDate(n.date) + ' · ' + n.time + ' · <span class="tag">' + escapeHtml(n.category) + '</span></div>' +
        (n.content ? '<div class="preview">' + highlight(n.content, f.text) + '</div>' : '');
      li.addEventListener('click', () => openNote(n.id));
      ul.appendChild(li);
    });
    $('emptyState').hidden = notes.length > 0 || filtered;
    $('resultInfo').textContent = filtered
      ? (notes.length ? 'Найдено заметок: ' + notes.length : 'По заданным условиям ничего не найдено')
      : (notes.length ? 'Всего заметок: ' + notes.length : '');
  }

  /* ---------- просмотр ---------- */

  function renderView(id) {
    const n = store.get(id);
    if (!n) return false;
    $('vTitle').textContent = n.title;
    $('vDate').textContent = formatDate(n.date);
    $('vTime').textContent = n.time;
    $('vCategory').textContent = n.category;
    $('vContent').textContent = n.content || '(без текста)';
    $('vUpdated').textContent = 'Изменено: ' + new Date(n.updatedAt).toLocaleString('ru-RU');
    return true;
  }

  function openNote(id) {
    currentId = id;
    if (renderView(id)) show('screenView');
  }

  /* ---------- создание и редактирование ---------- */

  let editorSnapshot = '';

  function editorState() {
    return ['eTitle', 'eDate', 'eTime', 'eCategory', 'eContent'].map(id => $(id).value).join('\u0001');
  }

  function editorChanged() {
    return editorState() !== editorSnapshot;
  }

  function openEditor(id) {
    editingId = id || null;
    const n = id ? store.get(id) : null;
    $('eTitle').value = n ? n.title : '';
    $('eDate').value = n ? n.date : today();
    $('eTime').value = n ? n.time : nowTime();
    $('eCategory').value = n ? n.category : CATEGORIES[0];
    $('eContent').value = n ? n.content : '';
    editorSnapshot = editorState();
    $('eTitle').classList.remove('invalid');
    $('eTitleError').hidden = true;
    show('screenEdit');
    if (!id) $('eTitle').focus();
  }

  async function saveNote(e) {
    e.preventDefault();
    const title = $('eTitle').value.trim();
    if (!title) {
      $('eTitle').classList.add('invalid');
      $('eTitleError').hidden = false;
      $('eTitle').focus();
      return;
    }
    const old = editingId ? store.get(editingId) : null;
    const stamp = new Date().toISOString();
    const note = {
      id: old ? old.id : uid(),
      title,
      date: $('eDate').value || today(),
      time: $('eTime').value || nowTime(),
      category: $('eCategory').value,
      content: $('eContent').value.trim(),
      createdAt: old ? old.createdAt : stamp,
      updatedAt: stamp
    };
    await store.save(note);
    toast(old ? 'Изменения сохранены' : 'Заметка создана');
    currentId = note.id;
    editingId = null;
    if (old) {
      screenStack.pop();
      renderView(note.id);
      show('screenView', false);
    } else {
      goHome();
    }
  }

  async function deleteNote() {
    const n = store.get(currentId);
    if (!n) return;
    const ok = await confirmAction('Удалить заметку «' + n.title + '»? Отменить удаление будет нельзя.');
    if (!ok) return;
    await store.remove(n.id);
    toast('Заметка удалена');
    goHome();
  }

  function noteAsText(n) {
    return n.title + '\n' + formatDate(n.date) + ' ' + n.time + ' | ' + n.category + '\n\n' + n.content + '\n';
  }

  /* ---------- хранилища ---------- */

  async function useStorage(name) {
    store = STORAGES[name] || SqliteStorage;
    await store.init();
    localStorage.setItem('notes.storage', store.name);
    $('storageBadge').textContent = store.label;
    document.querySelectorAll('input[name=storage]').forEach(r => { r.checked = r.value === store.name; });
    $('storageInfo').textContent = 'Сейчас: ' + store.where();
    $('btnExportDb').hidden = store.name !== 'sqlite';
  }

  async function copyToOther() {
    const other = store.name === 'sqlite' ? FileStorage : SqliteStorage;
    await other.init();
    const notes = store.all();
    for (const n of notes) await other.save(n);
    toast('Скопировано заметок: ' + notes.length + ' → ' + other.label);
  }

  async function importFile(file) {
    const text = await file.text();
    let notes = [];
    try {
      const data = JSON.parse(text);
      notes = Array.isArray(data) ? data : [data];
    } catch (e) {
      const lines = text.split(/\r?\n/);
      notes = [{ title: lines[0] || file.name, content: lines.slice(1).join('\n').trim() }];
    }
    let count = 0;
    const stamp = new Date().toISOString();
    for (const raw of notes) {
      if (!raw || !raw.title) continue;
      await store.save({
        id: raw.id || uid(),
        title: String(raw.title).slice(0, 120),
        date: raw.date || today(),
        time: raw.time || nowTime(),
        category: CATEGORIES.includes(raw.category) ? raw.category : 'Другое',
        content: raw.content || '',
        createdAt: raw.createdAt || stamp,
        updatedAt: raw.updatedAt || stamp
      });
      count++;
    }
    toast('Загружено заметок: ' + count);
    $('storageInfo').textContent = 'Сейчас: ' + store.where();
  }

  async function addDemo() {
    const d = new Date();
    const day = k => { const x = new Date(d); x.setDate(d.getDate() - k); return x.toISOString().slice(0, 10); };
    const demo = [
      ['Планёрка управляющих', 0, '10:30', 'Планёрка', 'Выручка за выходные выше плана на 6 %.\nКонтроль выдачи заказов доставки: не более 25 минут.\nОтветственный за стоп-лист - шеф смены.'],
      ['Совещание по банкетному сезону', 1, '15:00', 'Совещание', 'Новогодние корпоративы: загрузка залов на декабрь 78 %.\nПодготовить банкетное меню до 20.11.\nСогласовать с маркетингом рассылку гостям Primus Friends.'],
      ['Встреча с поставщиком пива', 3, '12:00', 'Деловая встреча', 'Обсудили сезонные сорта и гостевой кран.\nПоставщик даёт отсрочку 14 дней.\nЗапросить коммерческое предложение по бельгийским элям.'],
      ['Собрание персонала зала', 5, '11:00', 'Собрание', 'Новые стандарты подачи сетов.\nГрафик на матчи: усиление смены на 2 официантов.\nНапомнить про карту гостя при расчёте.'],
      ['Конференция по ресторанным технологиям', 9, '14:00', 'Конференция', 'Доклады про электронные очереди, QR-меню и аналитику продаж.\nИдея: сравнить нашу систему бронирования с решениями на рынке.']
    ];
    const stamp = new Date().toISOString();
    for (const [title, k, time, category, content] of demo) {
      await store.save({ id: uid(), title, date: day(k), time, category, content, createdAt: stamp, updatedAt: stamp });
    }
    toast('Добавлено 5 примеров');
    $('storageInfo').textContent = 'Сейчас: ' + store.where();
  }

  /* ---------- обработчики ---------- */

  function bind() {
    CATEGORIES.forEach(c => {
      $('eCategory').add(new Option(c, c));
      $('fCategory').add(new Option(c, c));
    });

    $('btnAdd').onclick = () => openEditor(null);
    $('btnBack').onclick = back;
    $('btnSettings').onclick = () => { $('storageInfo').textContent = 'Сейчас: ' + store.where(); show('screenSettings'); };
    $('btnEdit').onclick = () => openEditor(currentId);
    $('btnDelete').onclick = deleteNote;
    $('btnCancel').onclick = back;
    $('noteForm').addEventListener('submit', saveNote);
    $('eTitle').addEventListener('input', () => {
      $('eTitle').classList.remove('invalid');
      $('eTitleError').hidden = true;
    });

    let timer = null;
    $('searchText').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderList, 200); });
    ['fDateFrom', 'fDateTo', 'fTimeFrom', 'fTimeTo', 'fCategory'].forEach(id => $(id).addEventListener('change', renderList));
    $('btnFilters').onclick = () => {
      const f = $('filters');
      f.hidden = !f.hidden;
      $('btnFilters').setAttribute('aria-expanded', String(!f.hidden));
    };
    const resetAll = () => {
      ['searchText', 'fDateFrom', 'fDateTo', 'fTimeFrom', 'fTimeTo', 'fCategory'].forEach(id => { $(id).value = ''; });
      renderList();
    };
    $('btnResetFilters').onclick = resetAll;
    $('btnClearAll').onclick = resetAll;

    document.querySelectorAll('input[name=storage]').forEach(r => r.addEventListener('change', async () => {
      const prev = store;
      const target = STORAGES[r.value];
      await target.init();
      const count = prev.all().length;
      if (count && !target.all().length) {
        const copy = await confirmAction('В новом хранилище пока нет заметок. Перенести туда ' + count + ' заметок из «' + prev.label + '»?', 'Перенести', 'Нет');
        if (copy) for (const n of prev.all()) await target.save(n);
      }
      await useStorage(r.value);
      toast('Хранилище: ' + store.label);
    }));
    $('btnCopyToOther').onclick = copyToOther;
    $('btnExportAll').onclick = () => download('notes-' + today() + '.json', JSON.stringify(store.all(), null, 2), 'application/json');
    $('btnExportDb').onclick = () => download('notes.sqlite', new Blob([SqliteStorage.exportDb()], { type: 'application/x-sqlite3' }));
    $('btnExportOne').onclick = () => {
      const n = store.get(currentId);
      if (n) download(n.title.replace(/[\\/:*?"<>|]/g, '_') + '.txt', noteAsText(n), 'text/plain');
    };
    $('importFile').addEventListener('change', async e => {
      if (e.target.files[0]) await importFile(e.target.files[0]);
      e.target.value = '';
    });
    $('btnDemo').onclick = addDemo;

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('confirmDialog').open && screenStack.length > 1) back();
    });
  }

  async function start() {
    bind();
    try {
      await useStorage(localStorage.getItem('notes.storage') || 'sqlite');
    } catch (e) {
      await useStorage('files');
      toast('SQLite недоступна, включено хранение в файлах');
    }
    renderList();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  start();
})();
