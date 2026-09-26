(() => {
  'use strict';
  const { $, status } = window.T;

  // @lib
  const TWO32 = 0x100000000;
  // 均匀随机整数 [0, range)，range 为 1..2^53 的整数；拒绝采样消除取模偏差
  function randBelow(range, u32) {
    if (range <= TWO32) {
      const lim = Math.floor(TWO32 / range) * range;
      let x;
      do { x = u32(); } while (x >= lim);
      return x % range;
    }
    const TOP = 2 ** 53;
    const lim = Math.floor(TOP / range) * range;
    let x;
    do { x = (u32() & 0x1fffff) * TWO32 + u32(); } while (x >= lim);
    return x % range;
  }
  // 生成 count 个 [min, max] 的整数
  function pickNumbers(min, max, count, unique, u32) {
    const range = max - min + 1;
    if (unique && count > range) throw new Error(`不允许重复时，个数不能超过范围内的整数个数（${range}）`);
    if (!unique) return Array.from({ length: count }, () => min + randBelow(range, u32));
    if (range <= 1e6 && count > range / 4) { // 部分 Fisher–Yates
      const a = new Uint32Array(range);
      for (let i = 0; i < range; i++) a[i] = i;
      for (let i = 0; i < count; i++) {
        const j = i + randBelow(range - i, u32);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return Array.from(a.subarray(0, count), (v) => min + v);
    }
    const seen = new Set();
    const out = [];
    while (out.length < count) {
      const v = randBelow(range, u32);
      if (!seen.has(v)) { seen.add(v); out.push(min + v); }
    }
    return out;
  }
  const TAU = Math.PI * 2;
  const mod = (a, m) => ((a % m) + m) % m;
  // 指针固定在正上方；扇区 i 起始角 = rot + i·(2π/n) − π/2（顺时针）
  function sectorAt(rot, n) { return Math.floor(mod(-rot, TAU) / (TAU / n)) % n; }
  // 让扇区 w 的 f 位置（0..1）停在指针下，额外转 spins 圈
  function targetRotation(rot0, n, w, f, spins) {
    const a = TAU / n;
    const want = mod(-(w + f) * a, TAU);
    return rot0 + spins * TAU + mod(want - mod(rot0, TAU), TAU);
  }
  const easeOut = (x) => 1 - Math.pow(1 - x, 4);
  function parseOptions(text, limit = 50) {
    const all = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return { list: all.slice(0, limit), total: all.length };
  }
  // @endlib

  const buf = new Uint32Array(1);
  const u32 = () => { crypto.getRandomValues(buf); return buf[0]; };

  // ---------- 模式 ----------
  function setTab(t) {
    $('#tabNum').classList.toggle('on', t === 'num');
    $('#tabWheel').classList.toggle('on', t === 'wheel');
    $('#numBox').hidden = t !== 'num';
    $('#wheelBox').hidden = t !== 'wheel';
    if (t === 'wheel') { resize(); }
  }
  $('#tabNum').addEventListener('click', () => setTab('num'));
  $('#tabWheel').addEventListener('click', () => setTab('wheel'));

  // ---------- 随机数 ----------
  const nSt = $('#numStatus');
  const intOf = (s) => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : NaN);
  $('#gen').addEventListener('click', () => {
    const min = intOf($('#min').value), max = intOf($('#max').value), count = intOf($('#count').value);
    const allowDup = $('#dup').checked;
    status(nSt, '');
    const fail = (m) => { $('#numOut').value = ''; $('#numMeta').textContent = ''; status(nSt, m, 'err'); };
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return fail('最小值和最大值须为整数（绝对值不超过 2^53−1）');
    if (min > max) return fail('最小值不能大于最大值');
    if (max - min + 1 > 2 ** 53) return fail('范围过大（最多 2^53 个整数）');
    if (!Number.isInteger(count) || count < 1 || count > 10000) return fail('个数须为 1–10000 的整数');
    let out;
    try { out = pickNumbers(min, max, count, !allowDup, u32); } catch (e) { return fail(e.message); }
    if ($('#sort').checked) out.sort((a, b) => a - b);
    $('#numOut').value = out.join(count > 20 ? '\n' : ', ');
    $('#numMeta').textContent = `${count} 个 · ${min} ~ ${max} · ${allowDup ? '可重复' : '不重复'}`;
  });

  // ---------- 转盘 ----------
  const canvas = $('#wheel');
  const ctx = canvas.getContext('2d');
  const optsEl = $('#opts');
  const wSt = $('#wStatus');
  const spinBtn = $('#spin');
  const winnerEl = $('#winner');
  let options = [];
  let rot = 0;
  let spinning = false;
  let highlight = -1;
  let cssSize = 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function readOptions() {
    const { list, total } = parseOptions(optsEl.value);
    options = list;
    $('#optMeta').textContent = `${list.length} 项`;
    if (total > 50) status(wSt, `共 ${total} 项，只取前 50 项`, 'err');
    else if (!spinning) status(wSt, '');
  }
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k) => cs.getPropertyValue(k).trim();
    return { fills: [v('--hover'), v('--paper'), v('--rule')], ink: v('--ink'), ink2: v('--ink-2'), paper: v('--paper'),
      accent: v('--accent'), result: v('--result'), mono: v('--mono') || 'monospace' };
  }
  function ellipsize(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const chars = Array.from(text);
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(chars.slice(0, mid).join('') + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return chars.slice(0, lo).join('') + '…';
  }
  function draw() {
    if (!cssSize) return;
    const c = colors();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);
    const cx = cssSize / 2, cy = cssSize / 2 + 8;
    const R = cssSize / 2 - 14;
    const n = options.length;
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.ink;
    if (!n) {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = c.fills[0]; ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.ink2; ctx.font = `500 14px ${c.mono}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('请输入选项', cx, cy);
    } else {
      const a = TAU / n;
      const fs = n <= 8 ? 16 : n <= 20 ? 13 : 11;
      for (let i = 0; i < n; i++) {
        const s = rot + i * a - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, s, s + a);
        ctx.closePath();
        const fi = (n % 3 === 1 && n > 1 && i === n - 1) ? 1 : i % 3;
        ctx.fillStyle = i === highlight ? c.result : c.fills[fi];
        ctx.fill();
        if (n > 1) ctx.stroke();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s + a / 2);
        ctx.fillStyle = i === highlight ? c.paper : c.ink;
        ctx.font = `600 ${fs}px ${c.mono}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(ellipsize(options[i], R * 0.68), R - 12, 0);
        ctx.restore();
      }
      if (n === 1) { ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke(); }
    }
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(10, R * 0.08), 0, TAU); ctx.fillStyle = c.ink; ctx.fill();
    // 指针（品牌色）
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy - R - 12);
    ctx.lineTo(cx + 11, cy - R - 12);
    ctx.lineTo(cx, cy - R + 12);
    ctx.closePath();
    ctx.fillStyle = c.accent;
    ctx.fill();
  }
  function resize() {
    const w = Math.round(canvas.clientWidth);
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    cssSize = w;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    draw();
  }

  function removeOption(text) {
    const lines = optsEl.value.split(/\r?\n/);
    const k = lines.findIndex((l) => l.trim() === text);
    if (k >= 0) lines.splice(k, 1);
    optsEl.value = lines.join('\n');
    readOptions();
  }
  function addHistory(text) {
    const li = document.createElement('li');
    li.textContent = text;
    const h = $('#hist');
    h.appendChild(li);
    while (h.children.length > 100) h.firstElementChild.remove();
    li.scrollIntoView({ block: 'nearest' });
  }

  function spin() {
    if (spinning) return;
    readOptions();
    const n = options.length;
    if (n < 1) { status(wSt, '请至少输入 1 个选项', 'err'); return; }
    // 先用 crypto 决定结果，再计算动画落点
    const w = randBelow(n, u32);
    const f = 0.15 + 0.7 * (u32() / TWO32);
    const from = rot;
    const to = targetRotation(rot, n, w, f, 6);
    const T = reduceMotion.matches ? 0 : 5000;
    const label = options[w];
    spinning = true;
    highlight = -1;
    winnerEl.textContent = '';
    spinBtn.disabled = true;
    optsEl.readOnly = true;
    status(wSt, '');
    const t0 = performance.now();
    const done = () => {
      rot = mod(to, TAU);
      highlight = w;
      draw();
      spinning = false;
      spinBtn.disabled = false;
      optsEl.readOnly = false;
      winnerEl.textContent = label;
      addHistory(label);
      if ($('#remove').checked) {
        highlight = -1;
        removeOption(label);
        status(wSt, `「${label}」已从选项中移除`);
        setTimeout(draw, 900);
      }
    };
    const step = (t) => {
      const x = T ? Math.min(1, (t - t0) / T) : 1;
      rot = from + (to - from) * easeOut(x);
      draw();
      if (x < 1) requestAnimationFrame(step); else done();
    };
    if (T) requestAnimationFrame(step); else done();
  }

  spinBtn.addEventListener('click', spin);
  optsEl.addEventListener('input', () => { if (spinning) return; highlight = -1; readOptions(); draw(); });
  $('#histClear').addEventListener('click', () => { $('#hist').replaceChildren(); winnerEl.textContent = ''; highlight = -1; draw(); });
  window.addEventListener('resize', () => { if (!$('#wheelBox').hidden) resize(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

  readOptions();
  setTab('num');
})();
