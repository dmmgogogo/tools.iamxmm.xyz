(() => {
  'use strict';

  // ---------- 纯逻辑 ----------
  const MAX_MATCHES = 1000;  // 与 worker.js 保持一致
  const TIMEOUT_MS = 1500;

  const PRESETS = {
    mobile: '\\b1[3-9]\\d{9}\\b',
    email: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
    url: 'https?:\\/\\/[\\w.-]+(?::\\d+)?(?:[/?#][^\\s]*)?',
    ipv4: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b',
    idcard: '\\b[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]\\b',
    han: '[\\u4e00-\\u9fff]+',
  };

  // 把文本切成普通段与匹配段，供高亮渲染
  function segments(text, matches) {
    const out = [];
    let pos = 0;
    matches.forEach((m, i) => {
      if (m.index > pos) out.push({ mark: false, s: text.slice(pos, m.index) });
      out.push({ mark: true, s: m.text, n: i });
      pos = Math.max(pos, m.index + m.text.length);
    });
    if (pos < text.length) out.push({ mark: false, s: text.slice(pos) });
    return out;
  }

  // ---------- 界面 ----------
  const { $, status, debounce } = window.T;

  const pattern = $('#pattern');
  const text = $('#text');
  const rep = $('#rep');
  const hl = $('#hl');
  const list = $('#list');
  const st = $('#status');
  const flagBoxes = Array.from(document.querySelectorAll('[data-flag]'));

  const flags = () => flagBoxes.filter((b) => b.checked).map((b) => b.dataset.flag).join('');

  function renderHighlight(t, matches) {
    const frag = document.createDocumentFragment();
    for (const seg of segments(t, matches)) {
      if (!seg.mark) { frag.appendChild(document.createTextNode(seg.s)); continue; }
      const mk = document.createElement('mark');
      if (seg.s === '') mk.className = 'empty';
      else if (seg.n % 2) mk.className = 'alt';
      mk.textContent = seg.s;
      frag.appendChild(mk);
    }
    hl.textContent = '';
    hl.appendChild(frag);
  }

  function cell(tr, value, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (value instanceof Node) td.appendChild(value); else td.textContent = value;
    tr.appendChild(td);
    return td;
  }

  function groupLine(label, value) {
    const span = document.createElement('span');
    span.className = 'grp';
    const b = document.createElement('b');
    b.textContent = label + ' ';
    span.append(b, document.createTextNode(value === undefined ? '（未参与匹配）' : JSON.stringify(value)));
    return span;
  }

  function renderList(matches) {
    const frag = document.createDocumentFragment();
    matches.forEach((m, i) => {
      const tr = document.createElement('tr');
      cell(tr, String(i + 1));
      cell(tr, `${m.index}–${m.index + m.text.length}`);
      cell(tr, m.text === '' ? '（空匹配）' : m.text, m.text === '' ? 'none' : '');
      const g = document.createElement('div');
      m.groups.forEach((v, k) => g.appendChild(groupLine('$' + (k + 1), v)));
      if (m.named) for (const [name, v] of Object.entries(m.named)) g.appendChild(groupLine(`$<${name}>`, v));
      if (!g.childNodes.length) { g.className = 'none'; g.textContent = '—'; }
      cell(tr, g);
      frag.appendChild(tr);
    });
    list.textContent = '';
    list.appendChild(frag);
  }

  function run() {
    const src = pattern.value;
    const t = text.value;
    const fl = flags();
    status(st, '');
    $('#inMeta').textContent = t ? `${t.length} 字符` : '';
    $('#hitMeta').textContent = '';
    $('#listMeta').textContent = '';
    $('#repMeta').textContent = '';

    if (!src) {
      cancel();
      hl.textContent = t;
      list.textContent = '';
      $('#repOut').value = '';
      return;
    }
    exec({ src, flags: fl, text: t, rep: rep.value }).then((res) => {
      if (!res) return; // 已被更新的输入取代
      if (!res.ok) {
        hl.textContent = t;
        list.textContent = '';
        $('#repOut').value = '';
        status(st, res.timeout ? res.error : '正则语法错误：' + res.error, 'err');
        return;
      }
      render(t, fl, res);
    });
  }

  // ---------- Worker：超时即重建，防止灾难性回溯卡死页面 ----------
  let worker = null;
  let seq = 0;
  let pending = null; // { id, resolve, timer }

  // 取消进行中的任务：Worker 还在跑旧正则（可能正卡在回溯里），直接终止重建
  function cancel() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(null);
    pending = null;
    if (worker) { worker.terminate(); worker = null; }
  }

  function exec(job) {
    cancel();
    if (!worker) worker = new Worker('/regex/worker.js?v=1');
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        worker = null;
        pending = null;
        resolve({ ok: false, timeout: true, error: `匹配超过 ${TIMEOUT_MS / 1000} 秒已中止：正则可能存在灾难性回溯（如 (a+)+），请修改后重试` });
      }, TIMEOUT_MS);
      pending = { id, resolve, timer };
      worker.onmessage = (e) => {
        if (!pending || e.data.id !== pending.id) return;
        clearTimeout(pending.timer);
        pending = null;
        resolve(e.data);
      };
      worker.postMessage({ id, ...job });
    });
  }

  function render(t, fl, res) {
    const { matches, truncated } = res;
    renderHighlight(t, matches);
    renderList(matches);
    const count = matches.length ? `${matches.length}${truncated ? '+' : ''} 处匹配` : '无匹配';
    $('#hitMeta').textContent = count;
    $('#listMeta').textContent = count + (fl.includes('g') ? '' : '（未开 g，只取第一个）');
    if (truncated) status(st, `匹配超过 ${MAX_MATCHES} 处，高亮和列表只显示前 ${MAX_MATCHES} 处（替换结果不受影响）`, 'err');

    $('#repOut').value = res.replaced;
    $('#repMeta').textContent = matches.length ? `替换 ${matches.length}${truncated ? '+' : ''} 处` : '';
  }

  // ---------- 事件 ----------
  const runSoon = debounce(run, 120);
  const runLater = debounce(run, 400);
  const schedule = () => (text.value.length > 200000 ? runLater() : runSoon());
  pattern.addEventListener('input', schedule);
  text.addEventListener('input', schedule);
  rep.addEventListener('input', schedule);
  flagBoxes.forEach((b) => b.addEventListener('change', run));

  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    pattern.value = PRESETS[b.dataset.preset];
    flagBoxes.forEach((x) => { x.checked = x.dataset.flag === 'g'; });
    run();
    pattern.focus();
  }));

  run();
})();
