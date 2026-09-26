(() => {
  'use strict';
  const { $, status } = window.T;

  const pwOut = $('#pwOut');
  const uuOut = $('#uuOut');
  const pwSt = $('#pwStatus');
  const uuSt = $('#uuStatus');

  // ---------- 随机 ----------
  const SETS = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digit: '0123456789',
    symbol: '!@#$%^&*()-_=+[]{};:,.<>/?~',
  };
  const AMBIG = /[0O1lI]/g;
  const U32 = 0x100000000;

  const pool = new Uint32Array(256);
  let poolPos = pool.length;
  function randU32() {
    if (poolPos >= pool.length) { crypto.getRandomValues(pool); poolPos = 0; }
    return pool[poolPos++];
  }

  // [0, n) 均匀整数：丢弃落在 2^32 末尾不完整区间的值，避免取模偏差
  function randInt(n) {
    if (!(n >= 1 && n <= U32)) throw new RangeError('n 超出范围');
    const limit = U32 - (U32 % n);
    let x;
    do { x = randU32(); } while (x >= limit);
    return x % n;
  }

  // opts: { upper, lower, digit, symbol, noAmbig } -> 非空字符集数组
  function buildSets(opts) {
    const out = [];
    for (const k of ['upper', 'lower', 'digit', 'symbol']) {
      if (!opts[k]) continue;
      const s = opts.noAmbig ? SETS[k].replace(AMBIG, '') : SETS[k];
      if (s) out.push(s);
    }
    return out;
  }

  // 每个字符集先各取一个，其余从并集取，最后 Fisher-Yates 洗牌
  function genPassword(len, sets) {
    if (!sets.length) throw new Error('至少选择一种字符');
    if (len < sets.length) throw new Error('长度小于所选字符集数量');
    const all = sets.join('');
    const chars = sets.map((s) => s[randInt(s.length)]);
    while (chars.length < len) chars.push(all[randInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
    }
    return chars.join('');
  }

  function entropyBits(len, sets) {
    const n = sets.reduce((a, s) => a + s.length, 0);
    return n > 1 ? len * Math.log2(n) : 0;
  }

  function uuidV4Fallback() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = '';
    for (let i = 0; i < 16; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function uuidV4() {
    return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidV4Fallback();
  }

  // ---------- 界面 ----------
  const hasRandom = !!(window.crypto && window.crypto.getRandomValues);

  // 读数字输入并夹到 [min, max]，非法时回退默认值；write 为 true 时写回输入框
  function readInt(el, min, max, def, write) {
    let v = parseInt(el.value, 10);
    if (!Number.isFinite(v)) v = def;
    v = Math.min(max, Math.max(min, v));
    if (write) el.value = v;
    return v;
  }

  function strength(bits) {
    if (bits < 40) return '弱';
    if (bits < 64) return '一般';
    if (bits < 100) return '强';
    return '很强';
  }

  function genPasswords(write) {
    status(pwSt, '');
    if (!hasRandom) { status(pwSt, '当前浏览器不支持安全随机数', 'err'); return; }
    const len = readInt($('#pwLen'), 4, 128, 20, write);
    const count = readInt($('#pwCount'), 1, 100, 5, write);
    const sets = buildSets({
      upper: $('#csUpper').checked,
      lower: $('#csLower').checked,
      digit: $('#csDigit').checked,
      symbol: $('#csSymbol').checked,
      noAmbig: $('#noAmbig').checked,
    });
    if (!sets.length) {
      pwOut.value = '';
      $('#pwMeta').textContent = '';
      status(pwSt, '至少勾选一种字符集', 'err');
      return;
    }
    const lines = [];
    for (let i = 0; i < count; i++) lines.push(genPassword(len, sets));
    pwOut.value = lines.join('\n');
    const bits = entropyBits(len, sets);
    const poolSize = sets.reduce((a, s) => a + s.length, 0);
    $('#pwMeta').textContent = `${count} 个 · 每个 ≈ ${bits.toFixed(1)} bits（${strength(bits)}）· 字符池 ${poolSize}`;
  }

  let uuids = [];

  function renderUuids() {
    const up = $('#uuUpper').checked;
    const noDash = $('#uuNoDash').checked;
    uuOut.value = uuids.map((u) => {
      if (noDash) u = u.replace(/-/g, '');
      return up ? u.toUpperCase() : u;
    }).join('\n');
    $('#uuMeta').textContent = uuids.length ? `${uuids.length} 个` : '';
  }

  function genUuids(write) {
    status(uuSt, '');
    if (!hasRandom) { status(uuSt, '当前浏览器不支持安全随机数', 'err'); return; }
    const count = readInt($('#uuCount'), 1, 100, 5, write);
    uuids = [];
    for (let i = 0; i < count; i++) uuids.push(uuidV4());
    renderUuids();
  }

  // ---------- 事件 ----------
  $('#pwGen').addEventListener('click', () => genPasswords(true));
  $('#uuGen').addEventListener('click', () => genUuids(true));
  ['#pwLen', '#pwCount'].forEach((s) => $(s).addEventListener('change', () => genPasswords(true)));
  ['#csUpper', '#csLower', '#csDigit', '#csSymbol', '#noAmbig'].forEach((s) => $(s).addEventListener('change', () => genPasswords(false)));
  $('#uuCount').addEventListener('change', () => genUuids(true));
  ['#uuUpper', '#uuNoDash'].forEach((s) => $(s).addEventListener('change', renderUuids));

  genPasswords(true);
  genUuids(true);
})();
