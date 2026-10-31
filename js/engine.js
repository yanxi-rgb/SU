// 规则引擎：只处理数据与状态，不碰画面。
// C = 内容包（导入后建立索引），S = 进度存档。

export const STATE_VERSION = 1;
export let C = null;
export let S = null;
let onLog = () => {};
let onNotify = () => {};

const VARIANTS = ['default_variant', 'metronome_variant', 'beattrack_variant', 'affirmations_variant'];
const VARIANT_LABEL = {
  default_variant: '一般', metronome_variant: '节拍器', beattrack_variant: '节拍轨', affirmations_variant: '暗示语', _: '一般'
};
export const TYPE_LABEL = {
  INSTANT_TASK: '即时', DURATION_TASK: '持续', TIMED_TASK: '限时', COMPOSITE_TASK: '组合',
  MODIFIER_TASK: '附加条件', METRONOME_MINIGAME_TASK: '节拍器', BEATTRACK_MINIGAME_TASK: '节拍轨',
  AFFIRMATIONS_TASK: '暗示语', OBEDIENCE_MINIGAME_TASK: '服从口令', ESTIM_TASK: '电刺激'
};
export const ENT_LABEL = { Class: '课堂', Course: '课程', Degree: '学位', Club: '社团', Punishment: '惩罚' };
export const TIER_LABEL = ['特别', '初级', '中级', '高级', '专家'];
export const PUN_TIER_LABEL = ['', '轻度', '中度', '重度'];
const MINIGAMES = new Set(['METRONOME_MINIGAME_TASK', 'BEATTRACK_MINIGAME_TASK', 'AFFIRMATIONS_TASK', 'OBEDIENCE_MINIGAME_TASK']);

export function hooks(h) { onLog = h.log || onLog; onNotify = h.notify || onNotify; }

// ———————————————— 内容包索引 ————————————————

export function loadContent(data) {
  const ent = {}, items = {}, series = {};
  for (const i of data.items) items[i.id] = i;
  for (const e of data.entities) {
    ent[e.id] = e;
    if (e.type === 'Club' && e.modifiers) {
      // 社团福利自带的每日任务，变成社团的任务
      e.tasks = e.tasks && !Array.isArray(e.tasks) ? e.tasks : {};
      for (const m of Object.values(e.modifiers)) {
        if (m.task) e.tasks['p' + m.id] = { ...m.task, id: 'p' + m.id, perkId: m.id };
      }
    }
    if (e.type === 'Class') {
      const s = e.id.replace(/\d+$/, '');
      (series[s] = series[s] || []).push(e.id);
    }
  }
  for (const k in series) series[k].sort((a, b) => (ent[a].tier || 0) - (ent[b].tier || 0));
  C = { ...data, ent, items, series, rules: data.rules };
  return C;
}

export const entities = type => Object.values(C.ent).filter(e => e.type === type);
export const taskOf = (eid, tid) => C.ent[eid]?.tasks?.[tid];
const numId = x => { const n = parseFloat(x); return isNaN(n) ? 1e9 : n; };
export function topTasks(eid) {
  const ts = C.ent[eid]?.tasks || {};
  return Object.values(ts).filter(t => !t.parentId).sort((a, b) => numId(a.id) - numId(b.id));
}
export function childTasks(eid, pid) {
  const ts = C.ent[eid]?.tasks || {};
  return Object.values(ts).filter(t => t.parentId === pid).sort((a, b) => numId(a.id) - numId(b.id));
}

// ———————————————— 存档 ————————————————

export function newState() {
  return {
    v: STATE_VERSION,
    settings: {
      ph: {}, mode: 'replica', progressive: true, manual: 1.0, schedule: 'free',
      timer: true, autoComplete: false, pauseLimit: false, dayStartHour: 0, lockMin: 5, strictItems: true,
      onlyDoable: false, sound: true, vibrate: true, preferVariant: 'default_variant', wakeLock: true, affLang: 'zh'
    },
    credits: 0, tier: 1, owned: {}, wearing: {},
    enrolled: {}, clubs: {}, done: {}, runs: [], mods: [], puns: [],
    checkin: { day: null, streak: 0 }, chastity: { day: null, streak: 0 },
    inf: { day: null, uses: 0, mood: 0 },
    day: null, seq: 1, log: [], onboarded: false, graduations: []
  };
}

export function useState(st) {
  S = migrate(st || newState());
  return S;
}

function migrate(st) {
  const base = newState();
  st.settings = { ...base.settings, ...(st.settings || {}) };
  for (const k in base) if (!(k in st)) st[k] = base[k];
  st.v = STATE_VERSION;
  // 内容包更新后，指向已不存在任务的运行记录照样保留（快照里有全文），不会卡死
  return st;
}

const uid = p => p + (S.seq++);
export function log(msg) {
  S.log.unshift({ t: Date.now(), msg });
  if (S.log.length > 500) S.log.length = 500;
  onLog(msg);
}

// ———————————————— 日期 ————————————————

export function dayKey(t = Date.now()) {
  const d = new Date(t - (S.settings.dayStartHour || 0) * 3600e3);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const weekday = k => { const w = new Date(k + 'T12:00:00').getDay(); return w === 0 ? 7 : w; };
export const WEEK = ['', '一', '二', '三', '四', '五', '六', '日'];
const yesterday = k => { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() - 1); return dayKey(d.getTime() + (S.settings.dayStartHour || 0) * 3600e3); };

// ———————————————— 数值工具 ————————————————

const R = () => C.rules;
export const va = tier => R().va[Math.min(Math.max(tier || 1, 1), 5) - 1];
export const q25 = x => Math.round(x * 4) / 4;

export function parseDur(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([smhd])$/);
  if (!m) return null;
  return { n: parseFloat(m[1]), unit: m[2], sec: parseFloat(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] };
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const out = [];
  if (d) out.push(d + ' 天');
  if (h) out.push(h + ' 小时');
  if (m) out.push(m + ' 分钟');
  if (s && !d && !h) out.push(s + ' 秒');
  return out.join(' ') || '0 秒';
}

