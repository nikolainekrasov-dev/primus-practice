(() => {
  const engine = new Engine(KB);
  const answers = {};
  let step = 0;

  const $ = id => document.getElementById(id);
  const label = (attr, v) => KB.labels[attr + '=' + v] || v;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* вопросы, которые нужно задать при текущих ответах */
  function activeQuestions() {
    if (answers['алкоголь'] === 'нет') return KB.questions.slice(0, 1);
    return KB.questions;
  }

  function renderProgress() {
    const qs = activeQuestions();
    $('progress').innerHTML = qs.map((q, i) => '<span class="' + (i < step ? 'done' : '') + '"></span>').join('');
  }

  function renderQuestion() {
    const qs = activeQuestions();
    if (step >= qs.length) return showResult();
    const q = qs[step];
    renderProgress();
    $('result').hidden = true;
    $('question').hidden = false;
    const rules = engine.rulesUsing(q.attr);
    $('question').innerHTML =
      '<p class="muted">Вопрос ' + (step + 1) + ' из ' + qs.length + '</p>' +
      '<h2>' + esc(q.text) + '</h2>' +
      q.options.map(([v, t]) =>
        '<label class="option"><input type="radio" name="opt" value="' + esc(v) + '"' +
        (answers[q.attr] === v ? ' checked' : '') + '> ' + esc(t) + '</label>').join('') +
      '<div class="buttons">' +
      '<button class="btn secondary" id="btnPrev"' + (step === 0 ? ' disabled' : '') + '>Назад</button>' +
      '<button class="btn" id="btnNext"' + (answers[q.attr] ? '' : ' disabled') + '>Далее</button>' +
      '<button class="btn secondary" id="btnWhy">Зачем этот вопрос?</button>' +
      '</div>' +
      '<div class="why" id="why" hidden><b>Ответ используется в правилах:</b><ul>' +
      rules.map(r => '<li>' + r.id + ' «' + esc(r.name) + '»</li>').join('') + '</ul></div>';

    document.querySelectorAll('input[name=opt]').forEach(r => r.addEventListener('change', () => {
      answers[q.attr] = r.value;
      $('btnNext').disabled = false;
    }));
    $('btnPrev').onclick = () => { step--; renderQuestion(); };
    $('btnNext').onclick = () => { step++; renderQuestion(); };
    $('btnWhy').onclick = () => { $('why').hidden = !$('why').hidden; };
  }

  function showResult() {
    const qs = activeQuestions();
    const given = {};
    qs.forEach(q => { given[q.attr] = answers[q.attr]; });
    const r = engine.run(given);
    step = qs.length;
    renderProgress();
    $('question').hidden = true;
    const box = $('result');
    box.hidden = false;
    const recs = r.styles.slice(0, 3).map((s, i) =>
      '<div class="rec"><h3>' + (i + 1) + '. ' + esc(s.name || s.style) + '</h3>' +
      '<div>Предложить: <b>' + esc(s.items || '') + '</b></div>' +
      '<div class="muted">Подача: ' + esc(s.serve || '') + '</div>' +
      '<div class="bar"><i style="width:' + Math.round(s.cf * 100) + '%"></i></div>' +
      '<div class="muted">Уверенность: ' + Math.round(s.cf * 100) + ' % · правила: ' + s.rules.join(', ') + '</div></div>'
    ).join('');
    const advice = r.advice.map(a => '<div class="advice">' + esc(a) + '</div>').join('');
    const trace = r.trace.map(t =>
      '<li><b>' + t.rule.id + ' «' + esc(t.rule.name) + '»</b> (КУ условий ' + t.cf.toFixed(2) + ') → ' +
      t.results.map(x => esc(x.attr) + ' = ' + esc(label(x.attr, x.value)) + ' [' + x.total.toFixed(2) + ']').join('; ') +
      (t.rule.note ? '<br><span class="muted">' + esc(t.rule.note) + '</span>' : '') + '</li>'
    ).join('');
    box.innerHTML =
      '<h2>Рекомендация</h2>' +
      '<p class="answers">' + qs.map(q => esc(q.attr) + ': ' + esc(label(q.attr, answers[q.attr]))).join(' · ') + '</p>' +
      recs + advice +
      '<p class="muted">' + esc(KB.catalogueNote) + '</p>' +
      '<div class="buttons">' +
      '<button class="btn secondary" id="btnHow">Как получен вывод?</button>' +
      '<button class="btn secondary" id="btnChange">Изменить ответы</button>' +
      '<button class="btn" id="btnRestart">Новая консультация</button></div>' +
      '<div id="how" hidden><h2 style="margin-top:16px">Трасса логического вывода</h2>' +
      '<p class="muted">Правила в порядке срабатывания. В скобках - итоговый коэффициент уверенности факта.</p>' +
      '<ol class="trace">' + trace + '</ol></div>';
    $('btnHow').onclick = () => { $('how').hidden = !$('how').hidden; };
    $('btnChange').onclick = () => { step = 0; renderQuestion(); };
    $('btnRestart').onclick = () => { Object.keys(answers).forEach(k => delete answers[k]); step = 0; renderQuestion(); };
  }

  function renderKb() {
    $('rulesTable').querySelector('tbody').innerHTML = KB.rules.map(r =>
      '<tr><td>' + r.id + '</td><td><b>' + esc(r.name) + '.</b> ' + esc(Engine.describe(r, KB.labels)) + '</td><td>' + (r.salience || 0) + '</td></tr>'
    ).join('');
    $('catalogueNote').textContent = KB.catalogueNote;
    $('catalogueTable').querySelector('tbody').innerHTML = Object.values(KB.catalogue).map(c =>
      '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.items) + '</td><td>' + esc(c.serve) + '</td></tr>'
    ).join('');
  }

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === t.dataset.tab));
  }));

  renderKb();
  renderQuestion();
})();
