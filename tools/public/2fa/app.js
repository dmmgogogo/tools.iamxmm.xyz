(() => {
  'use strict';

  const STORE_KEY = 'tools.2fa.v1';
  const ALGOS = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const btnAdd = $('btnAdd');

  let items = load();
  const keyCache = new Map();   // secret|algo -> CryptoKey
  const codeCache = new Map();  // id -> { counter, code }

  // ---------- storage ----------
  function load() {
    let raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return []; }
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        const ok = data.map(sanitize).filter(Boolean);
        if (ok.length === data.length) return ok;
        // 有条目无法识别：备份原文，避免下次保存时被静默丢掉
        try { localStorage.setItem(STORE_KEY + '.corrupt.' + Date.now(), raw); } catch (e) { /* ignore */ }
        alert(`本地有 ${data.length - ok.length} 条数据无法识别，原始内容已备份到 localStorage。`);
        return ok;
      }
    } catch (e) { /* fallthrough */ }
    // 数据损坏：先备份原文，避免被新写入覆盖
    try { localStorage.setItem(STORE_KEY + '.corrupt.' + Date.now(), raw); } catch (e) { /* ignore */ }
    alert('本地数据损坏，已备份原始内容到 localStorage，当前列表为空。');
    return [];
  }

  // 保存失败时回滚内存到已持久化的状态，避免界面显示未保存的数据
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
      return true;
    } catch (e) {
      alert('保存失败：' + e.message);
      items = load();
      render();
      return false;
    }
  }

  function sanitize(it) {
    if (!it || typeof it !== 'object') return null;
    const secret = normSecret(it.secret);
    if (!isSecret(secret)) return null;
    const digits = [6, 7, 8].includes(+it.digits) ? +it.digits : 6;
    const period = Number.isInteger(+it.period) && +it.period >= 1 && +it.period <= 300 ? +it.period : 30;
    const algoIn = String(it.algo || '').toUpperCase().replace('-', '');
    const algo = ALGOS[algoIn] ? algoIn : 'SHA1';
    return {
      id: typeof it.id === 'string' && it.id ? it.id : newId(),
      name: String(it.name || '').slice(0, 100),
      secret, digits, period, algo,
    };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- base32 / TOTP ----------
  function normSecret(s) {
    return String(s || '').toUpperCase().replace(/[\s\-=]/g, '');
  }

  function isSecret(s, minLen = 8) {
    return s.length >= minLen && /^[A-Z2-7]+$/.test(s);
  }

  function base32Decode(s) {
    let bits = 0, value = 0;
    const out = [];
    for (const ch of s) {
      value = (value << 5) | B32.indexOf(ch);
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  async function getKey(it) {
    const k = it.secret + '|' + it.algo;
    if (!keyCache.has(k)) {
      keyCache.set(k, crypto.subtle.importKey(
        'raw', base32Decode(it.secret), { name: 'HMAC', hash: ALGOS[it.algo] }, false, ['sign']));
    }
    return keyCache.get(k);
  }

  async function totp(it, counter) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, Math.floor(counter / 0x100000000));
    view.setUint32(4, counter >>> 0);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await getKey(it), buf));
    const off = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % 10 ** it.digits).padStart(it.digits, '0');
  }

  // ---------- render ----------
  function render() {
    grid.querySelectorAll('.card:not(.add)').forEach((el) => el.remove());
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = it.id;
      const label = it.name || it.secret.slice(0, 6) + '…';
      card.title = (it.name ? it.name + '\n' : '') + '点击复制';
      card.innerHTML = '<div class="name"></div><div class="code">——</div><div class="left"></div>'
        + '<div class="bar"><i></i></div><button class="del" title="删除" aria-label="删除">×</button>';
      card.querySelector('.name').textContent = label;
      frag.appendChild(card);
    }
    grid.insertBefore(frag, btnAdd);
    $('count').textContent = String(items.length).padStart(2, '0') + ' 项';
    codeCache.clear();
    tick();
  }

  async function tick() {
    const now = Date.now() / 1000;
    for (const it of items) {
      const card = grid.querySelector(`.card[data-id="${CSS.escape(it.id)}"]`);
      if (!card) continue;
      const counter = Math.floor(now / it.period);
      const left = Math.ceil(it.period - (now % it.period));
      const leftEl = card.querySelector('.left');
      leftEl.textContent = left + 's';
      card.classList.toggle('warn', left <= 5);
      card.querySelector('.bar i').style.transform = `scaleX(${left / it.period})`;

      const cached = codeCache.get(it.id);
      if (cached && cached.counter === counter) continue;
      codeCache.set(it.id, { counter, code: null });
      const codeEl = card.querySelector('.code');
      try {
        const code = await totp(it, counter);
        codeCache.set(it.id, { counter, code });
        // 6 位码显示成「123 456」便于读，复制仍用原始值
        codeEl.textContent = code.length === 6 ? code.slice(0, 3) + ' ' + code.slice(3) : code;
        codeEl.classList.remove('err');
      } catch (e) {
        codeCache.delete(it.id);
        keyCache.delete(it.secret + '|' + it.algo);
        codeEl.textContent = '计算失败：' + e.message;
        codeEl.classList.add('err');
      }
    }
  }

  // ---------- actions ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  grid.addEventListener('click', async (e) => {
    const card = e.target.closest('.card:not(.add)');
    if (!card) return;
    const it = items.find((x) => x.id === card.dataset.id);
    if (!it) return;
    if (e.target.closest('.del')) {
      if (!confirm(`删除「${it.name || it.secret.slice(0, 6) + '…'}」？删除后无法恢复。`)) return;
      items = items.filter((x) => x.id !== it.id);
      if (save()) render();
      return;
    }
    const cached = codeCache.get(it.id);
    if (!cached || !cached.code) return;
    await copy(cached.code);
    toast('已复制 ' + cached.code);
    // 在卡片本身给出反馈，比底部 toast 更显眼
    card.classList.add('copied');
    clearTimeout(card._copiedTimer);
    card._copiedTimer = setTimeout(() => card.classList.remove('copied'), 1200);
  });

  // otpauth://totp/Label?secret=...&issuer=...&digits=6&period=30&algorithm=SHA1
  function parseUri(uri) {
    let u;
    try { u = new URL(uri.trim()); } catch (e) { return null; }
    if (u.protocol !== 'otpauth:') return null;
    if (u.host.toLowerCase() !== 'totp') throw new Error('只支持 TOTP，不支持 ' + u.host);
    const p = u.searchParams;
    let name = '';
    try { name = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch (e) { name = u.pathname.slice(1); }
    const issuer = p.get('issuer');
    if (issuer && !name.startsWith(issuer)) name = issuer + ':' + name;
    return sanitize({
      name, secret: p.get('secret'),
      digits: p.get('digits'), period: p.get('period'), algo: p.get('algorithm'),
    });
  }

  function addItems(newOnes) {
    const seen = new Set(items.map((x) => x.secret));
    let added = 0, dup = 0;
    for (const it of newOnes) {
      if (seen.has(it.secret)) { dup++; continue; }
      seen.add(it.secret);
      items.push(it);
      added++;
    }
    if (added && !save()) return { added: 0, dup, failed: true };
    if (added) render();
    return { added, dup };
  }

  // 添加
  btnAdd.addEventListener('click', () => {
    $('formAdd').reset();
    $('addErr').textContent = '';
    $('dlgAdd').showModal();
    $('inName').focus();
  });

  $('formAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('inSecret').value.trim();
    const name = $('inName').value.trim();
    let it;
    try {
      it = raw.toLowerCase().startsWith('otpauth:')
        ? parseUri(raw)
        : sanitize({ name, secret: raw });
    } catch (err) {
      $('addErr').textContent = err.message;
      return;
    }
    if (!it) {
      $('addErr').textContent = '密钥无效：只能包含 A-Z 和 2-7，至少 8 位';
      return;
    }
    if (name) it.name = name;
    const { added, failed } = addItems([it]);
    if (failed) return;
    if (!added) {
      $('addErr').textContent = '该密钥已存在';
      return;
    }
    $('dlgAdd').close();
    toast('已添加');
  });

  // 导入
  const NAME_KEYS = ['name', 'remark', 'remarks', 'title', 'label', 'account', 'note', 'memo', 'desc', 'beizhu', 'issuer'];
  const NAME_RE = /name|remark|title|label|account|note|memo|desc|beizhu|issuer/i;

  function fromObject(obj) {
    if (typeof obj === 'string') return fromLine(obj);
    if (!obj || typeof obj !== 'object') return null;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.trim().toLowerCase().startsWith('otpauth:')) return parseUri(v);
    }
    const entries = Object.entries(obj).filter(([, v]) => typeof v === 'string');
    // 先按字段名找密钥，找不到再找"看起来像 base32 密钥"的值
    let secretKey = entries.find(([k, v]) => /secret|key|miyao/i.test(k) && isSecret(normSecret(v)));
    if (!secretKey) secretKey = entries.find(([k, v]) => !NAME_RE.test(k) && isSecret(normSecret(v), 16));
    if (!secretKey) return null;
    let name = '';
    for (const nk of NAME_KEYS) {
      const hit = entries.find(([k]) => k.toLowerCase() === nk && k !== secretKey[0]);
      if (hit && hit[1].trim()) { name = hit[1].trim(); break; }
    }
    if (!name) {
      const hit = entries.find(([k, v]) => k !== secretKey[0] && NAME_RE.test(k) && v.trim());
      if (hit) name = hit[1].trim();
    }
    return sanitize({
      name: cleanName(name), secret: secretKey[1],
      digits: obj.digits, period: obj.period, algo: obj.algo || obj.algorithm,
    });
  }

  function fromLine(line) {
    line = line.trim();
    if (!line) return null;
    if (line.toLowerCase().startsWith('otpauth:')) return parseUri(line);
    // 优先「备注 密钥」；否则整行当作密钥（兼容 "JBSW Y3DP EHPK 3PXP" 这种分组写法）
    // 支持密钥分组写法：「ly2 JBSW Y3DP EHPK 3PXP」→ 末尾连续的 4 位组合并为密钥
    const g = line.match(/^(.*?)((?:[A-Za-z2-7]{4}\s+)+[A-Za-z2-7]{1,4}=*)$/);
    const m = line.match(/^(.*?)[\s,，|]+([A-Za-z2-7=]+)$/);
    let name = '', secret = '';
    if (m && isSecret(normSecret(m[2]), 16)) { name = m[1]; secret = m[2]; }
    else if (g && isSecret(normSecret(g[2]), 16)) { name = g[1]; secret = g[2]; }
    else return null;
    return sanitize({ name: cleanName(name), secret });
  }

  // lzltool 的备注常写成 "cloud -"，去掉尾部分隔符
  function cleanName(s) {
    return String(s || '').trim().replace(/[\s\-–—:：|,，]+$/, '');
  }

  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
      if (typeof data === 'string') data = JSON.parse(data);
    } catch (e) {
      data = undefined;
    }
    let rows;
    if (data !== undefined) {
      if (Array.isArray(data)) rows = data;
      else if (data && Array.isArray(data.items)) rows = data.items;
      else if (data && typeof data === 'object') rows = [data];
      else rows = [];
    } else {
      rows = text.split(/\r?\n/);
    }
    const ok = [];
    let bad = 0;
    for (const r of rows) {
      if (typeof r === 'string' && !r.trim()) continue;
      let it = null;
      try { it = fromObject(r); } catch (e) { it = null; }
      if (it) ok.push(it); else bad++;
    }
    return { ok, bad };
  }

  $('btnImport').addEventListener('click', () => {
    $('formImport').reset();
    $('importErr').textContent = '';
    $('dlgImport').showModal();
    $('inImport').focus();
  });

  $('formImport').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('inImport').value.trim();
    if (!text) { $('importErr').textContent = '内容为空'; return; }
    const { ok, bad } = parseImport(text);
    if (!ok.length) {
      $('importErr').textContent = '没有识别到有效密钥' + (bad ? `（${bad} 条无法解析）` : '');
      return;
    }
    const { added, dup, failed } = addItems(ok);
    if (failed) return;
    $('dlgImport').close();
    alert(`导入完成：新增 ${added} 个` + (dup ? `，重复跳过 ${dup} 个` : '') + (bad ? `，无法解析 ${bad} 条` : ''));
  });

  // 导出
  $('btnExport').addEventListener('click', () => {
    if (!items.length) { toast('没有可导出的数据'); return; }
    const data = { version: 1, exportedAt: new Date().toISOString(),
      items: items.map(({ name, secret, digits, period, algo }) => ({ name, secret, digits, period, algo })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `2fa-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  // 多标签页同步
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) { items = load(); render(); }
  });

  if (!window.crypto || !crypto.subtle) {
    alert('当前环境不支持 WebCrypto（需要 HTTPS），无法计算验证码。');
    return;
  }
  render();
  setInterval(tick, 1000);
})();
