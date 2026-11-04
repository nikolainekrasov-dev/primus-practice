/*
 * Машина логического вывода продукционной экспертной системы.
 * Прямой вывод (от фактов к целям) с разрешением конфликтов по приоритету
 * правила (salience) и коэффициентами уверенности в духе MYCIN/EMYCIN.
 *
 * Факт: { attr, value, cf, by } - атрибут, значение, уверенность 0..1, кто вывел.
 * Правило: { id, name, salience, if: [условия], then: [заключения], note }.
 * Условия: { attr, eq }, { attr, in: [...] }, { attr, not: value },
 *          { attr, absent: true }, { attr, countGte: n, minCf }.
 */
(function (root) {
  const THRESHOLD = 0.2;

  class Engine {
    constructor(kb) {
      this.kb = kb;
      this.reset();
    }

    reset() {
      this.facts = new Map();
      this.fired = new Set();
      this.trace = [];
    }

    key(attr, value) {
      return attr + '=' + value;
    }

    assert(attr, value, cf, by) {
      const k = this.key(attr, value);
      const old = this.facts.get(k);
      if (!old) {
        this.facts.set(k, { attr, value, cf, by: [by] });
        return cf;
      }
      // объединение уверенности (формулы MYCIN): подтверждение и опровержение
      let next;
      if (old.cf >= 0 && cf >= 0) next = old.cf + cf * (1 - old.cf);
      else if (old.cf < 0 && cf < 0) next = old.cf + cf * (1 + old.cf);
      else next = (old.cf + cf) / (1 - Math.min(Math.abs(old.cf), Math.abs(cf)));
      old.cf = +next.toFixed(4);
      old.by.push(by);
      return old.cf;
    }

    valuesOf(attr, minCf = THRESHOLD) {
      return [...this.facts.values()].filter(f => f.attr === attr && f.cf >= minCf);
    }

    /* возвращает уверенность выполнения условия или 0 */
    test(c) {
      const vals = this.valuesOf(c.attr);
      if (c.absent) return vals.length === 0 ? 1 : 0;
      if (c.countGte !== undefined) {
        return this.valuesOf(c.attr, c.minCf || THRESHOLD).length >= c.countGte ? 1 : 0;
      }
      if (c.not !== undefined) {
        return vals.length > 0 && vals.every(f => f.value !== c.not) ? 1 : 0;
      }
      const allowed = c.in || [c.eq];
      const hit = vals.filter(f => allowed.includes(f.value));
      return hit.length ? Math.max(...hit.map(f => f.cf)) : 0;
    }

    matchRule(rule) {
      let cf = 1;
      for (const c of rule.if) {
        const v = this.test(c);
        if (v < THRESHOLD) return 0;
        cf = Math.min(cf, v);
      }
      return cf;
    }

    /* один цикл: сопоставление, разрешение конфликта, срабатывание */
    step() {
      const agenda = [];
      for (const rule of this.kb.rules) {
        if (this.fired.has(rule.id)) continue;
        const cf = this.matchRule(rule);
        if (cf > 0) agenda.push({ rule, cf });
      }
      if (!agenda.length) return false;
      agenda.sort((a, b) => (b.rule.salience || 0) - (a.rule.salience || 0));
      const { rule, cf } = agenda[0];
      this.fired.add(rule.id);
      const results = rule.then.map(t => {
        const value = +(cf * t.cf).toFixed(4);
        const total = this.assert(t.attr, t.value, value, rule.id);
        return { attr: t.attr, value: t.value, cf: value, total };
      });
      this.trace.push({ rule, cf, results });
      return true;
    }

    run(answers) {
      this.reset();
      for (const [attr, value] of Object.entries(answers)) {
        if (value !== undefined && value !== '') this.assert(attr, value, 1, 'ответ пользователя');
      }
      let guard = 0;
      while (this.step() && guard++ < 500) { /* цикл до исчерпания агенды */ }
      return this.result();
    }

    result() {
      const styles = this.valuesOf(this.kb.goal)
        .sort((a, b) => b.cf - a.cf)
        .map(f => Object.assign({ style: f.value, cf: f.cf, rules: f.by }, this.kb.catalogue[f.value] || {}));
      const advice = this.valuesOf('совет').map(f => f.value);
      return { styles, advice, trace: this.trace, facts: [...this.facts.values()] };
    }

    /* правила, в условиях которых участвует атрибут (ответ на вопрос «зачем спрашиваем») */
    rulesUsing(attr) {
      return this.kb.rules.filter(r => r.if.some(c => c.attr === attr));
    }

    static describe(rule, labels) {
      const lbl = (a, v) => (labels && labels[a + '=' + v]) || v;
      const cond = rule.if.map(c => {
        if (c.absent) return 'нет выводов «' + c.attr + '»';
        if (c.countGte !== undefined) return 'выведено не менее ' + c.countGte + ' значений «' + c.attr + '» с КУ ≥ ' + (c.minCf || THRESHOLD);
        if (c.not !== undefined) return c.attr + ' ≠ ' + lbl(c.attr, c.not);
        if (c.in) return c.attr + ' ∈ {' + c.in.map(v => lbl(c.attr, v)).join(', ') + '}';
        return c.attr + ' = ' + lbl(c.attr, c.eq);
      }).join(' И ');
      const then = rule.then.map(t => t.attr + ' = ' + lbl(t.attr, t.value) + ' (КУ ' + t.cf + ')').join('; ');
      return 'ЕСЛИ ' + cond + ' ТО ' + then;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
