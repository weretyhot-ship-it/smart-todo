/* ============================================================================
   ui.js — the whole app skin in motion + the untouched business core
   ----------------------------------------------------------------------------
   BUSINESS LOGIC (unchanged, carried over from the v1 app):
     · DeepSeek API key -> localStorage
     · call the model, turn plain language into JSON {name,time,priority,category}
     · render cards sorted by priority (high > mid > low, then time)
     · Notification API, silent:true, polled locally every 10s
     · all data persisted locally
   SKIN (new):
     · settings sheet
     · in-page reminder cards (used when the OS refuses to show a toast)
     · anime.js entrance/stagger/exit motion (vanilla fallback if missing)
   ========================================================================= */

(function () {
'use strict';

/* ------------------------------------------------------------------ constants */
const LS_KEY = 'smart_todo_api_key';
const LS_MODEL = 'smart_todo_model';
const LS_BASE = 'smart_todo_base';
const LS_TASKS = 'smart_todo_tasks';
const LS_NOTIFIED = 'smart_todo_notified';
/* new keys, the old three above are untouched so v1 data still loads */
const LS_ALERT = 'smart_todo_alert_inpage';   // '0' turns the in-page reminder off
const LS_TIPDISMISS = 'smart_todo_tip_dismissed';

/* Priority is shown as a tier letter on a hairline bar, not as a coloured dot:
   the tier is still stored exactly as before ('high' | 'mid' | 'low'). */
const PRI = {
  high: { label: '高', tier: 'A', color: '#8f4a44', weight: 0 },
  mid: { label: '中', tier: 'B', color: '#9a7c33', weight: 1 },
  low: { label: '低', tier: 'C', color: '#5a6360', weight: 2 },
};
const PRI_ALIAS = {
  high: 'high', mid: 'mid', medium: 'mid', low: 'low',
  高: 'high', 中: 'mid', 低: 'low', 紧急: 'high', 重要: 'high', 急: 'high',
};

/* ---------------------------------------------------------------------- dom */
const $ = (id) => document.getElementById(id);

const video = $('bg-video');
const settings = $('settings');
const settingsBackdrop = $('settings-backdrop');
const apiKeyInput = $('api-key');
const apiModelInput = $('api-model');
const apiBaseInput = $('api-base');
const nlInput = $('nl-input');
const decomposeBtn = $('btn-decompose');
const decomposeLabel = $('btn-decompose-label');
const localBtn = $('btn-local');
const appendChk = $('chk-append');
const taskList = $('task-list');
const taskEmpty = $('task-empty');
const cardIndex = $('card-index');
const cardStat = $('card-stat');
const notifyBtn = $('btn-notify');
const notifyLabel = $('btn-notify-label');
const permBanner = $('permBanner');
const toastEl = $('toast');
const alertLayerEl = $('alert-layer');
const alertChk = $('chk-alert');
const notifyHint = $('notify-hint');
const settingsOpeners = ['btn-settings', 'btn-settings-top']
  .map((id) => $(id)).filter(Boolean);

/* -------------------------------------------------------------------- state */
let tasks = loadTasks();
let notified = loadNotified();
let snooze = loadSnooze();
let busy = false;

/* the page is on http(s), not opened as a local file */
function isLocal() { return location.protocol !== 'file:'; }

/* motion helper: anime.js when present, otherwise instant/fade fallback */
const hasAnime = () => typeof window.anime === 'function';

/* ----------------------------------------------------------------- utilities */
function pad(n) { return (n < 10 ? '0' : '') + n; }

function toLocalInput(d) {
  if (!d) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fromLocalInput(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}
function fmtTime(d) {
  const now = new Date();
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
  const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return '明天 ' + hm;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}
function normPriority(v) {
  if (v == null) return 'mid';
  const k = String(v).trim().toLowerCase();
  if (PRI_ALIAS[k]) return PRI_ALIAS[k];
  if (/high|urgent|p0|p1|紧急|重要/.test(k)) return 'high';
  if (/low|p3|p4|不急|低/.test(k)) return 'low';
  return 'mid';
}

let toastTimer = 0;
function toast(msg, ms = 2800) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), ms);
}