export function fmtClock(sec) {
  const neg = sec < 0; sec = Math.abs(Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return (neg ? '+' : '') + (h ? h + ':' + p(m) : m) + ':' + p(s);
}

function roundBy(x, r) {
  if (r === 'up') return Math.ceil(x - 1e-9);
  if (r === 'down') return Math.floor(x + 1e-9);
  if (r === true) return Math.round(x);
  return Math.round(x * 2) / 2;
}

// ———————————————— 任务视图 ————————————————

export function variantsOf(t) {
  const v = t?.variants;
  if (!v || !Object.keys(v).length) return ['_'];
  return VARIANTS.filter(k => v[k]);
}
export const variantLabel = k => VARIANT_LABEL[k] || k;

export function view(eid, tid, vk) {
  const e = C.ent[eid], t = e?.tasks?.[tid];
  if (!t) return null;
  const vs = variantsOf(t);
  if (!vk || !vs.includes(vk)) vk = vs.includes(S.settings.preferVariant) ? S.settings.preferVariant : vs[0];
  const v = vk === '_' ? {} : t.variants[vk];
  const pick = k => (v[k] !== undefined ? v[k] : t[k]);
  const type = pick('type') || (t.variants ? 'DURATION_TASK' : 'INSTANT_TASK');
  return {
    eid, tid, key: eid + ':' + tid, vk, variants: vs, e, t, entType: e.type,
    type, title: pick('title') || '', description: pick('description') || '', comment: pick('comment') || '',
    params: pick('params') || {}, requiredItems: pick('requiredItems') || [], requiredStats: t.requiredStats,
    tags: [...new Set([...(t.tags || []), ...(v.tags || []), ...(e.tags || [])])],
    activity: t.activityType || 'active', parts: t.parts || [], isParallel: !!t.isParallel,
    tier: t.tier || 1, isExam: e.type === 'Class' && t.tier === 2,
    metronome: pick('metronomeConfig'), beat: pick('beatTrackConfig'), aff: pick('affirmationsConfig'),
    obed: pick('obedienceConfig'), tasksConfig: pick('tasksConfig'),
    modifiers: t.modifiers, roll: t.roll, parentId: t.parentId, perkId: t.perkId,
    noGrade: (t.noBonus || []).includes('GRADE')
  };
}

// ———————————————— 难度 ————————————————

function activePerkMods() {
  const out = [];
  for (const [cid, c] of Object.entries(S.clubs)) {
    const e = C.ent[cid];
    if (!e?.modifiers) continue;
    for (const m of Object.values(e.modifiers)) if (c.perks?.[m.id]) out.push(m);
  }
  return out;
}

export function difficulty(V) {
  let base = 1;
  const effects = [
    ...activePerkMods().flatMap(m => m.effects || []),
    ...S.mods.filter(m => m.usesLeft > 0 && m.kind === 'requirements').flatMap(m => m.effects)
  ];
  for (const f of effects) {
    if (f.type === 'requirements' && f.operation === 'increase' && (!f.activityType || f.activityType === V.activity)) base += (f.value || 0) / 100;
  }
  if (S.settings.progressive) base += R().progressiveStep * (S.done[V.key]?.count || 0);
  return Math.round(base * (S.settings.manual || 1) * 100) / 100;
}

export function applyParams(params, mult) {
  const out = {};
  for (const [name, p] of Object.entries(params || {})) {
    const raw = p.value;
    const d = parseDur(raw);
    let n = d ? d.n : (typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? parseFloat(raw) : null));
    if (n === null) { out[name] = { text: Array.isArray(raw) ? raw.join('、') : String(raw ?? '') }; continue; }
    if (p.affected) n = n * mult;
    else if (p.affectedInversely) n = n / mult;
    n = roundBy(n, p.rounded);
    if (d) {
      const sec = n * { s: 1, m: 60, h: 3600, d: 86400 }[d.unit];
      out[name] = { sec, text: fmtDur(sec), dur: true };
    } else out[name] = { num: n, text: String(n) };
  }
  return out;
}

export function durationOf(P) {
  let s = 0;
  for (const [k, p] of Object.entries(P)) if (/duration/i.test(k) && p.sec) s += p.sec;
  return s;
}

// ———————————————— 文字代入 ————————————————

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function safeHtml(s) {
  return esc(s).replace(/&lt;(\/?)(b|i|br)\s*\/?&gt;/g, '<$1$2>');
}

export function phValue(key) {
  key = C.aliases?.[key] || key;
  const v = S.settings.ph[key];
  if (v) return v;
  const d = C.placeholders.find(p => p.key === key);
  return d ? (d.default || d.label) : key;
}

export function render(str, P = {}, mult = 1, V = null) {
  if (!str) return '';
  let s = safeHtml(str);
  s = s.replace(/\$URL=\S+/g, '').replace(/\$BR/g, '<br>');
  // 力度词
  const shift = Math.max(0, Math.floor((mult - 1) / 0.5 + 1e-9));
  s = s.replace(/\$(very_light|light|medium|hard|very_hard)\b/g, (_, k) => {
    const i = Math.min(C.powerKeys.indexOf(k) + shift, C.powerWords.length - 1);
    return '<b>' + C.powerWords[i] + '</b>';
  });
  // 参数（长名先换）
  const names = Object.keys(P).sort((a, b) => b.length - a.length);
  for (const n of names) {
    s = s.replace(new RegExp('\\$' + n + '(?![A-Za-z_0-9])', 'g'), P[n].text);
  }
  // 原数据漏给参数的时长
  s = s.replace(/\$duration(_\d+)?(?![A-Za-z_0-9])/g, '一段时间');
  // 服装门槛
  const rs = V?.requiredStats;
  if (rs && !Array.isArray(rs)) for (const [k, v] of Object.entries(rs)) s = s.replace(new RegExp('\\$' + k + '\\$?', 'g'), String(v));
  s = s.replace(/\$BODY_LEVEL_NUMBER/g, P.targetLevel?.text || '').replace(/\$BODY_TARGET\w*\$?/g, C.bodyTargetText || '');
  // 玩家称谓等
  s = s.replace(/\$([A-Z][A-Z_]+[A-Z])/g, (m, k) => (C.placeholders.some(p => p.key === (C.aliases?.[k] || k)) ? esc(phValue(k)) : m));
  s = s.replace(/\[([A-Z]+)\]/g, (m, k) => (C.aliases?.[k] ? esc(phValue(k)) : m));
  return s;
}

export function renderView(V, mult = difficulty(V)) {
  const P = applyParams(V.params, mult);
  return {
    P, mult,
    title: render(V.title, P, mult, V),
    text: render(V.description, P, mult, V),
    comment: render(V.comment, P, mult, V),
    durSec: durationOf(P)
  };
}

