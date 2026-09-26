(() => {
  'use strict';
  const { $, status, copy } = window.T;

  // @lib
  const p2 = (n) => String(n).padStart(2, '0');
  // 倒计时显示：剩余毫秒向上取整到秒
  function fmtCd(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return `${p2(Math.floor(t / 3600))}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}`;
  }
  // 秒表显示：精确到 1/100 秒，超过 1 小时带小时
  function fmtSw(ms) {
    const cs = Math.floor(Math.max(0, ms) / 10);
    const s = Math.floor(cs / 100);
    const h = Math.floor(s / 3600);
    const body = `${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}.${p2(cs % 100)}`;
    return h ? `${h}:${body}` : body;
  }
  // @endlib

  const TITLE = document.title;
  const now = () => performance.now();

  // ---------- 倒计时 ----------
  const cdShow = $('#cdShow');
  const cdStart = $('#cdStart');
  const cdSt = $('#cdStatus');
  let cdTotal = 5 * 60000;   // 设定时长
  let cdRemain = cdTotal;    // 暂停时的剩余
  let cdEnd = 0;             // 运行时的结束时刻（performance.now 基准）
  let cdRunning = false;
  let cdTick = 0, cdTimeout = 0, flashTimer = 0;
  let audioCtx = null;

  function readInputs() {
    const h = Number($('#h').value) || 0, m = Number($('#m').value) || 0, s = Number($('#s').value) || 0;
    if ([h, m, s].some((v) => !Number.isInteger(v) || v < 0) || m > 59 || s > 59 || h > 99) return -1;
    return (h * 3600 + m * 60 + s) * 1000;
  }
  function cdLeft() { return cdRunning ? cdEnd - now() : cdRemain; }
  function cdPaint() {
    const t = fmtCd(cdLeft());
    cdShow.textContent = t;
    if (cdRunning) document.title = `${t} · 倒计时`;
  }
  function setInputsDisabled(v) { ['#h', '#m', '#s'].forEach((s) => { $(s).disabled = v; }); $('#quick').querySelectorAll('button').forEach((b) => { b.disabled = v; }); }

  function stopFlash() {
    clearInterval(flashTimer);
    flashTimer = 0;
    document.title = TITLE;
  }
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.05;
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 3; j++) {
          const at = t0 + k * 1.0 + j * 0.22;
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = 'sine';
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
          o.connect(g).connect(audioCtx.destination);
          o.start(at);
          o.stop(at + 0.18);
        }
      }
    } catch (e) { /* 不支持 Web Audio 时静默 */ }
  }
  function finish() {
    if (!cdRunning) return;
    cdRunning = false;
    clearInterval(cdTick);
    clearTimeout(cdTimeout);
    cdRemain = 0;
    cdShow.textContent = fmtCd(0);
    cdShow.classList.add('done');
    cdStart.textContent = '开始';
    setInputsDisabled(false);
    status(cdSt, '时间到', 'ok');
    beep();
    let on = true;
    document.title = '⏰ 时间到！';
    clearInterval(flashTimer);
    flashTimer = setInterval(() => { on = !on; document.title = on ? '⏰ 时间到！' : TITLE; }, 800);
    if ($('#notify').checked && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('时间到', { body: `倒计时 ${fmtCd(cdTotal)} 已结束` }); } catch (e) { /* 某些平台只允许 SW 通知 */ }
    }
  }
  function cdSchedule() {
    clearInterval(cdTick);
    clearTimeout(cdTimeout);
    cdTick = setInterval(() => { if (cdLeft() <= 0) finish(); else cdPaint(); }, 200);
    cdTimeout = setTimeout(finish, Math.max(0, cdLeft())); // 单次定时，后台也能准点触发
  }
  function cdToggle() {
    stopFlash();
    cdShow.classList.remove('done');
    if (cdRunning) { // 暂停
      cdRemain = Math.max(0, cdEnd - now());
      cdRunning = false;
      clearInterval(cdTick);
      clearTimeout(cdTimeout);
      cdStart.textContent = '继续';
      document.title = TITLE;
      status(cdSt, '已暂停');
      cdPaint();
      return;
    }
    if (cdRemain <= 0 || cdStart.textContent === '开始') {
      const ms = readInputs();
      if (ms < 0) { status(cdSt, '请输入有效时间：时 0–99，分 / 秒 0–59 的整数', 'err'); return; }
      if (ms === 0) { status(cdSt, '时长不能为 0', 'err'); return; }
      cdTotal = ms;
      cdRemain = ms;
    }
    // 在用户点击时解锁音频
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { audioCtx = null; }
    cdEnd = now() + cdRemain;
    cdRunning = true;
    cdStart.textContent = '暂停';
    setInputsDisabled(true);
    status(cdSt, '');
    cdSchedule();
    cdPaint();
  }
  function cdReset() {
    stopFlash();
    cdRunning = false;
    clearInterval(cdTick);
    clearTimeout(cdTimeout);
    const ms = readInputs();
    cdTotal = ms > 0 ? ms : 0;
    cdRemain = cdTotal;
    cdShow.classList.remove('done');
    cdStart.textContent = '开始';
    setInputsDisabled(false);
    status(cdSt, '');
    cdPaint();
  }
  cdStart.addEventListener('click', cdToggle);
  $('#cdReset').addEventListener('click', cdReset);
  ['#h', '#m', '#s'].forEach((s) => $(s).addEventListener('input', () => { if (!cdRunning) cdReset(); }));
  $('#quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (!b || cdRunning) return;
    const min = Number(b.dataset.min);
    $('#h').value = Math.floor(min / 60);
    $('#m').value = min % 60;
    $('#s').value = 0;
    cdReset();
  });
  ['click', 'keydown', 'focus'].forEach((ev) => window.addEventListener(ev, () => { if (flashTimer) stopFlash(); }));

  const notify = $('#notify');
  if (!('Notification' in window)) {
    notify.disabled = true;
    notify.parentElement.title = '当前浏览器不支持通知';
  }
  notify.addEventListener('change', async () => {
    if (!notify.checked || !('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') { notify.checked = false; status(cdSt, '通知权限已被拒绝，请在浏览器设置中开启', 'err'); return; }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { notify.checked = false; status(cdSt, '未获得通知权限', 'err'); }
  });

  // ---------- 秒表 ----------
  const swShow = $('#swShow');
  const swStart = $('#swStart');
  const swLap = $('#swLap');
  let swAcc = 0, swT0 = 0, swRunning = false, raf = 0;
  let laps = []; // 累计毫秒
  const swElapsed = () => swAcc + (swRunning ? now() - swT0 : 0);
  function swPaint() { swShow.textContent = fmtSw(swElapsed()); }
  function loop() { swPaint(); raf = swRunning ? requestAnimationFrame(loop) : 0; }
  swStart.addEventListener('click', () => {
    if (swRunning) {
      swAcc += now() - swT0;
      swRunning = false;
      cancelAnimationFrame(raf);
      swStart.textContent = '继续';
      swLap.disabled = true;
      swPaint();
    } else {
      swT0 = now();
      swRunning = true;
      swStart.textContent = '暂停';
      swLap.disabled = false;
      loop();
    }
  });
  function renderLaps() {
    const tb = $('#laps');
    tb.replaceChildren();
    for (let i = laps.length - 1; i >= 0; i--) {
      const tr = document.createElement('tr');
      const split = laps[i] - (i ? laps[i - 1] : 0);
      for (const v of [String(i + 1), fmtSw(split), fmtSw(laps[i])]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    $('#lapMeta').textContent = laps.length ? `${laps.length} 次` : '';
  }
  swLap.addEventListener('click', () => { if (swRunning) { laps.push(swElapsed()); renderLaps(); } });
  $('#swReset').addEventListener('click', () => {
    swRunning = false;
    cancelAnimationFrame(raf);
    swAcc = 0;
    laps = [];
    swStart.textContent = '开始';
    swLap.disabled = true;
    renderLaps();
    swPaint();
  });
  $('#lapCopy').addEventListener('click', (e) => {
    const text = laps.map((t, i) => `#${i + 1}\t${fmtSw(t - (i ? laps[i - 1] : 0))}\t${fmtSw(t)}`).join('\n');
    copy(text, e.currentTarget);
  });

  // 回到前台时立即刷新（后台 rAF / interval 会被节流，但数值基于时间差，始终准确）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (cdRunning) { if (cdLeft() <= 0) finish(); else cdPaint(); }
    if (swRunning && !raf) loop();
    swPaint();
  });

  // ---------- 模式切换 ----------
  function setTab(t) {
    $('#tabCd').classList.toggle('on', t === 'cd');
    $('#tabSw').classList.toggle('on', t === 'sw');
    $('#cd').hidden = t !== 'cd';
    $('#sw').hidden = t !== 'sw';
    $('#hint').textContent = t === 'cd' ? '切换模式不会中断正在运行的计时' : '';
  }
  $('#tabCd').addEventListener('click', () => setTab('cd'));
  $('#tabSw').addEventListener('click', () => setTab('sw'));

  setTab('cd');
  cdReset();
})();