/* -------------------------------------------------------------- persistence */
function loadTasks() {
  try {
    const raw = localStorage.getItem(LS_TASKS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveTasks() {
  try { localStorage.setItem(LS_TASKS, JSON.stringify(tasks)); } catch (e) { /* ignore */ }
}
function loadNotified() {
  try {
    const o = JSON.parse(localStorage.getItem(LS_NOTIFIED) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}
function saveNotified() {
  try { localStorage.setItem(LS_NOTIFIED, JSON.stringify(notified)); } catch (e) { /* ignore */ }
}
/* per-tab only: "remind me in 10 minutes" must not survive a reload forever */
function loadSnooze() {
  try {
    const o = JSON.parse(sessionStorage.getItem(LS_NOTIFIED + '_snooze') || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}
function saveSnooze() {
  try { sessionStorage.setItem(LS_NOTIFIED + '_snooze', JSON.stringify(snooze)); } catch (e) { /* ignore */ }
}
function getKey() { return (localStorage.getItem(LS_KEY) || '').trim(); }
/* 给日志用的脱敏：任何像密钥的串都替换掉，避免它出现在控制台/截图里 */
function redact(text) {
  return String(text == null ? '' : text).replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***');
}
function getModel() { return localStorage.getItem(LS_MODEL) || 'deepseek-chat'; }
function getBase() {
  return (localStorage.getItem(LS_BASE) || 'https://api.deepseek.com').replace(/\/+$/, '');
}

/* ----------------------------------------------------------- settings sheet */
function closeSettings() {
  settings.classList.remove('is-open');
  settings.setAttribute('aria-hidden', 'true');
  settings.classList.remove('is-notify-focus');
}

/* --------------------------------------------------------------- task render */
function priorityRank(t) { return (PRI[t.priority] || PRI.mid).weight; }

function sortTasks() {
  tasks.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;   // open first
    const p = priorityRank(a) - priorityRank(b);          // high > mid > low
    if (p !== 0) return p;
    const at = a.time ? new Date(a.time).getTime() : Infinity;
    const bt = b.time ? new Date(b.time).getTime() : Infinity;
    if (at !== bt) return at - bt;
    return (a.created || 0) - (b.created || 0);
  });
}

function countdownText(t) {
  if (!t.time) return t.done ? '' : '未设时间';
  const ms = new Date(t.time).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const human = h > 0 ? h + ' 小时 ' + m + ' 分' : m + ' 分钟';
  if (t.done) return '';
  return ms <= 0 ? '已过 ' + human : '还有 ' + human;
}
function countdownClass(t) {
  if (!t.time || t.done) return '';
  const ms = new Date(t.time).getTime() - Date.now();
  if (ms <= 0) return 'task__count--over';
  if (ms <= 30 * 60 * 1000) return 'task__count--soon';
  return '';
}

/* one card = the same crop-cut glass vocabulary as the left column:
   chamfered corners, mono index, hairline rules, priority rail.
   The editor (时间 / 优先级) stays folded away until the row is hovered,
   focused or unfolded - so the list reads clean by default. */
function buildTaskNode(t) {
  const pri = PRI[t.priority] || PRI.mid;
  const li = document.createElement('li');
  li.className = 'task' + (t.done ? ' task--done' : '');
  li.dataset.id = t.id;
  li.dataset.pri = t.priority in PRI ? t.priority : 'mid';
  li.style.setProperty('--p', pri.color);

  /* a plain SVG check, drawn by CSS: no font glyph, no checkbox chrome */
  const NS = 'http://www.w3.org/2000/svg';
  function svgIcon(cls, d) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 12 12');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', cls);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }

  /* ---- top row: check box + name + priority dot ---- */
  const top = document.createElement('div');
  top.className = 'task__top';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'task__check';
  cb.checked = !!t.done;
  cb.title = t.done ? '标记为未完成' : '标记完成';
  cb.addEventListener('change', () => {
    t.done = cb.checked;
    if (t.done) notified[t.id] = true; else delete notified[t.id];
    saveNotified(); saveTasks(); render();
    toast(cb.checked ? '已完成：' + (t.name || '任务') : '已恢复为未完成');
  });
  top.appendChild(cb);

  const name = document.createElement('div');
  name.className = 'task__name';
  name.textContent = t.name || '(未命名任务)';
  name.title = t.name || '';
  top.appendChild(name);

  const chip = document.createElement('span');
  chip.className = 'task__tier';
  chip.title = pri.label + '优先级';
  const tierVar = document.createElement('span');
  tierVar.className = 'task__tierVar mono';
  tierVar.textContent = pri.tier;
  const tierBar = document.createElement('span');
  tierBar.className = 'task__tierBar';
  chip.appendChild(tierVar);
  chip.appendChild(tierBar);
  top.appendChild(chip);

  /* the priority is otherwise only encoded in colour */
  li.setAttribute('aria-label',
    (t.name || '未命名任务') + ' · ' + pri.label + '优先级' +
    (t.category ? ' · ' + t.category : '') + (t.done ? ' · 已完成' : ''));

  /* ---- badges: category / duration ---- */
  if (t.category || t.duration) {
    const badges = document.createElement('div');
    badges.className = 'task__badges';
    if (t.category) {
      const c = document.createElement('span');
      c.className = 'badge';
      c.textContent = t.category;
      badges.appendChild(c);
    }
    if (t.duration) {
      const d = document.createElement('span');
      d.className = 'badge';
      d.textContent = t.duration;
      badges.appendChild(d);
    }
    top.appendChild(badges);
  }

  /* ---- folded editor: date-time input + priority select ---- */
  const edit = document.createElement('div');
  edit.className = 'task__edit';

  const dl = document.createElement('label');
  dl.append('🕒');
  const tin = document.createElement('input');
  tin.type = 'datetime-local';
  tin.className = 'field__input task__time';
  tin.value = t.time ? toLocalInput(new Date(t.time)) : '';
  tin.addEventListener('change', () => {
    const d = fromLocalInput(tin.value);
    t.time = d ? d.toISOString() : null;
    delete notified[t.id];
    delete snooze[t.id];
    saveNotified(); saveSnooze(); saveTasks(); render();
    toast(d ? '时间已更新为 ' + fmtTime(d) : '已清除时间');
  });
  dl.appendChild(tin);
  edit.appendChild(dl);

  const pl = document.createElement('label');
  pl.append('⚑');
  const sel = document.createElement('select');
  sel.className = 'field__input task__pri';
  ['high', 'mid', 'low'].forEach((k) => {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = PRI[k].tier + ' · ' + PRI[k].label;
    if (t.priority === k) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    t.priority = normPriority(sel.value);
    saveTasks(); render();
    toast('优先级已改为' + (PRI[t.priority] || PRI.mid).label);
  });
  pl.appendChild(sel);
  edit.appendChild(pl);

  /* ---- meta row: countdown + time (click to edit) + delete ---- */
  const meta = document.createElement('div');
  meta.className = 'task__meta';

  const cd = document.createElement('span');
  cd.className = 'task__count ' + countdownClass(t);
  cd.textContent = countdownText(t);
  meta.appendChild(cd);

  const tbtn = document.createElement('button');
  tbtn.type = 'button';
  tbtn.className = 'task__when';
  tbtn.title = '点击修改时间';
  const pill = document.createElement('span');
  pill.className = 'pill';
  const tval = document.createElement('span');
  tval.className = 'pill__val';
  tval.textContent = t.time ? fmtTime(new Date(t.time)) : '未设时间';
  pill.appendChild(svgIcon('pill__icon', 'M6 1v2M6 9v2M1 6h2M9 6h2M6 8.2A2.2 2.2 0 1 0 6 3.8a2.2 2.2 0 0 0 0 4.4z'));
  pill.appendChild(tval);
  tbtn.appendChild(pill);
  tbtn.addEventListener('click', () => {
    li.classList.add('is-editing');
    try { tin.focus({ preventScroll: false }); } catch (e) { /* ignore */ }
    if (typeof tin.showPicker === 'function') { try { tin.showPicker(); } catch (e) { /* ignore */ } }
  });
  meta.appendChild(tbtn);

  edit.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && (edit.contains(to) || tbtn.contains(to))) return;
    li.classList.remove('is-editing');
  });
  document.addEventListener('click', (e) => {
    if (!li.isConnected) return;
    if (!li.contains(e.target)) li.classList.remove('is-editing');
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task__del';
  del.textContent = '删除';
  del.title = '删除这条任务';
  del.addEventListener('click', () => removeTask(t.id, li));
  meta.appendChild(del);

  li.appendChild(top);
  li.appendChild(edit);
  li.appendChild(meta);
  return li;
}

/* ------------------------------------------------------------------ empty state
   An empty card makes a first-time visitor (or a reviewer opening the GitHub
   Pages demo) leave in ten seconds, and most of them have no API key. So the
   empty state offers two ways in that need nothing: 示例数据 (pure local) and
   离线解析 (the regex parser, also pure local).                          */
let emptyStateHtml = '';

function updateEmptyState(html) {
  if (!taskEmpty) return;
  if (html) emptyStateHtml = html;
  if (taskEmpty.dataset && taskEmpty.dataset.built === '1') return;
  if (taskEmpty.dataset) taskEmpty.dataset.built = '1';
  const box = document.createElement('span');
  box.className = 'task-choice';
  const hint = document.createElement('span');
  hint.textContent = '还没有任务。左边写下想做的事 → 「智能拆解」；没有 API Key 也能先试：';
  const bExample = document.createElement('button');
  bExample.type = 'button';
  bExample.className = 'linkish linkish--sm';
  bExample.textContent = '填入示例数据';
  bExample.addEventListener('click', loadExampleTasks);
  const bDemo = document.createElement('button');
  bDemo.type = 'button';
  bDemo.className = 'linkish linkish--sm';
  bDemo.textContent = '看离线解析效果';
  bDemo.addEventListener('click', () => {
    nlInput.value = DEMO_SENTENCE;
    nlInput.focus();
    doLocalParse();
  });
  box.appendChild(hint);
  box.appendChild(bExample);
  box.appendChild(bDemo);
  taskEmpty.replaceChildren(box);
}

/* a few tasks that show off every visual state: three tiers, a timed one,
   a done one, different categories */
function exampleTasks() {
  /* 时间用"钟点"而不是"几分钟后"来算："95 分钟后"会随点击时刻漂移，
     半夜点就变成凌晨四点这种难看的时间；固定钟点永远好看，过点了自动顺延到明天 */
  const at = (hour, minute, dayOffset) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dayOffset || 0), hour, minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  };
  return [
    /* 名字控制在 10 个汉字以内：卡片的正文宽度约 250px，再长就会折成两行，
       示例数据是给人第一眼看的门面，一条一行最整齐 */
    { name: '交操作系统实验报告', time: at(16, 0), priority: 'high', category: '学习', duration: '2 小时' },
    { name: '给导师回邮件定选题', time: at(10, 30, 1), priority: 'mid', category: '学业' },
    { name: '取快递 + 买牛奶', time: null, priority: 'low', category: '生活' },
    { name: '整理上周课程笔记', time: null, priority: 'mid', category: '学习' },
  ].map((r) => { const t = normTask(r); if (t) t.sample = true; return t; }).filter(Boolean);
}

