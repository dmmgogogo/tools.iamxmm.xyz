(() => {
  'use strict';

  // ---------- 纯逻辑 ----------
  const MAX_LINES = 50000;   // 每侧行数上限
  const TIMEOUT_MS = 3000;   // 超时后剩余部分按「整块删除 + 整块新增」处理，结果仍正确但不一定最短

  function splitLines(text) {
    if (text === '') return [];
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  // 线性空间 Myers（middle snake 分治，思路同 diff-match-patch 的 bisect）
  // a、b 为整数数组；返回 { ops: [[type, ai, bi]], timedOut }，type：0 相同 / -1 删除 / 1 新增
  function myers(a, b, deadline = Infinity) {
    const out = [];
    let timedOut = false;

    function whole(a0, a1, b0, b1) {
      for (let i = a0; i < a1; i++) out.push([-1, i, -1]);
      for (let j = b0; j < b1; j++) out.push([1, -1, j]);
    }

    function main(a0, a1, b0, b1) {
      while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { out.push([0, a0, b0]); a0++; b0++; }
      let s = 0;
      while (a1 - s > a0 && b1 - s > b0 && a[a1 - s - 1] === b[b1 - s - 1]) s++;
      const ae = a1 - s;
      const be = b1 - s;
      if (a0 === ae || b0 === be) whole(a0, ae, b0, be);
      else bisect(a0, ae, b0, be);
      for (let k = 0; k < s; k++) out.push([0, ae + k, be + k]);
    }

    function split(a0, a1, b0, b1, x, y) {
      main(a0, a0 + x, b0, b0 + y);
      main(a0 + x, a1, b0 + y, b1);
    }

    function bisect(a0, a1, b0, b1) {
      const n1 = a1 - a0;
      const n2 = b1 - b0;
      const maxD = Math.ceil((n1 + n2) / 2);
      const off = maxD;
      const vlen = 2 * maxD + 2;
      const v1 = new Int32Array(vlen).fill(-1);
      const v2 = new Int32Array(vlen).fill(-1);
      v1[off + 1] = 0;
      v2[off + 1] = 0;
      const delta = n1 - n2;
      const front = (delta & 1) !== 0; // 奇数时正向路径先检测重叠
      let k1s = 0, k1e = 0, k2s = 0, k2e = 0;

      for (let d = 0; d < maxD; d++) {
        if (Date.now() > deadline) { timedOut = true; break; }
        for (let k1 = -d + k1s; k1 <= d - k1e; k1 += 2) {
          const k1o = off + k1;
          let x1 = (k1 === -d || (k1 !== d && v1[k1o - 1] < v1[k1o + 1])) ? v1[k1o + 1] : v1[k1o - 1] + 1;
          let y1 = x1 - k1;
          while (x1 < n1 && y1 < n2 && a[a0 + x1] === b[b0 + y1]) { x1++; y1++; }
          v1[k1o] = x1;
          if (x1 > n1) k1e += 2;
          else if (y1 > n2) k1s += 2;
          else if (front) {
            const k2o = off + delta - k1;
            if (k2o >= 0 && k2o < vlen && v2[k2o] !== -1 && x1 >= n1 - v2[k2o]) {
              split(a0, a1, b0, b1, x1, y1);
              return;
            }
          }
        }
        for (let k2 = -d + k2s; k2 <= d - k2e; k2 += 2) {
          const k2o = off + k2;
          let x2 = (k2 === -d || (k2 !== d && v2[k2o - 1] < v2[k2o + 1])) ? v2[k2o + 1] : v2[k2o - 1] + 1;
          let y2 = x2 - k2;
          while (x2 < n1 && y2 < n2 && a[a1 - x2 - 1] === b[b1 - y2 - 1]) { x2++; y2++; }
          v2[k2o] = x2;
          if (x2 > n1) k2e += 2;
          else if (y2 > n2) k2s += 2;
          else if (!front) {
            const k1o = off + delta - k2;
            if (k1o >= 0 && k1o < vlen && v1[k1o] !== -1) {
              const x1 = v1[k1o];
              const y1 = off + x1 - k1o;
              if (x1 >= n1 - x2) { split(a0, a1, b0, b1, x1, y1); return; }
            }
          }
        }
      }
      whole(a0, a1, b0, b1);
    }

    main(0, a.length, 0, b.length);
    return { ops: out, timedOut };
  }

  // 每段连续改动内，先列删除再列新增
  function groupChanges(ops) {
    const res = [];
    let dels = [], adds = [];
    const flush = () => { res.push(...dels, ...adds); dels = []; adds = []; };
    for (const op of ops) {
      if (op[0] === 0) { flush(); res.push(op); } else (op[0] < 0 ? dels : adds).push(op);
    }
    flush();
    return res;
  }

  // 返回 { rows: [{ t, na, nb, s }], add, del, timedOut }；na/nb 为 1 起始行号，0 表示无
  function diffText(oldText, newText, opts = {}, timeoutMs = TIMEOUT_MS) {
    const A = splitLines(oldText);
    const B = splitLines(newText);
    if (A.length > MAX_LINES || B.length > MAX_LINES) {
      throw new Error(`行数过多（上限每侧 ${MAX_LINES} 行，当前 ${A.length} / ${B.length}）`);
    }
    const ids = new Map();
    const key = (s) => {
      let k = opts.trim ? s.trim() : s;
      if (opts.ignoreCase) k = k.toLowerCase();
      let id = ids.get(k);
      if (id === undefined) { id = ids.size; ids.set(k, id); }
      return id;
    };
    const a = A.map(key);
    const b = B.map(key);
    const { ops, timedOut } = myers(a, b, Date.now() + timeoutMs);
    let add = 0, del = 0;
    const rows = groupChanges(ops).map(([t, i, j]) => {
      if (t < 0) { del++; return { t, na: i + 1, nb: 0, s: A[i] }; }
      if (t > 0) { add++; return { t, na: 0, nb: j + 1, s: B[j] }; }
      return { t, na: i + 1, nb: j + 1, s: A[i] };
    });
    return { rows, add, del, timedOut };
  }

  // ---------- 界面 ----------
  const { $, status, debounce } = window.T;

  const ta = $('#a');
  const tb = $('#b');
  const out = $('#out');
  const st = $('#status');
  const MAX_RENDER = 20000;
  const AUTO_LIMIT = 500000; // 两侧总字符数超过此值时不实时对比，需点按钮

  const SIGN = { '-1': '-', 0: ' ', 1: '+' };
  const CLS = { '-1': 'row del', 0: 'row', 1: 'row add' };

  function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function render(rows, maxNo) {
    out.textContent = '';
    out.style.setProperty('--nw', Math.max(2, String(maxNo).length) + 'ch');
    const frag = document.createDocumentFragment();
    const n = Math.min(rows.length, MAX_RENDER);
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const div = document.createElement('div');
      div.className = CLS[r.t];
      div.append(span('n', r.na ? String(r.na) : ''), span('n', r.nb ? String(r.nb) : ''), span('sg', SIGN[r.t]), span('tx', r.s));
      frag.appendChild(div);
    }
    if (rows.length > n) frag.appendChild(span('more', `…… 还有 ${rows.length - n} 行未显示（仅渲染前 ${MAX_RENDER} 行）`));
    out.appendChild(frag);
  }

  function lineCount(t) { return splitLines(t).length; }

  function clearResult() {
    out.textContent = '';
    $('#statAdd').textContent = '';
    $('#statDel').textContent = '';
  }

  function run() {
    status(st, '');
    $('#aMeta').textContent = ta.value ? `${lineCount(ta.value)} 行` : '';
    $('#bMeta').textContent = tb.value ? `${lineCount(tb.value)} 行` : '';
    if (!ta.value && !tb.value) { clearResult(); return; }
    let res;
    try {
      res = diffText(ta.value, tb.value, { trim: $('#optTrim').checked, ignoreCase: $('#optCase').checked });
    } catch (e) {
      clearResult();
      status(st, e.message, 'err');
      return;
    }
    $('#statAdd').textContent = `+${res.add}`;
    $('#statDel').textContent = `-${res.del}`;
    render(res.rows, Math.max(lineCount(ta.value), lineCount(tb.value)));
    if (res.timedOut) status(st, `计算超过 ${TIMEOUT_MS / 1000} 秒，部分差异以整块替换显示（结果正确但不是最短）`, 'err');
    else if (!res.add && !res.del) status(st, '两边内容相同', 'ok');
  }

  function autoRun() {
    if (ta.value.length + tb.value.length > AUTO_LIMIT) {
      status(st, '文本较大，已暂停实时对比，请点「对比」');
      return;
    }
    run();
  }

  // ---------- 事件 ----------
  const autoLater = debounce(autoRun, 300);
  ta.addEventListener('input', autoLater);
  tb.addEventListener('input', autoLater);
  $('#run').addEventListener('click', run);
  $('#optTrim').addEventListener('change', autoRun);
  $('#optCase').addEventListener('change', autoRun);
  $('#swap').addEventListener('click', () => {
    const t = ta.value;
    ta.value = tb.value;
    tb.value = t;
    autoRun();
  });

  run();
})();
