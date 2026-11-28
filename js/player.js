// 片库播放器：全屏层，一片切成约 1 分钟一段（flm_<片>_<序>），两个 video 轮流接，进度条按整片时间算。
// 只解密正在播和下一段（o.seg(k) 给网址，o.drop(k) 收掉）；看到哪里（秒）交给 o.onPos 存。
// o: { film:{id,title,segs:[秒]}, pos（秒）, muted, seg(k)→Promise<url|null>, drop(k), onPos(t), onMute(b), onClose(),
//      loop（播完从头，任务用）, shuffle（任务用：每段随机挑）, bare（任务用：不出拖动条，只有暂停和静音） }

const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const fmt = t => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

export function openPlayer(root, o) {
  const segs = o.film.segs, n = segs.length;
  const starts = segs.reduce((a, d, i) => (a.push(i ? a[i - 1] + segs[i - 1] : 0), a), []);
  const total = starts[n - 1] + segs[n - 1];
  const kOf = t => { let k = 0; while (k + 1 < n && starts[k + 1] <= t + 0.01) k++; return k; };

  root.innerHTML = `<div class="pv-stage"></div>
    <div class="pv-ui">
      <div class="pv-top"><button data-p="close">‹ 返回</button><span class="pv-ttl"></span><button data-p="mute"></button></div>
      <div class="pv-mid"><button data-p="back">−10</button><button data-p="play" class="big"></button><button data-p="fwd">＋10</button></div>
      <div class="pv-bot"><span class="pv-t">0:00</span><input type="range" min="0" max="1000" value="0"><span class="pv-d"></span></div>
    </div>
    <div class="pv-wait">载入中…</div>`;
  const $ = s => root.querySelector(s);
  const stage = $('.pv-stage'), ui = $('.pv-ui'), bar = $('input'), wait = $('.pv-wait');
  $('.pv-ttl').textContent = o.film.title;
  $('.pv-d').textContent = fmt(total);
  if (o.bare) { $('.pv-mid [data-p="back"]').remove(); $('.pv-mid [data-p="fwd"]').remove(); $('.pv-bot').remove(); }

  const vs = [0, 1].map(() => { const v = el('video'); v.playsInline = true; v.preload = 'auto'; stage.appendChild(v); return v; });
  let cur = 0, k = -1, nextK = -1, alive = true, paused = false, muted = !!o.muted, dragging = false, hideT = null, lastSave = 0;
  const loaded = new Map();     // 段号 → 网址（只留现在和下一段）
  const pick = after => o.shuffle ? Math.floor(Math.random() * n) : (after + 1 < n ? after + 1 : (o.loop ? 0 : -1));

  const url = async j => { if (!loaded.has(j)) loaded.set(j, await o.seg(j)); return loaded.get(j); };
  const tidy = () => { for (const j of [...loaded.keys()]) if (j !== k && j !== nextK) { o.drop(j); loaded.delete(j); } };
  const go = v => { v.muted = muted; return v.play().catch(() => { if (!alive) return; v.muted = true; return v.play().catch(() => {}); }); };
  const showBtns = () => {
    $('[data-p="play"]').textContent = paused ? '▶' : '❚❚';
    $('[data-p="mute"]').textContent = muted ? '静音' : '有声';
  };
  const now = () => k < 0 ? 0 : starts[k] + (vs[cur].currentTime || 0);
  const tick = () => {
    const t = now();
    $('.pv-t') && ($('.pv-t').textContent = fmt(t));
    if (!dragging && $('.pv-bot')) bar.value = Math.round(t / total * 1000);
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); o.onPos?.(t); }
  };

  // 预备下一段到另一个 video
  async function prep(after) {
    nextK = pick(after);
    const b = vs[1 - cur];
    if (nextK < 0) { b.removeAttribute('src'); return; }
    const u = await url(nextK);
    if (!alive || !u) return;
    b.src = u; b.load();
    tidy();
  }
  // 从段 j 的 off 秒开始（跳转／开头用）
  async function jump(j, off) {
    wait.hidden = false;
    const a = vs[cur];
    const u = await url(j);
    if (!alive) return;
    if (!u) { wait.textContent = '这一段还没导入（片子分了几个包，要全部导入）'; return; }
    k = j;
    if (a.src !== u) { a.src = u; await new Promise(r => { a.onloadedmetadata = r; a.onerror = r; }); }
    a.currentTime = Math.min(off, Math.max(0, (a.duration || segs[j]) - 0.2));
    a.classList.add('cur'); vs[1 - cur].classList.remove('cur');
    wait.hidden = true;
    if (!paused) go(a);
    tick();
    prep(j);
  }
  const seek = t => { t = Math.max(0, Math.min(total - 0.3, t)); const j = kOf(t); if (j === k) { vs[cur].currentTime = t - starts[j]; tick(); } else jump(j, t - starts[j]); };

  vs.forEach((v, i) => {
    v.ontimeupdate = () => { if (i === cur) tick(); };
    v.onended = () => {
      if (i !== cur || !alive) return;
      if (nextK < 0) { paused = true; showBtns(); showUi(); o.onPos?.(0); o.onEnd?.(); return; }
      const a = vs[cur], b = vs[1 - cur];
      b.addEventListener('playing', () => { b.classList.add('cur'); a.classList.remove('cur'); }, { once: true });
      cur = 1 - cur; k = nextK;
      if (!paused) go(b);
      prep(k);
    };
  });

  function showUi() {
    ui.classList.remove('hide'); clearTimeout(hideT);
    if (!paused) hideT = setTimeout(() => ui.classList.add('hide'), 3000);
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b) { if (ui.classList.contains('hide')) showUi(); else if (!e.target.closest('.pv-bot')) { ui.classList.add('hide'); clearTimeout(hideT); } return; }
    const p = b.dataset.p;
    if (p === 'close') return o.onClose();
    if (p === 'play') { paused ? api.resume() : api.pause(); }
    if (p === 'mute') { muted = !muted; vs.forEach(v => { v.muted = muted; }); o.onMute?.(muted); }
    if (p === 'back') seek(now() - 10);
    if (p === 'fwd') seek(now() + 10);
    showBtns(); showUi();
  });
  bar.addEventListener('input', () => { dragging = true; $('.pv-t').textContent = fmt(bar.value / 1000 * total); showUi(); });
  bar.addEventListener('change', () => { dragging = false; seek(bar.value / 1000 * total); });

  const api = {
    pause() { if (paused) return; paused = true; vs[cur].pause(); showBtns(); showUi(); o.onPos?.(now()); o.onPause?.(); },
    resume() { if (!paused) return; paused = false; if (k >= 0) go(vs[cur]); showBtns(); showUi(); o.onResume?.(); },
    get time() { return now(); },
    stop() {
      alive = false; clearTimeout(hideT);
      if (k >= 0 && !o.loop && !o.shuffle) o.onPos?.(now());
      vs.forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
      for (const j of loaded.keys()) o.drop(j);
      loaded.clear();
    }
  };
  showBtns(); showUi();
  const t0 = o.pos && o.pos < total - 3 ? o.pos : 0;
  const j0 = o.shuffle ? Math.floor(Math.random() * n) : kOf(t0);
  jump(j0, o.shuffle ? 0 : t0 - starts[j0]);
  return api;
}
