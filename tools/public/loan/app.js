(() => {
  'use strict';
  const { $, status, debounce, download, copy } = window.T;

  // @lib
  // P 本金；annualPct 年利率（%）；n 期数（月）；method 'annuity' 等额本息 | 'principal' 等额本金
  function schedule(P, annualPct, n, method) {
    const r = annualPct / 100 / 12;
    const rows = [];
    let rest = P;
    let totalInt = 0;
    if (method === 'annuity') {
      const f = Math.pow(1 + r, n);
      const pay = r === 0 ? P / n : (P * r * f) / (f - 1);
      for (let i = 1; i <= n; i++) {
        const int = rest * r;
        const prin = i === n ? rest : pay - int; // 末期消除浮点残差
        rest -= prin;
        totalInt += int;
        rows.push({ i, pay: prin + int, prin, int, rest: Math.abs(rest) < 1e-6 ? 0 : rest });
      }
      return { rows, first: pay, dec: 0, totalInt, total: P + totalInt };
    }
    const prin = P / n;
    for (let i = 1; i <= n; i++) {
      const int = rest * r;
      rest -= prin;
      totalInt += int;
      rows.push({ i, pay: prin + int, prin, int, rest: Math.abs(rest) < 1e-6 ? 0 : rest });
    }
    return { rows, first: rows[0].pay, dec: prin * r, totalInt, total: P + totalInt };
  }
  function money(v) {
    if (Math.abs(v) < 0.005) v = 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // @endlib

  const MAX_MONTHS = 1200;
  const PREVIEW = 12;
  let method = 'annuity';
  let unit = 'y';
  let result = null;
  let expanded = false;
  const st = $('#status');

  const parseNum = (s) => {
    const t = String(s).replace(/[,，\s]/g, '');
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  };

  function row(tbody, k, v, sub, copyVal) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = k;
    const td = document.createElement('td');
    td.append(v);
    if (copyVal) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tbtn cbtn';
      b.textContent = '复制';
      b.addEventListener('click', () => copy(copyVal, b));
      td.appendChild(b);
    }
    if (sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = sub; td.appendChild(s); }
    tr.append(th, td);
    tbody.appendChild(tr);
  }

  function renderPlan() {
    const tb = $('#plan');
    tb.replaceChildren();
    if (!result) { $('#planMeta').textContent = ''; $('#expand').hidden = true; return; }
    const rows = result.rows;
    const show = expanded ? rows : rows.slice(0, PREVIEW);
    const frag = document.createDocumentFragment();
    for (const r of show) {
      const tr = document.createElement('tr');
      for (const v of [String(r.i), money(r.pay), money(r.prin), money(r.int), money(r.rest)]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
    $('#planMeta').textContent = `共 ${rows.length} 期` + (show.length < rows.length ? `，显示前 ${show.length} 期` : '');
    $('#expand').hidden = rows.length <= PREVIEW;
    $('#expand').textContent = expanded ? '收起' : '展开全部';
  }

  function run() {
    const out = $('#out');
    out.replaceChildren();
    result = null;
    status(st, '');
    $('#outMeta').textContent = '';
    const P = parseNum($('#amount').value);
    const rate = parseNum($('#rate').value);
    const term = parseNum($('#term').value);
    let err = '';
    if (!(P > 0) || P > 1e12) err = '贷款金额须为大于 0 的数字（不超过 1 万亿）';
    else if (Number.isNaN(rate) || rate > 100) err = '年利率须为 0–100 之间的数字';
    else if (!(term > 0)) err = '期限须为大于 0 的数字';
    let n = 0;
    if (!err) {
      n = unit === 'y' ? Math.round(term * 12) : term;
      if (!Number.isInteger(n) || Math.abs((unit === 'y' ? term * 12 : term) - n) > 1e-9) err = '期限须能换算成整月（按年时可用 0.5 等）';
      else if (n < 1 || n > MAX_MONTHS) err = `期限须在 1–${MAX_MONTHS} 个月之间`;
    }
    if (err) { status(st, err, 'err'); renderPlan(); return; }

    result = schedule(P, rate, n, method);
    const r = result;
    if (method === 'annuity') {
      row(out, '每月还款', money(r.first), '', money(r.first));
    } else {
      row(out, '首月还款', money(r.first), '', money(r.first));
      row(out, '每月递减', money(r.dec));
      row(out, '末月还款', money(r.rows[n - 1].pay));
    }
    row(out, '贷款本金', money(P));
    row(out, '总利息', money(r.totalInt), '', money(r.totalInt));
    row(out, '还款总额', money(r.total), '', money(r.total));
    row(out, '期数', `${n} 期`, n >= 12 ? `${Math.floor(n / 12)} 年${n % 12 ? ` ${n % 12} 个月` : ''}` : '');
    $('#outMeta').textContent = `月利率 ${(rate / 12).toFixed(4)}%`;
    renderPlan();
  }

  function setMethod(m) {
    method = m;
    $('#mAnn').classList.toggle('on', m === 'annuity');
    $('#mPrin').classList.toggle('on', m === 'principal');
    run();
  }
  function setUnit(u) {
    unit = u;
    $('#uYear').classList.toggle('on', u === 'y');
    $('#uMonth').classList.toggle('on', u === 'm');
    run();
  }
  $('#mAnn').addEventListener('click', () => setMethod('annuity'));
  $('#mPrin').addEventListener('click', () => setMethod('principal'));
  $('#uYear').addEventListener('click', () => setUnit('y'));
  $('#uMonth').addEventListener('click', () => setUnit('m'));
  const later = debounce(run, 200);
  ['#amount', '#rate', '#term'].forEach((s) => $(s).addEventListener('input', later));
  $('#amount').addEventListener('blur', () => {
    const v = parseNum($('#amount').value);
    if (v > 0) $('#amount').value = v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  });
  $('#expand').addEventListener('click', () => { expanded = !expanded; renderPlan(); });

  $('#csv').addEventListener('click', () => {
    if (!result) { status(st, '没有可导出的还款计划', 'err'); return; }
    const f = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
    const lines = ['期数,月供,本金,利息,剩余本金'];
    for (const r of result.rows) lines.push([r.i, f(r.pay), f(r.prin), f(r.int), f(r.rest)].join(','));
    lines.push(`合计,${f(result.total)},${f(result.total - result.totalInt)},${f(result.totalInt)},`);
    download(`loan-${method === 'annuity' ? 'annuity' : 'principal'}-${result.rows.length}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  });

  run();
})();
