(() => {
  'use strict';
  const { $, status, debounce } = window.T;

  const input = $('#input');
  const st = $('#status');
  const hst = $('#hmacStatus');
  const upper = $('#upper');
  const hmacKey = $('#hmacKey');
  const MAX_FILE = 200 * 1024 * 1024;
  const MD5_CHUNK = 4 * 1024 * 1024;
  const ALGS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
  const subtle = window.crypto && window.crypto.subtle;

  let file = null;       // { name, bytes }，选择文件时有值
  let hmacAlg = 'SHA-256';
  let seq = 0;           // 丢弃过期的异步结果
  let hmacSeq = 0;
  let digests = {};      // alg -> Uint8Array
  let hmacBytes = null;

  // ---------- MD5（RFC 1321） ----------
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const MD5_K = new Int32Array(64);
  for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  function md5Block(st4, b, o, X) {
    for (let i = 0; i < 16; i++) {
      const j = o + i * 4;
      X[i] = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16) | (b[j + 3] << 24);
    }
    let a = st4[0], bb = st4[1], c = st4[2], d = st4[3];
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
      else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (bb | ~d); g = (7 * i) & 15; }
      const x = (a + f + MD5_K[i] + X[g]) | 0;
      const s = MD5_S[i];
      a = d; d = c; c = bb;
      bb = (bb + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    st4[0] = (st4[0] + a) | 0;
    st4[1] = (st4[1] + bb) | 0;
    st4[2] = (st4[2] + c) | 0;
    st4[3] = (st4[3] + d) | 0;
  }

  // 增量 MD5：update(Uint8Array) 可多次调用，digest() 返回 16 字节
  function createMd5() {
    const st4 = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    const buf = new Uint8Array(64);
    const X = new Int32Array(16);
    let bufLen = 0;
    let total = 0;

    function update(bytes) {
      total += bytes.length;
      let i = 0;
      if (bufLen) {
        i = Math.min(64 - bufLen, bytes.length);
        buf.set(bytes.subarray(0, i), bufLen);
        bufLen += i;
        if (bufLen < 64) return;
        md5Block(st4, buf, 0, X);
        bufLen = 0;
      }
      for (; i + 64 <= bytes.length; i += 64) md5Block(st4, bytes, i, X);
      if (i < bytes.length) { buf.set(bytes.subarray(i), 0); bufLen = bytes.length - i; }
    }

    function digest() {
      buf[bufLen++] = 0x80;
      if (bufLen > 56) { buf.fill(0, bufLen); md5Block(st4, buf, 0, X); bufLen = 0; }
      buf.fill(0, bufLen, 56);
      // 消息长度（bit）以 64 位小端写入
      const lo = (total * 8) >>> 0;
      const hi = Math.floor(total / 0x20000000) >>> 0;
      for (let k = 0; k < 4; k++) { buf[56 + k] = (lo >>> (8 * k)) & 0xff; buf[60 + k] = (hi >>> (8 * k)) & 0xff; }
      md5Block(st4, buf, 0, X);
      const out = new Uint8Array(16);
      for (let k = 0; k < 16; k++) out[k] = (st4[k >> 2] >>> ((k & 3) * 8)) & 0xff;
      return out;
    }

    return { update, digest };
  }

  function md5(bytes) {
    const h = createMd5();
    h.update(bytes);
    return h.digest();
  }

  // ---------- 工具函数 ----------
  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function toB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  const nextTick = () => new Promise((r) => setTimeout(r, 0));

  async function md5Chunked(bytes, id, onProgress) {
    const h = createMd5();
    for (let i = 0; i < bytes.length; i += MD5_CHUNK) {
      h.update(bytes.subarray(i, i + MD5_CHUNK));
      if (bytes.length > MD5_CHUNK) {
        onProgress(Math.min(1, (i + MD5_CHUNK) / bytes.length));
        await nextTick();
        if (id !== seq) return null;
      }
    }
    return h.digest();
  }

  // ---------- 渲染 ----------
  function hex(bytes) {
    const s = toHex(bytes);
    return upper.checked ? s.toUpperCase() : s;
  }

  function renderDigests() {
    for (const alg of ALGS) $('#h' + alg).textContent = digests[alg] ? hex(digests[alg]) : '';
  }

  function renderHmac() {
    $('#hmacHex').textContent = hmacBytes ? hex(hmacBytes) : '';
    $('#hmacB64').textContent = hmacBytes ? toB64(hmacBytes) : '';
  }

  function currentBytes() {
    if (file) return file.bytes;
    if (!input.value) return null;
    return new TextEncoder().encode(input.value);
  }

  // ---------- 主流程 ----------
  async function run() {
    const id = ++seq;
    digests = {};
    renderDigests();
    status(st, '');

    const bytes = currentBytes();
    if (file) $('#inMeta').textContent = `${file.name} · ${fmtSize(file.bytes.length)}`;
    else $('#inMeta').textContent = input.value ? `${input.value.length} 字符 · ${fmtSize(bytes.length)}` : '';

    runHmac(bytes);
    if (!bytes) { status(st, '输入文本或选择文件后自动计算'); return; }
    if (!subtle) status(st, '当前环境不支持 WebCrypto（需 HTTPS），无法计算 SHA', 'err');

    const big = bytes.length > MD5_CHUNK;
    if (big && subtle) status(st, '计算中…');
    try {
      const shaJobs = subtle
        ? ALGS.slice(1).map((alg) => subtle.digest(alg, bytes).then((b) => [alg, new Uint8Array(b)]))
        : [];
      // 本次计算被新输入取代时不会再 await 这些任务，先挂上 catch 防止未处理的拒绝
      shaJobs.forEach((p) => p.catch(() => {}));
      const m = await md5Chunked(bytes, id, (p) => { if (id === seq && subtle) status(st, `计算 MD5… ${Math.round(p * 100)}%`); });
      if (id !== seq || !m) return;
      digests.MD5 = m;
      renderDigests();
      for (const [alg, b] of await Promise.all(shaJobs)) digests[alg] = b;
      if (id !== seq) return;
      renderDigests();
      if (subtle) status(st, big ? `完成 · ${fmtSize(bytes.length)}` : '');
    } catch (e) {
      if (id !== seq) return;
      status(st, '计算失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  async function runHmac(bytes) {
    const id = ++hmacSeq;
    hmacBytes = null;
    renderHmac();
    status(hst, '');
    if (!hmacKey.value) { status(hst, '输入密钥后计算 HMAC'); return; }
    if (!bytes) { status(hst, '上方输入为空'); return; }
    if (!subtle) { status(hst, '当前环境不支持 WebCrypto（需 HTTPS）', 'err'); return; }
    try {
      const key = await subtle.importKey(
        'raw', new TextEncoder().encode(hmacKey.value),
        { name: 'HMAC', hash: hmacAlg }, false, ['sign'],
      );
      const sig = await subtle.sign('HMAC', key, bytes);
      if (id !== hmacSeq) return;
      hmacBytes = new Uint8Array(sig);
      renderHmac();
      status(hst, `HMAC-${hmacAlg}`);
    } catch (e) {
      if (id !== hmacSeq) return;
      status(hst, 'HMAC 计算失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  // ---------- 事件 ----------
  const runLater = debounce(run, 200);
  input.addEventListener('input', () => {
    if (file) file = null;
    runLater();
  });
  upper.addEventListener('change', () => { renderDigests(); renderHmac(); });

  // HMAC 变化只重算 HMAC，不重算大文件的摘要
  const hmacLater = debounce(() => runHmac(currentBytes()), 200);
  hmacKey.addEventListener('input', hmacLater);
  document.querySelectorAll('[data-alg]').forEach((b) => {
    b.addEventListener('click', () => {
      hmacAlg = b.dataset.alg;
      document.querySelectorAll('[data-alg]').forEach((x) => x.classList.toggle('on', x === b));
      runHmac(currentBytes());
    });
  });

  async function takeFile(f) {
    if (!f) return;
    if (f.size > MAX_FILE) { status(st, `文件过大（${fmtSize(f.size)}），上限 200 MB`, 'err'); return; }
    status(st, '读取文件…');
    let buf;
    try {
      buf = await f.arrayBuffer();
    } catch (e) {
      status(st, '读取文件失败：' + (e && e.message ? e.message : e), 'err');
      return;
    }
    file = { name: f.name, bytes: new Uint8Array(buf) };
    input.value = '';
    run();
  }

  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => { takeFile(e.target.files[0]); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    takeFile(e.dataTransfer.files[0]);
  });

  run();
})();