// ———————————————— 道具与服装 ————————————————

export function visibility() {
  const hide = new Set(), show = new Set();
  for (const m of activePerkMods()) for (const f of m.effects || []) {
    if (f.type !== 'inventory') continue;
    for (const id of f.itemIds || []) (f.operation === 'hide' ? hide : show).add(id);
  }
  return { hide, show };
}
export function itemVisible(id, vis = visibility()) {
  const it = C.items[id];
  if (!it) return false;
  if (vis.hide.has(id)) return false;
  if (it.isClubExclusive) return vis.show.has(id);
  return true;
}
const hasItem = (id, vis) => !!S.owned[id] && itemVisible(id, vis);

export function itemsCheck(reqs) {
  if (!reqs?.length) return { ok: true, missing: [] };
  const vis = visibility();
  const checkGroup = r => {
    if (r.honor || r.type === 'OPTIONAL') return true;
    if (r.type === 'ALL') return r.itemIds.every(id => hasItem(id, vis));
    return r.itemIds.some(id => hasItem(id, vis));
  };
  const branches = {};
  const plain = [];
  for (const r of reqs) (r.branchId ? (branches[r.branchId] = branches[r.branchId] || []) : plain).push(r);
  const missing = [];
  for (const r of plain) if (!checkGroup(r)) missing.push(r);
  const bk = Object.keys(branches);
  if (bk.length && !bk.some(b => branches[b].every(checkGroup))) missing.push(...branches[bk[0]].filter(r => !checkGroup(r)));
  return { ok: !missing.length, missing };
}

export function reqText(r) {
  const names = r.itemIds.filter(id => itemVisible(id)).map(id => C.items[id]?.name || id);
  const all = names.length ? names : r.itemIds.map(id => C.items[id]?.name || id);
  if (r.honor) return '（相关衣物，凭诚信）';
  if (r.type === 'ALL') return all.join(' ＋ ');
  if (r.type === 'OPTIONAL') return '可选：' + all.join('／');
  return all.length > 1 ? all.join('／') + '（任一）' : all[0] || '';
}

export function outfitStats() {
  const vis = visibility();
  const st = {};
  let legs = 0, dildoMax = 0;
  for (const id of Object.keys(S.wearing)) {
    if (!S.wearing[id] || !hasItem(id, vis)) continue;
    const it = C.items[id];
    if ((it.slots || []).some(s => s.startsWith('LEGS'))) legs++;
    if ((it.slots || []).includes('DILDO')) { dildoMax = Math.max(dildoMax, it.stats?.STIMULATION || 0); continue; }
    for (const [k, v] of Object.entries(it.stats || {})) st[k] = (st[k] || 0) + v;
  }
  if (dildoMax) st.STIMULATION = (st.STIMULATION || 0) + dildoMax;
  if (legs > 1) for (const k in st) st[k] = Math.round(st[k] * 0.75);
  return st;
}

export function statsCheck(rs) {
  if (!rs) return { ok: true, need: [] };
  const st = outfitStats();
  const need = [];
  if (Array.isArray(rs)) {
    for (const r of rs) if (r.anyStatMin && Math.max(0, ...Object.values(st)) < r.anyStatMin) need.push('任一服装数值 ≥ ' + r.anyStatMin);
  } else {
    for (const [k, v] of Object.entries(rs)) if ((st[k] || 0) < v) need.push((C.stats[k] || k) + ' ≥ ' + v);
  }
  return { ok: !need.length, need };
}

// ———————————————— 学分 ————————————————

function checkinPct(c) {
  const today = dayKey();
  if (c.day !== today && c.day !== yesterday(today)) return 0;
  return Math.min(c.streak, R().checkinCap);
}

export function pendingPenalty() {
  return S.puns.filter(p => !p.rid).reduce((a, p) => a + (R().punPendingPenalty[(p.tier || 1) - 1] || 0), 0);
}

export function creditsFor(V) {
  if (V.entType !== 'Class' || V.parentId) return { final: 0 };
  const tier = V.e.tier || 1;
  const base = V.isExam ? va(tier) * R().examMult : va(tier);
  const st = outfitStats();
  const top = Math.max(0, ...Object.values(st));
  const rate = 1 + Math.floor(top / R().outfitStep) * R().outfitRate;
  const outfit = base * (rate - 1);
  let flat = 0, mrate = 0;
  for (const m of activePerkMods()) for (const f of m.effects || []) {
    if (f.type !== 'credits' || (f.activityType && f.activityType !== V.activity)) continue;
    if (f.operation === 'add') flat += f.value || 0;
    if (f.operation === 'multiply') mrate += f.value || 0;
  }
  const club = flat + q25(base * mrate);
  const ci = base * checkinPct(S.checkin) / 100;
  const ch = base * checkinPct(S.chastity) / 100;
  const sum = base + outfit + club + ci + ch;
  const pen = pendingPenalty();
  const again = (S.done[V.key]?.count || 0) > 0;
  const final = Math.max(0, q25((again ? sum / 2 : sum) - pen));
  return { base, outfit, club, ci, ch, pen, again, final };
}

export function startCost(V) {
  if (V.parentId) return 0;
  if (V.isExam) return va(V.e.tier) * R().examCostMult;
  if (V.entType === 'Course') return R().courseCost;
  if (V.entType === 'Degree') return R().degreeCost;
  return 0;
}

// ———————————————— 进度查询 ————————————————

export const doneEver = key => (S.done[key]?.count || 0) > 0;
export const doneToday = key => S.done[key]?.day === dayKey();
export const runOf = key => S.runs.find(r => r.key === key && !r.parentDone);
export const runById = rid => S.runs.find(r => r.rid === rid);
export const isMember = eid => {
  const e = C.ent[eid];
  if (e.type === 'Club') return !!S.clubs[eid];
  if (e.type === 'Punishment') return S.puns.some(p => p.ent === eid);
  return S.enrolled[eid]?.status === 'active';
};
export const graduated = eid => S.enrolled[eid]?.status === 'done';
// 用户定（2026-10-31）：加入课堂就算出席，不用每天按出席；固定排课时课堂任务只在排定的星期能做
export const classDayOk = eid => !(S.settings.schedule === 'fixed' && C.ent[eid]?.days?.length && !C.ent[eid].days.includes(weekday(dayKey())));