/* 再点一次时先把上一批示例数据去掉：否则新旧混在一起，
   旧的那批时间还是按旧算法算的，看起来会像"改了没生效" */
function loadExampleTasks() {
  const before = tasks.length;
  const kept = tasks.filter((t) => !t.sample);
  const removed = before - kept.length;
  tasks = kept.concat(exampleTasks());
  notified = {};
  saveNotified(); saveTasks();
  render();
  animateIn(taskList.querySelectorAll('.task'));
  toast(removed ? '已用新的示例数据替换上一批（' + removed + ' 条）' : '已填入示例数据 —— 可以直接勾选、改优先级、改时间试试');
}

const DEMO_SENTENCE = '明天下午三点交课程论文，很重要；后天上午去体检；顺便买牛奶和鸡蛋';

function render() {
  if (!taskList) return;
  sortTasks();
  taskList.innerHTML = '';
  tasks.forEach((t) => taskList.appendChild(buildTaskNode(t)));

  const empty = tasks.length === 0;
  if (taskEmpty) taskEmpty.hidden = !empty;
  if (empty) updateEmptyState(emptyStateHtml);

  const open = tasks.filter((t) => !t.done).length;
  const timed = tasks.filter((t) => !t.done && t.time).length;
  if (cardIndex) cardIndex.textContent = '//' + pad(open);
  if (cardStat) cardStat.textContent = open + ' 项未完成 · ' + timed + ' 项定时';
}

function animateIn(nodes) {
  if (!nodes || !nodes.length) return;
  if (hasAnime()) {
    window.anime({
      targets: nodes,
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 620,
      delay: window.anime.stagger(70),
      easing: 'cubicBezier(0.16, 1, 0.3, 1)',
    });
  } else {
    nodes.forEach((n) => { n.style.opacity = '1'; });
  }
}

