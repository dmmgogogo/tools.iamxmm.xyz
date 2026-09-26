(() => {
  'use strict';
  const { $, status, download, debounce } = window.T;

  const input = $('#input');
  const output = $('#output');
  const st = $('#status');
  const urlSafe = $('#urlSafe');
  const dlBtn = $('#dlBtn');
  const preview = $('#preview');
  const previewImg = $('#previewImg');
  const MAX_FILE = 20 * 1024 * 1024;

  let mode = 'enc';
  let file = null;          // { name, type, bytes }，选择文件时有值
  let decodedBytes = null;  // 解码得到的二进制，供下载
  let decodedMime = '';

  // ---------- 编解码 ----------
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function toUrlSafe(b64) {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // 返回 { bytes, mime }，非法输入抛错
  function b64ToBytes(text) {
    let s = text.trim();
    let mime = '';
    const m = s.match(/^data:([^;,]*)(?:;[^,]*)?;base64,/i);
    if (m) { mime = m[1].toLowerCase(); s = s.slice(m[0].length); }
    s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('包含非 Base64 字符');
    s = s.replace(/=+$/, '');
    if (s.length % 4 === 1) throw new Error('长度不合法');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }

  function sniffImage(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
    return '';
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // ---------- 主流程 ----------
  function run() {
    decodedBytes = null;
    dlBtn.hidden = true;
    preview.hidden = true;
    status(st, '');

    if (mode === 'enc') {
      let bytes, b64;
      if (file) {
        bytes = file.bytes;
        b64 = bytesToB64(bytes);
        output.value = urlSafe.checked ? toUrlSafe(b64) : `data:${file.type || 'application/octet-stream'};base64,${b64}`;
        $('#inMeta').textContent = `${file.name} · ${fmtSize(bytes.length)}`;
        const img = sniffImage(bytes);
        if (img && !urlSafe.checked) { previewImg.src = output.value; preview.hidden = false; }
      } else {
        bytes = new TextEncoder().encode(input.value);
        b64 = bytesToB64(bytes);
        output.value = urlSafe.checked ? toUrlSafe(b64) : b64;
        $('#inMeta').textContent = input.value ? `${input.value.length} 字符 · ${fmtSize(bytes.length)}` : '';
      }
      $('#outMeta').textContent = output.value ? `${output.value.length} 字符` : '';
      return;
    }

    // 解码
    $('#inMeta').textContent = input.value ? `${input.value.trim().length} 字符` : '';
    if (!input.value.trim()) { output.value = ''; $('#outMeta').textContent = ''; return; }
    let res;
    try {
      res = b64ToBytes(input.value);
    } catch (e) {
      output.value = '';
      $('#outMeta').textContent = '';
      status(st, '解码失败：' + e.message, 'err');
      return;
    }
    const { bytes } = res;
    decodedBytes = bytes;
    decodedMime = res.mime || sniffImage(bytes) || 'application/octet-stream';
    $('#outMeta').textContent = fmtSize(bytes.length);
    dlBtn.hidden = false;

    const img = res.mime.startsWith('image/') ? res.mime : sniffImage(bytes);
    if (img) {
      output.value = `（${img} 图片，${fmtSize(bytes.length)}）`;
      previewImg.src = `data:${img};base64,${bytesToB64(bytes)}`;
      preview.hidden = false;
      return;
    }
    try {
      output.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      output.value = '';
      status(st, `内容不是 UTF-8 文本（${fmtSize(bytes.length)} 二进制），可点「下载文件」保存`, 'err');
    }
  }

  function setMode(m) {
    mode = m;
    $('#modeEnc').classList.toggle('on', m === 'enc');
    $('#modeDec').classList.toggle('on', m === 'dec');
    $('#inTitle').textContent = m === 'enc' ? '原文' : 'Base64';
    $('#outTitle').textContent = m === 'enc' ? 'Base64' : '原文';
    $('#drop').hidden = m !== 'enc';
    if (m === 'dec') file = null;
    run();
  }

  // ---------- 事件 ----------
  $('#modeEnc').addEventListener('click', () => setMode('enc'));
  $('#modeDec').addEventListener('click', () => setMode('dec'));
  urlSafe.addEventListener('change', run);

  const runLater = debounce(run, 120);
  input.addEventListener('input', () => {
    if (file) { file = null; }
    runLater();
  });

  $('#swap').addEventListener('click', () => {
    if (file || decodedBytes && !output.value) { status(st, '结果不是文本，不能作为输入', 'err'); return; }
    if (preview.hidden === false && mode === 'dec') { status(st, '图片结果不能作为输入', 'err'); return; }
    input.value = output.value;
    setMode(mode === 'enc' ? 'dec' : 'enc');
  });

  dlBtn.addEventListener('click', () => {
    if (!decodedBytes) return;
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[decodedMime] || 'bin';
    download('decoded.' + ext, new Blob([decodedBytes], { type: decodedMime }));
  });

  async function takeFile(f) {
    if (!f) return;
    if (f.size > MAX_FILE) { status(st, `文件过大（${fmtSize(f.size)}），上限 20 MB`, 'err'); return; }
    const buf = await f.arrayBuffer();
    file = { name: f.name, type: f.type, bytes: new Uint8Array(buf) };
    input.value = '';
    setMode('enc');
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