// 原站结构：学位 →（先修）课程 →（先修）专家课堂 → 高级 → 中级 → 初级
// 课堂才看先修；课程、学位随时可加入，先修只挡考试
export function prereqOk(eid) {
  const e = C.ent[eid];
  if (e.type !== 'Class') return true;
  return (e.prerequisites || []).every(p => !C.ent[p] || graduated(p));
}
// 课程底下的全部课堂（沿先修链往下找），按程度排
export function courseClasses(cid) {
  const out = new Set();
  const walk = id => (C.ent[id]?.prerequisites || []).forEach(p => {
    if (C.ent[p]?.type === 'Class' && !out.has(p)) { out.add(p); walk(p); }
  });
  walk(cid);
  return [...out].sort((a, b) => (C.ent[a].tier || 0) - (C.ent[b].tier || 0));
}
export const degreeCourses = did => (C.ent[did]?.prerequisites || []).filter(p => C.ent[p]?.type === 'Course');
export const nextClass = cid => entities('Class').find(c => (c.prerequisites || []).includes(cid))?.id || null;
const activeDegrees = () => Object.keys(S.enrolled).filter(id => C.ent[id]?.type === 'Degree' && isMember(id));
// 考试门槛：课程要先完成全部课堂且没有惩罚；学位要先完成全部课程
export function examLock(eid) {
  const e = C.ent[eid];
  if (e.type === 'Course') {
    const miss = courseClasses(eid).filter(c => !graduated(c));
    if (miss.length) return '先完成全部课堂（还差 ' + miss.length + ' 个程度）';
    if (S.puns.length) return '先做完惩罚';
  }
  if (e.type === 'Degree') {
    const miss = degreeCourses(eid).filter(c => !graduated(c));
    if (miss.length) return '先完成全部课程（还差 ' + miss.length + ' 门）';
  }
  return '';
}
export function tierOk(eid) {
  const e = C.ent[eid];
  return e.type !== 'Class' || (e.tier || 0) <= S.tier;
}

// 课堂成绩
export function gradeInfo(eid) {
  const ts = topTasks(eid).filter(t => !t.noBonus?.includes('GRADE'));
  const done = ts.filter(t => doneEver(eid + ':' + t.id)).length;
  const r = ts.length ? done / ts.length : 0;
  const cut = R().gradeCut;
  const g = r >= cut.A ? 'A' : r >= cut.B ? 'B' : r >= cut.C ? 'C' : r >= cut.D ? 'D' : 'F';
  return { done, total: ts.length, ratio: r, grade: g };
}

// 课程／学位成绩（原站 FD）：下层平均 40%＋本层考试 60%，按绩点 A4 B3 C2 D1 F0 折算
const GP = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const gpGrade = x => x >= 3.5 ? 'A' : x >= 2.5 ? 'B' : x >= 1.5 ? 'C' : x >= 0.5 ? 'D' : 'F';
export function finalGrade(eid) {
  const e = C.ent[eid];
  if (e.type === 'Class') return gradeInfo(eid).grade;
  const subs = e.type === 'Course' ? courseClasses(eid) : degreeCourses(eid);
  const sub = subs.length ? subs.reduce((a, s) => a + GP[finalGrade(s)], 0) / subs.length : 0;
  return gpGrade(sub * 0.4 + GP[gradeInfo(eid).grade] * 0.6);
}

export function canGraduate(eid) {
  const e = C.ent[eid];
  if (!isMember(eid)) return false;
  const tops = topTasks(eid);
  const allDone = tops.every(t => doneEver(eid + ':' + t.id));
  if (e.type === 'Class') {
    if (e.isSequential || S.settings.fullAttendance) return allDone;
    const exams = tops.filter(t => t.tier === 2);
    return allDone || (exams.length > 0 && exams.every(t => doneEver(eid + ':' + t.id)));
  }
  // 课程、学位：考试几选一，做完一个即可
  return !examLock(eid) && tops.some(t => doneEver(eid + ':' + t.id));
}

// 最终毕业（原站 /graduation）：没有进行中的学位、课程、课堂、任务、惩罚，且至少完成一个学位
export function graduationInfo() {
  const doneDeg = entities('Degree').filter(d => graduated(d.id));
  const block = [];
  if (S.puns.length) block.push('还有惩罚');
  if (activeDegrees().length) block.push('还有学位在读');
  if (entities('Course').some(c => isMember(c.id))) block.push('还有课程在读');
  if (entities('Class').some(c => isMember(c.id))) block.push('还有课堂在读');
  if (S.runs.length) block.push('还有进行中的任务');
  return { degrees: doneDeg.map(d => d.id), ok: doneDeg.length > 0 && !block.length, block };
}
export function graduateUniversity() {
  const g = graduationInfo();
  if (!g.ok) return { ok: false, why: g.block.join('、') || '还没完成任何学位' };
  const rec = { at: Date.now(), degrees: g.degrees.map(id => ({ id, grade: S.enrolled[id]?.grade || finalGrade(id) })) };
  S.graduations.push(rec);
  log('毕业：' + rec.degrees.map(d => C.ent[d.id]?.name + ' ' + d.grade).join('、'));
  return { ok: true, rec };
}

// ———————————————— 能否开始 ————————————————

const liveRuns = () => S.runs.filter(r => r.type !== 'COMPOSITE_TASK' && r.type !== 'MODIFIER_TASK');

export function conflicts(V, extra = []) {
  const reasons = [];
  if (V.type === 'MODIFIER_TASK' || V.type === 'COMPOSITE_TASK') return reasons;
  const runs = [...liveRuns(), ...extra];
  if (S.settings.mode === 'original') {
    if (!V.isParallel) {
      const r = runs.find(r => r.eid === V.eid && !r.isParallel);
      if (r) reasons.push('同一门里「' + r.short + '」还在进行（原版规则）');
    }
    return reasons;
  }
  if (V.activity === 'active' && !V.isParallel) {
    const r = runs.find(r => r.activity === 'active' && !r.isParallel);
    if (r) reasons.push('已有主动任务在进行：「' + r.short + '」');
  }
  for (const r of runs) {
    const hit = (r.parts || []).filter(p => V.parts.includes(p));
    if (hit.length) reasons.push('与「' + r.short + '」撞部位：' + hit.join('、'));
  }
  return reasons;
}