function removeTask(id, node) {
  const drop = () => {
    tasks = tasks.filter((x) => x.id !== id);
    delete notified[id];
    delete snooze[id];
    saveNotified(); saveSnooze(); saveTasks(); render();
  };
  if (hasAnime() && node) {
    window.anime({
      targets: node,
      opacity: [1, 0],
      translateX: [0, 14],
      duration: 260,
      easing: 'easeOutQuad',
      complete: drop,
    });
  } else {
    drop();
  }
}

/* --------------------------------------------------------------- notifications */
function updateNotifyUi() {
  if (!notifyBtn || !notifyLabel) return;
  if (!('Notification' in window)) {
    notifyBtn.disabled = true;
    notifyLabel.textContent = '不支持通知';
    return;
  }
  if (Notification.permission === 'granted') {
    notifyLabel.textContent = '通知已开启';
    notifyBtn.style.opacity = '1';
  } else if (Notification.permission === 'denied') {
    notifyLabel.textContent = '通知被拒绝';
  } else {
    notifyLabel.textContent = '开启通知';
  }
}

/* ------------------------------------------------------- in-page reminder card
   The OS toast is out of our hands: it needs an https/localhost secure origin,
   a browser permission AND Windows' own notification settings. This card is
   none of that - it lives in the page, so a task can never be missed silently
   and every reminder is clickable (完成 / 10 分钟后再提醒 / 知道了).        */
function inPageAlertOn() { return localStorage.getItem(LS_ALERT) !== '0'; }

function alertCount() {
  return alertLayerEl ? alertLayerEl.querySelectorAll('.alert').length : 0;
}
function trimAlerts() {
  if (!alertLayerEl) return;
  const all = alertLayerEl.querySelectorAll('.alert');
  while (alertLayerEl.children.length >= 4 && alertLayerEl.firstElementChild) {
    alertLayerEl.removeChild(alertLayerEl.firstElementChild);
  }
  if (all.length > 12) closeAlert(all[0]);
}

function closeAlert(node) {
  if (!node || !node.parentNode) return;
  node.classList.remove('is-show');
  node.classList.add('is-leaving');
  setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 380);
}

function showAlert(o) {
  if (!alertLayerEl || !inPageAlertOn()) return null;
  const node = document.createElement('div');
  node.className = 'alert';
  node.style.setProperty('--p', '#000');
  if (o.color) node.style.setProperty('--p', o.color);

  const head = document.createElement('div');
  head.className = 'alert__head';
  const dot = document.createElement('span');
  dot.className = 'alert__dot';
  const ti = document.createElement('span');
  ti.className = 'alert__title';
  ti.textContent = o.title || '提醒';
  head.appendChild(dot);
  head.appendChild(ti);
  if (o.tag) {
    const tg = document.createElement('span');
    tg.className = 'alert__tag';
    tg.textContent = o.tag;
    head.appendChild(tg);
  }
  node.appendChild(head);

  if (o.body) {
    const b = document.createElement('p');
    b.className = 'alert__body';
    b.textContent = o.body;
    node.appendChild(b);
  }

  const row = document.createElement('div');
  row.className = 'alert__row';
  const acts = o.actions || [];
  acts.forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'linkish linkish--sm';
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      if (typeof a.run === 'function') a.run();
      if (a.keepOpen !== true) closeAlert(node);
    });
    row.appendChild(btn);
  });
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'alert__close';
  x.setAttribute('aria-label', '关闭提醒');
  x.textContent = '✕';
  x.addEventListener('click', () => closeAlert(node));
  row.appendChild(x);
  node.appendChild(row);

  alertLayerEl.appendChild(node);
  trimAlerts();
  /* let the browser paint the entry state before flipping the class */
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-show')));
  setTimeout(() => { if (node.parentNode) closeAlert(node); }, 15 * 60 * 1000);
  return node;
}

/* a short two-note figure from Web Audio - no audio file needed, quiet on purpose */
let audioCtx = null;
function chime(strong) {
  if (!inPageAlertOn()) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const freq = strong ? 660 : 880;
    const t0 = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.06, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + 0.6);
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    gain2.connect(audioCtx.destination);
    gain2.gain.setValueAtTime(0.0001, t0 + 0.16);
    gain2.gain.linearRampToValueAtTime(0.05, t0 + 0.19);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.5;
    osc2.connect(gain2);
    osc2.start(t0 + 0.16);
    osc2.stop(t0 + 0.75);
  } catch (e) { /* audio is a bonus, never a requirement */ }
}

function showBanner(text) {
  if (!permBanner) return;
  permBanner.textContent = text;
  permBanner.classList.add('show');
}

/* the most useful sentence of this whole file: WHY Windows stays quiet */
function notifyDiagnosis() {
  const local = isLocal();
  if (!('Notification' in window)) {
    return '这个浏览器不支持系统通知，已自动改用页面内的提醒卡（同样会响、会显示，只是不在 Windows 右下角）。';
  }
  if (!local) {
    return '当前页面是 file:// 直接打开的，浏览器禁止它发系统通知。请双击 launcher.pyw，用 http://localhost:8000/index.html 打开，然后点「开启系统通知」。';
  }
  if (!window.isSecureContext) {
    return '当前不是安全来源（需要 https 或 localhost），浏览器不允许发系统通知。请用 launcher.pyw 的 http://localhost:8000 打开。';
  }
  if (Notification.permission === 'denied') {
    return '浏览器里通知权限是「拒绝」。点地址栏左侧的锁图标 →「网站设置」→ 通知改为「允许」，再刷新页面。';
  }
  if (Notification.permission === 'granted') {
    return '浏览器权限已允许。Windows 若仍不弹：请点「打开 Windows 通知设置」，确认「通知」总开关打开、且关闭「勿扰/专注助手」，并把浏览器（Chrome/Edge）的通知设为「开」。另外不保存数据时浏览器会撤销权限，重新点一次「开启系统通知」即可。';
  }
  return '点「开启系统通知」，在浏览器弹窗里选「允许」。之后 Windows 右下角就会有提醒。';
}

