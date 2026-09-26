(() => {
  'use strict';
  const { $, status, debounce } = window.T;

  const input = $('#input');
  const picker = $('#picker');
  const st = $('#status');
  const MAX_LEN = 200;

  // ---------- 解析与转换 ----------
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

  function num(s) {
    if (!NUM.test(s)) throw new Error(`「${s}」不是数字`);
    return parseFloat(s);
  }

  // 返回 { v, pct }
  function numOrPct(s) {
    if (s.endsWith('%')) return { v: num(s.slice(0, -1)), pct: true };
    return { v: num(s), pct: false };
  }

  function angle(s) {
    const m = s.match(/^(.*?)(deg|rad|grad|turn)?$/);
    let v = num(m[1]);
    if (m[2] === 'rad') v = (v * 180) / Math.PI;
    else if (m[2] === 'grad') v *= 0.9;
    else if (m[2] === 'turn') v *= 360;
    return ((v % 360) + 360) % 360;
  }

  function alphaOf(s) {
    if (s == null) return 1;
    const a = numOrPct(s);
    return clamp01(a.pct ? a.v / 100 : a.v);
  }

  // 拆分函数参数，支持逗号写法与空格 + 斜杠写法
  function splitArgs(body) {
    body = body.trim();
    let parts;
    let alpha = null;
    if (body.includes(',')) {
      parts = body.split(',').map((x) => x.trim());
      if (parts.length === 4) alpha = parts.pop();
    } else {
      const sl = body.split('/');
      if (sl.length > 2) return null;
      parts = sl[0].trim().split(/\s+/);
      if (sl.length === 2) alpha = sl[1].trim();
    }
    if (parts.length !== 3 || parts.some((x) => !x) || alpha === '') return null;
    return { parts, alpha };
  }

  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  // Björn Ottosson OKLab
  function rgbToOklab(r, g, b) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }

  function oklabToRgb(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [
      toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      toGam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
  }

  function rgbToOklch(r, g, b) {
    const [L, a, bb] = rgbToOklab(r, g, b);
    const C = Math.sqrt(a * a + bb * bb);
    let H = (Math.atan2(bb, a) * 180) / Math.PI;
    if (H < 0) H += 360;
    return [L, C, C < 1e-4 ? 0 : H];
  }

  function oklchToRgb(L, C, H) {
    const h = (H * Math.PI) / 180;
    return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
  }

  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }

  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    if (d < 1e-9) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return [h, s, l];
  }

  // 返回 { r, g, b, a, clipped }（r/g/b 为 0–1 的 sRGB），空输入返回 null，非法抛错
  function parseColor(str) {
    const s = str.trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
      const v = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1));
      return { r: v[0], g: v[1], b: v[2], a: v[3], clipped: false };
    }
    if (/^#/.test(s)) throw new Error('HEX 应为 3、4、6 或 8 位十六进制');
    m = s.match(/^(rgba?|hsla?|oklch)\((.*)\)$/);
    if (!m) throw new Error('无法识别的格式，支持 #hex、rgb()、hsl()、oklch()');
    const fn = m[1];
    const args = splitArgs(m[2]);
    if (!args) throw new Error(`${fn}() 参数应为 3 个值（可选 alpha），用逗号或空格分隔`);
    const [p0, p1, p2] = args.parts;
    const a = alphaOf(args.alpha);
    let rgb;
    if (fn.startsWith('rgb')) {
      rgb = [p0, p1, p2].map((x) => {
        const n = numOrPct(x);
        return clamp01(n.pct ? n.v / 100 : n.v / 255);
      });
    } else if (fn.startsWith('hsl')) {
      const sat = numOrPct(p1).v / 100;
      const lig = numOrPct(p2).v / 100;
      rgb = hslToRgb(angle(p0), clamp01(sat), clamp01(lig));
    } else {
      const L = numOrPct(p0);
      const C = numOrPct(p1);
      rgb = oklchToRgb(
        clamp01(L.pct ? L.v / 100 : L.v),
        Math.max(0, C.pct ? (C.v / 100) * 0.4 : C.v),
        angle(p2),
      );
    }
    const clipped = rgb.some((c) => c < -1e-4 || c > 1 + 1e-4 || Number.isNaN(c));
    rgb = rgb.map((c) => (Number.isNaN(c) ? 0 : clamp01(c)));
    return { r: rgb[0], g: rgb[1], b: rgb[2], a, clipped };
  }

  const fix = (x, d) => String(Number(x.toFixed(d)));
  // 色相四舍五入后可能变成 360，归一为 0
  const hue = (x, d) => { const v = fix(x, d); return v === '360' ? '0' : v; };
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  const to8 = (c) => Math.round(c * 255);

  // 返回各格式字符串
  function formats(c) {
    const r8 = to8(c.r), g8 = to8(c.g), b8 = to8(c.b);
    const hasA = c.a < 1;
    const a = fix(c.a, 3);
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    const [L, C, H] = rgbToOklch(c.r, c.g, c.b);
    const hslArgs = `${hue(h, 1)}, ${fix(s * 100, 1)}%, ${fix(l * 100, 1)}%`;
    const oklch = `oklch(${fix(L, 4)} ${fix(C, 4)} ${hue(H, 2)}${hasA ? ' / ' + a : ''})`;
    const hex = '#' + hex2(r8) + hex2(g8) + hex2(b8) + (hasA ? hex2(to8(c.a)) : '');
    return {
      hex,
      hex6: '#' + hex2(r8) + hex2(g8) + hex2(b8),
      rgb: hasA ? `rgba(${r8}, ${g8}, ${b8}, ${a})` : `rgb(${r8}, ${g8}, ${b8})`,
      hsl: hasA ? `hsla(${hslArgs}, ${a})` : `hsl(${hslArgs})`,
      oklch,
      vars: [
        `--color: ${hex};`,
        `--color-rgb: ${r8} ${g8} ${b8};`,
        `--color-hsl: ${hue(h, 1)} ${fix(s * 100, 1)}% ${fix(l * 100, 1)}%;`,
        `--color-oklch: ${oklch};`,
      ].join('\n'),
    };
  }

  function relLum(r, g, b) {
    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  }

  // 带透明度的颜色先按 alpha 合成到底色上再计算
  function contrast(c, bg) {
    const mix = (x, y) => c.a * x + (1 - c.a) * y;
    const l1 = relLum(mix(c.r, bg), mix(c.g, bg), mix(c.b, bg));
    const l2 = relLum(bg, bg, bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // ---------- 界面 ----------
  function renderTags(el, ratio) {
    el.textContent = '';
    const checks = [['AA', 4.5], ['AAA', 7], ['大字 AA', 3], ['大字 AAA', 4.5]];
    for (const [name, min] of checks) {
      const ok = ratio >= min;
      const t = document.createElement('span');
      t.className = 'tag ' + (ok ? 'good' : 'bad');
      t.textContent = `${name} ${ok ? '通过' : '不通过'}`;
      el.appendChild(t);
    }
  }

  function clearOut() {
    ['#oHex', '#oRgb', '#oHsl', '#oOklch', '#oVars', '#cWhite', '#cBlack', '#tWhite', '#tBlack', '#prevMeta'].forEach((s) => { $(s).textContent = ''; });
    $('#swatch').style.background = 'transparent';
    $('#sWhite').style.color = '';
    $('#sBlack').style.color = '';
  }

  function run(fromPicker) {
    status(st, '');
    const raw = input.value;
    if (raw.length > MAX_LEN) { clearOut(); status(st, '输入过长，不像是颜色值', 'err'); return; }
    let c;
    try {
      c = parseColor(raw);
    } catch (e) {
      clearOut();
      status(st, '无法解析：' + e.message, 'err');
      return;
    }
    if (!c) { clearOut(); status(st, '输入颜色值，或用右侧取色器选择'); return; }

    const f = formats(c);
    $('#oHex').textContent = f.hex;
    $('#oRgb').textContent = f.rgb;
    $('#oHsl').textContent = f.hsl;
    $('#oOklch').textContent = f.oklch;
    $('#oVars').textContent = f.vars;
    $('#swatch').style.background = f.rgb;
    $('#sWhite').style.color = f.rgb;
    $('#sBlack').style.color = f.rgb;
    $('#prevMeta').textContent = c.a < 1 ? `透明度 ${Math.round(c.a * 100)}%` : '';
    if (!fromPicker) picker.value = f.hex6;

    const cw = contrast(c, 1);
    const cb = contrast(c, 0);
    $('#cWhite').textContent = cw.toFixed(2) + ' : 1';
    $('#cBlack').textContent = cb.toFixed(2) + ' : 1';
    renderTags($('#tWhite'), cw);
    renderTags($('#tBlack'), cb);

    if (c.clipped) status(st, '超出 sRGB 色域，已按通道裁剪，输出为裁剪后的颜色', 'err');
  }

  // ---------- 事件 ----------
  input.addEventListener('input', debounce(() => run(false), 120));
  picker.addEventListener('input', () => {
    input.value = picker.value;
    run(true);
  });

  run(false);
})();
