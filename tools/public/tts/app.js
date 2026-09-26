(() => {
  'use strict';
  const { $, status, debounce } = window.T;

  // @lib
  const END = '。！？!?；;…\n';
  const CLOSE = '"”’」』）)';
  // 按句切分；超长句（部分浏览器单句超 15 秒会被截断）再按逗号 / 空格切
  function splitSentences(text, max = 160) {
    const out = [];
    const push = (s) => {
      s = s.trim();
      while (s.length > max) {
        let cut = -1;
        for (const ch of '，,、：: ') { const k = s.lastIndexOf(ch, max - 1); if (k > cut) cut = k; }
        if (cut < max / 3) cut = max - 1;
        out.push(s.slice(0, cut + 1).trim());
        s = s.slice(cut + 1).trim();
      }
      if (s) out.push(s);
    };
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      buf += c;
      const isEnd = END.includes(c) || (c === '.' && (i + 1 >= text.length || /\s/.test(text[i + 1])));
      if (!isEnd) continue;
      while (i + 1 < text.length && (CLOSE.includes(text[i + 1]) || (END.includes(text[i + 1]) && text[i + 1] !== '\n'))) buf += text[++i];
      push(buf);
      buf = '';
    }
    push(buf);
    return out;
  }
  // @endlib

  const st = $('#status');
  const sel = $('#voice');
  const input = $('#input');
  const sentsEl = $('#sents');
  const btnPlay = $('#play'), btnPause = $('#pause'), btnStop = $('#stop');
  const synth = window.speechSynthesis;

  let voices = [];
  let sents = [];
  let spans = [];
  let idx = 0;
  let gen = 0;          // 每次开始 / 停止递增，旧回调据此失效
  let playing = false, paused = false;
  let utter = null;     // 保持引用，防止被回收导致 onend 不触发

  function renderSents() {
    sents = splitSentences(input.value);
    sentsEl.replaceChildren();
    spans = sents.map((s, i) => {
      const sp = document.createElement('span');
      sp.textContent = s;
      sp.dataset.i = String(i);
      sentsEl.append(sp, document.createTextNode(' '));
      return sp;
    });
    $('#inMeta').textContent = input.value ? `${input.value.length} 字符 · ${sents.length} 句` : '';
    $('#progMeta').textContent = '';
  }
  function mark(i) {
    spans.forEach((sp, k) => {
      sp.classList.toggle('cur', k === i);
      sp.classList.toggle('done', i >= 0 && k < i);
    });
    if (i >= 0 && spans[i]) {
      spans[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      $('#progMeta').textContent = `第 ${i + 1} / ${sents.length} 句`;
    }
  }
  function setUi() {
    btnPlay.textContent = playing ? '从头播放' : '播放';
    btnPause.disabled = !playing;
    btnStop.disabled = !playing;
    btnPause.textContent = paused ? '继续' : '暂停';
  }

  function selectedVoice() { return voices[Number(sel.value)] || null; }

  function speakNext(g) {
    if (g !== gen) return;
    if (idx >= sents.length) {
      playing = false; paused = false; setUi(); mark(-1);
      spans.forEach((sp) => sp.classList.remove('done'));
      $('#progMeta').textContent = sents.length ? '朗读完成' : '';
      return;
    }
    const u = new SpeechSynthesisUtterance(sents[idx]);
    const v = selectedVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number($('#rate').value);
    u.pitch = Number($('#pitch').value);
    u.volume = Number($('#volume').value);
    u.onend = () => { if (g !== gen) return; idx++; speakNext(g); };
    u.onerror = (e) => {
      if (g !== gen || e.error === 'interrupted' || e.error === 'canceled') return;
      status(st, `朗读出错：${e.error || '未知错误'}，已跳过该句`, 'err');
      idx++;
      speakNext(g);
    };
    utter = u;
    mark(idx);
    synth.speak(u);
  }

  function playFrom(i) {
    if (!sents.length) { status(st, '请先输入要朗读的文字', 'err'); return; }
    synth.cancel();
    const g = ++gen;
    idx = i;
    playing = true;
    paused = false;
    status(st, '');
    setUi();
    setTimeout(() => speakNext(g), 60); // cancel 后立即 speak 在部分 Chrome 版本会被吞掉
  }
  function stop() {
    gen++;
    synth.cancel();
    utter = null;
    playing = false;
    paused = false;
    setUi();
    mark(-1);
    spans.forEach((sp) => sp.classList.remove('done'));
    $('#progMeta').textContent = '';
  }

  function loadVoices() {
    const list = synth.getVoices();
    if (!list.length) return false;
    const prev = selectedVoice();
    voices = list.slice();
    const groups = new Map();
    voices.forEach((v, i) => {
      const k = v.lang || '未知';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    const rank = (l) => (/^zh/i.test(l) ? 0 : /^en/i.test(l) ? 1 : 2);
    const langs = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    sel.replaceChildren();
    for (const l of langs) {
      const og = document.createElement('optgroup');
      og.label = l;
      for (const i of groups.get(l)) {
        const v = voices[i];
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = `${v.name}${v.localService ? '' : '（在线）'}${v.default ? ' · 默认' : ''}`;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    let pick = prev ? voices.findIndex((v) => v.voiceURI === prev.voiceURI) : -1;
    if (pick < 0) pick = voices.findIndex((v) => /^zh[-_]CN/i.test(v.lang));
    if (pick < 0) pick = voices.findIndex((v) => /^zh/i.test(v.lang));
    if (pick < 0) pick = voices.findIndex((v) => v.default);
    sel.value = String(Math.max(0, pick));
    if (!voices.some((v) => /^zh/i.test(v.lang))) status(st, '当前系统没有中文语音，朗读中文可能不正确，可在系统设置中添加语音');
    return true;
  }

  if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
    sel.replaceChildren(new Option('不可用'));
    [sel, btnPlay, btnPause, btnStop].forEach((b) => { b.disabled = true; });
    status(st, '当前浏览器不支持语音合成（speechSynthesis），请换用最新版 Chrome / Edge / Safari', 'err');
    renderSents();
    return;
  }

  if (!loadVoices()) {
    if (synth.addEventListener) synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
    // 部分浏览器不触发 voiceschanged，补充轮询
    let tries = 0;
    const poll = setInterval(() => {
      if (loadVoices() || ++tries >= 20) {
        clearInterval(poll);
        if (!voices.length) { sel.replaceChildren(new Option('系统默认语音')); status(st, '未获取到语音列表，将使用系统默认语音'); }
      }
    }, 250);
  } else if (synth.addEventListener) {
    synth.addEventListener('voiceschanged', loadVoices);
  }

  btnPlay.addEventListener('click', () => playFrom(0));
  btnPause.addEventListener('click', () => {
    if (!playing) return;
    if (paused) { synth.resume(); paused = false; } else { synth.pause(); paused = true; }
    setUi();
  });
  btnStop.addEventListener('click', stop);
  sentsEl.addEventListener('click', (e) => {
    const sp = e.target.closest('span[data-i]');
    if (sp) playFrom(Number(sp.dataset.i));
  });
  for (const [id, f] of [['rate', (v) => Number(v).toFixed(1)], ['pitch', (v) => Number(v).toFixed(1)], ['volume', (v) => `${Math.round(v * 100)}%`]]) {
    const el = $('#' + id);
    el.addEventListener('input', () => { $('#' + id + 'V').textContent = f(el.value); });
  }
  const reRender = debounce(renderSents, 200);
  input.addEventListener('input', () => { if (playing) stop(); reRender(); });
  window.addEventListener('pagehide', () => synth.cancel());

  renderSents();
  setUi();
})();
