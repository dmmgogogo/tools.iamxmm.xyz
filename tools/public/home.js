(() => {
  'use strict';

  const root = document.getElementById('catalog');
  const input = document.getElementById('q');
  const empty = document.getElementById('empty');
  const tally = document.getElementById('tally');

  // 渲染分类与条目，编号全站连续
  let n = 0;
  const rows = [];
  for (const group of window.TOOLS) {
    const sec = document.createElement('section');
    sec.className = 'cat';
    const head = document.createElement('div');
    head.className = 'cat-head';
    const h2 = document.createElement('h2');
    h2.textContent = group.cat;
    const cnt = document.createElement('span');
    cnt.className = 'cat-count';
    head.append(h2, cnt);
    const list = document.createElement('div');
    list.className = 'items';
    for (const it of group.items) {
      n++;
      const a = document.createElement('a');
      a.className = 'item';
      a.href = '/' + it.slug + '/';
      a.innerHTML = '<span class="no"></span><span class="body"><span class="name"></span><span class="desc"></span></span><span class="go" aria-hidden="true">→</span>';
      a.querySelector('.no').textContent = String(n).padStart(2, '0');
      a.querySelector('.name').textContent = it.name;
      a.querySelector('.desc').textContent = it.desc;
      a.title = it.desc;
      list.appendChild(a);
      rows.push({ el: a, sec, hay: [it.slug, it.name, it.desc, it.kw || ''].join(' ').toLowerCase() });
    }
    sec.append(head, list);
    root.appendChild(sec);
  }
  tally.textContent = String(n).padStart(2, '0') + ' 项';

  function filter() {
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = new Map();
    for (const r of rows) {
      const ok = terms.every((t) => r.hay.includes(t));
      r.el.hidden = !ok;
      if (ok) shown.set(r.sec, (shown.get(r.sec) || 0) + 1);
    }
    for (const sec of root.children) {
      const c = shown.get(sec) || 0;
      sec.hidden = c === 0;
      sec.querySelector('.cat-count').textContent = String(c).padStart(2, '0');
    }
    empty.hidden = shown.size > 0;
  }

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = rows.find((r) => !r.el.hidden);
      if (first) location.href = first.el.href;
    } else if (e.key === 'Escape') {
      input.value = '';
      filter();
      input.blur();
    }
  });
  // 按 / 聚焦搜索
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
  filter();
})();
