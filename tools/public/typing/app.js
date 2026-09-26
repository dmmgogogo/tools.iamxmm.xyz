(() => {
  'use strict';
  const { $, status } = window.T;

  // 自撰短文，无版权问题
  const TEXTS = {
    zh: [
      '清晨的菜市场总是最先醒来。卖豆腐的阿姨把木板一块块摆开，旁边的鱼摊溅起细小的水花，讨价还价的声音此起彼伏。买菜的人提着袋子慢慢走，挑一把青菜，称两斤番茄，顺手和熟悉的摊主聊几句天气。城市的一天，就从这些琐碎而热闹的声响里开始了。',
      '学习一门新技能，最难的往往不是开头，而是坚持到能看见进步的那一刻。前几周，你会觉得自己毫无长进，甚至怀疑方向是否正确。可只要每天留出一点时间，认真练习、及时复盘，某一天回头看，就会发现自己已经走出了很远。',
      '雨后的山路有些湿滑，空气里弥漫着泥土和树叶的味道。我们沿着溪流往上走，偶尔能听见鸟在林间鸣叫。走到半山腰的亭子时，云雾正好散开，远处的村庄和梯田一下子清晰起来，大家都停下脚步，安静地看了很久。',
      '写代码和写文章有很多相似之处。好的代码结构清晰、命名准确，让读的人一眼就能明白意图；好的文章同样条理分明、用词精准。两者都需要反复修改，删去多余的部分，只留下真正必要的内容。简洁从来不是偷懒，而是认真思考之后的结果。',
      '奶奶家的小院里种着一棵石榴树。每到夏天，树上开满火红的花，引来许多蜜蜂嗡嗡地飞。秋天果实成熟，奶奶会挑最大的几个留给我们。剥开厚厚的外皮，一粒粒晶莹的籽像红宝石一样挤在一起，咬一口，酸甜的汁水立刻在嘴里散开。',
      '一个好习惯的养成，通常需要几周甚至几个月的时间。与其一开始就给自己定下很高的目标，不如从最容易做到的小事做起，比如每天读十页书、步行二十分钟。当这些小事变成日常的一部分，更大的改变也就水到渠成了。',
      '夜深了，街边的便利店依然亮着灯。店员整理着货架，把明天要用的面包和牛奶一一摆好。偶尔有下班晚归的人推门进来，买一杯热饮，在窗边站一会儿，再走进夜色里。这盏不灭的灯，给许多晚归的人带来一点温暖。',
      '旅行的意义，并不只在于看过多少风景。更重要的是，在陌生的地方，我们会用新的眼光观察世界，也重新认识自己。一顿路边小店的晚饭，一段和陌生人的闲聊，常常比著名的景点更让人难忘。',
      '做计划时，要给意外留出空间。再周密的安排，也可能被突如其来的事情打乱。与其因为计划落空而焦虑，不如提前准备几种备选方案，并接受事情不会总是按预期发展。灵活应对，本身就是一种重要的能力。',
    ],
    en: [
      'The morning train was quieter than usual. A few passengers read the news on their phones, while others stared out the window at the gray sky. When the doors opened at the last station, everyone stepped out into the cold air and hurried toward the stairs.',
      'Learning to type quickly is less about speed and more about rhythm. Keep your fingers on the home row, look at the screen instead of the keyboard, and let accuracy come first. Speed will follow naturally once the movements become automatic.',
      'Our small garden changes with every season. In spring we plant tomatoes and beans, in summer we water them every evening, and in autumn we collect more vegetables than we can eat. Winter is for planning, drawing maps, and ordering new seeds.',
      'A good tool does one thing and does it well. It starts fast, explains itself clearly, and never gets in the way. When you finish your task, you should barely remember using it, because it simply worked the way you expected.',
      'The old library had wooden floors that creaked with every step. Sunlight fell through tall windows onto long tables, where students worked in silence. On the top shelf, forgotten books waited patiently for someone curious enough to reach them.',
      'Before you start a big project, write down what success looks like. Break the work into small steps, finish the first one today, and review your progress each week. Clear goals turn a vague idea into a series of simple actions.',
      'The lighthouse keeper climbed the spiral stairs every night at dusk. He cleaned the glass, checked the lamp, and wrote a short note in his log. Ships far out at sea never saw him, but they trusted the steady light he kept alive.',
      'Cooking dinner for friends is a simple way to slow down. You chop the onions, stir the soup, and taste the sauce while everyone talks in the kitchen. By the time the food is ready, the evening already feels warm and full.',
      'Rain started just as the match began, but nobody left the field. The players slipped on the wet grass and laughed at their own mistakes. By the final whistle, the score no longer mattered, and the whole team walked home soaked and happy.',
    ],
  };

  // @lib
  // 逐字比对：返回正确数、已输入数；速度按正确字符计（英文 5 字符 = 1 词）
  function score(target, typed, ms, lang) {
    const n = Math.min(typed.length, target.length);
    let correct = 0;
    for (let i = 0; i < n; i++) if (typed[i] === target[i]) correct++;
    const min = ms / 60000;
    const speed = min > 0 ? (lang === 'en' ? correct / 5 / min : correct / min) : 0;
    return { correct, typed: n, errors: n - correct, speed, acc: n ? correct / n : 0 };
  }
  // @endlib

  const textEl = $('#text');
  const input = $('#input');
  const st = $('#status');
  let lang = 'zh';
  let dur = 60;
  let idx = -1;
  let target = '';
  let spans = [];
  let composing = false;
  let started = false, ended = false;
  let t0 = 0, tick = 0, endTimer = 0;
  const now = () => performance.now();

  function pickText(forceNew) {
    const list = TEXTS[lang];
    if (forceNew || idx < 0 || idx >= list.length) {
      let j = Math.floor(Math.random() * list.length);
      if (list.length > 1 && j === idx) j = (j + 1) % list.length;
      idx = j;
    }
    target = list[idx];
  }

  function reset(forceNew) {
    clearInterval(tick);
    clearTimeout(endTimer);
    started = false;
    ended = false;
    composing = false;
    pickText(forceNew);
    textEl.classList.toggle('en', lang === 'en');
    textEl.replaceChildren();
    spans = Array.from(target, (ch) => {
      const s = document.createElement('span');
      s.textContent = ch;
      textEl.appendChild(s);
      return s;
    });
    input.value = '';
    input.readOnly = false;
    input.maxLength = target.length + 8;
    $('#result').hidden = true;
    $('#sSpeedLbl').textContent = lang === 'en' ? 'WPM' : '字/分钟';
    status(st, '');
    paint();
    input.focus();
  }

  function elapsed() { return started ? Math.min(now() - t0, dur * 1000) : 0; }

  function paint() {
    const typed = input.value;
    const cur = Math.min(typed.length, target.length);
    for (let i = 0; i < spans.length; i++) {
      let c = '';
      if (i < typed.length) c = typed[i] === target[i] ? 'ok' : 'bad';
      if (i === cur && !ended) c = c ? c + ' cur' : 'cur';
      if (spans[i].className !== c) spans[i].className = c;
    }
    const ms = elapsed();
    const s = score(target, typed, ms, lang);
    $('#sLeft').textContent = `${Math.max(0, Math.ceil(dur - ms / 1000))}s`;
    $('#sSpeed').textContent = ms >= 2000 ? String(Math.round(s.speed)) : '0';
    $('#sAcc').textContent = s.typed ? `${(s.acc * 100).toFixed(1)}%` : '—';
    $('#sProg').textContent = `${s.typed}/${target.length}`;
  }

  function end(reason) {
    if (ended || !started) return;
    const ms = elapsed();
    ended = true;
    clearInterval(tick);
    clearTimeout(endTimer);
    input.readOnly = true;
    paint();
    const s = score(target, input.value, ms, lang);
    $('#rSpeedLbl').textContent = lang === 'en' ? '速度 WPM' : '速度 字/分钟';
    $('#rSpeed').textContent = String(Math.round(s.speed));
    $('#rAcc').textContent = `${(s.acc * 100).toFixed(1)}%`;
    $('#rMeta').textContent = reason;
    const rows = [
      ['用时', `${(ms / 1000).toFixed(1)} 秒`],
      ['已输入', `${s.typed} 字符`],
      ['正确', `${s.correct} 字符`],
      ['错误', `${s.errors} 字符`],
    ];
    const tb = $('#rOut');
    tb.replaceChildren();
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = k;
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(th, td);
      tb.appendChild(tr);
    }
    $('#result').hidden = false;
    status(st, '点「重来」再测一次，或「换一段」换文本');
  }

  function onType() {
    if (ended || composing) return;
    if (!started && input.value.length) {
      started = true;
      t0 = now();
      tick = setInterval(() => { if (elapsed() >= dur * 1000) end('时间到'); else paint(); }, 200);
      endTimer = setTimeout(() => end('时间到'), dur * 1000);
    }
    paint();
    if (input.value.length >= target.length) end('已打完全文');
  }

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; onType(); });
  input.addEventListener('input', (e) => { if (e.isComposing) return; onType(); });
  input.addEventListener('paste', (e) => { e.preventDefault(); status(st, '打字测试不能粘贴', 'err'); });
  input.addEventListener('drop', (e) => e.preventDefault());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) e.preventDefault(); });

  function setLang(l) {
    lang = l;
    idx = -1;
    $('#lZh').classList.toggle('on', l === 'zh');
    $('#lEn').classList.toggle('on', l === 'en');
    reset(true);
  }
  $('#lZh').addEventListener('click', () => setLang('zh'));
  $('#lEn').addEventListener('click', () => setLang('en'));
  $('#durs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dur]');
    if (!b) return;
    dur = Number(b.dataset.dur);
    $('#durs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    reset(false);
  });
  $('#restart').addEventListener('click', () => reset(false));
  $('#next').addEventListener('click', () => reset(true));

  reset(true);
})();
