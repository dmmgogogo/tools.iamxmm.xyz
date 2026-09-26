(() => {
  'use strict';
  const { $, status, download, debounce, toast } = window.T;

  const input = $('#input');
  const st = $('#status');
  const canvas = $('#canvas');
  const empty = $('#empty');
  const dlPng = $('#dlPng');
  const dlSvg = $('#dlSvg');
  // 版本 40、字节模式下各纠错等级的最大容量
  const CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 };
  const HEX6 = /^#[0-9a-f]{6}$/i;

  let ecc = 'M';
  let current = null;  // { qr, margin, size, fg, bg }

  // ---------- 编码 ----------
  function encode(text, level) {
    const qr = window.qrcode(0, level);
    qr.addData(text, 'Byte');
    qr.make();
    return qr;
  }

  function toSvg(qr, margin, size, fg, bg) {
    const n = qr.getModuleCount();
    const cells = n + margin * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${cells} ${cells}" shape-rendering="crispEdges">`
      + `<rect width="${cells}" height="${cells}" fill="${bg}"/><path fill="${fg}" d="${d}"/></svg>\n`;
  }

  // 边界取整：总尺寸精确等于 size，且每个模块边缘落在整像素上
  function draw(qr, margin, size, fg, bg) {
    const n = qr.getModuleCount();
    const cells = n + margin * 2;
    const edge = (i) => Math.round((i * size) / cells);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fg;
    for (let r = 0; r < n; r++) {
      const y0 = edge(r + margin), y1 = edge(r + margin + 1);
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        const x0 = edge(c + margin), x1 = edge(c + margin + 1);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  function luminance(hex) {
    const ch = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  // ---------- 界面 ----------
  function readInt(el, min, max, def, write) {
    let v = parseInt(el.value, 10);
    if (!Number.isFinite(v)) v = def;
    v = Math.min(max, Math.max(min, v));
    if (write) el.value = v;
    return v;
  }

  function setEmpty(msg, kind) {
    current = null;
    canvas.hidden = true;
    empty.hidden = false;
    dlPng.disabled = true;
    dlSvg.disabled = true;
    $('#outMeta').textContent = '';
    status(st, msg, kind);
  }

  function run(write) {
    const text = input.value;
    const bytes = new TextEncoder().encode(text).length;
    $('#inMeta').textContent = text ? `${text.length} 字符 · ${bytes} 字节` : '';
    if (typeof window.qrcode !== 'function') { setEmpty('二维码编码库加载失败', 'err'); return; }
    if (!text) { setEmpty('输入内容后自动生成'); return; }

    const size = readInt($('#size'), 64, 2048, 320, write);
    const margin = readInt($('#margin'), 0, 16, 4, write);
    const fg = HEX6.test($('#fg').value) ? $('#fg').value : '#000000';
    const bg = HEX6.test($('#bg').value) ? $('#bg').value : '#ffffff';

    if (bytes > CAPACITY[ecc]) {
      setEmpty(`内容过长：${bytes} 字节，纠错等级 ${ecc} 最多 ${CAPACITY[ecc]} 字节（L 级最多 ${CAPACITY.L}）`, 'err');
      return;
    }
    let qr;
    try {
      qr = encode(text, ecc);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      setEmpty(/overflow/.test(msg) ? `内容过长，超出纠错等级 ${ecc} 的容量，可降低纠错等级或缩短内容` : '生成失败：' + msg, 'err');
      return;
    }

    draw(qr, margin, size, fg, bg);
    current = { qr, margin, size, fg, bg };
    canvas.hidden = false;
    empty.hidden = true;
    dlPng.disabled = false;
    dlSvg.disabled = false;
    const n = qr.getModuleCount();
    $('#outMeta').textContent = `版本 ${(n - 17) / 4} · ${n}×${n} · ${size}px`;

    const warns = [];
    if (size / (n + margin * 2) < 2) warns.push('尺寸偏小，每个模块不足 2 像素，可能难以扫描');
    if (Math.abs(luminance(fg) - luminance(bg)) < 0.4) warns.push('前景与背景对比度低，可能无法扫描');
    else if (luminance(fg) > luminance(bg)) warns.push('浅色码深色底，部分扫码器无法识别');
    if (margin < 2) warns.push('边距过小，部分扫码器识别困难（建议 ≥ 4）');
    status(st, warns.join('；'), warns.length ? 'err' : '');
  }

  // ---------- 事件 ----------
  input.addEventListener('input', debounce(() => run(false), 150));
  ['#size', '#margin'].forEach((s) => {
    $(s).addEventListener('input', debounce(() => run(false), 250));
    $(s).addEventListener('change', () => run(true));
  });
  ['#fg', '#bg'].forEach((s) => $(s).addEventListener('input', debounce(() => run(false), 60)));
  document.querySelectorAll('[data-ecc]').forEach((b) => {
    b.addEventListener('click', () => {
      ecc = b.dataset.ecc;
      document.querySelectorAll('[data-ecc]').forEach((x) => x.classList.toggle('on', x === b));
      run(false);
    });
  });

  dlPng.addEventListener('click', () => {
    if (!current) { toast('没有可下载的二维码'); return; }
    canvas.toBlob((blob) => {
      if (!blob) { toast('导出 PNG 失败'); return; }
      download('qrcode.png', blob);
    }, 'image/png');
  });
  dlSvg.addEventListener('click', () => {
    if (!current) { toast('没有可下载的二维码'); return; }
    const { qr, margin, size, fg, bg } = current;
    download('qrcode.svg', toSvg(qr, margin, size, fg, bg), 'image/svg+xml;charset=utf-8');
  });

  if (window.qrcode) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
  run(true);
})();
