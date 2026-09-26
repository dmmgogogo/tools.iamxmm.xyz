(() => {
  'use strict';

  // ---------- 纯逻辑 ----------
  const hex = (n, w) => n.toString(16).padStart(w, '0');

  // ---- HTML 实体 ----
  const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function htmlEncode(s) {
    return s.replace(/[&<>"']/g, (c) => HTML_ESC[c]);
  }

  // 常见命名实体（区分大小写）→ 码点
  const ENTITIES = {
    amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160, ensp: 8194, emsp: 8195, thinsp: 8201,
    zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, shy: 173,
    copy: 169, reg: 174, trade: 8482, hellip: 8230, mdash: 8212, ndash: 8211, minus: 8722,
    lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
    laquo: 171, raquo: 187, lsaquo: 8249, rsaquo: 8250, middot: 183, bull: 8226,
    prime: 8242, Prime: 8243, dagger: 8224, Dagger: 8225, permil: 8240, sect: 167, para: 182,
    deg: 176, plusmn: 177, times: 215, divide: 247, micro: 181, not: 172, frac12: 189, frac14: 188, frac34: 190,
    sup1: 185, sup2: 178, sup3: 179, ordf: 170, ordm: 186, acute: 180, uml: 168, cedil: 184, macr: 175,
    cent: 162, pound: 163, yen: 165, euro: 8364, curren: 164, brvbar: 166, iexcl: 161, iquest: 191,
    larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, lArr: 8656, rArr: 8658, hArr: 8660,
    ne: 8800, le: 8804, ge: 8805, asymp: 8776, equiv: 8801, infin: 8734, sum: 8721, prod: 8719, radic: 8730,
    hearts: 9829, spades: 9824, clubs: 9827, diams: 9830, check: 10003, cross: 10007, star: 9734, starf: 9733,
    Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199,
    Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207,
    Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, Oslash: 216,
    Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, szlig: 223,
    agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231,
    egrave: 232, eacute: 233, ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239,
    ntilde: 241, ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, oslash: 248,
    ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, yuml: 255,
    alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, lambda: 955, mu: 956, pi: 960, sigma: 963, omega: 969,
    Delta: 916, Sigma: 931, Omega: 937,
  };

  // 自己解析，不借助 DOM，杜绝脚本执行。未知命名实体原样保留
  function htmlDecode(s) {
    return s.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{0,31}));/g, (m, dec, hx, name) => {
      if (name) return Object.prototype.hasOwnProperty.call(ENTITIES, name) ? String.fromCodePoint(ENTITIES[name]) : m;
      const cp = dec ? parseInt(dec, 10) : parseInt(hx, 16);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
      return String.fromCodePoint(cp);
    });
  }

  // ---- Unicode \uXXXX ----
  // 只转义非 ASCII；非 BMP 字符输出代理对
  function unicodeEncode(s) {
    let out = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) { out += ch; continue; }
      for (let i = 0; i < ch.length; i++) out += '\\u' + hex(ch.charCodeAt(i), 4);
    }
    return out;
  }

  function unicodeDecode(s) {
    return s.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g, (m, cp, unit) => {
      if (cp !== undefined) {
        const n = parseInt(cp, 16);
        return n > 0x10ffff ? m : String.fromCodePoint(n);
      }
      return String.fromCharCode(parseInt(unit, 16)); // 相邻的代理对会自然拼回一个字符
    });
  }

  // ---- JS 字符串 ----
  const JS_ESC = {
    '\\': '\\\\', '"': '\\"', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t',
    '\b': '\\b', '\f': '\\f', '\v': '\\v', '\u2028': '\\u2028', '\u2029': '\\u2029',
  };

  function jsEncode(s) {
    return s.replace(/[\\"'\u0000-\u001f\u007f\u2028\u2029]/g, (c) => JS_ESC[c] || '\\x' + hex(c.charCodeAt(0), 2));
  }

  const JS_SIMPLE = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };

  // 手写解析，不用 eval / Function。出错时抛出带位置（1 起始）的错误
  function jsDecode(s) {
    const fail = (pos, msg) => { throw new Error(`第 ${pos + 1} 个字符：${msg}`); };
    let out = '';
    let i = 0;
    const n = s.length;
    while (i < n) {
      const j = s.indexOf('\\', i);
      if (j < 0) { out += s.slice(i); break; }
      out += s.slice(i, j);
      if (j + 1 >= n) fail(j, '末尾多了一个反斜杠');
      const e = s[j + 1];
      i = j + 2;
      if (JS_SIMPLE[e]) { out += JS_SIMPLE[e]; continue; }
      if (e === '0' && !/[0-9]/.test(s[i] || '')) { out += '\0'; continue; }
      if (e >= '0' && e <= '7') fail(j, '不支持八进制转义');
      if (e === 'x') {
        const h = s.slice(i, i + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(h)) fail(j, '\\x 后面需要两位十六进制');
        out += String.fromCharCode(parseInt(h, 16));
        i += 2;
        continue;
      }
      if (e === 'u') {
        if (s[i] === '{') {
          const end = s.indexOf('}', i);
          const h = end < 0 ? '' : s.slice(i + 1, end);
          if (!/^[0-9a-fA-F]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) fail(j, '\\u{…} 里需要 1–6 位十六进制且不超过 10FFFF');
          out += String.fromCodePoint(parseInt(h, 16));
          i = end + 1;
        } else {
          const h = s.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail(j, '\\u 后面需要四位十六进制');
          out += String.fromCharCode(parseInt(h, 16));
          i += 4;
        }
        continue;
      }
      if (e === '\r') { if (s[i] === '\n') i++; continue; } // 行续接
      if (e === '\n' || e === '\u2028' || e === '\u2029') continue;
      out += e; // 其余为恒等转义，如 \" \' \\ \/
    }
    return out;
  }

  const CODECS = {
    html: { enc: htmlEncode, dec: htmlDecode },
    unicode: { enc: unicodeEncode, dec: unicodeDecode },
    js: { enc: jsEncode, dec: jsDecode },
  };

  // ---------- 界面 ----------
  const { $, status, debounce } = window.T;

  const input = $('#input');
  const output = $('#output');
  const st = $('#status');
  let kind = 'html';
  let dir = 'enc';

  const HINT = {
    html: '转义 & < > " \'；反转义支持常见命名实体与 &#123; / &#x7B;',
    unicode: '只转义非 ASCII 字符，非 BMP 字符输出代理对；反转义支持 \\uXXXX 与 \\u{XXXXX}',
    js: '转义引号、反斜杠与控制字符；反转义支持 \\n \\t \\xHH \\uXXXX \\u{…} 等',
  };

  function run() {
    const s = input.value;
    status(st, s ? '' : HINT[kind]);
    $('#inMeta').textContent = s ? `${s.length} 字符` : '';
    if (!s) { output.value = ''; $('#outMeta').textContent = ''; return; }
    try {
      output.value = CODECS[kind][dir](s);
    } catch (e) {
      output.value = '';
      status(st, '反转义失败：' + e.message, 'err');
    }
    $('#outMeta').textContent = output.value ? `${output.value.length} 字符` : '';
  }

  function sync() {
    document.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    document.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('on', b.dataset.dir === dir));
    $('#inTitle').textContent = dir === 'enc' ? '原文' : '转义文本';
    $('#outTitle').textContent = dir === 'enc' ? '转义结果' : '原文';
    run();
  }

  // ---------- 事件 ----------
  document.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; sync(); }));
  document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { dir = b.dataset.dir; sync(); }));

  const runSoon = debounce(run, 120);
  const runLater = debounce(run, 500);
  input.addEventListener('input', () => (input.value.length > 1e6 ? runLater() : runSoon()));

  $('#swap').addEventListener('click', () => {
    if (!output.value) { status(st, '没有可作为输入的结果', 'err'); return; }
    input.value = output.value;
    dir = dir === 'enc' ? 'dec' : 'enc';
    sync();
  });

  sync();
})();
