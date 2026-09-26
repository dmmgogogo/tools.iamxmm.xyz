(() => {
  'use strict';
  const { $, status, download, debounce, toast } = window.T;
  const Core = window.ImgCore;

  const st = $('#status');
  const list = $('#list');
  const qual = $('#qual');
  const scaleVal = $('#scaleVal');
  const dlAll = $('#dlAll');
  const drop = $('#drop');
  const MAX_TOTAL = 200 * 1024 * 1024;
  const MAX_PIXELS = 100e6;
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  const opts = { fmt: 'jpg', q: 0.8, scale: 'orig', val: { long: '1920', pct: '50' } };
  // { id, name, size, file, thumbDone, res: { blob, w, h, ow, oh } | null, err, el: {...} }
  let items = [];
  let uid = 0;
  let gen = 0;
  let running = false;
  let downloading = false;

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const baseName = (n) => n.replace(/\.[^.]+$/, '') || 'image';

  // WebP 编码支持检测（Safari 等会退回 PNG）
  const webpOK = (() => {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    try { return c.toDataURL('image/webp').startsWith('data:image/webp'); } catch (e) { return false; }
  })();

  // 读成 data: URL（CSP 的 img-src 不允许 blob:）
  function toDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsDataURL(blob);
    });
  }

  // 按 EXIF 方向解码；不支持 createImageBitmap 选项时退回 Image 元素
  async function decode(file) {
    if (window.createImageBitmap) {
      try {
        const bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { src: bm, w: bm.width, h: bm.height, close: () => bm.close() };
      } catch (e) { /* 退回 Image 元素 */ }
    }
    const img = new Image();
    img.src = await toDataURL(file);
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  }

  function toBlob(canvas, type, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('编码失败（图片可能过大）'))), type, q);
    });
  }

  function mkBtn(text, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tbtn';
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  function outName(it) {
    return baseName(it.name) + '.' + opts.fmt;
  }

  // ---------- 行 ----------
  function buildRow(it) {
    const li = document.createElement('li');
    const th = document.createElement('canvas');
    th.className = 'th';
    th.width = 128; th.height = 128;
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = it.name;
    name.title = it.name;
    const line = document.createElement('div');
    line.className = 'line';
    const warn = document.createElement('div');
    warn.className = 'warn';
    info.append(name, line, warn);
    const ops = document.createElement('span');
    ops.className = 'ops';
    const dl = mkBtn('下载', () => {
      if (it.res) download(outName(it), it.res.blob);
    });
    const orig = mkBtn('下载原图', () => download(it.name, it.file));
    const del = mkBtn('删除', () => {
      items = items.filter((x) => x !== it);
      li.remove();
      renderSum();
    });
    ops.append(dl, orig, del);
    li.append(th, info, ops);
    it.el = { li, th, line, warn, dl, orig };
    paintRow(it);
    return li;
  }

  function paintRow(it) {
    const { line, warn, dl, orig } = it.el;
    line.textContent = '';
    warn.textContent = '';
    dl.disabled = !it.res;
    orig.hidden = true;
    const r = it.res;
    const src = (r ? `${r.ow}×${r.oh} · ` : '') + fmtSize(it.size);
    if (it.err) {
      line.textContent = src;
      warn.textContent = it.err;
      return;
    }
    if (!r) { line.textContent = src + ' → 处理中…'; return; }
    const nw = document.createElement('span');
    nw.className = 'new';
    nw.textContent = `${r.w}×${r.h} · ${fmtSize(r.blob.size)}`;
    const rate = document.createElement('span');
    rate.className = 'rate';
    rate.textContent = Core.fmtRatio(it.size, r.blob.size);
    line.append(src + ' → ', nw, '  ', rate);
    if (r.blob.size > it.size) {
      warn.textContent = '处理后反而变大，可改用原图';
      orig.hidden = false;
    }
  }

  function renderSum() {
    const done = items.filter((it) => it.res);
    $('#sum').hidden = !items.length;
    dlAll.disabled = !done.length || downloading;
    if (!items.length) { status(st, ''); return; }
    const a = done.reduce((s, it) => s + it.size, 0);
    const b = done.reduce((s, it) => s + it.res.blob.size, 0);
    const pending = items.length - done.length - items.filter((it) => it.err).length;
    $('#sumText').textContent = `${done.length}/${items.length} 张 · ${fmtSize(a)} → ${fmtSize(b)}  ${Core.fmtRatio(a, b)}` +
      (pending > 0 ? '  处理中…' : '');
  }

  // ---------- 处理 ----------
  async function processOne(it, g) {
    const d = await decode(it.file);
    try {
      if (g !== gen) return;
      if (!it.thumbDone) {
        const ctx = it.el.th.getContext('2d');
        const s = Math.min(128 / d.w, 128 / d.h);
        const w = Math.max(1, Math.round(d.w * s)), h = Math.max(1, Math.round(d.h * s));
        ctx.drawImage(d.src, (128 - w) / 2, (128 - h) / 2, w, h);
        it.thumbDone = true;
      }
      const sz = Core.calcSize(d.w, d.h, opts.scale, opts.val[opts.scale]);
      if (sz.w * sz.h > MAX_PIXELS) throw new Error(`输出尺寸过大（${sz.w}×${sz.h}），请缩小`);
      const c = document.createElement('canvas');
      c.width = sz.w; c.height = sz.h;
      const ctx = c.getContext('2d');
      if (opts.fmt === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sz.w, sz.h); }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(d.src, 0, 0, sz.w, sz.h);
      const blob = await toBlob(c, MIME[opts.fmt], opts.fmt === 'png' ? undefined : opts.q);
      c.width = 0; c.height = 0;
      if (g !== gen) return;
      it.res = { blob, w: sz.w, h: sz.h, ow: d.w, oh: d.h };
    } finally {
      d.close();
    }
  }

  async function processAll() {
    try {
      Core.checkScale(opts.scale, opts.val[opts.scale]);
    } catch (e) {
      gen++;
      running = false;
      status(st, e.message + '（当前结果仍是上一次设置）', 'err');
      return;
    }
    status(st, '');
    const g = ++gen;
    items.forEach((it) => { it.res = null; it.err = ''; paintRow(it); });
    renderSum();
    running = true;
    for (const it of items.slice()) {
      if (g !== gen) return;
      if (!items.includes(it)) continue;
      try {
        await processOne(it, g);
      } catch (e) {
        if (g !== gen) return;
        it.err = e && e.message ? (/decode|source image|Invalid/i.test(e.message) ? '无法解码这张图片' : e.message) : '处理失败';
      }
      if (g !== gen) return;
      paintRow(it);
      renderSum();
    }
    running = false;
  }
  const processLater = debounce(processAll, 250);

  // 新加入的文件只处理新增项，已有结果保留
  async function processNew(newItems) {
    const g = gen;
    for (const it of newItems) {
      if (g !== gen) return;
      if (!items.includes(it)) continue;
      try { await processOne(it, g); } catch (e) {
        if (g !== gen) return;
        it.err = e && e.message ? (/decode|source image|Invalid/i.test(e.message) ? '无法解码这张图片' : e.message) : '处理失败';
      }
      if (g !== gen) return;
      paintRow(it);
      renderSum();
    }
  }

  function addFiles(files) {
    const errs = [];
    const added = [];
    let sum = items.reduce((s, it) => s + it.size, 0);
    for (const f of Array.from(files)) {
      const okType = /^image\/(jpeg|png|webp|gif|bmp|x-ms-bmp)$/.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
      if (!okType) { errs.push(`「${f.name}」不是支持的图片格式`); continue; }
      if (sum + f.size > MAX_TOTAL) { errs.push(`总大小超过 200 MB，已跳过「${f.name}」及之后的文件`); break; }
      sum += f.size;
      const it = { id: ++uid, name: f.name, size: f.size, file: f, res: null, err: '', thumbDone: false };
      items.push(it);
      list.appendChild(buildRow(it));
      added.push(it);
    }
    renderSum();
    if (errs.length) status(st, errs.join('；'), 'err');
    if (!added.length) return;
    try { Core.checkScale(opts.scale, opts.val[opts.scale]); } catch (e) { status(st, e.message, 'err'); return; }
    if (running) processLater(); else processNew(added);
  }

  // ---------- 选项 ----------
  function bindSeg(sel, fn) {
    const seg = $(sel);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.disabled) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    });
  }

  function syncQual() {
    const off = opts.fmt === 'png';
    qual.disabled = off;
    $('#qualWrap').classList.toggle('off', off);
    $('#qualWrap').title = off ? 'PNG 为无损格式，质量设置无效' : '';
  }

  bindSeg('#fmtSeg', (v) => {
    opts.fmt = v;
    syncQual();
    if (items.length) processLater();
  });
  bindSeg('#scaleSeg', (v) => {
    opts.scale = v;
    $('#scaleWrap').hidden = v === 'orig';
    if (v !== 'orig') {
      scaleVal.value = opts.val[v];
      $('#scaleUnit').textContent = v === 'long' ? 'px（不放大）' : '%';
    }
    if (items.length) processLater();
  });
  qual.addEventListener('input', () => {
    opts.q = Number(qual.value);
    $('#qualVal').textContent = opts.q.toFixed(2);
    if (items.length) processLater();
  });
  scaleVal.addEventListener('input', () => {
    opts.val[opts.scale] = scaleVal.value;
    if (items.length) processLater();
  });

  dlAll.addEventListener('click', async () => {
    const done = items.filter((it) => it.res);
    if (!done.length || downloading) return;
    downloading = true;
    renderSum();
    try {
      for (let i = 0; i < done.length; i++) {
        download(outName(done[i]), done[i].res.blob);
        if (i < done.length - 1) await sleep(350);
      }
      if (done.length > 1) toast('浏览器若拦截多文件下载，请允许');
    } finally {
      downloading = false;
      renderSum();
    }
  });

  $('#clear').addEventListener('click', () => {
    gen++;
    running = false;
    items = [];
    list.textContent = '';
    renderSum();
    status(st, '');
  });

  $('#file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });

  if (!webpOK) {
    const b = $('#webpBtn');
    b.disabled = true;
    b.title = '当前浏览器不支持 WebP 编码';
    status(st, '当前浏览器不支持 WebP 编码，WebP 输出已禁用（仍可读取 WebP 图片）');
  }
  syncQual();
  renderSum();
})();