export function check(V, { ignoreConflicts = false, extra = [] } = {}) {
  const why = [];
  const e = V.e;
  if (V.type === 'ESTIM_TASK') return { ok: false, unsupported: true, why: ['此版本不支持（电刺激）'] };
  if (runOf(V.key)) return { ok: false, running: true, why: ['进行中'] };
  if (e.type === 'Punishment') {
    if (!S.puns.some(p => p.ent === V.eid && !p.rid)) why.push('没有待做的这项惩罚');
  } else if (e.type === 'Club') {
    if (!S.clubs[V.eid]) why.push('未加入社团');
    if (V.perkId && !S.clubs[V.eid]?.perks?.[V.perkId]) why.push('福利未开启');
  } else {
    if (!isMember(V.eid)) why.push(graduated(V.eid) ? '已结业' : '未加入');
    else if (e.type === 'Class' && !classDayOk(V.eid)) why.push('今天不排课');
    else if (examLock(V.eid)) why.push(examLock(V.eid));
  }
  if (e.type !== 'Punishment' && doneToday(V.key)) why.push('今天已完成');
  if (e.doOnlyOnce && doneEver(V.key)) why.push('只能做一次');
  if (e.isSequential && !V.parentId) {
    const next = topTasks(V.eid).find(t => !doneEver(V.eid + ':' + t.id));
    if (next && next.id !== V.tid) why.push('要按顺序做');
  }
  if (V.parentId) {
    const pr = runOf(V.eid + ':' + V.parentId);
    if (!pr) why.push('先开始组合任务');
    else {
      const kids = childTasks(V.eid, V.parentId);
      const next = kids.find(k => !(pr.kidsDone || []).includes(k.id));
      if ((pr.kidsDone || []).includes(V.tid)) why.push('这一步已做完');
      else if (next && next.id !== V.tid && pr.sequential) why.push('要按顺序做');
    }
  }
  const ic = itemsCheck(V.requiredItems);
  if (!ic.ok) why.push((S.settings.strictItems ? '缺道具：' : '提示·缺道具：') + ic.missing.map(reqText).join('；'));
  const sc = statsCheck(V.requiredStats);
  if (!sc.ok) why.push((S.settings.strictItems ? '服装数值不足：' : '提示·服装数值不足：') + sc.need.join('，'));
  const cost = startCost(V);
  if (cost > S.credits) why.push('学分不够（要 ' + cost + '）');
  if (!ignoreConflicts) why.push(...conflicts(V, extra));
  const blocking = why.filter(w => !w.startsWith('提示·'));
  return { ok: !blocking.length, why, cost };
}

// ———————————————— 附加条件（配合下一个任务） ————————————————

function modMatches(m, V) {
  if (m.kind === 'activity') return V.activity === m.activity;
  if (m.kind === 'taggedTask') return V.tags.some(t => m.tags.includes(t));
  if (m.kind === 'requirements') return V.entType !== 'Punishment';
  return false;
}

export const pendingMods = () => S.mods.filter(m => m.usesLeft > 0 && !m.attachedTo && (m.kind === 'activity' || m.kind === 'taggedTask'));
export function matchingMods(V) { return S.mods.filter(m => m.usesLeft > 0 && !m.attachedTo && modMatches(m, V)); }

// ———————————————— 开始／完成／失败 ————————————————

export function start(V, opts = {}) {
  const chk = check(V, opts);
  if (!chk.ok && !opts.force) return chk;
  const R0 = renderView(V);
  const now = Date.now();
  const cost = chk.cost || 0;
  if (cost) S.credits = q25(S.credits - cost);
  const short = stripTags(R0.title || R0.text).slice(0, 24) || V.tid;
  const run = {
    rid: uid('r'), key: V.key, eid: V.eid, tid: V.tid, vk: V.vk, type: V.type, entType: V.entType,
    title: R0.title, text: R0.text, comment: R0.comment, short, mult: R0.mult,
    activity: V.activity, parts: V.parts, isParallel: V.isParallel, tags: V.tags, isExam: V.isExam,
    startedAt: now, pausedAt: null, pausedTotal: 0, durSec: 0, limitSec: 0, cost,
    mods: [], parentRid: null, notified: false, game: null, gameDone: false
  };
  const t = V.type;
  if (t === 'DURATION_TASK') run.durSec = S.settings.timer ? R0.durSec : 0;
  if (t === 'TIMED_TASK') run.limitSec = R0.P.timelimit?.sec || R0.durSec;
  if (t === 'COMPOSITE_TASK') {
    run.limitSec = R0.durSec || R().compositeDefaultMin * 60;
    run.sequential = V.tasksConfig?.schedulingType === 'sequential';
    const mx = parseDur(V.tasksConfig?.sequentialConfig?.maxDuration || '');
    run.stepWindow = mx ? mx.sec : 0;
    run.kidsDone = []; run.lastStepAt = now;
  }
  if (MINIGAMES.has(t)) run.game = gameConfig(V, R0);
  run.hypno = hypnoOf(run, R0.durSec);
  if (V.parentId) {
    const pr = runOf(V.eid + ':' + V.parentId);
    if (pr) run.parentRid = pr.rid;
  }
  // 挂上等着配合的附加条件
  for (const m of matchingMods(V)) { m.attachedTo = run.rid; run.mods.push(m.mid); }
  // 本任务自带的附加条件
  if (V.modifiers) {
    for (const m of Object.values(V.modifiers)) {
      for (const f of m.effects || []) {
        if (!['activity', 'taggedTask', 'requirements'].includes(f.type)) continue;
        S.mods.push({
          mid: uid('m'), srcRid: run.rid, srcKey: V.key, kind: f.type, activity: f.activityType, tags: f.tags || [],
          effects: [f], usesLeft: m.uses || 1, attachedTo: null,
          text: render(m.description || '', R0.P, R0.mult, V) || run.text, from: short
        });
      }
    }
  }
  if (V.entType === 'Punishment') {
    const p = S.puns.find(p => p.ent === V.eid && !p.rid);
    if (p) p.rid = run.rid;
  }
  S.runs.push(run);
  log('开始：' + short + (cost ? '（花 ' + cost + ' 学分）' : ''));
  if (t === 'INSTANT_TASK' && opts.instantDone) complete(run.rid);
  return { ok: true, run };
}

