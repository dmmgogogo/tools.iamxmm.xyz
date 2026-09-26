// 在 Worker 里执行正则：灾难性回溯只会卡住 Worker，主线程超时后直接 terminate
'use strict';

const MAX_MATCHES = 1000;

// 零长度匹配时推进 lastIndex；u 模式下跨过完整的代理对
function advanceIndex(str, i, unicode) {
  if (unicode && i + 1 < str.length) {
    const c = str.charCodeAt(i);
    const d = str.charCodeAt(i + 1);
    if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) return i + 2;
  }
  return i + 1;
}

// 返回 { matches: [{ index, text, groups, named }], truncated }；正则非法时抛 SyntaxError
function findMatches(src, flags, text, limit = MAX_MATCHES) {
  const re = new RegExp(src, flags);
  const matches = [];
  const toMatch = (m) => ({
    index: m.index,
    text: m[0],
    groups: m.slice(1),
    named: m.groups ? Object.assign({}, m.groups) : null,
  });
  if (!re.global) {
    const m = re.exec(text);
    if (m) matches.push(toMatch(m));
    return { matches, truncated: false };
  }
  let truncated = false;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (matches.length >= limit) { truncated = true; break; }
    matches.push(toMatch(m));
    if (m[0] === '') re.lastIndex = advanceIndex(text, re.lastIndex, re.unicode);
  }
  return { matches, truncated };
}

self.onmessage = (e) => {
  const { id, src, flags, text, rep } = e.data;
  try {
    const res = findMatches(src, flags, text);
    const replaced = text ? text.replace(new RegExp(src, flags), rep) : '';
    self.postMessage({ id, ok: true, matches: res.matches, truncated: res.truncated, replaced });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
