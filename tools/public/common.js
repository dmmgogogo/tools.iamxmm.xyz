// 工具页公共脚本：复制、提示、下载、[data-copy] / [data-clear] 自动绑定
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);

  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
  }

  // 复制成功后按钮短暂显示「✓ 已复制」
  function flash(btn) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = '✓ 已复制';
    btn.classList.add('done');
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(() => {
      btn.textContent = btn.dataset.label;
      btn.classList.remove('done');
    }, 1200);
  }

  async function copy(text, btn) {
    if (!text) { toast('没有可复制的内容'); return false; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) { toast('复制失败，请手动复制'); return false; }
    }
    if (btn) flash(btn); else toast('已复制');
    return true;
  }

  function download(filename, data, type = 'text/plain;charset=utf-8') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function debounce(fn, ms = 150) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // 状态行：kind = '' | 'err' | 'ok'
  function status(el, msg, kind = '') {
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  const valueOf = (el) => ('value' in el ? el.value : el.textContent);

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      const target = $(c.dataset.copy);
      if (target) copy(valueOf(target), c);
      return;
    }
    const x = e.target.closest('[data-clear]');
    if (x) {
      const target = $(x.dataset.clear);
      if (target) {
        target.value = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
      }
    }
  });

  window.T = { $, toast, copy, download, debounce, status };
})();