function gameConfig(V, R0) {
  const m = R0.mult;
  if (V.type === 'METRONOME_MINIGAME_TASK') {
    const stages = (V.metronome?.stages || []).map(s => {
      const a = s.isAffectedByDifficulty;
      return {
        label: s.label, kind: s.type || 'beats', bpm: s.bpm || 60,
        reps: s.repetitions ? (a ? Math.round(s.repetitions * m) : s.repetitions) : null,
        sec: s.duration ? (a ? Math.round(s.duration * m) : s.duration) : null,
        auto: s.startNextStageAutomatically !== false
      };
    });
    return { kind: 'metronome', stages };
  }
  if (V.type === 'BEATTRACK_MINIGAME_TASK') {
    return { kind: 'beattrack', beats: V.beat?.beats || [], intro: (V.beat?.initialDialog || []).map(d => ({ message: d.message, ms: d.duration || 4000 })) };
  }
  if (V.type === 'AFFIRMATIONS_TASK') {
    const es = V.aff?.entries || [];
    const n = es.reduce((a, e) => a + (e.repetitions || 0), 0) || 5;
    const tags = [...new Set(es.flatMap(e => e.tags || []))];
    return { kind: 'affirm', tags: tags.length ? tags : ['ANY'], total: Math.min(50, Math.max(1, V.aff?.isAffectedByDifficulty ? Math.round(n * m) : n)) };
  }
  if (V.type === 'OBEDIENCE_MINIGAME_TASK') {
    const n = Math.max(1, Math.round(R0.P.commands?.num || 5));
    return { kind: 'obedience', total: n };
  }
  return null;
}

// 催眠任务（文字提到催眠的计时／限时任务）：可在 App 里直接播。视频＝有图，音频＝暗屏只有螺旋和字幕
export function hypnoOf(run, sec) {
  if (run.type !== 'DURATION_TASK' && run.type !== 'TIMED_TASK') return null;
  if (!/催眠/.test(run.text || '')) return null;
  return {
    video: /视频/.test(run.text), punish: run.entType === 'Punishment', open: run.type === 'TIMED_TASK',
    sec: sec || run.durSec || run.limitSec || 600
  };
}

export function remaining(run, now = Date.now()) {
  const paused = run.pausedTotal + (run.pausedAt ? now - run.pausedAt : 0);
  const el = (now - run.startedAt - paused) / 1000;
  if (run.durSec) return run.durSec - el;
  if (run.limitSec) return run.limitSec - el;
  return null;
}
export const elapsed = (run, now = Date.now()) => (now - run.startedAt - run.pausedTotal - (run.pausedAt ? now - run.pausedAt : 0)) / 1000;

export function canFinish(run) {
  if (run.type === 'MODIFIER_TASK') return { ok: false, why: '等配合的任务完成后自动结算' };
  if (run.type === 'COMPOSITE_TASK') return { ok: false, why: '子任务全部完成后自动结算' };
  if (run.game && !run.gameDone) return { ok: false, why: '小游戏还没做完' };
  if (run.type === 'DURATION_TASK' && remaining(run) > 0) return { ok: false, why: '时间还没到' };
  if (run.type === 'TIMED_TASK' && remaining(run) < 0) return { ok: false, why: '已超时' };
  if (run.pausedAt) return { ok: false, why: '暂停中' };
  return { ok: true };
}

export function pause(rid) { const r = runById(rid); if (r && !r.pausedAt) { r.pausedAt = Date.now(); } }
export function resume(rid) { const r = runById(rid); if (r && r.pausedAt) { r.pausedTotal += Date.now() - r.pausedAt; r.pausedAt = null; } }

function endRun(run) {
  S.runs = S.runs.filter(r => r.rid !== run.rid);
  // 放开挂在它身上的附加条件
  for (const m of S.mods) if (m.attachedTo === run.rid) m.attachedTo = null;
}

function dropOwnMods(run) { S.mods = S.mods.filter(m => m.srcRid !== run.rid); }

export function complete(rid, { force = false, silent = false } = {}) {
  const run = runById(rid);
  if (!run) return;
  if (!force) { const f = canFinish(run); if (!f.ok && !run._auto) return f; }
  const V = view(run.eid, run.tid, run.vk);
  let credits = 0;
  if (V && !run.noCredit) {
    credits = creditsFor(V).final;
    S.credits = q25(S.credits + credits);
  }
  const today = dayKey();
  const d = S.done[run.key] || (S.done[run.key] = { count: 0, first: Date.now() });
  d.count++; d.day = today;
  // 消耗挂着的附加条件
  const used = [...run.mods];
  endRun(run);
  dropOwnMods(run);
  for (const mid of used) {
    const m = S.mods.find(x => x.mid === mid);
    if (!m) continue;
    m.usesLeft--; m.attachedTo = null;
    if (m.usesLeft <= 0) {
      S.mods = S.mods.filter(x => x !== m);
      const src = runById(m.srcRid);
      if (src && !S.mods.some(x => x.srcRid === src.rid)) { src._auto = true; complete(src.rid, { force: true }); }
    }
  }
  if (run.entType === 'Punishment') S.puns = S.puns.filter(p => p.rid !== run.rid);
  if (V?.roll && run.entType !== 'Punishment') rollPunishments(V.roll.amount || 1, V.roll.tier, V.tags, '任务抽签');
  log('完成：' + run.short + (credits ? '（+' + credits + ' 学分）' : ''));
  // 组合任务
  if (run.parentRid) {
    const pr = runById(run.parentRid);
    if (pr) {
      pr.kidsDone = [...(pr.kidsDone || []), run.tid];
      pr.lastStepAt = Date.now();
      const kids = childTasks(pr.eid, pr.tid);
      if (kids.every(k => pr.kidsDone.includes(k.id))) { pr._auto = true; complete(pr.rid, { force: true }); }
    }
  }
  if (!silent) onNotify('done', run);
  return { ok: true, credits };
}