function updateNotifyHint() {
  if (!notifyHint) return;
  notifyHint.textContent = notifyDiagnosis();
}

function askPermission(quiet) {
  if (!('Notification' in window)) {
    updateNotifyUi(); updateNotifyHint();
    if (!quiet) { showBanner(notifyDiagnosis()); openSettings('notify'); }
    return;
  }
  if (Notification.permission === 'granted') { updateNotifyUi(); updateNotifyHint(); if (!quiet) toast('系统通知已经开着了 ✅'); return; }
  if (Notification.permission === 'denied') {
    updateNotifyUi(); updateNotifyHint();
    showBanner(notifyDiagnosis());
    if (!quiet) openSettings('notify');
    return;
  }
  Notification.requestPermission().then((p) => {
    updateNotifyUi(); updateNotifyHint();
    if (p === 'granted') {
      if (!quiet) toast('通知已开启，到点会自动提醒 ✅');
      try {
        new Notification('Terranova', {
          body: '通知已开启，任务到点时会在这里提醒你 🌿',
          silent: true,
          tag: 'todo-hello',
        });
      } catch (e) { /* ignore */ }
    } else {
      showBanner('你暂时没有允许系统通知。没关系——页面右下角的提醒卡仍然会弹出来，不会漏事。');
    }
  }).catch(() => { updateNotifyUi(); updateNotifyHint(); });
}

function fireNotify(t, isDue) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const when = t.time ? fmtTime(new Date(t.time)) : '';
  const pri = PRI[t.priority] || PRI.mid;
  const body = (when ? when + ' · ' : '') + (t.category ? '【' + t.category + '】' : '') +
    '[' + pri.tier + '] ' + pri.label + '优先级';
  const title = isDue === false ? '🔔 Terranova 通知测试' : '⏰ ' + (t.name || '待办提醒');
  try {
    const n = new Notification(title, {
      body: isDue === false ? '看到这条说明 Windows 右下角已经能弹提醒了 🌿' : body,
      silent: true,            // no OS sound; the page plays a soft chime instead
      tag: isDue === false ? 'todo-test' : 'todo-' + t.id,
      requireInteraction: false,
    });
    n.onclick = () => { try { window.focus(); } catch (e) { /* ignore */ } n.close(); };
    return true;
  } catch (e) {
    return false;
  }
}

/* one reminder = OS toast (if allowed) + in-page card + soft chime */
function presentAlert(t, kind) {
  const pri = PRI[t.priority] || PRI.mid;
  const isDue = kind !== 'test';
  chime(isDue);
  /* the OS toast goes out for both paths: a "test" that only draws the in-page
     card would prove nothing about Windows actually showing anything */
  fireNotify(t, isDue);
  if (isDue) toast('⏰ 到点了：' + (t.name || '待办提醒'), 4200);

  const actions = [];
  if (isDue) {
    actions.push({
      label: '标记完成',
      run: () => {
        const item = tasks.find((x) => x.id === t.id);
        if (!item) return;
        item.done = true;
        notified[t.id] = true;
        saveNotified(); saveTasks(); render();
        toast('已完成：' + (item.name || '任务'));
      },
    });
    actions.push({
      label: '10 分钟后再提醒',
      run: () => {
        delete notified[t.id];
        snooze[t.id] = Date.now() + 10 * 60 * 1000;
        saveNotified(); saveSnooze();   // persist, or a refresh would re-fire at once
        toast('好的，10 分钟后再提醒你');
      },
    });
  }
  actions.push({ label: '知道了' });

  return showAlert({
    title: isDue ? '⏰ 到点提醒' : '🔔 通知测试',
    body: isDue
      ? (t.name || '待办提醒')
      : '如果你在页面右下角看到了这张卡，说明页面内提醒工作正常；如果系统通知也弹了，那 Windows 这边也通了。',
    tag: isDue ? ([t.category, pri.label + '优先'].filter(Boolean).join(' · ')) : '页面内提醒',
    color: pri.color,
    actions,
  });
}

function testNotify() {
  presentAlert({ id: 'test', name: '这是一条测试提醒', priority: 'mid', category: '设置' }, 'test');
  updateNotifyUi();
  updateNotifyHint();
  if (!('Notification' in window)) {
    toast('这个浏览器不支持系统通知，已用页面内提醒卡代替', 4600);
    return;
  }
  if (Notification.permission === 'granted') {
    toast('已发送：系统通知 + 页面内提醒卡 · 都没看到就点「打开 Windows 通知设置」', 6000);
  } else if (Notification.permission === 'denied') {
    openSettings('notify');
    toast('浏览器通知被拒绝，已用页面内提醒卡代替', 4600);
  } else {
    askPermission(false);
  }
}

/* local timer: catch up on anything that came due, even if the tab was asleep */
function checkDue() {
  const now = Date.now();
  let changed = false;
  tasks.forEach((t) => {
    if (t.done || !t.time || notified[t.id]) return;
    if (snooze[t.id] > now) return;                 // "remind me in 10 minutes"
    const ts = new Date(t.time).getTime();
    if (Number.isNaN(ts)) return;
    /* overdue by at most 12h: a tab that was closed overnight still tells you */
    if (ts <= now && now - ts <= 12 * 60 * 60 * 1000) {
      presentAlert(t);
      notified[t.id] = true;
      changed = true;
    }
  });
  if (changed) { saveNotified(); render(); }
}

