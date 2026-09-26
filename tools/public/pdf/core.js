// PDF 工具箱纯逻辑：页码解析、PDF 读取/合并/拆分、图片页排版、JPEG EXIF 方向。
// 浏览器挂到 window.PDFCore；node 测试可 require 本文件。PDFLib 由调用方传入。
(function (root) {
  'use strict';

  // "1-3,5,8-" → 0 起始页索引数组（按输入顺序、去重）。非法输入抛出带中文说明的错误
  function parseRanges(input, total) {
    if (!Number.isInteger(total) || total < 1) throw new Error('PDF 没有页面');
    const s = String(input == null ? '' : input).replace(/[，、]/g, ',').replace(/\s+/g, '');
    if (!s) throw new Error('请输入页码范围，如 1-3,5');
    const out = [];
    const seen = new Set();
    for (const tok of s.split(',')) {
      if (!tok) continue;
      const m = tok.match(/^(\d+)(?:(-)(\d*))?$/);
      if (!m) throw new Error('无法识别「' + tok + '」，格式如 1-3,5,8-');
      const a = parseInt(m[1], 10);
      const b = m[2] ? (m[3] === '' ? total : parseInt(m[3], 10)) : a;
      if (a < 1 || b < 1) throw new Error('页码从 1 开始：' + tok);
      if (a > total || b > total) throw new Error('页码超出范围：' + tok + '（共 ' + total + ' 页）');
      if (a > b) throw new Error('起始页大于结束页：' + tok);
      for (let i = a; i <= b; i++) {
        if (!seen.has(i)) { seen.add(i); out.push(i - 1); }
      }
    }
    if (!out.length) throw new Error('请输入页码范围，如 1-3,5');
    return out;
  }

  // 把 pdf-lib / pdf.js 的异常翻译成友好提示
  function friendlyError(e, name) {
    const msg = String((e && (e.message || e)) || '');
    const ename = (e && e.name) || '';
    const who = name ? '「' + name + '」' : '文件';
    if (ename === 'PasswordException' || /encrypt/i.test(msg)) return who + '已加密（有密码保护），请先解除密码再处理';
    if (ename === 'InvalidPDFException' || /No PDF header|Failed to parse|Invalid PDF|invalid pdf structure/i.test(msg)) {
      return who + '不是有效的 PDF，或文件已损坏';
    }
    return who + '处理失败：' + msg;
  }

  async function loadPdf(PDFLib, bytes, name) {
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      throw new Error(friendlyError(e, name));
    }
    if (doc.getPageCount() < 1) throw new Error(friendlyError(new Error('Invalid PDF'), name));
    return doc;
  }

  // 从已加载的文档复制指定页到新文档
  async function copyPages(PDFLib, src, indices) {
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    return out.save();
  }

  // items: [{ name, bytes }] → 合并后的 Uint8Array
  async function mergePdfs(PDFLib, items) {
    const out = await PDFLib.PDFDocument.create();
    for (const it of items) {
      const src = await loadPdf(PDFLib, it.bytes, it.name);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    return out.save();
  }

  const A4 = [595.28, 841.89];
  const MARGIN = 36;      // 0.5 英寸
  const MAX_PAGE = 14400; // PDF 规范允许的最大页面边长（pt）

  // 图片（像素，按 1px = 1pt）在页面上的位置。mode: 'fit' 页面=图片尺寸；'a4' A4 纵向居中等比缩放留边
  function placeImage(iw, ih, mode) {
    if (!(iw > 0 && ih > 0)) throw new Error('图片尺寸无效');
    if (mode === 'a4') {
      const pw = A4[0], ph = A4[1];
      const s = Math.min((pw - 2 * MARGIN) / iw, (ph - 2 * MARGIN) / ih);
      const w = iw * s, h = ih * s;
      return { pw, ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
    }
    const s = Math.min(1, MAX_PAGE / iw, MAX_PAGE / ih);
    const w = iw * s, h = ih * s;
    return { pw: w, ph: h, x: 0, y: 0, w, h };
  }

  // img: { type: 'jpg' | 'png', bytes }。嵌入失败会抛错，由调用方决定是否转码重试
  async function addImagePage(doc, img, mode) {
    const embedded = img.type === 'jpg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
    const r = placeImage(embedded.width, embedded.height, mode);
    const page = doc.addPage([r.pw, r.ph]);
    page.drawImage(embedded, { x: r.x, y: r.y, width: r.w, height: r.h });
  }

  // 读取 JPEG 的 EXIF Orientation（1-8），没有或解析不了返回 0
  function jpegOrientation(b) {
    if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return 0;
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xFF) return 0;
      const marker = b[p + 1];
      if (marker === 0xDA || marker === 0xD9) return 0;
      const len = (b[p + 2] << 8) | b[p + 3];
      if (len < 2) return 0;
      const end = Math.min(p + 2 + len, b.length);
      const s = p + 4;
      if (marker === 0xE1 && s + 14 <= end &&
          b[s] === 0x45 && b[s + 1] === 0x78 && b[s + 2] === 0x69 && b[s + 3] === 0x66 && b[s + 4] === 0 && b[s + 5] === 0) {
        const t = s + 6;
        const le = b[t] === 0x49 && b[t + 1] === 0x49;
        if (!le && !(b[t] === 0x4D && b[t + 1] === 0x4D)) return 0;
        const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
        const u32 = (o) => (le
          ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
          : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
        const ifd = t + u32(t + 4);
        if (ifd + 2 > end) return 0;
        const n = u16(ifd);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 12 > end) return 0;
          if (u16(e) === 0x0112) {
            const v = u16(e + 8);
            return v >= 1 && v <= 8 ? v : 0;
          }
        }
        return 0;
      }
      p += 2 + len;
    }
    return 0;
  }

  const api = { parseRanges, friendlyError, loadPdf, copyPages, mergePdfs, placeImage, addImagePage, jpegOrientation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PDFCore = api;
})(typeof self !== 'undefined' ? self : this);
