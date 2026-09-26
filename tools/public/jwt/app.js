(() => {
  'use strict';
  const { $, status, debounce } = window.T;

  const input = $('#input');
  const st = $('#status');
  const times = $('#times');
  const MAX_LEN = 1024 * 1024;

  let payloadObj = null;  // 当前解析成功的 payload，用于每秒刷新剩余时间

  // ---------- 解码 ----------
  // 返回 { obj, text }；失败抛出带中文说明的 Error
  function decodePart(seg, name) {
    if (!seg) throw new Error(`${name} 段为空`);
    const bad = seg.match(/[^A-Za-z0-9_\-=]/);
    if (bad) {
      const hint = bad[0] === '+' || bad[0] === '/' ? '（JWT 应使用 base64url：- 和 _ 代替 + 和 /）' : '';
      throw new Error(`${name} 不是合法的 base64url：含非法字符「${bad[0]}」${hint}`);
    }
    let b = seg.replace(/=+$/, '');
    if (b.includes('=')) throw new Error(`${name} 不是合法的 base64url：「=」只能出现在末尾`);
    if (b.length % 4 === 1) throw new Error(`${name} 不是合法的 base64url：长度不合法`);
    b = b.replace(/-/g, '+').replace(/_/g, '/');
    b += '='.repeat((4 - (b.length % 4)) % 4);
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      throw new Error(`${name} 解码后不是合法的 UTF-8 文本`);
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error(`${name} 不是合法 JSON：${e.message}`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${name} 应为 JSON 对象`);
    return { obj, text };
  }

  // 返回 { parts, header, payload, sig, errors }；header/payload 为 decodePart 结果或 null
  function parseJwt(raw) {
    const s = raw.trim().replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
    const parts = s.split('.');
    const res = { parts: parts.length, header: null, payload: null, sig: '', errors: [] };
    if (parts.length === 5) {
      res.errors.push('这是 JWE（5 段，加密的 JWT），内容已加密，无法直接解码');
      return res;
    }
    if (parts.length !== 3) {
      res.errors.push(`段数不对：JWT 应为 3 段（header.payload.signature），实际 ${parts.length} 段`);
      return res;
    }
    try { res.header = decodePart(parts[0], 'Header'); } catch (e) { res.errors.push(e.message); }
    try { res.payload = decodePart(parts[1], 'Payload'); } catch (e) { res.errors.push(e.message); }
    res.sig = parts[2];
    return res;
  }

  function fmtDur(sec) {
    sec = Math.floor(Math.abs(sec));
    const units = [[86400, '天'], [3600, '小时'], [60, '分'], [1, '秒']];
    const out = [];
    for (const [n, u] of units) {
      const v = Math.floor(sec / n);
      sec -= v * n;
      if (v || out.length) out.push(v + u);
      if (out.length === 3) break;
    }
    return out.length ? out.join(' ') : '0秒';
  }

  const pad = (n) => String(n).padStart(2, '0');
  function fmtDate(sec) {
    const d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return null;
    const off = -d.getTimezoneOffset();
    const tz = `UTC${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tz}`;
  }

  // 生成时间行：[{ key, date, tag, kind, sub }]，now 为秒
  function timeRows(p, now) {
    const rows = [];
    const valid = {};
    for (const key of ['exp', 'nbf', 'iat']) {
      if (!(key in p)) continue;
      const v = p[key];
      if (typeof v !== 'number' || !isFinite(v)) {
        rows.push({ key, date: JSON.stringify(v), tag: '格式错误', kind: 'bad', sub: '应为数字（秒级 Unix 时间戳）' });
        continue;
      }
      const date = fmtDate(v);
      if (!date) { rows.push({ key, date: String(v), tag: '超出范围', kind: 'bad', sub: '无法转换为日期' }); continue; }
      valid[key] = v;
      const row = { key, date, tag: '', kind: '', sub: '' };
      const diff = v - now;
      if (key === 'exp') {
        if (diff <= 0) { row.tag = '已过期'; row.kind = 'bad'; row.sub = `已过期 ${fmtDur(diff)}`; }
        else { row.tag = '未过期'; row.kind = 'good'; row.sub = `剩余 ${fmtDur(diff)}`; }
      } else if (key === 'nbf') {
        if (diff > 0) { row.tag = '未生效'; row.kind = 'bad'; row.sub = `还有 ${fmtDur(diff)} 生效`; }
        else { row.tag = '已生效'; row.kind = 'good'; row.sub = `${fmtDur(diff)} 前生效`; }
      } else if (diff > 0) {
        row.tag = '在未来'; row.kind = 'bad'; row.sub = `签发时间比现在晚 ${fmtDur(diff)}`;
      } else {
        row.sub = `${fmtDur(diff)} 前签发`;
      }
      if (v > 1e11) row.sub += ' · 数值像毫秒，JWT 规定为秒';
      rows.push(row);
    }
    if (!rows.length) return rows;

    let overall;
    if ('nbf' in valid && valid.nbf > now) overall = { tag: '未生效', kind: 'bad', sub: `还有 ${fmtDur(valid.nbf - now)} 生效` };
    else if ('exp' in valid && valid.exp <= now) overall = { tag: '已过期', kind: 'bad', sub: `已过期 ${fmtDur(valid.exp - now)}` };
    else if ('exp' in valid) overall = { tag: '有效', kind: 'good', sub: `剩余 ${fmtDur(valid.exp - now)}` };
    else overall = { tag: '有效', kind: 'good', sub: '没有 exp，不会过期' };
    rows.unshift({ key: '状态', date: '', ...overall });
    return rows;
  }

  // ---------- 渲染 ----------
  function renderTimes() {
    times.textContent = '';
    if (!payloadObj) { $('#timeMeta').textContent = ''; return; }
    const rows = timeRows(payloadObj, Date.now() / 1000);
    $('#timeMeta').textContent = rows.length ? '按本机时间与时区计算' : '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'Payload 中没有 exp / nbf / iat';
      tr.appendChild(td);
      times.appendChild(tr);
      return;
    }
    for (const r of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = r.key;
      const td = document.createElement('td');
      if (r.date) td.appendChild(document.createTextNode(r.date));
      if (r.tag) {
        const tag = document.createElement('span');
        tag.className = 'tag' + (r.kind ? ' ' + r.kind : '');
        tag.textContent = r.tag;
        td.appendChild(tag);
      }
      if (r.sub) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = r.sub;
        td.appendChild(sub);
      }
      tr.appendChild(th);
      tr.appendChild(td);
      times.appendChild(tr);
    }
  }

  function run() {
    payloadObj = null;
    $('#header').textContent = '';
    $('#payload').textContent = '';
    $('#sig').textContent = '';
    $('#algMeta').textContent = '';
    status(st, '');

    const raw = input.value;
    $('#inMeta').textContent = raw.trim() ? `${raw.trim().length} 字符` : '';
    if (!raw.trim()) { renderTimes(); return; }
    if (raw.length > MAX_LEN) { status(st, '输入超过 1 MB，不像是 JWT', 'err'); renderTimes(); return; }

    const res = parseJwt(raw);
    if (res.header) {
      $('#header').textContent = JSON.stringify(res.header.obj, null, 2);
      const alg = res.header.obj.alg;
      if (typeof alg === 'string') $('#algMeta').textContent = 'alg: ' + alg + (alg.toLowerCase() === 'none' ? '（无签名）' : '');
    }
    if (res.payload) {
      $('#payload').textContent = JSON.stringify(res.payload.obj, null, 2);
      payloadObj = res.payload.obj;
    }
    if (res.parts === 3) $('#sig').textContent = res.sig || '（空）';
    if (res.errors.length) status(st, res.errors.join('；'), 'err');
    else status(st, '已解码（签名未校验）', 'ok');
    renderTimes();
  }

  // ---------- 事件 ----------
  input.addEventListener('input', debounce(run, 120));
  setInterval(() => { if (payloadObj && !document.hidden) renderTimes(); }, 1000);

  run();
})();