function refreshCountdowns() {
  if (!taskList) return;
  taskList.querySelectorAll('.task').forEach((node) => {
    const t = tasks.find((x) => x.id === node.dataset.id);
    const cd = node.querySelector('.task__count');
    if (!t || !cd) return;
    cd.textContent = countdownText(t);
    cd.className = 'task__count ' + countdownClass(t);
    const val = node.querySelector('.pill__val');
    if (val) val.textContent = t.time ? fmtTime(new Date(t.time)) : '未设时间';
  });
}

/* ------------------------------------------------------------------- DeepSeek */
function buildSystemPrompt() {
  const now = new Date();
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const nowStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ' ' + wd;
  return [
    '你是一个待办事项解析助手。用户会用大白话描述他/她想做的事，你要把它拆解成结构化的任务列表。',
    '',
    '当前本地时间（用户时区）：' + nowStr,
    '',
    '只输出 JSON，不要输出任何解释文字、不要用 markdown 代码块。JSON 结构必须是：',
    '{"tasks":[{"name":"任务名","time":"YYYY-MM-DDTHH:MM","priority":"high|mid|low","category":"类别","duration":"时长，如 2 小时，可为空"}]}',
    '',
    '规则：',
    '1. time 必须是本地时间，格式严格为 YYYY-MM-DDTHH:MM（24 小时制，不带秒、不带时区后缀）。',
    '2. 如果用户没给任何时间信息，time 返回 null。',
    '3. 如果时间模糊（例如「下午」「上午」「晚上」「中午」），按以下默认值补全：',
    '   上午/早上 => 当天 09:00；中午 => 当天 12:00；下午 => 当天 14:00；傍晚 => 当天 18:00；晚上 => 当天 20:00；',
    '   只说「今天」不说时段 => 当天 14:00。日期模糊（明天/后天/下周一/周五等）请依据当前时间推算成具体日期。',
    '4. priority：明确说「重要、急、尽快、必须」等 => high；说「不急、有空再说、随意」等 => low；其他 => mid。',
    '5. category 用 2-4 个字的简短中文类别，例如：工作、学习、生活、健康、购物、社交、家务、理财。',
    '6. 一句话里有多个可独立执行的任务时，拆成多条。',
    '7. name 要简洁明确，保留关键动作与对象，去掉时间词。',
  ].join('\n');
}

function extractJson(s) {
  s = String(s).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch (e) { /* keep trying */ }
  let i = s.indexOf('{');
  let j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { /* keep trying */ }
  }
  i = s.indexOf('[');
  j = s.lastIndexOf(']');
  if (i >= 0 && j > i) {
    try { return { tasks: JSON.parse(s.slice(i, j + 1)) }; } catch (e) { /* give up */ }
  }
  throw new Error('AI 返回的不是合法 JSON：' + s.slice(0, 120));
}

function parseWithApi(text) {
  const key = getKey();
  if (!key) return Promise.reject(new Error('NO_KEY'));
  const payload = {
    model: getModel(),
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    stream: false,
  };
  return fetch(getBase() + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(payload),
  }).then((res) => res.text().then((raw) => {
    if (!res.ok) {
      let msg = raw;
      try { msg = (JSON.parse(raw).error || {}).message || raw; } catch (e) { /* keep raw */ }
      throw new Error('接口返回 ' + res.status + '：' + msg);
    }
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('接口返回内容无法解析'); }
    const content = data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (!content) throw new Error('接口未返回内容');
    return extractJson(content);
  }));
}

/* ------------------------------------------------- offline fallback parser */
function parseLocally(text) {
  const out = [];
  let parts = String(text)
    .split(/[\n；;。]+|(?:\s+然后\s+)|(?:\s+还有\s+)|(?:，\s*再)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) parts = [String(text).trim()];

  parts.forEach((seg) => {
    let pri = 'mid';
    if (/(重要|紧急|急|尽快|必须|马上|立刻)/.test(seg)) pri = 'high';
    if (/(不急|有空|随意|随便|顺带)/.test(seg)) pri = 'low';

    let cat = '';
    const catMap = [
      [/开会|会议|汇报|报表|客户|项目|邮件|方案|预算|周会|工作|加班|写代码|需求/, '工作'],
      [/看书|学习|复习|考试|背单词|课程|作业|论文|读书|阅读/, '学习'],
      [/买菜|购物|超市|牛奶|鸡蛋|快递|下单|网购/, '购物'],
      [/跑步|健身|锻炼|医院|吃药|体检|睡觉|休息/, '健康'],
      [/打扫|洗衣|做饭|家务|收拾|整理/, '家务'],
      [/朋友|聚餐|见面|电话|约会|社交|生日/, '社交'],
    ];
    for (let i = 0; i < catMap.length; i++) {
      if (catMap[i][0].test(seg)) { cat = catMap[i][1]; break; }
    }

    const base = new Date();
    let d = null;
    let dayOffset = 0;
    if (/大后天/.test(seg)) dayOffset = 3;
    else if (/后天/.test(seg)) dayOffset = 2;
    else if (/明天|明早|明晚/.test(seg)) dayOffset = 1;

    const hm = seg.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
    const hOnly = seg.match(/(\d{1,2})\s*点\s*(半|\d{1,2}\s*分)?/);
    let hour = null;
    let minute = 0;
    if (hm) { hour = +hm[1]; minute = +hm[2]; }
    else if (hOnly) {
      hour = +hOnly[1];
      if (hOnly[2] === '半') minute = 30;
      else if (hOnly[2]) minute = parseInt(hOnly[2], 10) || 0;
    }
    if (hour !== null && /下午|晚上|傍晚/.test(seg) && hour < 12) hour += 12;

    const hasVague = /上午|早上|中午|下午|傍晚|晚上|今天|明天|后天/.test(seg);
    if (hour === null && hasVague) {
      if (/上午|早上|明早/.test(seg)) hour = 9;
      else if (/中午/.test(seg)) hour = 12;
      else if (/傍晚/.test(seg)) hour = 18;
      else if (/晚上|明晚/.test(seg)) hour = 20;
      else hour = 14;               // "下午" and bare "今天" both land at 14:00
    }
    if (hour !== null) {
      d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, minute, 0, 0);
    }

    let name = seg
      .replace(/今天|明天|后天|大后天|上午|早上|中午|下午|傍晚|晚上|明早|明晚/g, '')
      .replace(/\d{1,2}\s*[:：]\s*\d{1,2}/g, '')
      .replace(/\d{1,2}\s*点\s*(半|\d{1,2}\s*分)?/g, '')
      .replace(/重要|紧急|尽快|必须|马上|立刻|不急|有空再说/g, '')
      .replace(/^[，,、\s的]+|[，,、\s]+$/g, '')
      .trim();
    if (!name) name = seg.trim();

    const dur = seg.match(/(\d+(?:\.\d+)?)\s*(个)?\s*(小时|分钟|h|min)/i);
    out.push({
      name,
      time: d ? d.toISOString() : null,
      priority: pri,
      category: cat,
      duration: dur ? dur[1] + (/小时|h/i.test(dur[3]) ? ' 小时' : ' 分钟') : '',
    });
  });
  return { tasks: out };
}

