(() => {
  'use strict';
  const { $, status, debounce } = window.T;

  // @lib
  const DAY = 86400000;
  // 纯日期运算一律在 UTC 上做“日序号”，与时区 / 夏令时无关
  function dn(y, m, d) {
    const t = new Date(0);
    t.setUTCFullYear(y, m - 1, d);
    return Math.round(t.getTime() / DAY);
  }
  function fromDn(n) {
    const t = new Date(n * DAY);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const dnOf = (p) => dn(p.y, p.m, p.d);
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function dim(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function weekday(n) { return (((n % 7) + 7) % 7 + 4) % 7; } // 0 = 周日（1970-01-01 是周四）
  const WD = '日一二三四五六';
  const wdName = (n) => '星期' + WD[weekday(n)];

  // 加减月：目标月没有该日时取月末
  function addMonths(p, k) {
    const t = p.y * 12 + (p.m - 1) + k;
    const y = Math.floor(t / 12);
    const m = t - y * 12 + 1;
    const last = dim(y, m);
    return { y, m, d: Math.min(p.d, last), clamped: p.d > last };
  }
  function addDays(p, k) { return fromDn(dnOf(p) + k); }

  // a <= b：满足 addMonths(a, k) <= b 的最大 k（与加减月规则一致）
  function monthsBetween(a, b) {
    const B = dnOf(b);
    let k = Math.max(0, (b.y - a.y) * 12 + (b.m - a.m));
    while (k > 0 && dnOf(addMonths(a, k)) > B) k--;
    return k;
  }
  function ymd(a, b) {
    const k = monthsBetween(a, b);
    return { y: Math.floor(k / 12), m: k % 12, d: dnOf(b) - dnOf(addMonths(a, k)) };
  }
  // [A, B) 区间内周一至周五的天数
  function workdays(A, B) {
    const n = B - A;
    if (n <= 0) return 0;
    const full = Math.floor(n / 7);
    let c = full * 5;
    for (let i = A + full * 7; i < B; i++) { const w = weekday(i); if (w >= 1 && w <= 5) c++; }
    return c;
  }
  const STARS = [[1, 20, '水瓶座'], [2, 19, '双鱼座'], [3, 21, '白羊座'], [4, 20, '金牛座'], [5, 21, '双子座'], [6, 22, '巨蟹座'],
    [7, 23, '狮子座'], [8, 23, '处女座'], [9, 23, '天秤座'], [10, 24, '天蝎座'], [11, 23, '射手座'], [12, 22, '摩羯座']];
  function star(m, d) {
    let r = '摩羯座';
    for (const [mm, dd, name] of STARS) if (m > mm || (m === mm && d >= dd)) r = name;
    return r;
  }
  function shengxiao(y) { return '鼠牛虎兔龙蛇马羊猴鸡狗猪'[(((y - 4) % 12) + 12) % 12]; }

  function age(birth, ref) {
    const B = dnOf(birth), R = dnOf(ref);
    if (B > R) return null;
    const years = Math.floor(monthsBetween(birth, ref) / 12);
    const thisBd = addMonths(birth, 12 * years);
    const isToday = dnOf(thisBd) === R;
    const next = addMonths(birth, 12 * (years + 1));
    return { years, isToday, next, toNext: dnOf(next) - R, lived: R - B, star: star(birth.m, birth.d), sx: shengxiao(birth.y) };
  }

  function parse(v) {
    const m = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) return null;
    const p = { y: +m[1], m: +m[2], d: +m[3] };
    if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > dim(p.y, p.m)) return null;
    return p;
  }
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmt = (p) => `${p.y < 0 ? '-' : ''}${pad(Math.abs(p.y), 4)}-${pad(p.m)}-${pad(p.d)}`;
  // @endlib

  const num = (n) => n.toLocaleString('en-US');
  function today() {
    const t = new Date();
    return fmt({ y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() });
  }
  function fill(tbody, rows) {
    tbody.replaceChildren();
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = k;
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(th, td);
      tbody.appendChild(tr);
    }
  }

  function runA() {
    const a = parse($('#dA').value), b = parse($('#dB').value);
    status($('#stA'), '');
    if (!a || !b) { fill($('#outA'), []); status($('#stA'), '请选择两个有效日期', 'err'); return; }
    let A = dnOf(a), B = dnOf(b);
    const swapped = A > B;
    const lo = swapped ? b : a, hi = swapped ? a : b;
    if (swapped) [A, B] = [B, A];
    const incl = $('#incl').checked;
    const days = B - A + (incl ? 1 : 0);
    const d = ymd(lo, hi);
    fill($('#outA'), [
      ['相差天数', `${num(days)} 天`],
      ['周 + 天', `${num(Math.floor(days / 7))} 周 ${days % 7} 天`],
      ['年月日', `${d.y} 年 ${d.m} 个月 ${d.d + (incl ? 1 : 0)} 天`],
      ['工作日', `${num(workdays(A, B + (incl ? 1 : 0)))} 天`],
      ['起止', `${wdName(A)} → ${wdName(B)}`],
    ]);
    if (swapped) status($('#stA'), '结束日期早于开始日期，已按先后顺序计算');
  }

  function runB() {
    const p = parse($('#dBase').value);
    const n = Number($('#nAdd').value);
    status($('#stB'), '');
    if (!p) { fill($('#outB'), []); status($('#stB'), '请选择有效日期', 'err'); return; }
    if (!Number.isInteger(n) || Math.abs(n) > 1000000) { fill($('#outB'), []); status($('#stB'), '加减数量须为整数（绝对值不超过 1,000,000）', 'err'); return; }
    const unit = $('#unit').value;
    let r, clamped = false;
    if (unit === 'd') r = addDays(p, n);
    else if (unit === 'w') r = addDays(p, n * 7);
    else { r = addMonths(p, unit === 'm' ? n : n * 12); clamped = r.clamped; }
    const R = dnOf(r);
    const rows = [['结果日期', fmt(r)], ['星期', wdName(R)], ['相差天数', `${num(R - dnOf(p))} 天`]];
    fill($('#outB'), rows);
    if (clamped) status($('#stB'), `${r.y} 年 ${r.m} 月没有 ${p.d} 日，已取月末 ${r.d} 日`);
  }

  function runC() {
    const b = parse($('#dBirth').value), r = parse($('#dRef').value);
    status($('#stC'), '');
    if (!b || !r) { fill($('#outC'), []); status($('#stC'), '请选择有效的出生日期和截至日期', 'err'); return; }
    const a = age(b, r);
    if (!a) { fill($('#outC'), []); status($('#stC'), '出生日期晚于截至日期', 'err'); return; }
    fill($('#outC'), [
      ['周岁', `${a.years} 岁`],
      ['下次生日', a.isToday ? `今天就是生日（下次 ${fmt(a.next)}，${num(a.toNext)} 天后）` : `${fmt(a.next)}（还有 ${num(a.toNext)} 天）`],
      ['已活天数', `${num(a.lived)} 天`],
      ['星座', a.star],
      ['生肖', a.sx],
    ]);
  }

  const lA = debounce(runA, 150), lB = debounce(runB, 150), lC = debounce(runC, 150);
  ['#dA', '#dB', '#incl'].forEach((s) => { $(s).addEventListener('input', lA); $(s).addEventListener('change', lA); });
  ['#dBase', '#nAdd', '#unit'].forEach((s) => { $(s).addEventListener('input', lB); $(s).addEventListener('change', lB); });
  ['#dBirth', '#dRef'].forEach((s) => { $(s).addEventListener('input', lC); $(s).addEventListener('change', lC); });

  function fillToday() {
    const t = today();
    $('#dA').value = t;
    if (!$('#dB').value) {
      const p = parse(t);
      $('#dB').value = fmt({ y: p.y, m: 12, d: 31 });
    }
    $('#dBase').value = t;
    $('#dRef').value = t;
    runA(); runB(); runC();
  }
  $('#fillToday').addEventListener('click', fillToday);
  fillToday();
})();
