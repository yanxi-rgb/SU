import * as Vt from './vault.js';
import * as E from './engine.js';
import { openGame } from './minigame.js';

const APP_VER = '1.0.0';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const app = () => $('#app');

let screen = 'boot';
let tab = 'home';
let more = 'menu';
let classFilter = 'mine';
let advFilter = 'mine';
let sheets = [];
let sel = new Map();          // 一起开始：key|vk → view
let showModMatch = false;
let hiddenAt = 0;
let saveTimer = null;
let imgIdx = {};
const imgUrls = new Map();
let gameStop = null;
let wake = null;
let scrollMem = {};

// ———————————————— 存取 ————————————————

function save(now = false) {
  if (!Vt.unlocked() || !E.S) return;
  clearTimeout(saveTimer);
  const go = () => Vt.putJSON('state', E.S).catch(err => toast('存档失败：' + err.message));
  if (now) return go();
  saveTimer = setTimeout(go, 300);
}

async function loadAll() {
  const content = await Vt.getJSON('content');
  imgIdx = (await Vt.getJSON('imgidx')) || {};
  E.useState(await Vt.getJSON('state'));
  E.hooks({ notify });
  if (!content) { screen = 'import'; return; }
  E.loadContent(content);
  E.rollover();
  screen = E.S.onboarded ? 'app' : 'ask';
}

// ———————————————— 提醒 ————————————————

function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach(o => o.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

function beep() {
  if (!E.S.settings.sound) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach(d => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 988; g.gain.value = 0.2;
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.15);
    });
  } catch {}
}

async function sysNotify(body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification('进度簿', { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' });
  } catch {}
}

function notify(kind, p) {
  if (kind === 'due') { beep(); vib([300, 150, 300]); toast('计时到了：' + p.short); sysNotify('计时到了', p.rid); }
  if (kind === 'over') { vib(200); toast('已超时：' + p.short); sysNotify('已超时', p.rid); }
  if (kind === 'pun' && p?.length) toast('领到惩罚：' + p.map(e => e.name).join('、'));
}
const vib = p => { if (E.S.settings.vibrate && navigator.vibrate) navigator.vibrate(p); };

// ———————————————— 对话框 ————————————————

function dialog({ title = '', html = '', fields = [], buttons = [{ label: '确定', value: true, cls: 'primary' }, { label: '取消', value: false }] }) {
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="modal-box">
      ${title ? `<h3>${esc(title)}</h3>` : ''}
      ${html ? `<div class="modal-body">${html}</div>` : ''}
      ${fields.map((f, i) => `<label class="field"><span>${esc(f.label)}</span>
        <input data-i="${i}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} autocomplete="off" placeholder="${esc(f.placeholder || '')}"></label>`).join('')}
      <div class="row end">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-b="${i}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    document.body.appendChild(d);
    const ins = [...d.querySelectorAll('input')];
    ins[0]?.focus();
    const done = i => { const data = ins.map(x => x.value); d.remove(); res({ value: buttons[i].value, data }); };
    d.querySelectorAll('[data-b]').forEach(b => b.onclick = () => done(+b.dataset.b));
    ins.forEach(x => x.onkeydown = e => { if (e.key === 'Enter') done(0); });
  });
}
const confirmBox = async (msg, ok = '确定', cls = 'primary') => (await dialog({ html: msg, buttons: [{ label: ok, value: true, cls }, { label: '取消', value: false }] })).value;

// ———————————————— 图片 ————————————————

const pic = (id, cls = 'r34') => `<div class="pic ${cls}" data-img="${esc(id)}">${imgIdx[id] ? '' : `<span>${esc(id)}</span>`}</div>`;

async function hydrateImages(root = document) {
  for (const n of root.querySelectorAll('[data-img]')) {
    const id = n.dataset.img;
    if (!imgIdx[id] || n.dataset.done) continue;
    n.dataset.done = '1';
    let url = imgUrls.get(id);
    if (!url) {
      try {
        const b = await Vt.getBytes('img:' + id);
        if (!b) continue;
        url = URL.createObjectURL(new Blob([b], { type: imgIdx[id] }));
        imgUrls.set(id, url);
      } catch { continue; }
    }
    n.innerHTML = `<img src="${url}" alt="">`;
  }
}
function dropImageUrls() { for (const u of imgUrls.values()) URL.revokeObjectURL(u); imgUrls.clear(); }

// ———————————————— 画面：锁定／设定／导入 ————————————————

function viewLock() {
  return `<div class="center">
    <div class="logo">${logoSvg()}</div>
    <h2>进度簿</h2>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">
    <button class="btn primary wide" data-act="unlock">打开</button>
    <p class="muted small" id="pinmsg"></p>
  </div>`;
}

function viewSetup() {
  return `<div class="center">
    <div class="logo">${logoSvg()}</div>
    <h2>设定 PIN</h2>
    <p class="muted small">所有记录与图片都用这个 PIN 加密存在本机。<b>忘了就救不回来</b>，只能清除重来。</p>
    <input id="pin1" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN（至少 4 位）">
    <input id="pin2" type="password" inputmode="numeric" autocomplete="off" placeholder="再输入一次">
    <button class="btn primary wide" data-act="setup">设定</button>
    <p class="muted small" id="pinmsg"></p>
  </div>`;
}

function viewImport() {
  return `<div class="center">
    <h2>导入内容包</h2>
    <p class="muted small">选手机里的 .bin 内容包，再输入打包时设的口令。导入后可以把 .bin 删掉。</p>
    <button class="btn primary wide" data-act="pick">选择文件</button>
    <p class="muted small" id="impmsg"></p>
  </div>`;
}

function viewAsk() {
  const ph = E.C.placeholders;
  return `<div class="page">
    <h2>几个称呼</h2>
    <p class="muted small">会代入任务文字里。之后可在「更多 › 设置」改。</p>
    ${ph.map(p => `<label class="field"><span>${esc(p.label)}${p.ask ? '' : '（可留默认）'}</span>
      <input data-ph="${p.key}" value="${esc(E.S.settings.ph[p.key] || '')}" placeholder="${esc(p.default || '')}"></label>`).join('')}
    <button class="btn primary wide" data-act="askDone">完成</button>
  </div>`;
}

// ———————————————— 主画面 ————————————————

const TABS = [['home', '首页'], ['class', '课堂'], ['adv', '进阶'], ['pun', '惩罚'], ['more', '更多']];

