// 小说阅读器：全屏层，一章一页往下滑。排版照各书 html（小说\白帝\tools\build_*.py）的写法：
// `***` 分隔、`## ` 小标题、`> ` 题记、【…完】章末、其他【…】讯息（连着几行收进一张卡）、〔…〕待补段。
// 字号、行距、底色存在设置；每章读到哪里（比例 0～1）交给 o.onPos 存进进度。

const THEMES = [['', '米'], ['paper', '白'], ['green', '绿'], ['dark', '夜']];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(txt) {
  const out = [];
  let card = null;
  const flush = () => { if (card) { out.push('<div class="rd-card">' + card.join('') + '</div>'); card = null; } };
  for (let l of txt.split(/\r?\n/)) {
    l = l.trim();
    if (!l) continue;
    if (/^【.*】$/.test(l) && !/完】$/.test(l)) { (card = card || []).push('<p class="msg">' + esc(l) + '</p>'); continue; }
    flush();
    if (l === '***') out.push('<p class="sep">＊＊＊</p>');
    else if (l.startsWith('## ')) out.push('<h2>' + esc(l.slice(3)) + '</h2>');
    else if (l.startsWith('> ')) out.push('<p class="note">' + esc(l.slice(2)) + '</p>');
    else if (/^【.*完】$/.test(l)) out.push('<p class="end">' + esc(l) + '</p>');
    else if (/^〔.*〕$/.test(l)) out.push('<p class="todo">' + esc(l) + '</p>');
    else out.push('<p>' + esc(l) + '</p>');
  }
  flush();
  return out.join('');
}

// o: { book, k（章）, pos, settings:{fs,lh,theme}, getText(k)→Promise<string>, progress(k)→0～1,
//      onPos(k, ratio), onSettings(s), onClose() }
export function openReader(root, o) {
  const st = { fs: 20, lh: 1.95, theme: '', ...o.settings };
  const chs = o.book.chapters;
  let i = Math.max(0, chs.findIndex(c => c.k === o.k));
  let saveT = null, lastY = 0, alive = true;

  root.innerHTML = `<div id="rd-prog"></div>
    <div class="rd-bar">
      <button data-r="close">‹ 书库</button><span class="rd-ttl"></span>
      <button data-r="toc">目录</button><button data-r="set">Aa</button>
    </div>
    <div class="rd-panel" hidden></div>
    <div class="rd-scroll"><article class="rd-text"></article></div>`;
  const $ = s => root.querySelector(s);
  const scroller = $('.rd-scroll'), bar = $('.rd-bar'), panel = $('.rd-panel');

  const apply = () => {
    root.dataset.theme = st.theme;
    root.style.setProperty('--rfs', st.fs + 'px');
    root.style.setProperty('--rlh', st.lh);
  };
  const ratio = () => { const h = scroller.scrollHeight - scroller.clientHeight; return h > 0 ? Math.min(1, scroller.scrollTop / h) : 1; };
  const savePos = () => { clearTimeout(saveT); saveT = null; if (alive) o.onPos(chs[i].k, ratio()); };

  async function show(idx, pos = 0) {
    if (saveT) savePos();
    i = idx;
    const c = chs[i];
    panel.hidden = true;
    $('.rd-ttl').textContent = c.no + '　' + c.title;
    const txt = await o.getText(c.k);
    if (!alive) return;
    const prev = chs[i - 1], next = chs[i + 1];
    const nb = (ch, d, lab) => ch ? `<button data-r="go" data-i="${i + d}"><small>${lab}</small>${esc(ch.no)}　${esc(ch.title)}</button>` : `<span><small>${lab}</small>没有了</span>`;
    $('.rd-text').innerHTML = `<h1><span class="no">${esc(c.no)}</span>${esc(c.title)}</h1>
      <div class="meta">${esc(o.book.title)} · 约 ${c.han.toLocaleString()} 字 · 约 ${Math.max(1, Math.round(c.han / 500))} 分钟</div>
      ${txt == null ? '<p class="todo">这一章的内容不在手机里，重新导入小说包。</p>' : toHtml(txt)}
      <nav class="rd-nav">${nb(prev, -1, '上一章')}<button data-r="toc" class="ix">目录</button>${nb(next, 1, '下一章')}</nav>`;
    requestAnimationFrame(() => {
      scroller.scrollTop = pos * (scroller.scrollHeight - scroller.clientHeight);
      lastY = scroller.scrollTop;
      onScroll();
      o.onPos(c.k, ratio());
    });
  }

  function onScroll() {
    $('#rd-prog').style.width = (ratio() * 100).toFixed(1) + '%';
    const y = scroller.scrollTop;
    if (y > lastY + 8 && y > 80) bar.classList.add('hide');
    else if (y < lastY - 8) bar.classList.remove('hide');
    lastY = y;
    if (!saveT) saveT = setTimeout(savePos, 800);
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  function toc() {
    panel.innerHTML = '<div class="rd-toc">' + chs.map((c, n) => {
      const p = o.progress(c.k);
      return `<button data-r="go" data-i="${n}" class="${n === i ? 'on' : ''}"><span class="no">${esc(c.no)}</span><span class="t">${esc(c.title)}</span><span class="c">${p >= 0.98 ? '读完' : p > 0 ? Math.round(p * 100) + '%' : ''}</span></button>`;
    }).join('') + '</div>';
    panel.hidden = false;
    panel.querySelector('.on')?.scrollIntoView({ block: 'center' });
  }
  function settings() {
    panel.innerHTML = `<div class="rd-set">
      <div><span>字号</span><button data-r="fs" data-d="-1">A−</button><b>${st.fs}</b><button data-r="fs" data-d="1">A＋</button></div>
      <div><span>行距</span><button data-r="lh" data-d="-0.1">−</button><b>${st.lh.toFixed(2)}</b><button data-r="lh" data-d="0.1">＋</button></div>
      <div><span>底色</span>${THEMES.map(([k, l]) => `<button data-r="th" data-k="${k}" class="${st.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>`;
    panel.hidden = false;
  }
  const keep = fn => { const r = ratio(); fn(); apply(); o.onSettings({ ...st }); requestAnimationFrame(() => { scroller.scrollTop = r * (scroller.scrollHeight - scroller.clientHeight); }); settings(); };

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b) {
      if (!panel.hidden && !e.target.closest('.rd-panel')) { panel.hidden = true; return; }
      if (e.target.closest('.rd-scroll')) bar.classList.toggle('hide');
      return;
    }
    const r = b.dataset.r;
    if (r === 'close') o.onClose();
    else if (r === 'toc') { if (!panel.hidden && panel.querySelector('.rd-toc')) panel.hidden = true; else { bar.classList.remove('hide'); toc(); } }
    else if (r === 'set') { if (!panel.hidden && panel.querySelector('.rd-set')) panel.hidden = true; else settings(); }
    else if (r === 'go') { const n = +b.dataset.i; const p = o.progress(chs[n].k); show(n, p >= 0.98 ? 0 : p); }
    else if (r === 'fs') keep(() => { st.fs = Math.min(32, Math.max(14, st.fs + +b.dataset.d)); });
    else if (r === 'lh') keep(() => { st.lh = Math.round(Math.min(2.6, Math.max(1.4, st.lh + +b.dataset.d)) * 100) / 100; });
    else if (r === 'th') keep(() => { st.theme = b.dataset.k; });
  });

  apply();
  show(i, o.pos || 0);
  return () => { if (saveT) savePos(); alive = false; };
}
