(() => {
  'use strict';
  const { $, status, debounce, copy } = window.T;

  // @lib
  const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ebef}\u{30000}-\u{3134f}]/gu;
  const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  const PUNCT = /\p{P}/gu;

  function countOf(re, s) { const m = s.match(re); return m ? m.length : 0; }

  function stats(raw) {
    const s = raw.replace(/\r\n?/g, '\n');
    const han = countOf(HAN, s);
    const words = countOf(WORD, s);
    const lineArr = s ? s.split('\n') : [];
    return {
      han,
      words,
      chars: Array.from(s).length,
      charsNoSpace: Array.from(s.replace(/\s/g, '')).length,
      punct: countOf(PUNCT, s),
      paras: lineArr.filter((l) => l.trim()).length,
      lines: lineArr.length,
      bytes: new TextEncoder().encode(s).length,
      minutes: han / 400 + words / 200,
    };
  }

  function fmtRead(min) {
    if (min <= 0) return '0 秒';
    const sec = Math.max(1, Math.round(min * 60));
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
  }

  // 每行去首尾空白（含全角空格），连续空行压成一个，整体去首尾
  function tidy(raw) {
    return raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  // @endlib

  const input = $('#input');
  const out = $('#out');
  const st = $('#status');
  const ROWS = [
    ['han', '中文字数'], ['words', '英文单词'], ['chars', '字符(含空格)'], ['charsNoSpace', '字符(不含空格)'],
    ['punct', '标点'], ['paras', '段落'], ['lines', '行数'], ['bytes', '字节 UTF-8'], ['minutes', '预计阅读'],
  ];
  const cells = {};
  for (const [k, label] of ROWS) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    cells[k] = td;
    tr.append(th, td);
    out.appendChild(tr);
  }
  const num = (n) => n.toLocaleString('en-US');
  let last = stats('');

  function run() {
    last = stats(input.value);
    for (const [k] of ROWS) cells[k].textContent = k === 'minutes' ? fmtRead(last.minutes) : num(last[k]);
    $('#inMeta').textContent = input.value ? `${num(last.chars)} 字符` : '';
  }

  const runShort = debounce(run, 150);
  const runLong = debounce(run, 400);
  input.addEventListener('input', () => { status(st, ''); (input.value.length > 200000 ? runLong : runShort)(); });

  $('#tidy').addEventListener('click', () => {
    const before = input.value;
    const after = tidy(before);
    if (after === before) { status(st, '没有需要整理的空行或空格'); return; }
    input.value = after;
    run();
    status(st, `已整理，减少 ${num(Array.from(before).length - Array.from(after).length)} 个字符`, 'ok');
  });

  $('#copyAll').addEventListener('click', (e) => {
    if (!input.value) { copy('', e.currentTarget); return; }
    const text = ROWS.map(([k, label]) => `${label}：${k === 'minutes' ? fmtRead(last.minutes) : num(last[k])}`).join('\n');
    copy(text, e.currentTarget);
  });

  run();
})();