/* ------------------------------------------------------- normalize + add */
function normTask(raw) {
  if (!raw) return null;
  const name = String(raw.name || raw.title || raw.task || raw.content || raw['事项'] || '').trim();
  if (!name) return null;

  let d = null;
  const t = raw.time || raw.datetime || raw.date || raw['时间'] || null;
  if (t && typeof t === 'string') {
    const s = t.trim();
    if (s && !/^(null|none|无|待定|-)$/i.test(s)) {
      /* 两种格式必须分开处理，否则每存读一次就偏一个时区：
         · "2026-10-15T16:00:00.000Z"（带 Z / ±偏移）= 绝对时刻，交给原生解析
         · "2026-10-15T16:00"（模型按约定返回的本地时间）= 按用户本地时区理解 */
      const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
      if (hasZone) {
        const p = new Date(s);
        if (!Number.isNaN(p.getTime())) d = p;
      }
      if (!d) d = fromLocalInput(s.replace(/\//g, '-'));
      if (!d) {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) d = new Date(+m[1], +m[2] - 1, +m[3], 14, 0, 0, 0);   // 只给日期 -> 当天 14:00
      }
      if (!d) { const p = new Date(s); if (!Number.isNaN(p.getTime())) d = p; }
    }
  }

  return {
    id: 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    name,
    time: d ? d.toISOString() : null,
    priority: normPriority(raw.priority || raw.level || raw['优先级']),
    category: String(raw.category || raw.tag || raw['类别'] || '').trim(),
    duration: String(raw.duration || raw['时长'] || '').trim(),
    done: false,
    created: Date.now(),
  };
}

function addTasks(list) {
  let added = 0;
  (list || []).forEach((r) => {
    const t = normTask(r);
    if (t) { tasks.push(t); added += 1; }
  });
  return added;
}

function maybeAskNotify() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  const hasFuture = tasks.some((t) => t.time && !t.done && new Date(t.time).getTime() > Date.now());
  if (hasFuture) askPermission(true);
}

function replaceIfRequested() {
  if (appendChk && !appendChk.checked) {
    tasks = [];
    notified = {};
    snooze = {};
    saveNotified(); saveSnooze();
  }
}

/* -------------------------------------------------------------------- actions */
function setBusy(state) {
  busy = state;
  decomposeBtn.disabled = state;
  decomposeLabel.textContent = state ? '解析中…' : '智能拆解';
  localBtn.disabled = state;
  document.body.classList.toggle('is-busy', state);
}

/* open the settings sheet, highlight the field it was opened for */
function openSettings(focus) {
  apiKeyInput.value = localStorage.getItem(LS_KEY) || '';
  apiModelInput.value = getModel();
  apiBaseInput.value = localStorage.getItem(LS_BASE) || 'https://api.deepseek.com';
  if (alertChk) alertChk.checked = inPageAlertOn();
  settings.classList.add('is-open');
  settings.setAttribute('aria-hidden', 'false');
  settings.classList.toggle('is-notify-focus', focus === 'notify');
  setTimeout(() => {
    try {
      if (focus === 'notify' && notifyHint) {
        notifyHint.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        updateNotifyHint();
      } else {
        apiKeyInput.focus();
      }
    } catch (e) { /* ignore */ }
  }, 60);
}

function doDecompose() {
  if (busy) return;
  const text = nlInput.value.trim();
  if (!text) { toast('先写点内容吧～'); nlInput.focus(); return; }
  if (!getKey()) {
    toast('还没有配置 API Key，先点「设置」填写，或改用「离线解析」', 4200);
    openSettings();
    return;
  }

  setBusy(true);
  parseWithApi(text).then((obj) => {
    const list = Array.isArray(obj) ? obj : (obj.tasks || obj.list || obj.items || obj['待办'] || []);
    if (!Array.isArray(list) || !list.length) throw new Error('AI 没有解析出任何任务');
    replaceIfRequested();
    const n = addTasks(list);
    if (!n) throw new Error('AI 返回的任务缺少任务名');
    saveTasks(); render();
    animateIn(taskList.querySelectorAll('.task'));
    nlInput.value = '';
    toast('已解析出 ' + n + ' 个任务 ✅');
    maybeAskNotify();
  }).catch((err) => {
    const m = (err && err.message) ? err.message : String(err);
    if (m === 'NO_KEY') { openSettings(); return; }
    /* 脱敏后再打印：万一错误信息里带了请求头，也不要把 Key 留在控制台 */
    console.error('[decompose] failed:', redact(m));
    const extra = /Failed to fetch|NetworkError|Load failed/i.test(m)
      ? '（可能是网络不通，或浏览器拦截了跨域请求。可改用「离线解析」。）' : '';
    toast('调用失败：' + m + extra, 6000);
  }).then(() => setBusy(false));
}

