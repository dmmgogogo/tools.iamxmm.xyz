(() => {
  'use strict';
  const { $, status, download, toast } = window.T;
  const Core = window.PDFCore;
  const PDFLib = window.PDFLib;

  const st = $('#status');
  const list = $('#list');
  const pagesEl = $('#pages');
  const goBtn = $('#go');
  const drop = $('#drop');
  const fileInput = $('#file');
  const MAX_TOTAL = 200 * 1024 * 1024;
  const MAX_PIXELS = 16e6;       // 单页导出画布上限（兼顾 iOS Safari）
  const PDFJS_SRC = '/pdf/vendor/pdf.min.js?v=4.10.38';
  const PDFJS_WORKER = '/pdf/vendor/pdf.worker.min.js?v=4.10.38';

  const MODES = {
    img: { go: '生成 PDF', drop: '拖入或点击选择图片（JPG / PNG / WebP，可多选）', accept: 'image/jpeg,image/png,image/webp', multi: true },
    merge: { go: '合并下载', drop: '拖入或点击选择多个 PDF', accept: 'application/pdf,.pdf', multi: true },
    split: { go: '导出', drop: '拖入或点击选择一个 PDF', accept: 'application/pdf,.pdf', multi: false },
    render: { go: '全部下载', drop: '拖入或点击选择一个 PDF', accept: 'application/pdf,.pdf', multi: false },
  };

  let mode = 'img';
  let busy = false;
  let uid = 0;
  // 每个模式各自的文件列表：{ id, name, size, bytes, kind, w, h, orient, pages, thumb }
  const lists = { img: [], merge: [], split: [], render: [] };
  const opts = { page: 'fit', scale: 2, fmt: 'png' };

  // PDF 转图片的状态
  let rdoc = null;          // pdf.js 文档
  let rgen = 0;             // 渲染代号，换文件时让旧渲染停止
  let rsizes = [];          // 每页 1x 尺寸 [w, h]

  // ---------- 工具函数 ----------
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const baseName = (n) => n.replace(/\.[^.]+$/, '') || 'file';
  const total = (arr) => arr.reduce((s, it) => s + it.size, 0);

  function sniff(b) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
    return '';
  }

  // 读成 data: URL（CSP 的 img-src 不允许 blob:）
  function toDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsDataURL(blob);
    });
  }

  // 解码图片（按 EXIF 方向），返回可 drawImage 的对象与尺寸
  async function decode(blob) {
    if (window.createImageBitmap) {
      try {
        const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        return { src: bm, w: bm.width, h: bm.height, close: () => bm.close() };
      } catch (e) { /* 退回 Image 元素 */ }
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = await toDataURL(blob);
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  }

  function toBlob(canvas, type, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败（图片可能过大）'))), type, q);
    });
  }

  function drawThumb(src, w, h, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const s = Math.min(size / w, size / h);
    const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return c;
  }

  // 图片重新编码（webp → png；带旋转的 jpg → jpg），返回 { type, bytes }
  async function reencode(it, type) {
    const d = await decode(new Blob([it.bytes]));
    try {
      const c = document.createElement('canvas');
      c.width = d.w; c.height = d.h;
      const ctx = c.getContext('2d');
      if (type === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, d.w, d.h); }
      ctx.drawImage(d.src, 0, 0);
      const blob = await toBlob(c, type === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
      c.width = 0; c.height = 0;
      return { type, bytes: new Uint8Array(await blob.arrayBuffer()) };
    } finally {
      d.close();
    }
  }

  function setBusy(b, label) {
    busy = b;
    goBtn.disabled = b;
    goBtn.textContent = b ? (label || '处理中…') : MODES[mode].go;
  }

  // ---------- 列表渲染 ----------
  function mkBtn(text, fn, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tbtn';
    b.textContent = text;
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function renderList() {
    const arr = lists[mode];
    list.textContent = '';
    arr.forEach((it, i) => {
      const li = document.createElement('li');
      if (it.thumb) { it.thumb.className = 'th'; li.appendChild(it.thumb); }
      else { const s = document.createElement('span'); s.className = 'noth'; li.appendChild(s); }
      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = it.name;
      name.title = it.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      const parts = [fmtSize(it.size)];
      if (it.w) parts.push(it.w + '×' + it.h);
      if (it.pages) parts.push(it.pages + ' 页');
      meta.textContent = parts.join(' · ');
      info.append(name, meta);
      const ops = document.createElement('span');
      ops.className = 'ops';
      if (MODES[mode].multi) {
        ops.appendChild(mkBtn('↑', () => move(i, -1), i === 0 || busy));
        ops.appendChild(mkBtn('↓', () => move(i, 1), i === arr.length - 1 || busy));
      }
      ops.appendChild(mkBtn('删除', () => removeAt(i), busy));
      li.append(info, ops);
      list.appendChild(li);
    });
  }

  function move(i, d) {
    const arr = lists[mode];
    const j = i + d;
    if (busy || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderList();
  }

  function removeAt(i) {
    if (busy) return;
    lists[mode].splice(i, 1);
    if (mode === 'render') resetRender();
    if (mode === 'split' || mode === 'render') status(st, '');
    renderList();
    summary();
  }

  function summary() {
    const arr = lists[mode];
    if (!arr.length) { status(st, ''); return; }
    const n = arr.length;
    const unit = mode === 'img' ? '张图片' : '个文件';
    let msg = `${n} ${unit} · 共 ${fmtSize(total(arr))}`;
    if (mode === 'merge' && n > 0) msg += ` · 合计 ${arr.reduce((s, it) => s + (it.pages || 0), 0)} 页`;
    if (mode === 'split') msg = `${arr[0].name} · 共 ${arr[0].pages} 页，输入页码范围后点「导出」`;
    if (mode === 'render') return;
    status(st, msg);
  }

  // ---------- 加入文件 ----------
  async function addFiles(files) {
    if (busy || !files.length) return;
    const cfg = MODES[mode];
    const m = mode;
    let incoming = Array.from(files);
    if (!cfg.multi) {
      incoming = incoming.slice(0, 1);
      lists[m] = [];
      if (m === 'render') resetRender();
    }
    const arr = lists[m];
    const errs = [];
    setBusy(true, '读取中…');
    try {
      for (const f of incoming) {
        if (total(arr) + f.size > MAX_TOTAL) { errs.push(`总大小超过 200 MB，已跳过「${f.name}」及之后的文件`); break; }
        let bytes;
        try { bytes = new Uint8Array(await f.arrayBuffer()); } catch (e) { errs.push(`「${f.name}」读取失败`); continue; }
        const it = { id: ++uid, name: f.name, size: f.size, bytes };
        if (m === 'img') {
          it.kind = sniff(bytes);
          if (!it.kind) { errs.push(`「${f.name}」不是 JPG / PNG / WebP 图片`); continue; }
          it.orient = it.kind === 'jpg' ? Core.jpegOrientation(bytes) : 0;
          try {
            const d = await decode(new Blob([bytes]));
            it.w = d.w; it.h = d.h;
            it.thumb = drawThumb(d.src, d.w, d.h, 96);
            d.close();
          } catch (e) { errs.push(`「${f.name}」无法解码`); continue; }
        } else {
          if (m === 'render') {
            it.pages = 0;
          } else {
            try {
              const doc = await Core.loadPdf(PDFLib, bytes, f.name);
              it.pages = doc.getPageCount();
            } catch (e) { errs.push(e.message); continue; }
          }
        }
        arr.push(it);
      }
    } finally {
      setBusy(false);
    }
    if (mode !== m) return;
    renderList();
    summary();
    if (errs.length) status(st, errs.join('；'), 'err');
    if (m === 'render' && arr.length) openRender(arr[0]);
  }

  // ---------- 图片转 PDF ----------
  async function runImg() {
    const arr = lists.img;
    if (!arr.length) { status(st, '请先添加图片', 'err'); return; }
    setBusy(true, '生成中…');
    try {
      const doc = await PDFLib.PDFDocument.create();
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        status(st, `正在处理 ${i + 1}/${arr.length}：${it.name}`);
        let img;
        if (it.kind === 'webp') img = await reencode(it, 'png');
        else if (it.kind === 'jpg' && it.orient > 1) img = await reencode(it, 'jpg');
        else img = { type: it.kind, bytes: it.bytes };
        try {
          await Core.addImagePage(doc, img, opts.page);
        } catch (e) {
          // 少数 PNG（如特殊位深）pdf-lib 解不了，转成标准 PNG 再试
          await Core.addImagePage(doc, await reencode(it, 'png'), opts.page);
        }
      }
      const out = await doc.save();
      const name = arr.length === 1 ? baseName(arr[0].name) + '.pdf' : 'images.pdf';
      download(name, new Blob([out], { type: 'application/pdf' }));
      status(st, `已生成 ${name}：${arr.length} 页 · ${fmtSize(out.length)}`, 'ok');
    } catch (e) {
      status(st, '生成失败：' + (e.message || e), 'err');
    } finally {
      setBusy(false);
    }
  }

  // ---------- 合并 ----------
  async function runMerge() {
    const arr = lists.merge;
    if (arr.length < 2) { status(st, '至少添加 2 个 PDF', 'err'); return; }
    setBusy(true, '合并中…');
    try {
      const out = await Core.mergePdfs(PDFLib, arr.map((it) => ({ name: it.name, bytes: it.bytes })));
      download('merged.pdf', new Blob([out], { type: 'application/pdf' }));
      status(st, `已合并 ${arr.length} 个文件 · ${fmtSize(out.length)}`, 'ok');
    } catch (e) {
      status(st, e.message || String(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  // ---------- 拆分 ----------
  const MAX_EACH = 50;
  async function runSplit() {
    const it = lists.split[0];
    if (!it) { status(st, '请先选择一个 PDF', 'err'); return; }
    let idx;
    try { idx = Core.parseRanges($('#range').value, it.pages); } catch (e) { status(st, e.message, 'err'); return; }
    const each = $('#each').checked;
    if (each && idx.length > MAX_EACH) { status(st, `逐页下载最多 ${MAX_EACH} 页，当前选择了 ${idx.length} 页，请缩小范围`, 'err'); return; }
    setBusy(true, '导出中…');
    const base = baseName(it.name);
    try {
      const src = await Core.loadPdf(PDFLib, it.bytes, it.name);
      if (!each) {
        const out = await Core.copyPages(PDFLib, src, idx);
        download(`${base}-pages.pdf`, new Blob([out], { type: 'application/pdf' }));
        status(st, `已导出 ${idx.length} 页 · ${fmtSize(out.length)}`, 'ok');
      } else {
        for (let k = 0; k < idx.length; k++) {
          status(st, `逐页下载 ${k + 1}/${idx.length}`);
          const out = await Core.copyPages(PDFLib, src, [idx[k]]);
          download(`${base}-p${idx[k] + 1}.pdf`, new Blob([out], { type: 'application/pdf' }));
          await sleep(350);
        }
        status(st, `已逐页导出 ${idx.length} 个文件（浏览器若拦截多文件下载，请允许）`, 'ok');
      }
    } catch (e) {
      status(st, e.message || String(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  // ---------- PDF 转图片 ----------
  let pdfjsP = null;
  function loadPdfjs() {
    if (!pdfjsP) {
      pdfjsP = import(PDFJS_SRC).then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return lib;
      }).catch((e) => { pdfjsP = null; throw new Error('pdf.js 加载失败：' + (e.message || e)); });
    }
    return pdfjsP;
  }

  function resetRender() {
    rgen++;
    rsizes = [];
    pagesEl.textContent = '';
    if (rdoc) { rdoc.destroy(); rdoc = null; }
  }

  // 按倍数算导出尺寸，超出画布上限时降低倍数
  function outScale(i) {
    const [w, h] = rsizes[i];
    const s = Math.min(opts.scale, Math.sqrt(MAX_PIXELS / (w * h)), 16384 / w, 16384 / h);
    return { s, w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(h * s)), clamped: s < opts.scale };
  }

  function updateDims() {
    pagesEl.querySelectorAll('.pg').forEach((fig) => {
      const i = Number(fig.dataset.i);
      if (!rsizes[i]) return;
      const o = outScale(i);
      fig.querySelector('.dim').textContent = `${o.w}×${o.h}`;
    });
  }

  async function renderPage(page, scale, canvas, white) {
    const vp = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    if (white) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  }

  async function openRender(it) {
    resetRender();
    const gen = rgen;
    setBusy(true, '加载中…');
    status(st, '正在加载 pdf.js…');
    try {
      const lib = await loadPdfjs();
      if (gen !== rgen) return;
      const doc = await lib.getDocument({ data: it.bytes.slice(), isEvalSupported: false }).promise;
      if (gen !== rgen) { doc.destroy(); return; }
      rdoc = doc;
      it.pages = doc.numPages;
      renderList();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= doc.numPages; i++) {
        if (gen !== rgen) return;
        status(st, `渲染缩略图 ${i}/${doc.numPages}`);
        const page = await doc.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        rsizes[i - 1] = [vp1.width, vp1.height];
        const fig = document.createElement('figure');
        fig.className = 'pg';
        fig.dataset.i = String(i - 1);
        const box = document.createElement('div');
        box.className = 'cv';
        const cv = document.createElement('canvas');
        box.appendChild(cv);
        const cap = document.createElement('figcaption');
        const no = document.createElement('span');
        no.textContent = '第 ' + i + ' 页';
        const dim = document.createElement('span');
        dim.className = 'dim';
        const sp = document.createElement('span');
        sp.className = 'spacer';
        const dl = mkBtn('下载', () => downloadPage(i - 1));
        cap.append(no, dim, sp, dl);
        fig.append(box, cap);
        pagesEl.appendChild(fig);
        await renderPage(page, (220 * dpr) / Math.max(vp1.width, vp1.height), cv, true);
        cv.style.width = Math.round(cv.width / dpr) + 'px';
        page.cleanup();
        updateDims();
      }
      if (gen === rgen) status(st, `共 ${doc.numPages} 页，点缩略图下的「下载」或上方「全部下载」`, 'ok');
    } catch (e) {
      if (gen === rgen) {
        status(st, e.message && e.message.startsWith('pdf.js') ? e.message : Core.friendlyError(e, it.name), 'err');
        lists.render = [];
        renderList();
        resetRender();
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportPage(i) {
    const page = await rdoc.getPage(i + 1);
    const o = outScale(i);
    const c = document.createElement('canvas');
    try {
      await renderPage(page, o.s, c, true);
      const jpg = opts.fmt === 'jpg';
      const blob = await toBlob(c, jpg ? 'image/jpeg' : 'image/png', 0.92);
      const it = lists.render[0];
      download(`${baseName(it ? it.name : 'page')}-p${i + 1}.${jpg ? 'jpg' : 'png'}`, blob);
      return o.clamped;
    } finally {
      c.width = 0; c.height = 0;
      page.cleanup();
    }
  }

  async function downloadPage(i) {
    if (busy || !rdoc) return;
    setBusy(true, '导出中…');
    try {
      const clamped = await exportPage(i);
      if (clamped) toast('页面过大，已自动降低倍数');
    } catch (e) {
      status(st, '导出失败：' + (e.message || e), 'err');
    } finally {
      setBusy(false);
    }
  }

  async function runRender() {
    if (!rdoc) { status(st, '请先选择一个 PDF', 'err'); return; }
    const gen = rgen;
    const n = rdoc.numPages;
    setBusy(true, '导出中…');
    let clamped = false;
    try {
      for (let i = 0; i < n; i++) {
        if (gen !== rgen) return;
        status(st, `导出 ${i + 1}/${n}`);
        clamped = (await exportPage(i)) || clamped;
        await sleep(350);
      }
      status(st, `已导出 ${n} 张图片${clamped ? '（部分页面过大，已自动降低倍数）' : ''}；浏览器若拦截多文件下载，请允许`, 'ok');
    } catch (e) {
      status(st, '导出失败：' + (e.message || e), 'err');
    } finally {
      setBusy(false);
    }
  }

  // ---------- 模式与选项 ----------
  function setMode(m) {
    if (busy) { toast('正在处理，请稍候'); return; }
    mode = m;
    const cfg = MODES[m];
    $('#modes').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    document.querySelectorAll('.grp').forEach((g) => { g.hidden = g.dataset.for !== m; });
    goBtn.textContent = cfg.go;
    $('#dropText').textContent = cfg.drop;
    fileInput.accept = cfg.accept;
    fileInput.multiple = cfg.multi;
    pagesEl.hidden = m !== 'render';
    renderList();
    summary();
  }

  function bindSeg(sel, fn) {
    const seg = $(sel);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    });
  }

  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  bindSeg('#pageSeg', (v) => { opts.page = v; });
  bindSeg('#scaleSeg', (v) => { opts.scale = Number(v); updateDims(); });
  bindSeg('#fmtSeg', (v) => { opts.fmt = v; });
  $('#range').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSplit(); });

  goBtn.addEventListener('click', () => {
    if (busy) return;
    ({ img: runImg, merge: runMerge, split: runSplit, render: runRender })[mode]();
  });
  $('#clear').addEventListener('click', () => {
    if (busy) return;
    lists[mode] = [];
    if (mode === 'render') resetRender();
    renderList();
    status(st, '');
  });

  fileInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });

  if (!PDFLib || !Core) { status(st, 'pdf-lib 加载失败，请刷新重试', 'err'); goBtn.disabled = true; return; }
  setMode('img');
})();
