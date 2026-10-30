// 小游戏：节拍器、节拍轨、服从口令、自我暗示语、计数。全部在本机跑；“嗒”声是合成的，暗示语配音从内容包来。

let ac = null;
function click(hi = false, on = true) {
  if (!on) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = hi ? 1320 : 880;
    g.gain.setValueAtTime(0.25, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.09);
  } catch {}
}
const buzz = (ms, on) => { if (on && navigator.vibrate) navigator.vibrate(ms); };

// opts: { sound, vibrate, commands:[{text,sec}], onDone(), onClose() }
export function openGame(cfg, root, opts) {
  root.innerHTML = '';
  const box = el('div', 'game');
  root.appendChild(box);
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const every = (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t; };
  const stopAll = () => { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers.length = 0; opts.affirm?.stop?.(); };
  const finish = () => { stopAll(); opts.onDone(); };
  const head = el('div', 'game-head');
  const big = el('div', 'game-big');
  const sub = el('div', 'game-sub');
  const pulse = el('div', 'pulse');
  const btns = el('div', 'game-btns');
  box.append(head, pulse, big, sub, btns);
  const beat = (hi) => { click(hi, opts.sound); buzz(30, opts.vibrate); pulse.classList.remove('on'); void pulse.offsetWidth; pulse.classList.add('on'); };
  const button = (txt, fn, cls = '') => { const b = el('button', 'btn ' + cls, txt); b.onclick = fn; btns.appendChild(b); return b; };
  const clearBtns = () => { btns.innerHTML = ''; };

  if (cfg.kind === 'metronome') {
    let i = -1;
    const next = () => {
      stopAll(); clearBtns();
      i++;
      if (i >= cfg.stages.length) { head.textContent = '全部完成'; big.textContent = '✓'; sub.textContent = ''; button('结算', finish, 'primary'); return; }
      const s = cfg.stages[i];
      head.textContent = `第 ${i + 1}／${cfg.stages.length} 段　${s.label || ''}`;
      const ms = 60000 / (s.bpm || 60);
      const goOn = () => (s.auto ? next() : (clearBtns(), button('下一段', next, 'primary')));
      if (s.kind === 'timer') {
        let left = s.sec || 30;
        big.textContent = left; sub.textContent = '休息';
        every(() => { left--; big.textContent = Math.max(0, left); if (left <= 0) { stopAll(); buzz(200, opts.vibrate); goOn(); } }, 1000);
      } else if (s.kind === 'edge') {
        big.textContent = '寸止'; sub.textContent = `跟着节拍（${s.bpm} 次／分），到边缘时按下面的键`;
        every(() => beat(false), ms);
        button('到边缘了', () => { stopAll(); next(); }, 'primary');
      } else if (s.kind === 'timed') {
        let left = s.sec || 10;
        big.textContent = left; sub.textContent = `跟着节拍（${s.bpm} 次／分）`;
        const t0 = Date.now();
        every(() => beat(false), ms);
        every(() => { left = Math.ceil((s.sec * 1000 - (Date.now() - t0)) / 1000); big.textContent = Math.max(0, left); if (left <= 0) { stopAll(); goOn(); } }, 250);
      } else {
        let n = 0;
        const total = s.reps;
        big.textContent = total ? `0／${total}` : '0';
        sub.textContent = `跟着节拍（${s.bpm} 次／分）` + (total ? '' : '，做完按下面的键');
        every(() => {
          n++; beat(total && n === total);
          big.textContent = total ? `${n}／${total}` : String(n);
          if (total && n >= total) { stopAll(); goOn(); }
        }, ms);
        if (!total) button('做完了', () => { stopAll(); next(); }, 'primary');
      }
      if (s.kind !== 'edge' && s.reps !== null) button('跳过这段', () => { stopAll(); next(); });
    };
    clearBtns();
    head.textContent = '节拍器'; big.textContent = cfg.stages.length + ' 段'; sub.textContent = '准备好就开始';
    button('开始', next, 'primary');
  }

  else if (cfg.kind === 'beattrack') {
    const times = [];
    let t = 0;
    for (const b of cfg.beats) {
      if (b.timestamp !== undefined) { t = b.timestamp; times.push({ at: t, text: b.text }); continue; }
      if (b.type === 'group') for (let k = 0; k < (b.beatsNum || 1); k++) { t += b.interval || 1000; times.push({ at: t, text: k === 0 ? (b.text || b.message) : (k === b.beatsNum - 1 ? b.lastBeatMsg : null) }); }
    }
    const lead = 1500;
    const run = () => {
      clearBtns();
      const t0 = Date.now() + 3000;
      head.textContent = '节拍轨';
      let idx = 0;
      big.textContent = '3';
      sub.textContent = `共 ${times.length} 拍，圆点亮的瞬间做一下`;
      every(() => {
        const now = Date.now() - t0;
        if (now < 0) { big.textContent = String(Math.ceil(-now / 1000)); return; }
        while (idx < times.length && times[idx].at <= now) {
          beat(idx === times.length - 1);
          if (times[idx].text) sub.textContent = times[idx].text;
          idx++;
        }
        big.textContent = `${idx}／${times.length}`;
        const nx = times[idx];
        pulse.style.setProperty('--near', nx ? Math.max(0, 1 - (nx.at - now) / lead) : 0);
        if (idx >= times.length) { stopAll(); head.textContent = '完成'; button('结算', finish, 'primary'); }
      }, 30);
      button('中止', () => { stopAll(); opts.onClose(); });
    };
    const intro = cfg.intro || [];
    let k = 0;
    const say = () => {
      clearBtns();
      if (k >= intro.length) { run(); return; }
      head.textContent = '说明'; big.textContent = ''; sub.textContent = intro[k].message;
      button('下一句', () => { k++; say(); }, 'primary');
      button('跳过说明', () => { k = intro.length; say(); });
    };
    say();
  }

  else if (cfg.kind === 'obedience') {
    const cmds = opts.commands?.length ? opts.commands : [{ text: '跪下', sec: '20s' }];
    let n = 0;
    const next = () => {
      stopAll(); clearBtns();
      if (n >= cfg.total) { head.textContent = '全部完成'; big.textContent = '✓'; sub.textContent = ''; button('结算', finish, 'primary'); return; }
      const c = cmds[Math.floor(Math.random() * cmds.length)];
      const sec = parseInt(c.sec) || 20;
      head.textContent = `口令 ${n + 1}／${cfg.total}`;
      big.textContent = c.text;
      beat(true);
      let left = sec;
      sub.textContent = `保持 ${left} 秒`;
      every(() => { left--; sub.textContent = `保持 ${Math.max(0, left)} 秒`; if (left <= 0) { n++; next(); } }, 1000);
      button('做到了', () => { n++; next(); }, 'primary');
    };
    head.textContent = '服从口令'; big.textContent = cfg.total + ' 道'; sub.textContent = '每道口令照做并保持到倒数结束';
    button('开始', next, 'primary');
  }

  else if (cfg.kind === 'affirm') {
    // 原站：先倒数 3 秒，一次一句，每次换一句（不连着重复），按长短给念的时间后自动换
    const A = opts.affirm || {};
    const all = A.lines || [];
    const tags = cfg.tags || ['ANY'];
    let pool = tags.includes('ANY') ? all : all.filter(a => (a.tags || []).some(t => tags.includes(t)));
    if (!pool.length) pool = all.length ? all : [{ id: '', zh: '我是乖女孩', en: 'I am a good girl' }];
    let lang = A.lang === 'en' ? 'en' : 'zh';
    let n = 0, cur = null, token = 0, paused = false;
    const bar = el('div', 'aff-bar'), fill = el('i');
    bar.appendChild(fill);
    box.insertBefore(bar, btns);
    pulse.remove();
    const langBtn = el('button', 'btn ghost aff-lang');
    box.appendChild(langBtn);
    const readSec = (t, l) => {
      const k = l === 'en' ? t.split(/\s+/).filter(Boolean).length * 0.4 : t.replace(/[\s，、。：；！？「」,.]/g, '').length * 0.28;
      return Math.min(12, Math.max(2.5, k + 1.5));
    };
    const paint = () => {
      langBtn.textContent = lang === 'zh' ? '中文 ⇄ EN' : 'EN ⇄ 中文';
      if (!cur) return;
      big.textContent = cur[lang];
      sub.textContent = cur[lang === 'zh' ? 'en' : 'zh'];
    };
    const say = async () => {
      const my = ++token;
      stopAll();
      paint();
      fill.style.width = '0%';
      if (A.voice) await A.voice(cur.id, lang);
      if (my !== token || paused) return;
      const ms = readSec(cur[lang], lang) * 1000, t0 = Date.now();
      every(() => {
        const f = (Date.now() - t0) / ms;
        fill.style.width = Math.min(100, f * 100) + '%';
        if (f >= 1) next();
      }, 100);
    };
    const next = () => {
      token++; stopAll();
      if (n >= cfg.total) {
        clearBtns(); bar.remove(); langBtn.remove();
        head.textContent = '全部完成'; big.textContent = '✓'; sub.textContent = '';
        button('结算', finish, 'primary');
        return;
      }
      let c;
      do c = pool[Math.floor(Math.random() * pool.length)]; while (pool.length > 1 && c === cur);
      cur = c; n++;
      head.textContent = `第 ${n}／${cfg.total} 句`;
      say();
    };
    langBtn.onclick = () => {
      lang = lang === 'zh' ? 'en' : 'zh';
      A.setLang?.(lang);
      if (cur && !paused) say(); else paint();
    };
    const go = () => {
      clearBtns();
      let left = 3;
      big.textContent = left; sub.textContent = '听完跟着大声念出来';
      every(() => { left--; if (left > 0) big.textContent = left; else next(); }, 1000);
      button('念完了，下一句', () => { if (cur) next(); }, 'primary');
      button('再听一次', () => { if (cur) { paused = false; pb.textContent = '暂停'; say(); } });
      const pb = button('暂停', () => {
        if (!cur) return;
        paused = !paused;
        pb.textContent = paused ? '继续' : '暂停';
        if (paused) { token++; stopAll(); sub.textContent = '暂停中'; } else say();
      });
    };
    head.textContent = '自我暗示语';
    big.textContent = cfg.total + ' 句';
    sub.textContent = '每句先听，再跟着大声念出来；左上角可切换中文／英文';
    paint();
    button('开始', go, 'primary');
  }

  else {
    let n = 0;
    head.textContent = cfg.label || '计数';
    const show = () => { big.textContent = `${n}／${cfg.total}`; };
    show(); sub.textContent = '每做一次按一下';
    const b = button('＋1', () => { n++; beat(n === cfg.total); show(); if (n >= cfg.total) { clearBtns(); button('结算', finish, 'primary'); } }, 'primary big');
    b.style.minHeight = '96px';
  }

  const close = el('button', 'btn ghost game-close', '收起');
  close.onclick = () => { stopAll(); opts.onClose(); };
  box.appendChild(close);
  return stopAll;
}

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
