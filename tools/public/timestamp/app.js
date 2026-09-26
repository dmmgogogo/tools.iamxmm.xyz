(() => {
  'use strict';

  // ---------- 纯逻辑 ----------
  const MAX_MS = 8.64e15; // Date 可表示范围 ±275760 年

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmtYear = (y) => (y < 0 ? '-' + pad(-y, 4) : pad(y, 4));

  // 解析时间戳：整数部分 ≥12 位视为毫秒，否则为秒。返回 { ms, unit, digits }
  function parseTs(str) {
    const s = str.trim();
    const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error('只能输入数字（可带小数点、负号）');
    const digits = m[2].length;
    const unit = digits >= 12 ? 'ms' : 's';
    const num = Number(s);
    const ms = unit === 's' ? Math.round(num * 1000) : Math.trunc(num);
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) throw new Error('超出可表示范围（约 ±27 万年）');
    return { ms, unit, digits };
  }

  function offsetStr(d) {
    const off = -d.getTimezoneOffset();
    const a = Math.abs(off);
    return (off >= 0 ? '+' : '-') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }

  function fmtLocal(d) {
    const ms = d.getMilliseconds();
    return `${fmtYear(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` + (ms ? '.' + pad(ms, 3) : '');
  }

  function fmtUTC(d) {
    const ms = d.getUTCMilliseconds();
    return `${fmtYear(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` + (ms ? '.' + pad(ms, 3) : '');
  }

  function isoLocal(d) {
    return `${fmtYear(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${offsetStr(d)}`;
  }

  const REL_UNITS = [['年', 31536000], ['个月', 2592000], ['天', 86400], ['小时', 3600], ['分钟', 60], ['秒', 1]];

  function relTime(ms, now) {
    const diff = ms - now;
    const a = Math.abs(diff) / 1000;
    if (a < 1) return '现在';
    const suffix = diff < 0 ? '前' : '后';
    for (const [name, size] of REL_UNITS) {
      if (a >= size) return `${Math.floor(a / size)} ${name}${suffix}`;
    }
    return '现在';
  }

  // 日期字符串 → { ms, how }。无时区的按本地时区；带 Z / ±hh:mm 的按其偏移；其他交给浏览器
  const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:(?:\s+|T)(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

  function parseDate(str) {
    const s = str.trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) throw new Error('这是时间戳，请在左侧「时间戳 → 日期」里转换');
    const m = DATE_RE.exec(s);
    if (m) {
      const y = +m[1], mo = +m[2], day = +m[3];
      const h = +(m[4] || 0), mi = +(m[5] || 0), sec = +(m[6] || 0);
      const msPart = m[7] ? +m[7].slice(0, 3).padEnd(3, '0') : 0;
      if (mo < 1 || mo > 12) throw new Error('月份超出范围');
      const probe = new Date(0);
      probe.setUTCFullYear(y, mo - 1, day);
      if (probe.getUTCDate() !== day) throw new Error(`${y} 年 ${mo} 月没有 ${day} 日`);
      if (h > 23 || mi > 59 || sec > 59) throw new Error('时、分、秒超出范围');
      if (m[8]) {
        let off = 0;
        if (m[8].toUpperCase() !== 'Z') {
          const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(m[8]);
          off = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +(z[3] || 0));
        }
        probe.setUTCHours(h, mi, sec, msPart);
        return { ms: probe.getTime() - off * 60000, how: 'offset' };
      }
      const d = new Date(0);
      d.setFullYear(y, mo - 1, day);
      d.setHours(h, mi, sec, msPart);
      return { ms: d.getTime(), how: 'local' };
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error('无法识别的日期格式');
    return { ms: t, how: 'browser' };
  }

  // ---------- 界面 ----------
  const { $, status, copy, debounce } = window.T;

  const tsIn = $('#tsIn');
  const dtIn = $('#dtIn');
  const tsOut = $('#tsOut');
  const dtOut = $('#dtOut');
  let relCell = null;  // 相对时间单元格，每秒刷新
  let relMs = 0;

  const tzName = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  })();
  $('#tz').textContent = `时区 ${tzName || '未知'}（UTC${offsetStr(new Date())}）`;

  // rows: [[标签, 值], ...]，返回 标签 → 值元素
  function renderKV(tbody, rows) {
    tbody.textContent = '';
    const cells = {};
    for (const [label, value] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      const span = document.createElement('span');
      span.className = 'val';
      span.textContent = value;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tbtn';
      btn.textContent = '复制';
      btn.addEventListener('click', () => copy(span.textContent));
      td.append(span, btn);
      tr.append(th, td);
      tbody.appendChild(tr);
      cells[label] = span;
    }
    return cells;
  }

  function runTs() {
    const st = $('#tsStatus');
    status(st, '');
    $('#tsMeta').textContent = '';
    relCell = null;
    if (!tsIn.value.trim()) { tsOut.textContent = ''; return; }
    let r;
    try { r = parseTs(tsIn.value); } catch (e) { tsOut.textContent = ''; status(st, e.message, 'err'); return; }
    $('#tsMeta').textContent = `识别为${r.unit === 'ms' ? '毫秒' : '秒'}（${r.digits} 位）`;
    const d = new Date(r.ms);
    const cells = renderKV(tsOut, [
      ['本地时间', fmtLocal(d)],
      ['UTC', fmtUTC(d)],
      ['ISO 8601', d.toISOString()],
      ['ISO 本地偏移', isoLocal(d)],
      ['相对时间', relTime(r.ms, Date.now())],
    ]);
    relCell = cells['相对时间'];
    relMs = r.ms;
  }

  const HOW = { local: '按本地时区解析', offset: '按输入中的时区偏移解析', browser: '由浏览器解析，请核对' };

  function runDt() {
    const st = $('#dtStatus');
    status(st, '');
    $('#dtMeta').textContent = '';
    if (!dtIn.value.trim()) { dtOut.textContent = ''; return; }
    let r;
    try { r = parseDate(dtIn.value); } catch (e) { dtOut.textContent = ''; status(st, e.message, 'err'); return; }
    if (!Number.isFinite(r.ms) || Math.abs(r.ms) > MAX_MS) { dtOut.textContent = ''; status(st, '超出可表示范围', 'err'); return; }
    $('#dtMeta').textContent = HOW[r.how];
    const d = new Date(r.ms);
    renderKV(dtOut, [
      ['秒', String(Math.floor(r.ms / 1000))],
      ['毫秒', String(r.ms)],
      ['本地时间', fmtLocal(d)],
      ['ISO 8601', d.toISOString()],
    ]);
  }

  function tick() {
    const now = Date.now();
    $('#nowS').textContent = String(Math.floor(now / 1000));
    $('#nowMs').textContent = String(now);
    if (relCell) relCell.textContent = relTime(relMs, now);
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  // ---------- 事件 ----------
  $('#nowS').addEventListener('click', (e) => copy(e.currentTarget.textContent));
  $('#nowMs').addEventListener('click', (e) => copy(e.currentTarget.textContent));
  tsIn.addEventListener('input', debounce(runTs, 120));
  dtIn.addEventListener('input', debounce(runDt, 120));
  $('#tsNow').addEventListener('click', () => { tsIn.value = String(Math.floor(Date.now() / 1000)); runTs(); });
  $('#dtNow').addEventListener('click', () => { dtIn.value = fmtLocal(new Date(Math.floor(Date.now() / 1000) * 1000)); runDt(); });

  tick();
})();
