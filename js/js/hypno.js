// 催眠播放器：螺旋＋图（Ken Burns）＋暗示语配音（带回声，和诱导同一种念法，一句接一句）＋双耳低频嗡声＋潜意识闪字。
// 时长一律跟任务计时器走：诱导 → 暗示语轮播 → 结尾，结尾按配音实际长度倒推，最后一个字落在“时间到”。
// 时间按真实钟点算（o.rem() 每步重读），切出去再回来会接到该在的段落；暂停＝任务暂停。

const VOICE = { intro: [1, 2, 3, 4, 5, 6, 7, 8, 9], introShort: [1, 3, 5, 8, 9], introMini: [1, 8], deep: [10, 11, 12, 13, 14, 15],
  outro: [16, 17, 18, 19], outroPun: [17, 20, 21], outroMini: [18, 19], outroPunMini: [20, 21], back: [10, 5] };
const GAP = 0.9;          // 句与句之间（秒）
const DEEP_EVERY = 8;     // 每几句暗示语插一句加深（测试页可用 o.deepEvery 改小）
const FULL_INTRO_MIN = 8; // 任务不到 8 分钟用短诱导
const MINI_MIN = 3;       // 不到 3 分钟：诱导、结尾都只留两句
const LOAD_MAX = 4000;    // 配音最多等这么久，等不到就当没有、照字数估时
const WORDS = ['服从', '乖', '乖女孩', '更深', '空', '听话', 'OBEY', 'GOOD GIRL', 'SINK', 'EMPTY'];
// 节拍段：每句加深之后插一段 120 拍快切，每拍换一张图、闪一个词，配合成的鼓点和铺底
const BPM = 120, SPB = 60 / BPM;
const BEAT_SEC = 32;      // 一段多长（秒）
const BEAT_VOL = 0.32;    // 鼓点＋铺底的总音量（配音是 1）
const BEAT_IMGS = 32;     // 一段轮几张（不够 64 拍就循环）
const BEAT_WORDS = {
  zh: ['臣服', '流口水', '锁住', '乖女孩', '更深', '空白', '听话', '跪下', '是的', '想要', '放弃', '沉下去', '不准射', '软掉', '张嘴', '吞下去', '求我', '湿透'],
  en: ['SURRENDER', 'DROOL', 'LOCKED', 'GOOD GIRL', 'DEEPER', 'EMPTY', 'OBEY', 'KNEEL', 'YES', 'NEEDY', 'GIVE UP', 'SINK', 'NO CUM', 'SOFT', 'OPEN UP', 'SWALLOW', 'BEG', 'WET']
};
// 每八拍换一个和弦：Am → F → G → E
const CHORDS = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

