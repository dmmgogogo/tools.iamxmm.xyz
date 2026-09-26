(() => {
  'use strict';

  // ---------- 纯逻辑 ----------
  // 字符偏移 → 1 起始的行号、列号
  function posToLineCol(text, pos) {
    const p = Math.max(0, Math.min(pos, text.length));
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < p; i++) {
      if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    }
    return { line, col: p - lineStart + 1 };
  }

  // 从各浏览器的 SyntaxError 消息里取行列号，取不到返回 null
  // V8: "... in JSON at position 7 (line 1 column 8)" / 旧版 "... at position 7"
  // Firefox: "... at line 1 column 8 of the JSON data"
  // Safari: 无位置信息
  function errLocation(msg, text) {
    let m = /line (\d+) column (\d+)/i.exec(msg);
    if (m) return { line: +m[1], col: +m[2] };
    m = /position (\d+)/i.exec(msg);
    if (m) return posToLineCol(text, +m[1]);
    if (/end of (JSON )?(input|data)/i.test(msg)) return posToLineCol(text, text.length);
    const pos = locateError(text);
    return pos === null ? null : posToLineCol(text, pos);
  }

  // 消息里没有位置时（如新版 V8 的 "Unexpected token ... is not valid JSON"、Safari）自己扫描定位。
  // 返回第一个出错字符的偏移；合法或无法判断（如嵌套过深）返回 null
  function locateError(text) {
    const n = text.length;
    const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    let i = 0;
    const fail = () => { throw i; };
    const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
    function string() {
      i++;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 34) { i++; return; }
        if (c < 0x20) fail();
        if (c === 92) {
          const e = text[i + 1];
          if (e && '"\\/bfnrt'.includes(e)) i += 2;
          else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
          else { i++; fail(); }
        } else i++;
      }
      fail();
    }
    function value() {
      ws();
      const c = text[i];
      if (c === '{') {
        i++; ws();
        if (text[i] === '}') { i++; return; }
        for (;;) {
          ws();
          if (text[i] !== '"') fail();
          string(); ws();
          if (text[i] !== ':') fail();
          i++; value(); ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; return; }
          fail();
        }
      }
      if (c === '[') {
        i++; ws();
        if (text[i] === ']') { i++; return; }
        for (;;) {
          value(); ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; return; }
          fail();
        }
      }
      if (c === '"') { string(); return; }
      if (c === '-' || (c >= '0' && c <= '9')) {
        NUM.lastIndex = i;
        if (!NUM.exec(text)) { i++; fail(); }
        i = NUM.lastIndex;
        if (/[.eE]/.test(text[i] || '')) { i++; fail(); } // 残缺的小数或指数，与 V8 一样指向其后一位
        return;
      }
      for (const w of ['true', 'false', 'null']) if (text.startsWith(w, i)) { i += w.length; return; }
      fail();
    }
    try {
      value(); ws();
      if (i < n) fail();
      return null;
    } catch (e) {
      return typeof e === 'number' ? e : null;
    }
  }

  // 找出超过安全整数范围的整数字面量（JSON.parse 会丢精度）。跳过字符串内容。
  function findBigInts(text, limit = 5) {
    const found = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) { // "
        i++;
        while (i < n) {
          const d = text.charCodeAt(i);
          if (d === 92) { i += 2; continue; }
          i++;
          if (d === 34) break;
        }
        continue;
      }
      if (c === 45 || (c >= 48 && c <= 57)) { // - 或数字
        const start = i;
        if (c === 45) i++;
        const digStart = i;
        while (i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
        const digits = i - digStart;
        let isInt = true;
        while (i < n && /[0-9.eE+-]/.test(text[i])) { isInt = false; i++; }
        if (isInt && digits > 15) {
          const raw = text.slice(start, i);
          const abs = BigInt(raw.replace('-', ''));
          if (abs > BigInt(Number.MAX_SAFE_INTEGER)) {
            found.push({ pos: start, raw });
            if (found.length >= limit) break;
          }
        }
        continue;
      }
      i++;
    }
    return found;
  }

  function sortKeysDeep(v) {
    if (Array.isArray(v)) return v.map(sortKeysDeep);
    if (v && typeof v === 'object') {
      const o = {};
      // 用 defineProperty 而不是赋值，避免 "__proto__" 键触发原型 setter 被吞掉
      for (const k of Object.keys(v).sort()) {
        Object.defineProperty(o, k, { value: sortKeysDeep(v[k]), enumerable: true, writable: true, configurable: true });
      }
      return o;
    }
    return v;
  }

  // JSON 文本 → JS 字符串字面量内容（不含两侧引号）
  function escapeText(text) {
    return JSON.stringify(text).slice(1, -1);
  }

  // 反向：接受带或不带两侧双引号的转义串
  function unescapeText(s) {
    const t = s.trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
      try { return JSON.parse(t); } catch (e) { /* 两侧引号可能是内容本身，继续按无引号处理 */ }
    }
    // 复制时常带上的尾部换行不属于内容
    return JSON.parse('"' + s.replace(/[\r\n]+$/, '') + '"');
  }

  // ---------- 界面 ----------
  const { $, status, debounce } = window.T;

  const input = $('#input');
  const output = $('#output');
  const st = $('#status');
  const warn = $('#warn');
  const sortKeys = $('#sortKeys');

  let op = 'format';
  let indent = '2';

  const TITLES = {
    format: ['JSON', '格式化结果'],
    minify: ['JSON', '压缩结果'],
    escape: ['JSON', '转义后的字符串'],
    unescape: ['转义字符串', '去转义结果'],
  };

  function showParseError(e, text) {
    const loc = errLocation(e.message, text);
    const where = loc ? `第 ${loc.line} 行第 ${loc.col} 列 · ` : '';
    status(st, `JSON 无效：${where}${e.message}`, 'err');
  }

  function showBigIntWarn(text) {
    const big = findBigInts(text);
    if (!big.length) { warn.hidden = true; return; }
    const list = big.map((b) => {
      const { line, col } = posToLineCol(text, b.pos);
      return `${b.raw}（${line}:${col}）`;
    }).join('、');
    warn.textContent = `注意：存在超过 2^53 的整数，JSON.parse 后精度会丢失，结果里的这些数字可能已被改变：${list}`;
    warn.hidden = false;
  }

  function run() {
    const text = input.value;
    status(st, '');
    warn.hidden = true;
    $('#inMeta').textContent = text ? `${text.length} 字符` : '';
    if (!text.trim()) { output.value = ''; $('#outMeta').textContent = ''; return; }

    if (op === 'unescape') {
      try {
        output.value = unescapeText(text);
        status(st, '去转义成功', 'ok');
      } catch (e) {
        output.value = '';
        status(st, '去转义失败：内容不是合法的转义字符串（' + e.message + '）', 'err');
      }
    } else if (op === 'escape') {
      output.value = escapeText(text);
      try { JSON.parse(text); status(st, 'JSON 有效', 'ok'); } catch (e) { showParseError(e, text); }
    } else {
      let v;
      try {
        v = JSON.parse(text);
      } catch (e) {
        output.value = '';
        showParseError(e, text);
        $('#outMeta').textContent = '';
        return;
      }
      if (sortKeys.checked) v = sortKeysDeep(v);
      const ind = op === 'minify' ? undefined : (indent === 'tab' ? '\t' : +indent);
      output.value = JSON.stringify(v, null, ind);
      status(st, 'JSON 有效', 'ok');
      showBigIntWarn(text);
    }
    $('#outMeta').textContent = output.value ? `${output.value.length} 字符` : '';
  }

  function setOp(o) {
    op = o;
    document.querySelectorAll('[data-op]').forEach((b) => b.classList.toggle('on', b.dataset.op === o));
    $('#inTitle').textContent = TITLES[o][0];
    $('#outTitle').textContent = TITLES[o][1];
    run();
  }

  // ---------- 事件 ----------
  document.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => setOp(b.dataset.op)));
  document.querySelectorAll('[data-indent]').forEach((b) => b.addEventListener('click', () => {
    indent = b.dataset.indent;
    document.querySelectorAll('[data-indent]').forEach((x) => x.classList.toggle('on', x === b));
    if (op !== 'format') setOp('format'); else run();
  }));
  sortKeys.addEventListener('change', run);

  const runSoon = debounce(run, 150);
  const runLater = debounce(run, 600);
  input.addEventListener('input', () => (input.value.length > 1e6 ? runLater() : runSoon()));

  $('#swap').addEventListener('click', () => {
    if (!output.value) { status(st, '没有可作为输入的结果', 'err'); return; }
    input.value = output.value;
    if (op === 'escape') setOp('unescape');
    else if (op === 'unescape') setOp('format');
    else run();
  });

  run();
})();
