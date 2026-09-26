// 图片处理纯逻辑：输出尺寸计算、大小变化百分比。浏览器挂到 window.ImgCore；node 测试可 require
(function (root) {
  'use strict';

  const LIMITS = { long: [1, 16384], pct: [1, 400] };

  // 校验缩放参数，返回数值；非法抛错
  function checkScale(mode, value) {
    if (mode === 'orig') return 0;
    const lim = LIMITS[mode];
    if (!lim) throw new Error('未知缩放方式');
    const s = String(value == null ? '' : value).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(mode === 'long' ? '最长边请输入正整数像素' : '百分比请输入数字');
    const v = Number(s);
    if (mode === 'long' && !Number.isInteger(v)) throw new Error('最长边请输入正整数像素');
    if (v < lim[0] || v > lim[1]) throw new Error((mode === 'long' ? '最长边' : '百分比') + '范围 ' + lim[0] + '–' + lim[1]);
    return v;
  }

  // 按缩放方式计算输出尺寸（保持比例）。long：最长边不超过 value，不放大；pct：按百分比
  function calcSize(w, h, mode, value) {
    if (!(w > 0 && h > 0)) throw new Error('图片尺寸无效');
    const v = checkScale(mode, value);
    let s = 1;
    if (mode === 'long') s = Math.min(1, v / Math.max(w, h));
    else if (mode === 'pct') s = v / 100;
    if (s === 1) return { w, h };
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  // 大小变化：-72.3% / +5.0% / 0%
  function fmtRatio(oldSize, newSize) {
    if (!(oldSize > 0)) return '';
    const r = (newSize - oldSize) / oldSize * 100;
    if (Math.abs(r) < 0.05) return '0%';
    return (r < 0 ? '−' : '+') + Math.abs(r).toFixed(1) + '%';
  }

  const api = { checkScale, calcSize, fmtRatio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImgCore = api;
})(typeof self !== 'undefined' ? self : this);