function viewApp() {
  const pc = E.S.puns.length;
  let body = '';
  if (tab === 'home') body = viewHome();
  if (tab === 'class') body = viewClasses();
  if (tab === 'adv') body = viewAdv();
  if (tab === 'pun') body = viewPun();
  if (tab === 'more') body = viewMore();
  return `<header class="top">
      <div><b>${E.S.credits}</b> <span class="muted">学分</span></div>
      <div class="muted small">${E.TIER_LABEL[E.S.tier]}｜${E.dayKey().slice(5)} 周${E.WEEK[E.weekday(E.dayKey())]}</div>
      <button class="icon" data-act="lock" title="上锁">${lockSvg()}</button>
    </header>
    <main id="main" class="page">${body}</main>
    <nav class="tabs">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${l}${k === 'pun' && pc ? `<i class="dot">${pc}</i>` : ''}${k === 'home' && E.S.runs.length ? `<i class="dot alt">${E.S.runs.length}</i>` : ''}</button>`).join('')}</nav>`;
}

// —— 首页 ——

function viewHome() {
  const S = E.S;
  let out = '';
  const ci = S.checkin.day === E.dayKey(), cc = S.chastity.day === E.dayKey();
  out += `<div class="row gap">
    <button class="btn ${ci ? 'ghost' : ''}" data-act="checkin" data-k="normal" ${ci ? 'disabled' : ''}>${ci ? '已签到' : '签到'}｜${E.checkinStreak('normal')}%</button>
    <button class="btn ${cc ? 'ghost' : ''}" data-act="checkin" data-k="chastity" ${cc ? 'disabled' : ''}>${cc ? '贞操已签' : '贞操签到'}｜${E.checkinStreak('chastity')}%</button>
  </div>`;
  // 待配合
  const pm = E.pendingMods();
  if (pm.length) {
    out += `<div class="banner"><div class="row between"><b>${pm.length} 项待配合</b>
      <button class="btn small" data-act="modMatch">${showModMatch ? '收起' : '能配合的任务'}</button></div>
      ${pm.map(m => `<div class="modline">· ${m.text}<span class="muted small">　来自「${esc(m.from)}」${m.usesLeft > 1 ? '，还剩 ' + m.usesLeft + ' 次' : ''}</span></div>`).join('')}`;
    if (showModMatch) {
      const list = E.startableNow(v => E.matchingMods(v).length > 0);
      out += list.length ? list.map(v => taskCard(v, { compact: true })).join('') : `<p class="muted small">现在没有能配合的任务（先出席课堂，或检查道具）。</p>`;
    }
    out += `</div>`;
  }
  // 进行中
  if (S.runs.length) {
    out += `<h3>进行中</h3>` + S.runs.filter(r => !r.parentRid).map(runCard).join('');
  }
  // 待出席
  const att = Object.keys(S.enrolled).filter(id => E.C.ent[id] && E.canAttend(id));
  if (att.length) {
    out += `<h3>今天还没出席</h3><div class="chips">${att.map(id => `<button class="chip" data-act="attend" data-id="${id}">${esc(E.C.ent[id].name)} ✓</button>`).join('')}</div>`;
  }
  // 待做惩罚
  const pend = S.puns.filter(p => !p.rid);
  if (pend.length) out += `<div class="notice" data-act="tab" data-k="pun">${pend.length} 项惩罚待做，每项会扣完成任务时的学分 →</div>`;
  // 可开始
  const list = E.startableNow(v => !v.parentId);
  out += `<h3>现在可以开始 <span class="muted small">${list.length} 项</span></h3>`;
  if (!list.length) out += `<p class="muted">没有。去「课堂」加入课堂并出席。</p>`;
  else {
    out += `<p class="muted small">勾选多项可一起开始；会互相冲突的会自动变灰。</p>`;
    out += list.map(v => taskCard(v, { selectable: true, compact: true })).join('');
  }
  if (sel.size) out += `<div class="floatbar"><button class="btn primary wide" data-act="startSel">一起开始（${sel.size}）</button><button class="btn ghost" data-act="clearSel">清除</button></div>`;
  return out;
}

function selConflicts(v) {
  const extra = [...sel.values()].filter(x => x.key !== v.key).map(x => ({ short: E.stripTags(E.renderView(x).title || E.renderView(x).text).slice(0, 16), parts: x.parts, activity: x.activity, isParallel: x.isParallel, eid: x.eid }));
  return E.conflicts(v, extra);
}

// —— 任务卡 ——

function taskCard(v, o = {}) {
  const R = E.renderView(v);
  const chk = E.check(v);
  const run = E.runOf(v.key);
  const cr = E.creditsFor(v).final;
  const cost = E.startCost(v);
  const d = E.S.done[v.key];
  const selKey = v.key + '|' + v.vk;
  const selOn = sel.has(selKey);
  const selBlock = o.selectable && !selOn && sel.size ? selConflicts(v) : [];
  const tags = [];
  if (v.isExam) tags.push('<i class="pill warn">考试</i>');
  tags.push(`<i class="pill">${E.TYPE_LABEL[v.type] || v.type}</i>`);
  if (v.type !== 'MODIFIER_TASK') tags.push(`<i class="pill ${v.activity === 'active' ? 'act' : 'pas'}">${v.activity === 'active' ? '主动' : '被动'}</i>`);
  if (v.isParallel) tags.push('<i class="pill">可并行</i>');
  for (const p of v.parts) tags.push(`<i class="pill part">${esc(p)}</i>`);
  const meta = [];
  if (R.durSec && v.type !== 'COMPOSITE_TASK') meta.push((v.type === 'TIMED_TASK' ? '限时 ' : '') + E.fmtDur(R.durSec));
  if (R.mult !== 1) meta.push('难度 ×' + R.mult);
  if (cr) meta.push('+' + cr + ' 学分');
  if (cost) meta.push('费用 ' + cost);
  if (d?.count) meta.push('已完成 ' + d.count + ' 次');
  const reqs = (v.requiredItems || []).map(E.reqText).filter(Boolean);
  const rs = v.requiredStats;
  if (rs && !Array.isArray(rs)) for (const [k, n] of Object.entries(rs)) reqs.push((E.C.stats[k] || k) + ' ≥ ' + n);
  if (Array.isArray(rs)) for (const r of rs) if (r.anyStatMin) reqs.push('任一服装数值 ≥ ' + r.anyStatMin);
  const mm = !run && chk.ok ? E.matchingMods(v) : [];
  const head = o.showEnt !== false && o.compact ? `<div class="muted small">${esc(v.e.name)}${v.entType === 'Class' ? '' : '・' + E.ENT_LABEL[v.entType]}</div>` : '';
  let btn = '';
  if (chk.unsupported) btn = `<span class="muted small">此版本不支持</span>${!E.doneToday(v.key) && E.isMember(v.eid) ? ` <button class="btn small ghost" data-act="skipU" data-e="${v.eid}" data-t="${v.tid}">跳过</button>` : ''}`;
  else if (run) btn = `<span class="pill act">进行中</span>`;
  else if (chk.ok) btn = `<button class="btn small primary" data-act="start" data-e="${v.eid}" data-t="${v.tid}" data-v="${v.vk}">开始</button>`;
  const why = !chk.ok && !run && !chk.unsupported ? chk.why : chk.why.filter(w => w.startsWith('提示·'));
  return `<div class="card task ${o.selectable && selBlock.length ? 'dim' : ''}">
    ${head}
    <div class="row between top-al">
      <div class="tags">${o.selectable && chk.ok ? `<input type="checkbox" class="sel" data-sel="${esc(selKey)}" data-e="${v.eid}" data-t="${v.tid}" data-v="${v.vk}" ${selOn ? 'checked' : ''} ${selBlock.length ? 'disabled' : ''}>` : ''}${tags.join('')}</div>
      <div>${btn}</div>
    </div>
    ${R.title ? `<div class="ttl">${R.title}</div>` : ''}
    <div class="txt">${R.text}</div>
    ${R.comment ? `<div class="muted small">${R.comment}</div>` : ''}
    ${reqs.length ? `<div class="req">需要：${reqs.map(esc).join('；')}</div>` : ''}
    ${meta.length ? `<div class="muted small">${meta.join('｜')}</div>` : ''}
    ${v.variants.length > 1 ? `<div class="chips">${v.variants.map(k => `<button class="chip ${k === v.vk ? 'on' : ''}" data-act="variant" data-k="${k}">${E.variantLabel(k)}</button>`).join('')}</div>` : ''}
    ${mm.length ? `<div class="hint">会一并执行：${mm.map(m => m.text).join('；')}</div>` : ''}
    ${why.length ? `<div class="why">${why.map(w => esc(w.replace('提示·', '提示：'))).join('<br>')}</div>` : ''}
    ${selBlock.length ? `<div class="why">${selBlock.map(esc).join('<br>')}</div>` : ''}
  </div>`;
}

// —— 进行中卡 ——

function runCard(r) {
  const V = E.view(r.eid, r.tid, r.vk);
  const rem = E.remaining(r);
  const f = E.canFinish(r);
  const mods = E.S.mods.filter(m => r.mods.includes(m.mid));
  const own = E.S.mods.filter(m => m.srcRid === r.rid);
  let timer = '';
  if (r.type === 'DURATION_TASK' && r.durSec) timer = `<div class="timer ${rem <= 0 ? 'due' : ''}" data-timer="${r.rid}">${rem > 0 ? E.fmtClock(rem) : '时间到'}</div>`;
  else if (r.limitSec) timer = `<div class="timer ${rem < 0 ? 'due' : ''}" data-timer="${r.rid}">${E.fmtClock(rem)}</div><div class="muted small">剩余时限</div>`;
  else if (r.type !== 'MODIFIER_TASK') timer = `<div class="timer soft" data-elapsed="${r.rid}">${E.fmtClock(E.elapsed(r))}</div>`;
  let kids = '';
  if (r.type === 'COMPOSITE_TASK' && V) {
    kids = `<div class="kids">${E.childTasks(r.eid, r.tid).map(k => {
      const kv = E.view(r.eid, k.id);
      const kr = E.runOf(kv.key);
      if ((r.kidsDone || []).includes(k.id)) return `<div class="kid done">✓ ${E.stripTags(E.renderView(kv).text).slice(0, 40)}</div>`;
      if (kr) return runCard(kr);
      return taskCard(kv, { compact: false, showEnt: false });
    }).join('')}</div>`;
    if (r.stepWindow && (r.kidsDone || []).length) {
      const left = r.stepWindow - (Date.now() - r.lastStepAt) / 1000;
      if (!E.S.runs.some(k => k.parentRid === r.rid)) kids = `<div class="why">下一步要在 ${E.fmtClock(left)} 内开始</div>` + kids;
    }
  }
  const btns = [];
  if (r.game && !r.gameDone) btns.push(`<button class="btn primary" data-act="game" data-r="${r.rid}">${r.type === 'METRONOME_MINIGAME_TASK' ? '打开节拍器' : '开始'}</button>`);
  if (f.ok) btns.push(`<button class="btn primary" data-act="done" data-r="${r.rid}">完成</button>`);
  if (r.type === 'DURATION_TASK' || r.type === 'COMPOSITE_TASK') btns.push(r.pausedAt ? `<button class="btn" data-act="resume" data-r="${r.rid}">继续</button>` : `<button class="btn ghost" data-act="pause" data-r="${r.rid}">暂停</button>`);
  btns.push(`<button class="btn ghost" data-act="runMenu" data-r="${r.rid}">⋯</button>`);
  return `<div class="card run ${r.pausedAt ? 'paused' : ''}">
    <div class="muted small">${esc(E.C.ent[r.eid]?.name || r.eid)}${r.isExam ? '・考试' : ''}・${E.TYPE_LABEL[r.type] || ''}${r.pausedAt ? '・暂停中' : ''}</div>
    ${r.title ? `<div class="ttl">${r.title}</div>` : ''}
    <div class="txt">${r.text}</div>
    ${mods.length ? `<div class="hint">一并执行：${mods.map(m => m.text).join('；')}</div>` : ''}
    ${own.length ? `<div class="hint alt">等下一个任务配合：${own.map(m => m.text).join('；')}</div>` : ''}
    ${timer}
    ${!f.ok && r.type !== 'MODIFIER_TASK' && r.type !== 'COMPOSITE_TASK' && !(r.game && !r.gameDone) ? `<div class="muted small">${f.why}</div>` : ''}
    <div class="row gap wrap">${btns.join('')}</div>
    ${kids}
  </div>`;
}

// —— 课堂 ——

function entCard(e) {
  const st = E.graduated(e.id) ? `<i class="pill ok">已结业 ${E.S.enrolled[e.id].grade || ''}</i>` : E.isMember(e.id) ? `<i class="pill act">已加入</i>` : '';
  let prog = '';
  if (E.isMember(e.id) && e.type === 'Class') { const g = E.gradeInfo(e.id); prog = `<span class="muted small">${g.done}／${g.total}</span>`; }
  const days = e.days?.length ? '周' + e.days.map(d => E.WEEK[d]).join('') : '';
  return `<div class="card ent" data-act="ent" data-id="${e.id}">
    ${pic(e.id, 'r34 thumb')}
    <div class="grow">
      <div class="row between"><b>${esc(e.name)}</b>${st}</div>
      <div class="muted small">${e.type === 'Class' ? E.TIER_LABEL[e.tier || 0] : E.ENT_LABEL[e.type]}${days ? '｜' + days : ''} ${prog}</div>
      <div class="small clamp">${esc(e.description || '')}</div>
    </div>
  </div>`;
}

function filterEnts(list, f) {
  if (f === 'mine') return list.filter(e => E.isMember(e.id));
  if (f === 'open') return list.filter(e => !E.isMember(e.id) && !E.graduated(e.id) && E.tierOk(e.id) && E.prereqOk(e.id));
  if (f === 'done') return list.filter(e => E.graduated(e.id));
  return list;
}
const filterChips = (cur, act) => `<div class="chips">${[['mine', '我的'], ['open', '可加入'], ['done', '已结业'], ['all', '全部']].map(([k, l]) => `<button class="chip ${cur === k ? 'on' : ''}" data-act="${act}" data-k="${k}">${l}</button>`).join('')}</div>`;

function viewClasses() {
  const next = E.S.tier + 1;
  let out = '';
  if (next <= 4) out += `<div class="row between card"><span>已解锁到 <b>${E.TIER_LABEL[E.S.tier]}</b></span><button class="btn small" data-act="unlockTier">解锁${E.TIER_LABEL[next]}（${E.C.rules.tierUnlockCost[next]}）</button></div>`;
  out += filterChips(classFilter, 'cf');
  const list = filterEnts(E.entities('Class'), classFilter).sort((a, b) => (a.tier || 0) - (b.tier || 0) || a.id.localeCompare(b.id));
  out += list.length ? list.map(entCard).join('') : `<p class="muted">没有。${classFilter === 'mine' ? '点「可加入」挑课堂。' : ''}</p>`;
  return out;
}

function viewAdv() {
  let out = filterChips(advFilter, 'af');
  for (const type of ['Course', 'Degree']) {
    const list = filterEnts(E.entities(type), advFilter);
    out += `<h3>${E.ENT_LABEL[type]}</h3>` + (list.length ? list.map(entCard).join('') : '<p class="muted small">没有</p>');
  }
  return out;
}

// —— 惩罚 ——

function viewPun() {
  const S = E.S;
  let out = '';
  const max = E.maxPunTier();
  out += `<p class="muted small">惩罚上限：${max ? E.PUN_TIER_LABEL[max] : '未开放（解锁中级课堂后才会有惩罚）'}。每项待做惩罚在完成课堂任务时扣学分。</p>`;
  if (!S.puns.length) out += `<p class="muted">没有待做的惩罚。</p>`;
  for (const p of S.puns) {
    const e = E.C.ent[p.ent];
    if (!e) { out += `<div class="card">已不存在的惩罚（${esc(p.ent)}）<button class="btn small" data-act="punDrop" data-p="${p.pid}">移除</button></div>`; continue; }
    const run = p.rid && E.runById(p.rid);
    out += `<div class="card">
      <div class="row between"><b>${esc(e.name)}</b><i class="pill warn">${E.PUN_TIER_LABEL[p.tier]}</i></div>
      <div class="muted small">${esc(p.why || '')}</div>
      ${run ? runCard(run) : E.topTasks(e.id).map(t => taskCard(E.view(e.id, t.id), { showEnt: false })).join('')}
      ${run ? '' : `<div class="row gap"><button class="btn small" data-act="punReroll" data-p="${p.pid}">重抽（${E.C.rules.punRerollCost[p.tier - 1]}）</button><button class="btn small ghost" data-act="punAbandon" data-p="${p.pid}">放弃（扣 ${E.C.rules.punAbandonCost[p.tier - 1]}）</button></div>`}
    </div>`;
  }
  if (max) out += `<div class="row gap"><button class="btn ghost" data-act="punSelf">自愿领一项</button></div>`;
  return out;
}

// —— 更多 ——

function viewMore() {
  if (more === 'menu') {
    const items = [['clubs', '社团'], ['items', '物品与服装'], ['inf', '医务室'], ['log', '记录'], ['settings', '设置'], ['data', '备份与内容包']];
    return items.map(([k, l]) => `<button class="card menu" data-act="more" data-k="${k}">${l}<span>›</span></button>`).join('') +
      `<p class="muted small center-t">进度簿 ${APP_VER}｜内容包 ${esc(E.C.version || '')}</p>`;
  }
  const back = `<button class="btn ghost small" data-act="more" data-k="menu">‹ 返回</button>`;
  if (more === 'clubs') return back + viewClubs();
  if (more === 'items') return back + viewItems();
  if (more === 'inf') return back + viewInf();
  if (more === 'log') return back + `<h3>记录</h3>` + E.S.log.slice(0, 300).map(l => `<div class="logline"><span class="muted small">${new Date(l.t).toLocaleString('zh-CN', { hour12: false })}</span> ${esc(l.msg)}</div>`).join('');
  if (more === 'settings') return back + viewSettings();
  if (more === 'data') return back + viewData();
  return '';
}

function perkText(m) {
  if (m.description) return E.render(m.description);
  const out = [];
  for (const f of m.effects || []) {
    if (f.type === 'inventory') out.push((f.operation === 'show' ? '解锁专属物品 ' : '隐藏物品 ') + (f.itemIds || []).length + ' 件');
    if (f.type === 'credits') out.push(f.operation === 'multiply' ? '学分 +' + Math.round(f.value * 100) + '%' : '每任务 +' + f.value + ' 学分');
    if (f.type === 'requirements') out.push('难度 +' + f.value + '%');
    if (f.type === 'audio') out.push('（音频，此版本不播放）');
  }
  if (m.task) out.push('附每日任务');
  return out.join('，') || '福利';
}

function viewClubs() {
  return `<h3>社团</h3>` + E.entities('Club').map(e => {
    const on = !!E.S.clubs[e.id];
    return `<div class="card">
      <div class="row between"><b>${esc(e.name)}</b><button class="btn small ${on ? 'ghost' : 'primary'}" data-act="${on ? 'leave' : 'join'}" data-id="${e.id}">${on ? '退出' : '加入'}</button></div>
      <div class="small">${esc(e.description || '')}</div>
      ${on ? Object.values(e.modifiers || {}).map(m => `<label class="toggle"><input type="checkbox" data-perk="${e.id}|${m.id}" ${E.S.clubs[e.id].perks?.[m.id] ? 'checked' : ''}><span>${perkText(m)}</span></label>`).join('') : ''}
      ${on ? Object.keys(e.tasks || {}).filter(t => E.S.clubs[e.id].perks?.[e.tasks[t].perkId]).map(t => taskCard(E.view(e.id, t), { showEnt: false })).join('') : ''}
    </div>`;
  }).join('');
}

function viewItems() {
  const vis = E.visibility();
  const st = E.outfitStats();
  const top = Math.max(0, ...Object.values(st));
  const rate = 1 + Math.floor(top / E.C.rules.outfitStep) * E.C.rules.outfitRate;
  let out = `<div class="card"><b>目前穿着</b>：${Object.entries(st).map(([k, v]) => `${esc(E.C.stats[k] || k)} ${v}`).join('，') || '无'}<div class="muted small">课堂学分加成 ×${rate}（看最高一项，每 ${E.C.rules.outfitStep} 点 +${E.C.rules.outfitRate * 100}%）</div></div>
    <p class="muted small">勾「有」＝你手上有这件；勾「穿」＝现在穿着／戴着。</p>`;
  const groups = {};
  for (const it of Object.values(E.C.items)) {
    if (!E.itemVisible(it.id, vis)) continue;
    const loc = (it.location || ['其他'])[0];
    (groups[loc] = groups[loc] || []).push(it);
  }
  for (const [loc, list] of Object.entries(groups)) {
    out += `<h3>${esc(E.C.locations[loc] || loc)}</h3>`;
    out += list.map(it => `<div class="card item">
      ${pic(it.id, 'r11 thumb')}
      <div class="grow"><b>${esc(it.name)}</b><div class="muted small">${esc(it.description || '')}</div>
      <div class="muted small">${Object.entries(it.stats || {}).map(([k, v]) => esc(E.C.stats[k] || k) + ' ' + v).join('，')}</div></div>
      <div class="col"><label><input type="checkbox" data-own="${it.id}" ${E.S.owned[it.id] ? 'checked' : ''}>有</label>
      <label><input type="checkbox" data-wear="${it.id}" ${E.S.wearing[it.id] ? 'checked' : ''} ${E.S.owned[it.id] ? '' : 'disabled'}>穿</label></div>
    </div>`).join('');
  }
  return out;
}

function viewInf() {
  const I = E.C.infirmary;
  const today = E.dayKey();
  const used = E.S.inf.day === today ? E.S.inf.uses : 0;
  return `<h3>医务室</h3>
    <div class="card"><div>护士今天：<b>${esc(I.moods[E.moodIndex()])}</b></div>
    <div class="muted small">完成任务会让心情变好，失败或放弃会变差。今天还能来 ${Math.max(0, E.C.rules.infirmaryPerDay - used)} 次。</div></div>
    ${I.requests.map(r => `<button class="btn wide" data-act="inf" data-k="${r.id}" ${used >= E.C.rules.infirmaryPerDay ? 'disabled' : ''}>${esc(r.label)}</button>`).join('')}
    <div id="infres"></div>`;
}

function viewSettings() {
  const s = E.S.settings;
  const tg = (k, label, note = '') => `<label class="toggle"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span>${label}${note ? `<br><span class="muted small">${note}</span>` : ''}</span></label>`;
  const selx = (k, label, opts) => `<label class="field"><span>${label}</span><select data-set="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  return `<h3>规则</h3>
    ${selx('mode', '同时进行', [['replica', '复刻版：主动任务一次一个，被动可叠，撞部位就挡'], ['original', '原版：同一门课的非并行任务不能同时做']])}
    ${tg('progressive', '渐进难度', '同一任务每做一次，难度 +20%')}
    <label class="field"><span>手动加难 ×<b id="manualv">${s.manual}</b></span><input type="range" min="1" max="2" step="0.1" value="${s.manual}" data-set="manual"></label>
    ${selx('schedule', '排课', [['free', '自由：哪天都能出席'], ['fixed', '固定：只能在排定的星期出席']])}
    ${tg('rollcallExempt', '点名豁免', '固定排课时，缺课不抽惩罚')}
    ${tg('strictItems', '道具检查从严', '关掉的话，缺道具只提示、不挡')}
    ${selx('preferVariant', '有多种玩法时默认', [['default_variant', '一般'], ['metronome_variant', '节拍器'], ['beattrack_variant', '节拍轨'], ['affirmations_variant', '暗示语']])}
    <h3>计时</h3>
    ${tg('timer', '持续任务要计时', '关掉就随时可按完成')}
    ${tg('autoComplete', '时间到自动完成')}
    ${tg('pauseLimit', '暂停超过 2 小时算失败')}
    ${selx('dayStartHour', '换日时间', [0, 1, 2, 3, 4, 5, 6].map(h => [h, h + ':00']))}
    ${tg('sound', '提示音')}${tg('vibrate', '震动')}${tg('wakeLock', '小游戏时屏幕常亮')}
    <button class="btn wide" data-act="notifPerm">开启系统通知（内容只写“计时到了”）</button>
    <p class="muted small">App 被系统关掉时不会提醒；回到 App 会自动补算。</p>
    <h3>称呼</h3>
    ${E.C.placeholders.map(p => `<label class="field"><span>${esc(p.label)}</span><input data-ph="${p.key}" value="${esc(s.ph[p.key] || '')}" placeholder="${esc(p.default || '')}"></label>`).join('')}
    <h3>隐私</h3>
    ${selx('lockMin', '离开多久后要重新输入 PIN', [[0, '马上'], [1, '1 分钟'], [5, '5 分钟'], [15, '15 分钟'], [60, '1 小时']])}
    <button class="btn wide" data-act="changePin">改 PIN</button>
    <h3>急救</h3>
    <button class="btn wide" data-act="clearRuns">清掉所有进行中（不罚）</button>
    <button class="btn wide" data-act="clearMods">清掉所有待配合条件</button>
    <button class="btn wide danger" data-act="wipe">全部清除（进度、内容、图片）</button>`;
}

function viewData() {
  const n = Object.keys(imgIdx).length;
  return `<h3>备份</h3>
    <p class="muted small">备份文件用你另设的口令加密。换手机或清掉浏览器资料前先备份。</p>
    <button class="btn wide primary" data-act="backup">导出备份</button>
    <h3>导入</h3>
    <p class="muted small">同一个按钮可导入：内容包（pack.bin）、图片包（images.bin）、备份。会自动认出种类。</p>
    <button class="btn wide" data-act="pick">选择 .bin 文件</button>
    <p class="muted small" id="impmsg"></p>
    <h3>图片</h3>
    <p>已存 ${n} 张（加密存在 App 里，相册与文件搜索看不到）。</p>
    ${n ? `<button class="btn wide ghost" data-act="clearImgs">删除全部图片</button>` : ''}`;
}

// —— 实体详情（叠层） ——

function viewEnt(id) {
  const e = E.C.ent[id];
  if (!e) return '<p>找不到</p>';
  const S = E.S;
  const btns = [];
  if (e.type === 'Punishment') { }
  else if (E.isMember(id)) {
    if (e.type === 'Class') btns.push(E.canAttend(id) ? `<button class="btn primary" data-act="attend" data-id="${id}">出席</button>` : `<span class="pill ok">${E.attendedToday(id) ? '今天已出席' : '今天不排课'}</span>`);
    if (E.canGraduate(id)) btns.push(`<button class="btn primary" data-act="graduate" data-id="${id}">结业</button>`);
    btns.push(`<button class="btn ghost" data-act="leave" data-id="${id}">退出${e.type === 'Class' ? '（扣 ' + E.C.rules.leaveCost[Math.max(1, e.tier || 1) - 1] + '）' : ''}</button>`);
    btns.push(`<button class="btn ghost" data-act="resetEnt" data-id="${id}">重置今天</button>`);
  } else if (E.graduated(id)) {
    btns.push(`<span class="pill ok">已结业 ${S.enrolled[id].grade || ''}</span>`);
  } else {
    const ok = E.tierOk(id) && E.prereqOk(id);
    btns.push(`<button class="btn primary" data-act="join" data-id="${id}" ${ok ? '' : 'disabled'}>加入</button>`);
    if (!E.tierOk(id)) btns.push(`<span class="muted small">要先解锁${E.TIER_LABEL[e.tier]}</span>`);
  }
  const pre = (e.prerequisites || []).filter(p => E.C.ent[p]);
  let info = '';
  if (e.type === 'Class') {
    const g = E.gradeInfo(id);
    info = `<div class="muted small">${E.TIER_LABEL[e.tier || 0]}｜每任务基础 ${E.va(e.tier)} 学分｜考试 ×${E.C.rules.examMult}${e.days?.length ? '｜排在周' + e.days.map(d => E.WEEK[d]).join('、') : ''}</div>
      ${E.isMember(id) ? `<div class="muted small">进度 ${g.done}／${g.total}，目前成绩 ${g.grade}。全部做完＝A；或做完考试即可结业。</div>` : ''}`;
  }
  if (e.type === 'Course' || e.type === 'Degree') info = `<div class="muted small">开始任务要付 ${E.startCost({ entType: e.type })} 学分；做完任一主任务即可结业。</div>`;
  const tops = E.topTasks(id);
  const tasks = tops.map(t => {
    const v = E.view(id, t.id);
    let html = taskCard(v, { showEnt: false });
    if (v.type === 'COMPOSITE_TASK') {
      const kids = E.childTasks(id, t.id);
      html += `<div class="kids">${kids.map(k => taskCard(E.view(id, k.id), { showEnt: false })).join('')}</div>`;
    }
    return html;
  }).join('');
  return `<div class="ent-head">${pic(id, 'r34 hero')}
      <div class="grow"><h2>${esc(e.name)}</h2>
      <div class="muted small">${E.ENT_LABEL[e.type]}${(e.tags || []).length ? '｜' + e.tags.map(t => esc(E.C.tags[t] || t)).join('、') : ''}</div>
      ${info}</div></div>
    <p>${esc(e.description || '')}</p>
    ${pre.length ? `<div class="small">先修：${pre.map(p => `<span class="pill ${E.graduated(p) ? 'ok' : ''}">${esc(E.C.ent[p].name)}</span>`).join(' ')}</div>` : ''}
    <div class="row gap wrap">${btns.join('')}</div>
    <h3>任务</h3>${tasks || '<p class="muted">没有任务</p>'}`;
}

// ———————————————— 绘制 ————————————————

function render() {
  const m = $('#main');
  if (m) scrollMem[tab + more] = m.scrollTop;
  let html = '';
  if (screen === 'lock') html = viewLock();
  else if (screen === 'setup') html = viewSetup();
  else if (screen === 'import') html = viewImport();
  else if (screen === 'ask') html = viewAsk();
  else if (screen === 'app') html = viewApp();
  app().innerHTML = html;
  app().className = screen === 'app' ? 'shell' : '';
  const m2 = $('#main');
  if (m2) m2.scrollTop = scrollMem[tab + more] || 0;
  renderSheet();
  hydrateImages();
  const pin = $('#pin') || $('#pin1');
  if (pin) pin.focus();
}

function renderSheet() {
  let sh = $('#sheet');
  if (!sheets.length || screen !== 'app') { if (sh) sh.remove(); return; }
  if (!sh) { sh = document.createElement('div'); sh.id = 'sheet'; document.body.appendChild(sh); }
  const top = sheets[sheets.length - 1];
  const keep = sh.querySelector('.sheet-body')?.scrollTop || 0;
  sh.innerHTML = `<div class="sheet-bar"><button class="btn ghost small" data-act="back">‹ 返回</button><span class="muted small">${sheets.length > 1 ? sheets.length + ' 层' : ''}</span><span>${E.S.credits} 学分</span></div>
    <div class="sheet-body">${top.kind === 'ent' ? viewEnt(top.id) : ''}</div>`;
  sh.querySelector('.sheet-body').scrollTop = keep;
  hydrateImages(sh);
}

function openSheet(s) { sheets.push(s); history.pushState({ sh: sheets.length }, ''); renderSheet(); }
window.addEventListener('popstate', () => {
  if ($('#game')) { closeGame(); return; }
  if (sheets.length) { sheets.pop(); renderSheet(); }
});

function refresh() { save(); render(); }

// ———————————————— 小游戏 ————————————————

async function showGame(rid) {
  const r = E.runById(rid);
  if (!r?.game) return;
  const g = document.createElement('div');
  g.id = 'game';
  document.body.appendChild(g);
  history.pushState({ game: 1 }, '');
  if (E.S.settings.wakeLock && navigator.wakeLock) { try { wake = await navigator.wakeLock.request('screen'); } catch {} }
  gameStop = openGame(r.game, g, {
    sound: E.S.settings.sound, vibrate: E.S.settings.vibrate, commands: E.C.commands,
    onDone: () => {
      r.gameDone = true;
      closeGame(true);
      finishRun(rid);
    },
    onClose: () => closeGame(true)
  });
}
function closeGame(viaUi = false) {
  if (gameStop) gameStop();
  gameStop = null;
  $('#game')?.remove();
  if (wake) { wake.release().catch(() => {}); wake = null; }
  if (viaUi && history.state?.game) history.back();
}

// ———————————————— 动作 ————————————————

function finishRun(rid, force = false) {
  const r = E.runById(rid);
  const res = E.complete(rid, { force });
  if (res?.ok) {
    E.infMood(3);
    toast('完成' + (res.credits ? '，+' + res.credits + ' 学分' : ''));
    vib(60);
  } else if (res?.why) toast(res.why);
  refresh();
}

async function startTask(v) {
  const mm = E.matchingMods(v);
  if (mm.length && !(await confirmBox(`这个任务会一并执行：<br><b>${mm.map(m => m.text).join('<br>')}</b>`, '开始'))) return;
  const cost = E.startCost(v);
  if (cost && !(await confirmBox(`开始要付 ${cost} 学分。`, '付并开始'))) return;
  const res = E.start(v);
  if (!res.ok) { toast(res.why?.join('；') || '不能开始'); return; }
  sel.clear();
  refresh();
  if (res.run.game) showGame(res.run.rid);
}

const ACT = {
  async unlock() {
    const pin = $('#pin').value;
    $('#pinmsg').textContent = '解锁中…';
    if (!(await Vt.unlock(pin))) { $('#pinmsg').textContent = 'PIN 不对'; $('#pin').value = ''; vib(200); return; }
    await loadAll(); render();
  },
  async setup() {
    const a = $('#pin1').value, b = $('#pin2').value;
    if (a.length < 4) { $('#pinmsg').textContent = '至少 4 位'; return; }
    if (a !== b) { $('#pinmsg').textContent = '两次不一样'; return; }
    $('#pinmsg').textContent = '设定中…';
    await Vt.setup(a);
    E.useState(null);
    await Vt.putJSON('state', E.S);
    screen = 'import'; render();
  },
  pick() { $('#file').value = ''; $('#file').click(); },
  lock() { doLock(); },
  tab(d) { tab = d.k; if (tab !== 'more') more = 'menu'; sel.clear(); render(); },
  more(d) { more = d.k; render(); },
  cf(d) { classFilter = d.k; render(); },
  af(d) { advFilter = d.k; render(); },
  back() { history.back(); },
  ent(d) { openSheet({ kind: 'ent', id: d.id }); },
  modMatch() { showModMatch = !showModMatch; render(); },
  checkin(d) { E.checkin(d.k === 'chastity' ? 'chastity' : 'normal'); refresh(); },
  attend(d) { E.attend(d.id); toast('已出席：' + E.C.ent[d.id].name); refresh(); },
  async join(d) {
    const r = E.join(d.id);
    if (!r.ok) toast(r.why); else toast('已加入');
    refresh();
  },
  async leave(d) {
    const e = E.C.ent[d.id];
    if (!(await confirmBox(`退出「${esc(e.name)}」？进行中的任务会取消（不罚）。`, '退出', 'danger'))) return;
    const r = E.leave(d.id);
    if (!r.ok) toast(r.why);
    refresh();
  },
  async graduate(d) {
    const r = E.graduate(d.id);
    if (r.ok) toast('结业' + (r.grade ? '，成绩 ' + r.grade : '') + (r.bonus ? '，+' + r.bonus + ' 学分' : ''));
    refresh();
  },
  async resetEnt(d) {
    if (!(await confirmBox('清掉这门今天的进行中任务与出席（不罚），累计完成次数保留。用于卡住时。', '重置'))) return;
    E.resetEntity(d.id); refresh();
  },
  async unlockTier() {
    const next = E.S.tier + 1;
    if (!(await confirmBox(`花 ${E.C.rules.tierUnlockCost[next]} 学分解锁${E.TIER_LABEL[next]}课堂？解锁后惩罚上限也会提高。`, '解锁'))) return;
    const r = E.unlockTier(); if (!r.ok) toast(r.why); refresh();
  },
  start(d) { const v = E.view(d.e, d.t, d.v); if (v) startTask(v); },
  variant(d, el) {
    const card = el.closest('.card');
    const sb = card.querySelector('[data-act="start"]') || card.querySelector('[data-sel]');
    const eid = sb?.dataset.e, tid = sb?.dataset.t;
    if (!eid) { E.S.settings.preferVariant = d.k; refresh(); return; }
    const v = E.view(eid, tid, d.k);
    card.outerHTML = taskCard(v, { showEnt: !card.closest('#sheet'), compact: !card.closest('#sheet') });
  },
  skipU(d) { E.skipUnsupported(E.view(d.e, d.t)); refresh(); },
  game(d) { showGame(d.r); },
  done(d) { finishRun(d.r); },
  pause(d) { E.pause(d.r); refresh(); },
  resume(d) { E.resume(d.r); refresh(); },
  async runMenu(d) {
    const r = E.runById(d.r);
    if (!r) return;
    const pun = r.entType === 'Punishment';
    const failNote = pun ? `扣 ${E.C.rules.punAbandonCost[(E.C.ent[r.eid]?.tier || 1) - 1]} 学分` : (r.entType === 'Club' || r.parentRid ? '不罚' : '抽 1 项惩罚');
    const { value } = await dialog({
      title: r.short,
      buttons: [
        { label: `放弃（${failNote}）`, value: 'fail', cls: 'danger' },
        { label: '放弃（不罚，用于卡住）', value: 'free' },
        { label: '强制完成', value: 'force' },
        { label: '取消', value: null }
      ]
    });
    if (value === 'fail') { E.fail(d.r); E.infMood(-10); }
    if (value === 'free') E.fail(d.r, { noPenalty: true, reason: '手动' });
    if (value === 'force') { finishRun(d.r, true); return; }
    refresh();
  },
  async startSel() {
    const vs = [...sel.values()];
    sel.clear();
    const bad = [];
    for (const v of vs) {
      const res = E.start(v);
      if (!res.ok) bad.push(E.stripTags(E.renderView(v).text).slice(0, 12) + '：' + res.why.join('，'));
    }
    if (bad.length) toast('没开始：' + bad.join('；'), 5000);
    else toast('已开始 ' + vs.length + ' 项');
    refresh();
    const g = E.S.runs.find(r => r.game && !r.gameDone && vs.some(v => v.key === r.key));
    if (g) showGame(g.rid);
  },
  clearSel() { sel.clear(); render(); },
  punReroll(d) { const r = E.rerollPunishment(d.p); if (r && !r.ok) toast(r.why); refresh(); },
  async punAbandon(d) { if (await confirmBox('放弃这项惩罚？会扣学分。', '放弃', 'danger')) { E.abandonPunishment(d.p); E.infMood(-10); refresh(); } },
  punDrop(d) { E.abandonPunishment(d.p, true); refresh(); },
  async punSelf() { if (await confirmBox('自愿领一项随机惩罚？')) { E.rollPunishments(1, null, [], '自愿'); refresh(); } },
  inf(d) {
    const r = E.infirmary(d.k);
    if (!r.ok) { toast(r.why); return; }
    refresh();
    const box = $('#infres');
    if (box) box.innerHTML = `<div class="card big-t">${esc(r.granted ? E.C.infirmary.grant : E.C.infirmary.deny)}</div>`;
  },
  async notifPerm() {
    if (!('Notification' in window)) { toast('这个浏览器不支持通知'); return; }
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? '已开启' : '没有开启');
  },
  async changePin() {
    const { value, data } = await dialog({ title: '改 PIN', fields: [{ label: '旧 PIN', type: 'password', inputmode: 'numeric' }, { label: '新 PIN（至少 4 位）', type: 'password', inputmode: 'numeric' }, { label: '再输入一次', type: 'password', inputmode: 'numeric' }] });
    if (!value) return;
    if (data[1].length < 4 || data[1] !== data[2]) { toast('新 PIN 不符'); return; }
    toast((await Vt.changePin(data[0], data[1])) ? '已改' : '旧 PIN 不对');
  },
  async clearRuns() {
    if (!(await confirmBox('所有进行中的任务都取消，不罚、退回费用。', '清掉', 'danger'))) return;
    for (const r of [...E.S.runs]) if (E.runById(r.rid)) E.fail(r.rid, { noPenalty: true, reason: '急救' });
    refresh();
  },
  async clearMods() {
    if (!(await confirmBox('清掉所有等着配合的条件？', '清掉', 'danger'))) return;
    E.S.mods = []; E.log('急救：清掉所有待配合条件'); refresh();
  },
  async wipe() {
    if (!(await confirmBox('<b>全部清除</b>：进度、内容包、图片都会删掉，没有备份就救不回。', '全部清除', 'danger'))) return;
    const { value, data } = await dialog({ title: '再确认一次', fields: [{ label: '输入「清除」两字' }] });
    if (!value || data[0] !== '清除') return;
    dropImageUrls(); await Vt.wipeAll(); location.reload();
  },
  async backup() {
    const { value, data } = await dialog({ title: '备份口令', html: '<span class="muted small">导入备份时要用；可以和 PIN 不同。</span>', fields: [{ label: '口令', type: 'password' }, { label: '再输入一次', type: 'password' }] });
    if (!value) return;
    if (!data[0] || data[0] !== data[1]) { toast('口令不符'); return; }
    const bytes = await Vt.makeFile({ kind: 'backup', ver: APP_VER, at: Date.now(), state: E.exportState() }, data[0]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = 'pb-' + E.dayKey().replace(/-/g, '') + '.bin';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已导出');
  },
  async clearImgs() {
    if (!(await confirmBox('删除全部图片？', '删除', 'danger'))) return;
    for (const id of Object.keys(imgIdx)) await Vt.blobDelete('img:' + id);
    imgIdx = {}; await Vt.putJSON('imgidx', imgIdx); dropImageUrls(); render();
  },
  async askDone() {
    readPh();
    E.S.onboarded = true;
    screen = 'app'; tab = 'more'; more = 'items';
    refresh();
    toast('先在这里勾选你有的物品，之后随时可改');
  }
};

function readPh() {
  for (const i of document.querySelectorAll('[data-ph]')) {
    const v = i.value.trim();
    if (v) E.S.settings.ph[i.dataset.ph] = v; else delete E.S.settings.ph[i.dataset.ph];
  }
}

async function importFile(file) {
  const msg = t => { const m = $('#impmsg'); if (m) m.textContent = t; };
  const { value, data } = await dialog({ title: '输入口令', fields: [{ label: '打包／备份时设的口令', type: 'password' }] });
  if (!value) return;
  msg('解密中…');
  let res;
  try { res = await Vt.openFile(await file.arrayBuffer(), data[0]); }
  catch (err) { msg(err.message); toast(err.message); return; }
  const h = res.header;
  if (h.kind === 'backup') {
    if (E.C && !(await confirmBox('用这份备份<b>取代</b>目前的进度？', '取代', 'danger'))) { msg(''); return; }
    E.useState(h.state);
    await save(true);
  } else if (h.kind === 'pack' || h.kind === 'images') {
    if (h.kind === 'pack') {
      h.data.version = h.version;
      await Vt.putJSON('content', h.data);
      E.loadContent(h.data);
    }
    let n = 0;
    for (const f of res.files) {
      msg(`存图片 ${++n}／${res.files.length}…`);
      await Vt.putBytes('img:' + f.name, f.bytes);
      imgIdx[f.name] = f.type;
    }
    await Vt.putJSON('imgidx', imgIdx);
    dropImageUrls();
    toast(h.kind === 'pack' ? `内容包已导入（${h.data.entities.length} 项，图片 ${res.files.length} 张）` : `图片已导入 ${res.files.length} 张`);
  } else { msg('不认识的文件'); return; }
  msg('');
  if (screen === 'import') {
    if (!E.C) { msg('请先导入内容包'); return; }
    screen = E.S.onboarded ? 'app' : 'ask';
  }
  refresh();
}

function doLock() {
  save(true);
  closeGame();
  sheets = []; sel.clear();
  dropImageUrls();
  Vt.lock();
  screen = 'lock';
  render();
}

// ———————————————— 事件 ————————————————

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const f = ACT[a.dataset.act];
  if (f) { e.preventDefault(); f(a.dataset, a, e); }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (!E.S) return;
  if (t.id === 'file') { const f = t.files[0]; t.value = ''; if (f) importFile(f); return; }
  if (t.dataset.sel) {
    const v = E.view(t.dataset.e, t.dataset.t, t.dataset.v);
    if (t.checked) sel.set(t.dataset.sel, v); else sel.delete(t.dataset.sel);
    render(); return;
  }
  if (t.dataset.own) { E.S.owned[t.dataset.own] = t.checked; if (!t.checked) delete E.S.wearing[t.dataset.own]; refresh(); return; }
  if (t.dataset.wear) { E.S.wearing[t.dataset.wear] = t.checked; refresh(); return; }
  if (t.dataset.perk) { const [c, m] = t.dataset.perk.split('|'); E.togglePerk(c, m, t.checked); refresh(); return; }
  if (t.dataset.ph && screen === 'app') { readPh(); save(); return; }
  if (t.dataset.set) {
    const k = t.dataset.set;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (['manual'].includes(k)) v = parseFloat(v);
    if (['dayStartHour', 'lockMin'].includes(k)) v = parseInt(v);
    E.S.settings[k] = v;
    refresh();
  }
});
document.addEventListener('input', e => { if (e.target.dataset.set === 'manual') { const b = $('#manualv'); if (b) b.textContent = e.target.value; } });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'pin') ACT.unlock();
  if (e.target.id === 'pin2') ACT.setup();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    document.body.classList.add('veil');
    save(true);
  } else {
    document.body.classList.remove('veil');
    if (Vt.unlocked() && screen !== 'lock' && E.S && Date.now() - hiddenAt >= (E.S.settings.lockMin || 0) * 60e3 && hiddenAt) doLock();
    else if (screen === 'app') { E.tick(); refresh(); }
  }
});

// 每秒：更新计时、检查到时
setInterval(() => {
  if (screen !== 'app' || !Vt.unlocked()) return;
  const before = JSON.stringify(E.S.runs.map(r => [r.rid, r.notified]));
  const ev = E.tick();
  const after = JSON.stringify(E.S.runs.map(r => [r.rid, r.notified]));
  if (ev.length || before !== after) { refresh(); return; }
  for (const n of document.querySelectorAll('[data-timer]')) {
    const r = E.runById(n.dataset.timer); if (!r) continue;
    const rem = E.remaining(r);
    if (r.type === 'DURATION_TASK') { n.textContent = rem > 0 ? E.fmtClock(rem) : '时间到'; }
    else n.textContent = E.fmtClock(rem);
    n.classList.toggle('due', r.type === 'DURATION_TASK' ? rem <= 0 : rem < 0);
    if (r.type === 'DURATION_TASK' && rem <= 0 && !n.dataset.ref) { n.dataset.ref = 1; refresh(); return; }
  }
  for (const n of document.querySelectorAll('[data-elapsed]')) { const r = E.runById(n.dataset.elapsed); if (r) n.textContent = E.fmtClock(E.elapsed(r)); }
}, 1000);

// ———————————————— 图标 ————————————————

function logoSvg() { return `<svg viewBox="0 0 64 64" width="72" height="72"><rect x="10" y="6" width="44" height="52" rx="6" fill="var(--acc)"/><rect x="18" y="16" width="28" height="4" rx="2" fill="var(--bg)"/><rect x="18" y="26" width="20" height="4" rx="2" fill="var(--bg)"/><rect x="18" y="36" width="24" height="4" rx="2" fill="var(--bg)"/></svg>`; }
function lockSvg() { return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`; }

// ———————————————— 启动 ————————————————

export async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('有新版本，下次打开生效', 4000); });
      });
    }).catch(() => {});
  }
  screen = (await Vt.isSetUp()) ? 'lock' : 'setup';
  render();
}