export function fail(rid, { noPenalty = false, reason = '' } = {}) {
  const run = runById(rid);
  if (!run) return;
  endRun(run);
  dropOwnMods(run);
  // 组合任务失败：子任务一并结束
  for (const k of S.runs.filter(r => r.parentRid === run.rid)) { endRun(k); dropOwnMods(k); }
  let msg = (noPenalty ? '放弃（不罚）：' : '失败：') + run.short + (reason ? '（' + reason + '）' : '');
  if (run.entType === 'Punishment') {
    S.puns = S.puns.filter(p => p.rid !== run.rid);
    if (!noPenalty) {
      const tier = C.ent[run.eid]?.tier || 1;
      const c = R().punAbandonCost[tier - 1];
      S.credits = q25(S.credits - c); msg += '，扣 ' + c + ' 学分';
    }
  } else if (!noPenalty && !run.parentRid && (run.entType === 'Class' || run.entType === 'Course' || run.entType === 'Degree')) {
    const tags = C.ent[run.eid]?.tags || [];
    rollPunishments(1, null, tags, '任务失败');
  }
  if (noPenalty && run.cost) { S.credits = q25(S.credits + run.cost); msg += '，退回 ' + run.cost + ' 学分'; }
  log(msg);
}

export function skipUnsupported(V) {
  const d = S.done[V.key] || (S.done[V.key] = { count: 0, first: Date.now() });
  d.count++; d.day = dayKey();
  log('跳过（不支持）：' + V.eid + ' #' + V.tid);
}

// ———————————————— 惩罚 ————————————————

export function maxPunTier() { return Math.min(3, S.tier - 1); }

export function rollPunishments(n, tier, tags = [], why = '') {
  const max = maxPunTier();
  if (max < 1) { log('惩罚豁免（' + why + '）：还没解锁中级'); return []; }
  const t = Math.min(tier || max, max);
  let pool = entities('Punishment').filter(e => e.tier === t);
  const pref = pool.filter(e => (e.tags || []).some(x => tags.includes(x)));
  const doable = list => list.filter(e => topTasks(e.id).every(tk => itemsCheck(view(e.id, tk.id).requiredItems).ok));
  pool = doable(pref).length ? doable(pref) : doable(pool).length ? doable(pool) : pool;
  const got = [];
  for (let i = 0; i < n && pool.length; i++) {
    const e = pool[Math.floor(Math.random() * pool.length)];
    S.puns.push({ pid: uid('p'), ent: e.id, tier: t, at: Date.now(), why });
    got.push(e);
  }
  if (got.length) log('领到惩罚（' + why + '）：' + got.map(e => e.name).join('、'));
  onNotify('pun', got);
  return got;
}

export function rerollPunishment(pid) {
  const p = S.puns.find(x => x.pid === pid);
  if (!p || p.rid) return;
  const c = R().punRerollCost[(p.tier || 1) - 1];
  if (S.credits < c) return { ok: false, why: '学分不够' };
  S.credits = q25(S.credits - c);
  S.puns = S.puns.filter(x => x !== p);
  rollPunishments(1, p.tier, C.ent[p.ent]?.tags || [], '重抽');
  return { ok: true };
}

export function abandonPunishment(pid, noPenalty = false) {
  const p = S.puns.find(x => x.pid === pid);
  if (!p) return;
  if (p.rid) return fail(p.rid, { noPenalty });
  const c = R().punAbandonCost[(p.tier || 1) - 1];
  if (!noPenalty) S.credits = q25(S.credits - c);
  S.puns = S.puns.filter(x => x !== p);
  log((noPenalty ? '移除惩罚（不罚）：' : '放弃惩罚，扣 ' + c + ' 学分：') + (C.ent[p.ent]?.name || p.ent));
}

// ———————————————— 加入／结业 ————————————————

export function join(eid) {
  const e = C.ent[eid];
  if (e.type === 'Club') { S.clubs[eid] = { at: Date.now(), perks: {} }; log('加入社团：' + e.name); return { ok: true }; }
  if (isMember(eid) || graduated(eid)) return { ok: false, why: graduated(eid) ? '已结业' : '已加入' };
  if (!tierOk(eid)) return { ok: false, why: '还没解锁' + TIER_LABEL[e.tier] + '：到「课堂」页最上面，花 ' + R().tierUnlockCost[e.tier] + ' 学分' };
  if (!prereqOk(eid)) return { ok: false, why: '先完成上一个程度' };
  if (e.type === 'Course' && !activeDegrees().some(d => degreeCourses(d).includes(eid))) return { ok: false, why: '先加入包含这门课程的学位' };
  enroll(eid);
  // 原站：加入学位 → 一并加入它的课程；加入课程 → 一并加入还没完成的初级课堂
  if (e.type === 'Degree') for (const c of degreeCourses(eid)) if (!isMember(c) && !graduated(c)) enroll(c);
  if (e.type === 'Degree' || e.type === 'Course') autoJoinFirst(e.type === 'Degree' ? degreeCourses(eid) : [eid]);
  return { ok: true };
}
function enroll(eid) {
  S.enrolled[eid] = { status: 'active', at: Date.now() };
  log('加入' + ENT_LABEL[C.ent[eid].type] + '：' + C.ent[eid].name);
}
function autoJoinFirst(courses) {
  for (const c of courses) {
    if (!isMember(c)) continue;
    const first = courseClasses(c).find(k => C.ent[k].tier === 1);
    if (first && !isMember(first) && !graduated(first)) enroll(first);
  }
}

export function leaveCost(eid) {
  const e = C.ent[eid];
  if (e.type === 'Class') return R().leaveCost[Math.max(1, e.tier || 1) - 1];
  if (e.type === 'Degree') return q25(Math.max(0, S.credits) * (R().degreeLeaveRate ?? 0.5));
  return 0;
}

export function leave(eid, free = false) {
  const e = C.ent[eid];
  if (e.type === 'Club') {
    for (const r of S.runs.filter(r => r.eid === eid)) fail(r.rid, { noPenalty: true, reason: '退出' });
    delete S.clubs[eid];
    log('退出社团：' + e.name);
    return { ok: true };
  }
  const c = free ? 0 : leaveCost(eid);
  if (c > S.credits) return { ok: false, why: '学分不够（要 ' + c + '）' };
  S.credits = q25(S.credits - c);
  unenroll(eid);
  log('退出' + ENT_LABEL[e.type] + '：' + e.name + (c ? '（扣 ' + c + '）' : ''));
  // 原站：退学位连带退课程，退课程连带退它的课堂（连带的不另扣）；别的在读学位还要用的课程留着
  if (e.type === 'Degree') {
    for (const k of degreeCourses(eid)) {
      if (!isMember(k) || activeDegrees().some(d => degreeCourses(d).includes(k))) continue;
      unenroll(k); log('连带退出课程：' + C.ent[k].name);
      leaveClassesOf(k);
    }
  }
  if (e.type === 'Course') leaveClassesOf(eid);
  return { ok: true };
}
function unenroll(eid) {
  for (const r of S.runs.filter(r => r.eid === eid)) fail(r.rid, { noPenalty: true, reason: '退出' });
  delete S.enrolled[eid];
}
function leaveClassesOf(cid) {
  for (const k of courseClasses(cid)) if (isMember(k)) { unenroll(k); log('连带退出课堂：' + C.ent[k].name); }
}