function spiralSvg() {
  const pts = a => { const p = []; for (let t = 0; t < 14 * Math.PI; t += 0.08) { const r = 2.2 * t; p.push(`${(50 + r * Math.cos(t + a)).toFixed(1)},${(50 + r * Math.sin(t + a)).toFixed(1)}`); } return p.join(' '); };
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke-width="3.2" stroke-linecap="round">
    <polyline points="${pts(0)}" stroke="#ff4fb8"/><polyline points="${pts(Math.PI)}" stroke="#9b5cff"/></g></svg>`;
}

// o: { lines, imgs, allImgs, voice, tags, video, punish, open, sec, lang, setLang,
//      rem(), elapsed(), paused(), pause(), resume(), audio(key), image(name), onDone(), onClose() }
export function openHypno(root, o) {
  root.innerHTML = '';
  const box = el('div', 'hyp' + (o.video ? '' : ' audio'));
  // 每层：底下一张放大模糊的铺满，上面一张完整显示（不裁切）
  const pics = [0, 1].map(() => { const d = el('div', 'hyp-pic'); d.append(el('img', 'bg'), el('img', 'fg')); return d; });
  const spiral = el('div', 'hyp-spiral'); spiral.innerHTML = spiralSvg();
  const veil = el('div', 'hyp-veil');
  const flash = el('div', 'hyp-flash');
  const cap = el('div', 'hyp-cap'); const capBig = el('div', 'hyp-big'); const capSub = el('div', 'hyp-sub');
  cap.append(capBig, capSub);
  const bar = el('div', 'hyp-bar');
  const clock = el('span', 'hyp-clock');
  const bLang = el('button', 'btn ghost', o.lang === 'en' ? 'EN' : '中');
  const bPause = el('button', 'btn ghost');
  const bClose = el('button', 'btn ghost', '✕');
  bar.append(clock, el('span', 'grow'), bLang, bPause, bClose);
  const endBox = el('div', 'hyp-end');
  box.append(...pics, spiral, veil, flash, cap, endBox, bar);
  root.appendChild(box);
  pics.forEach(p => p.querySelectorAll('img').forEach(i => { i.alt = ''; i.onerror = () => p.classList.remove('on'); }));

  // —— 时钟：有任务计时器就用它；计时器关掉时自己数 o.sec ——
  let localStart = Date.now(), localPaused = 0, localPauseAt = 0;
  const ownClock = o.rem() == null;
  const remain = () => {
    if (!ownClock) return o.rem();
    const p = localPaused + (localPauseAt ? Date.now() - localPauseAt : 0);
    return o.sec - (Date.now() - localStart - p) / 1000;
  };
  const total = () => ownClock ? o.sec : o.rem() + o.elapsed();
  const started = () => ownClock ? total() - remain() : o.elapsed();

  // —— 声音 ——
  let ac = null, master = null, drone = null;
  const bufs = new Map();
  let sources = [], waits = [], gen = 0, dead = false, beatStop = null;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.connect(ac.destination);
  } catch { ac = null; }
  async function load(key) {
    if (!ac) return null;
    if (bufs.has(key)) return bufs.get(key);
    const p = (async () => { try { const b = await o.audio(key); return b ? await ac.decodeAudioData(b) : null; } catch { return null; } })();
    bufs.set(key, p);
    return p;
  }
  function startDrone() {
    if (!ac || drone) return;
    const g = ac.createGain(); g.gain.value = 0; g.connect(master);
    const m = ac.createChannelMerger(2); m.connect(g);
    const mk = (f, ch, v) => { const s = ac.createOscillator(), gg = ac.createGain(); s.frequency.value = f; gg.gain.value = v; s.connect(gg).connect(m, 0, ch); s.start(); return s; };
    // 左 110、右 116：差 6 Hz（θ 波）；再垫一层 55 Hz
    const os = [mk(110, 0, .5), mk(116, 1, .5), mk(55, 0, .35), mk(55, 1, .35)];
    g.gain.linearRampToValueAtTime(0.07, ac.currentTime + 4);
    drone = { g, os };
  }
  function fadeDrone(sec = 4) {
    if (!drone) return;
    const t = ac.currentTime;
    drone.g.gain.cancelScheduledValues(t); drone.g.gain.setValueAtTime(drone.g.gain.value, t); drone.g.gain.linearRampToValueAtTime(0, t + sec);
    const d = drone; drone = null;
    setTimeout(() => d.os.forEach(s => { try { s.stop(); } catch {} }), sec * 1000 + 100);
  }
  // 播一段；echo＝叠两层错开的回声
  function play(buf, { echo = false } = {}) {
    const my = gen;
    if (!ac || !buf) return Promise.resolve(false);
    return new Promise(res => {
      const t = ac.currentTime + 0.05;
      const one = (delay, gain, pan, lp) => {
        const s = ac.createBufferSource(); s.buffer = buf;
        let n = s;
        if (lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n.connect(f); n = f; }
        const g = ac.createGain(); g.gain.value = gain; n.connect(g); n = g;
        if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p; }
        n.connect(master);
        s.start(t + delay);
        sources.push(s);
        return s;
      };
      const side = Math.random() < .5 ? -1 : 1;
      const main = one(0, 1, 0, 0);
      if (echo) { one(.35, .28, -.7 * side, 1600); one(.7, .14, .7 * side, 1200); }
      main.onended = () => { sources = sources.filter(s => s !== main); res(my === gen); };
      main._res = res;
    });
  }
  const wait = ms => new Promise(res => { const my = gen; const w = { res }; w.t = setTimeout(() => { waits = waits.filter(x => x !== w); res(my === gen); }, Math.max(0, ms)); waits.push(w); });
  function abort() {
    gen++;
    for (const w of waits) { clearTimeout(w.t); w.res(false); }
    for (const s of sources) { try { s.stop(); } catch {} s._res?.(false); }
    waits = []; sources = [];
    beatStop?.();
  }

  // —— 节拍音乐：鼓点（每拍）＋反拍沙沙声＋三音和弦铺底（每拍压一下、滤波慢慢打开），整段一次排好 ——
  let noise = null;
  function music(t0, n) {
    if (!ac) return () => {};
    const end = t0 + n * SPB;
    const bus = ac.createGain(); bus.connect(master);
    bus.gain.setValueAtTime(0, t0); bus.gain.linearRampToValueAtTime(BEAT_VOL, t0 + 2);
    bus.gain.setValueAtTime(BEAT_VOL, end - 2); bus.gain.linearRampToValueAtTime(0, end);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(350, t0); lp.frequency.linearRampToValueAtTime(1600, end);
    const pump = ac.createGain(); lp.connect(pump).connect(bus);
    const pad = [0, 1, 2].flatMap(j => [-7, 7].map(dt => {
      const s = ac.createOscillator(), g = ac.createGain();
      s.type = 'sawtooth'; s.detune.value = dt; g.gain.value = .07;
      s.connect(g).connect(lp); s.start(t0); s.stop(end + .1);
      return { s, j };
    }));
    if (!noise) { noise = ac.createBuffer(1, ac.sampleRate * .1, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    for (let b = 0; b < n; b++) {
      const t = t0 + b * SPB;
      if (b % 8 === 0) { const ch = CHORDS[(b / 8) % CHORDS.length]; pad.forEach(({ s, j }) => s.frequency.setValueAtTime(ch[j], t)); }
      pump.gain.setValueAtTime(.2, t); pump.gain.linearRampToValueAtTime(1, t + .4);
      const k = ac.createOscillator(), kg = ac.createGain();
      k.frequency.setValueAtTime(150, t); k.frequency.exponentialRampToValueAtTime(42, t + .12);
      kg.gain.setValueAtTime(1, t); kg.gain.exponentialRampToValueAtTime(.001, t + .35);
      k.connect(kg).connect(bus); k.start(t); k.stop(t + .4);
      const h = ac.createBufferSource(), hf = ac.createBiquadFilter(), hg = ac.createGain();
      h.buffer = noise; hf.type = 'highpass'; hf.frequency.value = 7000;
      hg.gain.setValueAtTime(.18, t + SPB / 2); hg.gain.exponentialRampToValueAtTime(.001, t + SPB / 2 + .06);
      h.connect(hf).connect(hg).connect(bus); h.start(t + SPB / 2);
    }
    return () => {
      const t = ac.currentTime;
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + .08);
      setTimeout(() => { pad.forEach(({ s }) => { try { s.stop(); } catch {} }); bus.disconnect(); }, 150);
    };
  }

  // —— 文字估时（没有配音时照这个时间显示字幕） ——
  const est = t => o.lang === 'en' ? t.split(/\s+/).length * .4 + 1 : t.replace(/[\s，。…、！？：；,.!?]/g, '').length * .28 + 1;
  const vline = n => o.voice.find(v => v.n === n);
  const vkey = n => `hypv_${o.lang}_${n}`;
  const loadT = key => Promise.race([load(key), new Promise(r => setTimeout(() => r(null), LOAD_MAX))]);
  const lineLen = async n => { const v = vline(n); if (!v) return 0; const b = await loadT(vkey(n)); return (b ? b.duration : est(v[o.lang] || v.zh)) + GAP; };
  const other = () => o.lang === 'en' ? 'zh' : 'en';

  function caption(big, sub = '', cls = '') {
    capBig.textContent = big; capSub.textContent = sub;
    cap.className = 'hyp-cap on ' + cls;
  }
  async function say(n) {
    const v = vline(n);
    if (!v) return true;
    caption(v[o.lang] || v.zh, '', 'voice');
    const my = gen;
    const b = await loadT(vkey(n));
    if (my !== gen) return false;
    const ok = b ? await play(b, { echo: true }) : await wait(est(v[o.lang] || v.zh) * 1000);
    return ok && wait(GAP * 1000);
  }

  // —— 画面 ——
  let front = 0;
  async function showPic(aff) {
    if (!o.video) return;
    const list = (aff && o.imgs[aff.id]?.length ? o.imgs[aff.id] : o.allImgs);
    if (!list.length) return;
    const url = await o.image(list[Math.floor(Math.random() * list.length)]);
    if (!url || dead) return;
    const nx = pics[1 - front], cur = pics[front];
    nx.querySelectorAll('img').forEach(i => { i.src = url; });
    nx.classList.remove('kb'); void nx.offsetWidth; nx.classList.add('kb', 'on');
    cur.classList.remove('on');
    front = 1 - front;
  }
  let flashT = null;
  function scheduleFlash() {
    flashT = setTimeout(() => {
      if (dead) return;
      if (!paused && !box.classList.contains('beat')) {
        const a = o.lines[Math.floor(Math.random() * o.lines.length)];
        flash.textContent = Math.random() < .5 ? WORDS[Math.floor(Math.random() * WORDS.length)] : (a?.[o.lang] || '');
        flash.classList.add('on');
        setTimeout(() => flash.classList.remove('on'), 90);
      }
      scheduleFlash();
    }, 4000 + Math.random() * 6000);
  }

  // —— 节拍段 ——
  const now = () => ac ? ac.currentTime : performance.now() / 1000;
  // 先把要轮的图解好码，切的时候才不会闪白（在加深那句播的时候就开始载）；4 路并发，解码成功的才放进 got，边载边用
  function beatPics() {
    const got = [];
    if (!o.video || !o.allImgs.length) return { got, done: Promise.resolve() };
    const keys = shuffle(o.allImgs.slice()).slice(0, BEAT_IMGS);
    let next = 0;
    const worker = async () => {
      while (next < keys.length && !dead) {
        try { const u = await o.image(keys[next++]); if (!u) continue; const i = new Image(); i.alt = ''; i.src = u; await i.decode(); got.push(i); } catch {}
      }
    };
    return { got, done: Promise.all([0, 1, 2, 3].map(worker)) };
  }
  async function beatRun(pre) {
    const my = gen;
    caption('', '', 'idle');
    await Promise.race([pre.done, wait(3000)]);
    if (my !== gen || dead) return false;
    const layer = el('div', 'hyp-beat'), ims = pre.got;
    box.insertBefore(layer, spiral);
    box.classList.add('beat');
    const words = shuffle((BEAT_WORDS[o.lang] || BEAT_WORDS.zh).slice());
    const n = Math.round(BEAT_SEC / SPB), t0 = now() + .15;
    const musStop = music(t0, n);
    let i = 0, k = 0, cur = null, timers = [];
    const flip = () => {
      if (!ims.length) return;
      cur?.classList.remove('on'); cur = ims[k++ % ims.length];
      if (cur.parentNode !== layer) layer.appendChild(cur);
      cur.classList.add('on');
    };
    const word = b => { flash.textContent = words[b % words.length]; flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 260); };
    // 画面跟音频钟对齐：每 50 毫秒把快到的拍子排进 setTimeout
    const sched = setInterval(() => {
      while (i < n && t0 + i * SPB < now() + .2) {
        const b = i++, at = (t0 + b * SPB - now()) * 1000;
        timers.push(setTimeout(() => { flip(); word(b); }, at));
        if (b % 8 === 7) timers.push(setTimeout(flip, at + SPB * 500));  // 每八拍多切一下（半拍）
      }
    }, 50);
    beatStop = () => {
      beatStop = null;
      clearInterval(sched); timers.forEach(clearTimeout); musStop();
      layer.remove(); box.classList.remove('beat'); flash.classList.remove('on', 'beat');
    };
    flash.classList.add('beat');
    const ok = await wait((t0 + n * SPB - now()) * 1000);
    beatStop?.();
    return ok;
  }

  // —— 句子：先挑和任务主题相同的，不够 20 句就全部一起轮 ——
  const tagSet = new Set((o.tags || []).filter(t => t !== 'ANY'));
  let pool = o.lines.filter(a => a.tags?.some(t => tagSet.has(t)));
  if (pool.length < 20) pool = o.lines.slice();
  let queue = [], lastId = null;
  const nextAff = () => {
    if (!queue.length) { queue = shuffle(pool.slice()); if (queue[0]?.id === lastId && queue.length > 1) queue.push(queue.shift()); }
    const a = queue.shift(); lastId = a.id; return a;
  };

  // —— 流程 ——
  let phase = 'intro', idx = 0, count = 0, deepI = 0, beatI = 0, outroLen = 0, paused = false;
  const mini = !o.open && total() < MINI_MIN * 60;
  const introList = () => mini ? VOICE.introMini : total() >= FULL_INTRO_MIN * 60 ? VOICE.intro : VOICE.introShort;
  let outroList = o.punish ? (mini ? VOICE.outroPunMini : VOICE.outroPun) : (mini ? VOICE.outroMini : VOICE.outro);
  let outroLens = [], beatPre = null;
  if (started() > 90) { phase = 'back'; }  // 中途才打开：短短拉回去就进主体

  async function sentence(a) {
    const text = a[o.lang] || a.zh;
    showPic(a);
    caption(text, a[other()] || '');
    const my = gen;
    const b = await loadT(`aff_${o.lang}_${a.id}`);
    if (my !== gen) return false;
    const nextA = queue[0]; if (nextA) load(`aff_${o.lang}_${nextA.id}`);
    if (!(b ? await play(b, { echo: true }) : await wait(est(text) * 1000))) return false;
    return wait(GAP * 1000);
  }
  async function sentenceLen(a) {
    const text = a[o.lang] || a.zh;
    const b = await loadT(`aff_${o.lang}_${a.id}`);
    return (b ? b.duration : est(text)) + GAP;
  }

  const every = o.deepEvery || DEEP_EVERY;
  async function run() {
    const my = gen;
    const alive = () => my === gen && !dead;
    if (!o.open && phase !== 'outro') {
      outroLens = await Promise.all(outroList.map(n => lineLen(n)));
      outroLen = outroLens.reduce((s, x) => s + x, 0);
    }
    if (!alive()) return;
    startDrone();
    if (remain() <= 0 && !o.open) return end();
    if (phase === 'back' || phase === 'intro') {
      const list = phase === 'back' ? VOICE.back : introList();
      while (idx < list.length) {
        const need = await lineLen(list[idx]);
        if (!alive()) return;
        if (!o.open && remain() - outroLen < need + 5) break;
        if (!(await say(list[idx]))) return;
        idx++;
      }
      phase = 'body'; idx = 0;
    }
    if (phase === 'body') {
      for (;;) {
        if (count && count % every === 0 && deepI < count / every) {
          const n = VOICE.deep[deepI % VOICE.deep.length];
          const need = await lineLen(n);
          if (!alive()) return;
          if (!o.open && remain() - outroLen < need) break;
          if (deepI === beatI) beatPre = beatPics();
          if (!(await say(n))) return;
          deepI++;
        }
        // 加深之后接一段节拍；剩的时间不够一整段就跳过
        if (beatI < deepI) {
          if (o.open || remain() - outroLen >= BEAT_SEC + 2) {
            if (!(await beatRun(beatPre || beatPics()))) return;
          }
          beatI = deepI; beatPre = null;
        }
        const a = queue[0] || (queue = shuffle(pool.slice()), queue[0]);
        const need = await sentenceLen(a);
        if (!alive()) return;
        if (!o.open && remain() - outroLen < need) break;
        nextAff();
        if (!(await sentence(a))) return;
        count++;
      }
      // 剩下几秒：螺旋和嗡声垫着，到点开始结尾
      caption('', '', 'idle');
      showPic(null);
      if (!(await wait((remain() - outroLen) * 1000))) return;
      // 时间不够整段结尾：从前面删句，至少留最后一句
      while (outroList.length > 1 && outroLen > remain() + 2) { outroLen -= outroLens.shift(); outroList = outroList.slice(1); }
      phase = 'outro'; idx = 0;
    }
    if (phase === 'outro') {
      while (idx < outroList.length) { if (!(await say(outroList[idx]))) return; idx++; }
      phase = 'end';
    }
    if (alive()) end();
  }

  function end() {
    phase = 'end';
    fadeDrone(o.punish ? 8 : 4);
    caption('', '', 'idle');
    endBox.innerHTML = '';
    endBox.append(el('div', 'hyp-big', o.punish ? '时间到。你还在下面。' : '时间到'));
    const done = el('button', 'btn primary', '完成任务'); done.onclick = () => { stop(); o.onDone(); };
    const close = el('button', 'btn ghost', '关闭'); close.onclick = () => { stop(); o.onClose(); };
    endBox.append(done, close);
    endBox.classList.add('on');
  }

  function setPaused(p, fromTask = false) {
    paused = p;
    bPause.textContent = p ? '继续' : '暂停';
    box.classList.toggle('paused', p);
    if (p) {
      abort();
      if (!fromTask) o.pause();
      if (ownClock && !localPauseAt) localPauseAt = Date.now();
      ac?.suspend().catch(() => {});
      caption(o.lang === 'en' ? 'Paused' : '暂停中', '', 'idle');
    } else {
      if (!fromTask) o.resume();
      if (ownClock && localPauseAt) { localPaused += Date.now() - localPauseAt; localPauseAt = 0; }
      ac?.resume().catch(() => {});
      if (phase !== 'end') restart();  // 从被打断的那一句重来
    }
  }
  // 任何时候只让一条流程在跑：先作废旧的再开新的
  let begun = false;
  function restart() { if (dead || paused || phase === 'end') return; begun = true; abort(); run(); }
  bPause.onclick = e => { e.stopPropagation(); setPaused(!paused); };
  bClose.onclick = () => { stop(); o.onClose(); };
  bLang.onclick = () => {
    o.lang = o.lang === 'en' ? 'zh' : 'en'; o.setLang(o.lang); bLang.textContent = o.lang === 'en' ? 'EN' : '中';
    if (begun) restart();
  };

  let lastTP = o.paused();
  const tick = setInterval(() => {
    const r = remain();
    clock.textContent = o.open ? (r >= 0 ? `时限 ${fmt(r)}` : `超时 ${fmt(-r)}`) : (r > 0 ? fmt(r) : '0:00');
    // 在任务页那边被暂停／继续了，这边跟着
    const tp = o.paused();
    if (tp !== lastTP) { lastTP = tp; if (tp !== paused) setPaused(tp, true); }
  }, 500);
  // 切回前台：重新对时（setTimeout 在后台会被拖慢）
  const onVis = () => { if (document.visibilityState === 'visible' && begun) { ac?.resume().catch(() => {}); restart(); } };
  document.addEventListener('visibilitychange', onVis);

  function stop() {
    if (dead) return;
    dead = true;
    abort();
    clearInterval(tick); clearTimeout(flashT);
    document.removeEventListener('visibilitychange', onVis);
    fadeDrone(.3);
    setTimeout(() => ac?.close().catch(() => {}), 500);
  }

  scheduleFlash();
  // 先把开头、结尾和头几句暗示语的配音载进来
  if (ac) { introList().forEach(n => load(vkey(n))); outroList.forEach(n => load(vkey(n))); queue = shuffle(pool.slice()); queue.slice(0, 3).forEach(a => load(`aff_${o.lang}_${a.id}`)); }
  if (o.paused()) { paused = true; bPause.textContent = '继续'; box.classList.add('paused'); caption('暂停中', '按「继续」接着播', 'idle'); }
  else {
    bPause.textContent = '暂停';
    // 手机要先有一下点按才能出声：没被允许就先等一下点按
    if (ac && ac.state === 'suspended') {
      caption(o.lang === 'en' ? 'Tap to begin' : '点一下开始', '', 'idle');
      box.addEventListener('click', () => { ac.resume().catch(() => {}).then(restart); }, { once: true });
    } else restart();
  }
  return stop;
}
