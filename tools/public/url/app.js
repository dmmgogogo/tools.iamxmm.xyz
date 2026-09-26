(() => {
  'use strict';

  // ---------- 纯逻辑 ----------
  function encode(s, mode) {
    try {
      return mode === 'uri' ? encodeURI(s) : encodeURIComponent(s);
    } catch (e) {
      throw new Error('包含不成对的代理字符（残缺的 emoji 等），无法编码');
    }
  }

  // 解码失败时尽量指出第一个出错的位置（1 起始字符序号）
  function decode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      const bad = /%(?![0-9a-fA-F]{2})/.exec(s);
      if (bad) throw new Error(`第 ${bad.index + 1} 个字符处的 % 后面不是两位十六进制`);
      const re = /(?:%[0-9a-fA-F]{2})+/g;
      let m;
      while ((m = re.exec(s)) !== null) {
        try { decodeURIComponent(m[0]); } catch (e2) {
          throw new Error(`第 ${m.index + 1} 个字符起的 ${m[0].length > 24 ? m[0].slice(0, 24) + '…' : m[0]} 不是合法的 UTF-8 编码序列`);
        }
      }
      throw new Error('包含非法的百分号编码');
    }
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  // 返回 { parts: [[名称, 值, 备注]], params: [[键, 值]] }，值已解码
  function parseUrl(str) {
    const s = str.trim();
    let u;
    try {
      u = new URL(s);
    } catch (e) {
      throw new Error(/^[a-z][a-z0-9+.-]*:/i.test(s) ? '不是合法的 URL' : '不是合法的完整 URL（缺少协议，如 https://）');
    }
    const parts = [['protocol', u.protocol]];
    if (u.username) parts.push(['username', safeDecode(u.username)]);
    if (u.password) parts.push(['password', safeDecode(u.password)]);
    parts.push(
      ['host', u.host],
      ['hostname', u.hostname],
      ['port', u.port, u.port ? '' : '（默认端口）'],
      ['pathname', u.pathname],
    );
    const decodedPath = safeDecode(u.pathname);
    if (decodedPath !== u.pathname) parts.push(['pathname 解码', decodedPath]);
    parts.push(['search', u.search], ['hash', u.hash], ['origin', u.origin === 'null' ? '' : u.origin]);
    return { parts, params: Array.from(u.searchParams) };
  }

  // ---------- 界面 ----------
  const { $, status, copy, debounce } = window.T;

  const input = $('#input');
  const output = $('#output');
  const st = $('#status');
  const urlIn = $('#urlIn');
  let mode = 'comp';

  const TITLES = { comp: ['原文', '编码结果'], uri: ['原文', '编码结果'], dec: ['编码文本', '解码结果'] };

  function run() {
    status(st, '');
    const s = input.value;
    $('#inMeta').textContent = s ? `${s.length} 字符` : '';
    if (!s) { output.value = ''; $('#outMeta').textContent = ''; return; }
    try {
      output.value = mode === 'dec' ? decode(s) : encode(s, mode);
    } catch (e) {
      output.value = '';
      status(st, (mode === 'dec' ? '解码失败：' : '编码失败：') + e.message, 'err');
    }
    $('#outMeta').textContent = output.value ? `${output.value.length} 字符` : '';
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#inTitle').textContent = TITLES[m][0];
    $('#outTitle').textContent = TITLES[m][1];
    run();
  }

  function valueCell(value, empty) {
    const td = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'val';
    if (value === '') {
      span.classList.add('dim');
      span.textContent = empty || '（空）';
      td.appendChild(span);
      return td;
    }
    span.textContent = value;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tbtn';
    btn.textContent = '复制';
    btn.addEventListener('click', () => copy(value));
    td.append(span, btn);
    return td;
  }

  function runParse() {
    const pst = $('#parseStatus');
    const parts = $('#parts');
    const query = $('#query');
    status(pst, '');
    parts.textContent = '';
    query.textContent = '';
    $('#qHead').hidden = true;
    $('#qTable').hidden = true;
    if (!urlIn.value.trim()) return;
    let r;
    try { r = parseUrl(urlIn.value); } catch (e) { status(pst, e.message, 'err'); return; }

    for (const [name, value, note] of r.parts) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = name;
      tr.append(th, valueCell(value, note));
      parts.appendChild(tr);
    }
    if (!r.params.length) return;
    $('#qMeta').textContent = `${r.params.length} 项（已解码，+ 视为空格）`;
    for (const [k, v] of r.params) {
      const tr = document.createElement('tr');
      tr.append(valueCell(k), valueCell(v));
      query.appendChild(tr);
    }
    $('#qHead').hidden = false;
    $('#qTable').hidden = false;
  }

  // ---------- 事件 ----------
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  input.addEventListener('input', debounce(run, 120));
  urlIn.addEventListener('input', debounce(runParse, 120));

  $('#swap').addEventListener('click', () => {
    if (!output.value) { status(st, '没有可作为输入的结果', 'err'); return; }
    input.value = output.value;
    setMode(mode === 'dec' ? 'comp' : 'dec');
  });

  run();
})();