export function graduate(eid) {
  if (!canGraduate(eid)) return { ok: false };
  const e = C.ent[eid];
  let bonus = 0, grade = '';
  if (e.type === 'Class') {
    const g = gradeInfo(eid); grade = g.grade;
    const mult = R().graduationMult[grade] || 0;
    bonus = q25(va(e.tier) * mult * (1 + checkinPct(S.checkin) / 100));
    S.credits = q25(S.credits + bonus);
  } else grade = finalGrade(eid);
  S.enrolled[eid] = { ...S.enrolled[eid], status: 'done', grade, doneAt: Date.now() };
  log('结业：' + e.name + (grade ? '，成绩 ' + grade : '') + (bonus ? '，+' + bonus + ' 学分' : ''));
  return { ok: true, grade, bonus, next: e.type === 'Class' ? nextClass(eid) : null };
}

export function resetEntity(eid) {
  for (const r of S.runs.filter(r => r.eid === eid)) fail(r.rid, { noPenalty: true, reason: '重置' });
  S.mods = S.mods.filter(m => !m.srcKey?.startsWith(eid + ':'));
  for (const k of Object.keys(S.done)) if (k.startsWith(eid + ':') && S.done[k].day === dayKey()) S.done[k].day = null;
  log('重置：' + C.ent[eid].name + '（今天的进行中已清，累计完成保留）');
}

export function unlockTier() {
  const next = S.tier + 1;
  if (next > 4) return { ok: false };
  const c = R().tierUnlockCost[next];
  if (S.credits < c) return { ok: false, why: '学分不够（要 ' + c + '）' };
  S.credits = q25(S.credits - c); S.tier = next;
  log('解锁' + TIER_LABEL[next] + '课堂（花 ' + c + '）');
  return { ok: true };
}

export function togglePerk(cid, mid, on) {
  const c = S.clubs[cid]; if (!c) return;
  c.perks[mid] = on;
  log((on ? '开启' : '关闭') + '福利：' + C.ent[cid].name);
}

// ———————————————— 签到／医务室 ————————————————

export function checkin(kind) {
  const c = kind === 'chastity' ? S.chastity : S.checkin;
  const today = dayKey();
  if (c.day === today) return false;
  c.streak = c.day === yesterday(today) ? c.streak + 1 : 1;
  c.day = today;
  log((kind === 'chastity' ? '贞操签到' : '签到') + '，连续 ' + c.streak + ' 天');
  return true;
}
export const checkinStreak = kind => checkinPct(kind === 'chastity' ? S.chastity : S.checkin);

export function moodIndex() {
  const m = S.inf.mood;
  const cuts = [-70, -40, -10, 10, 40, 70];
  let i = 0; while (i < cuts.length && m > cuts[i]) i++;
  return i;
}

export function infirmary(reqId) {
  const today = dayKey();
  if (S.inf.day !== today) { S.inf.day = today; S.inf.uses = 0; }
  if (S.inf.uses >= R().infirmaryPerDay) return { ok: false, why: '今天的次数用完了' };
  S.inf.uses++;
  S.inf.mood = S.inf.mood > 0 ? S.inf.mood * 0.5 : S.inf.mood * 0.8;
  const req = C.infirmary.requests.find(r => r.id === reqId);
  const p = Math.min(0.95, Math.max(0.05, req.chance + S.inf.mood / 400));
  const granted = Math.random() < p;
  log('医务室：' + req.label + ' → ' + (granted ? '准' : '不准'));
  return { ok: true, granted, p };
}
export function infMood(delta) { S.inf.mood = Math.max(-100, Math.min(100, S.inf.mood + delta)); }

// ———————————————— 定时检查与日终 ————————————————

export function tick(now = Date.now()) {
  const events = [];
  rollover(now);
  for (const run of [...S.runs]) {
    if (!runById(run.rid)) continue;
    const rem = remaining(run, now);
    if (S.settings.pauseLimit && run.pausedAt && (run.pausedTotal + now - run.pausedAt) > R().pauseLimitMin * 60e3) {
      fail(run.rid, { reason: '暂停超过上限' }); events.push('fail'); continue;
    }
    if (run.pausedAt) continue;
    if (run.type === 'DURATION_TASK' && run.durSec && rem <= 0 && !run.notified) {
      run.notified = true; events.push('due');
      onNotify('due', run);
      if (S.settings.autoComplete) complete(run.rid);
    }
    if (run.type === 'TIMED_TASK' && rem < 0 && !run.notified) { run.notified = true; onNotify('over', run); events.push('over'); }
    if (run.type === 'COMPOSITE_TASK') {
      if (rem < 0) { fail(run.rid, { reason: '组合任务超时' }); events.push('fail'); continue; }
      if (run.sequential && run.stepWindow && (run.kidsDone || []).length) {
        const kidsRunning = S.runs.some(k => k.parentRid === run.rid);
        if (!kidsRunning && now - run.lastStepAt > run.stepWindow * 1000) { fail(run.rid, { reason: '下一步没在时窗内开始' }); events.push('fail'); }
      }
    }
  }
  return events;
}

export function rollover(now = Date.now()) {
  const today = dayKey(now);
  if (!S.day) { S.day = today; return; }
  if (S.day === today) return;
  S.day = today;
  log('新的一天：' + today);
}

// ———————————————— 杂项 ————————————————

export function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ''); }

export function startableNow(filter = () => true) {
  const out = [];
  for (const e of Object.values(C.ent)) {
    if (!isMember(e.id)) continue;
    for (const t of Object.values(e.tasks || {})) {
      const V = view(e.id, t.id);
      if (!V || !filter(V)) continue;
      if (check(V).ok) out.push(V);
    }
  }
  return out;
}

export function exportState() { return JSON.parse(JSON.stringify(S)); }