function doLocalParse() {
  if (busy) return;
  const text = nlInput.value.trim();
  if (!text) { toast('先写点内容吧～'); nlInput.focus(); return; }
  replaceIfRequested();
  const n = addTasks(parseLocally(text).tasks);
  saveTasks(); render();
  animateIn(taskList.querySelectorAll('.task'));
  nlInput.value = '';
  toast('离线解析完成，共 ' + n + ' 个任务 ⚡（时间可手动修改）');
  maybeAskNotify();
}

/* ------------------------------------------------------------------ wire up */
function wire() {
  $('btn-settings').addEventListener('click', () => openSettings());
  const settingsTop = $('btn-settings-top');
  if (settingsTop) settingsTop.addEventListener('click', () => openSettings());
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-cancel').addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);
  $('btn-eye').addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    $('btn-eye').textContent = apiKeyInput.type === 'password' ? '显示' : '隐藏';
  });
  $('settings-save').addEventListener('click', () => {
    const k = apiKeyInput.value.trim();
    try {
      localStorage.setItem(LS_KEY, k);
      localStorage.setItem(LS_MODEL, apiModelInput.value);
      localStorage.setItem(LS_BASE, apiBaseInput.value.trim() || 'https://api.deepseek.com');
    } catch (e) { /* ignore */ }
    closeSettings();
    toast(k ? '已保存到本地浏览器 ✅ 下次打开不用再填' : '已清空 API Key');
  });

  decomposeBtn.addEventListener('click', doDecompose);
  localBtn.addEventListener('click', doLocalParse);
  if (notifyBtn) notifyBtn.addEventListener('click', () => askPermission(false));

  /* ---- 到点提醒：权限 / 测试 / Windows 设置 / 页面内提醒卡开关 ---- */
  const notifyEnable = $('btn-notify-enable');
  if (notifyEnable) notifyEnable.addEventListener('click', () => askPermission(false));
  const notifyTest = $('btn-notify-test');
  if (notifyTest) notifyTest.addEventListener('click', testNotify);
  const winSettings = $('btn-win-settings');
  if (winSettings) {
    winSettings.addEventListener('click', () => {
      try { window.open('ms-settings:notifications', '_self'); }
      catch (e) { toast('没能自动打开设置：请按 Win+I → 系统 → 通知，确认通知与专注助手都允许', 6000); }
    });
  }
  if (alertChk) {
    alertChk.addEventListener('change', () => {
      try { localStorage.setItem(LS_ALERT, alertChk.checked ? '1' : '0'); } catch (e) { /* ignore */ }
      if (alertChk.checked) { toast('页面内提醒卡已开启'); testNotify(); }
      else { toast('页面内提醒卡已关闭，只保留系统通知'); }
    });
  }

  $('btn-clear-done').addEventListener('click', () => {
    tasks = tasks.filter((t) => !t.done);
    saveTasks(); render();
    toast('已清除完成的任务');
  });
  $('btn-clear-all').addEventListener('click', () => {
    if (!tasks.length) { toast('列表已经是空的'); return; }
    tasks = []; notified = {}; snooze = {};
    saveNotified(); saveSnooze(); saveTasks(); render();
    toast('已清空全部任务');
  });

  nlInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doDecompose(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (alertLayerEl && alertLayerEl.lastElementChild) { closeAlert(alertLayerEl.lastElementChild); return; }
    if (settings.classList.contains('is-open')) closeSettings();
  });

  /* a background tab is throttled, so catch up the moment it comes back */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { checkDue(); refreshCountdowns(); }
  });
}

/* --------------------------------------------------------------------- boot */
function boot() {
  wire();
  render();
  updateNotifyUi();
  updateNotifyHint();

  if (!('Notification' in window)) {
    showBanner('当前浏览器不支持系统通知：到点会在页面右下角弹提醒卡（点「设置」可测试）。');
  } else if (!isLocal()) {
    showBanner('页面是 file:// 打开的，浏览器不允许发系统通知。双击 launcher.pyw，用 http://localhost:8000/index.html 打开即可（设置里可测试）。');
  } else if (!window.isSecureContext) {
    showBanner('当前不是安全来源，浏览器不允许发系统通知。请用 launcher.pyw 的 http://localhost:8000 打开。');
  } else if (Notification.permission === 'default') {
    showBanner('想让 Windows 右下角弹出提醒？点右上角「开启通知」授权；只是想页面内提醒的话，现在已经可以了。');
  } else if (Notification.permission === 'denied') {
    showBanner('浏览器通知被拒绝，已自动改用页面内提醒卡（不会漏事）。想恢复系统通知：地址栏左侧锁图标 → 网站设置 → 通知 → 允许。');
  }

  setInterval(checkDue, 10000);
  setInterval(refreshCountdowns, 30000);
  checkDue();

  /* entrance motion for whatever was already stored */
  animateIn(taskList.querySelectorAll('.task'));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* keep the video going even if autoplay was deferred */
if (video) {
  video.muted = true;
  const kick = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
  video.addEventListener('canplay', kick);
  document.addEventListener('click', kick, { once: true });
  kick();
}

})();
