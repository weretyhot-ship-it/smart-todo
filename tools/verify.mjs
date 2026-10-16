/* ============================================================================
   tools/verify.mjs — 用一条命令验证整个页面有没有坏

   为什么要写它：这个项目是两个普通 <script>（不是模块）共享同一个全局作用域，
   任何一个文件里出现语法错误，整个脚本都不会执行，而表现只是"按钮全都没反应"。
   在浏览器里靠刷新和肉眼找一个作用域冲突的 bug 非常慢，所以这里把两个脚本按
   网页真实的方式装进同一个 Node vm 上下文里跑，出问题直接定位到行。

   它同时模拟了浏览器的最小 DOM（不是真的浏览器，只覆盖这个页面用到的 API）。

   用法:  node tools/verify.mjs      （等价于 npm test，零依赖）
   退出码 0 = 全部通过，1 = 有失败项
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------------------------------------------------------------- tiny DOM */
let uid = 0;
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; on ? this.set.add(c) : this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
  get value() { return [...this.set].join(' '); }
}
class Node {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._listeners = {};
    this.classList = new ClassList(this);
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this._id = uid++;
  }
  /* classList must survive a className assignment: sync, never replace */
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this.classList.value; }
  /* render() clears the list with innerHTML = '' */
  set innerHTML(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._html = String(v); }
  get innerHTML() { return this._html || ''; }
  setAttribute(k, v) {
    this._attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'id') this.id = String(v);
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; }
  hasAttribute(k) { if (k === 'hidden') return !!this.hidden; return k in this._attrs; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(typeof n === 'string' ? new TextNode(n) : n)); }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; } return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...ns) { this.innerHTML = ''; ns.forEach((n) => this.appendChild(n)); }
  get firstElementChild() { return this.children.find((c) => !(c instanceof TextNode)) || null; }
  get lastElementChild() { const e = this.children.filter((c) => !(c instanceof TextNode)); return e[e.length - 1] || null; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatch(type, ev) { (this._listeners[type] || []).forEach((fn) => fn(ev || {})); }
  click() { this.dispatch('click', { target: this, preventDefault() {} }); if (this.tagName === 'BUTTON') this.dispatch('click', { target: this, preventDefault() {} }); }
  focus() {}
  contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 20, top: 20, width: 356, height: 480, right: 376, bottom: 500 }; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c instanceof TextNode) return; if (matches(c, sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === document; }
}
class TextNode { constructor(t) { this.text = t; this.parentNode = null; } }
function matches(el, sel) {
  return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((one) => {
    const parts = one.split(/(?=[.#\[])/).filter(Boolean);
    return parts.every((p) => {
      if (p.startsWith('.')) return el.classList.contains(p.slice(1));
      if (p.startsWith('#')) return el.id === p.slice(1);
      if (p.startsWith('[')) return el.hasAttribute(p.slice(1, -1).split('=')[0]);
      return el.tagName === p.toUpperCase();
    });
  });
}

const byId = {};
const document = new Node('#document');
document.documentElement = new Node('html');
document.head = new Node('head');
document.body = new Node('body');
document.appendChild(document.documentElement);
document.documentElement.appendChild(document.head);
document.documentElement.appendChild(document.body);
document.readyState = 'complete';
document.hidden = false;
document._listeners = {};
document.addEventListener = Node.prototype.addEventListener.bind(document);
document.dispatchEvent = Node.prototype.dispatch.bind(document);
document.documentElement.clientWidth = 1440;
document.documentElement.clientHeight = 900;
document.createElement = (t) => {
  const n = new Node(t);
  if (t === 'canvas') n.getContext = () => ({ drawImage() {} });
  return n;
};
document.createElementNS = (ns, t) => new Node(t);
document.getElementById = (id) => byId[id] || null;
document.querySelector = (sel) => document.body.querySelector(sel) || document.documentElement.querySelector(sel);
document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);

/* build a node for every id="..." in the real HTML, nesting them the same way */
const openTags = [];
const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
let m;
while ((m = tagRe.exec(html))) {
  const [, close, tag, attrs, selfClose] = m;
  if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
  if (close) {
    for (let i = openTags.length - 1; i >= 0; i--) { if (openTags[i].tagName === tag.toUpperCase()) { openTags.length = i; break; } }
    continue;
  }
  const idMatch = attrs.match(/\bid="([^"]+)"/);
  const classMatch = attrs.match(/\bclass="([^"]+)"/);
  if (!idMatch && !classMatch) { if (!selfClose) openTags.push(new Node(tag)); continue; }
  const el = new Node(tag);
  if (idMatch) { el.id = idMatch[1]; byId[el.id] = el; }
  if (classMatch) el.className = classMatch[1];
  const parent = openTags.length ? openTags[openTags.length - 1] : document.body;
  parent.appendChild(el);
  if (!selfClose) openTags.push(el);
}
byId['bg-video'].videoWidth = 1920;
byId['bg-video'].videoHeight = 1080;
byId['bg-video'].play = () => Promise.resolve();

/* ---------------------------------------------------------------- browser bits */
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.localStorage = localStorage;
const session = new Map();
const sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
};
global.sessionStorage = sessionStorage;

const notifications = [];
let permission = 'default';
function Notification(title, opts) { this.title = title; Object.assign(this, opts || {}); notifications.push(this); this.close = () => {}; }
Notification.permission = permission;
Notification.requestPermission = () => { Notification.permission = 'granted'; return Promise.resolve('granted'); };
global.Notification = Notification;

const alerts = [];
const timers = [];
const nodeSetTimeout = global.setTimeout;
const nodeClearTimeout = global.clearTimeout;
global.window = global;
global.document = document;
global.location = { protocol: 'http:', href: 'http://localhost:8000/index.html', origin: 'http://localhost:8000' };
global.isSecureContext = true;
global.fetch = () => Promise.reject(new Error('not used in this harness'));
global.console = console;
global.setTimeout = (fn, ms) => { const id = nodeSetTimeout(fn, Math.min(ms || 0, 1)); return id; };
global.clearTimeout = nodeClearTimeout;
global.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearInterval = () => {};
global.requestAnimationFrame = (fn) => nodeSetTimeout(() => fn(Date.now()), 0);
global.alert = (m) => alerts.push(m);
global.AudioContext = function () {
  return {
    state: 'running', currentTime: 0, destination: {}, resume() {},
    createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
    createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: {}, type: '' }),
  };
};

/* -------------------------------------------------- load the two real scripts */
const uiSrc = fs.readFileSync(path.join(ROOT, 'ui.js'), 'utf8');
const glassSrc = fs.readFileSync(path.join(ROOT, 'glass-card.js'), 'utf8');

function makeEnv() {
  const byId = {};
  const doc = new Node('#document');
  doc.documentElement = new Node('html');
  doc.head = new Node('head');
  doc.body = new Node('body');
  doc.appendChild(doc.documentElement);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.readyState = 'complete';
  doc.hidden = false;
  doc.addEventListener = Node.prototype.addEventListener.bind(doc);
  doc.dispatchEvent = Node.prototype.dispatch.bind(doc);
  doc.documentElement.clientWidth = 1440;
  doc.documentElement.clientHeight = 900;
  doc.createElement = (t) => { const n = new Node(t); if (t === 'canvas') n.getContext = () => ({ drawImage() {} }); return n; };
  doc.createElementNS = (ns, t) => new Node(t);
  doc.getElementById = (id) => byId[id] || null;
  doc.querySelector = (sel) => doc.body.querySelector(sel) || doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);

  /* build a node for every id="..." in the real HTML, nested the same way */
  const openTags = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, close, tag, attrs, selfClose] = m;
    if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
    if (close) {
      for (let i = openTags.length - 1; i >= 0; i--) {
        if (openTags[i].tagName === tag.toUpperCase()) { openTags.length = i; break; }
      }
      continue;
    }
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const classMatch = attrs.match(/\bclass="([^"]+)"/);
    if (!idMatch && !classMatch) { if (!selfClose) openTags.push(new Node(tag)); continue; }
    const el = new Node(tag);
    if (idMatch) { el.id = idMatch[1]; byId[el.id] = el; }
    if (classMatch) el.className = classMatch[1];
    const parent = openTags.length ? openTags[openTags.length - 1] : doc.body;
    parent.appendChild(el);
    if (!selfClose) openTags.push(el);
  }
  byId['bg-video'].videoWidth = 1920;
  byId['bg-video'].videoHeight = 1080;
  byId['bg-video'].play = () => Promise.resolve();

  /* ------------------------------------------------------------ browser bits */
  const store = new Map();
  const session = new Map();
  const notifications = [];
  const timers = [];
  const mkStore = (map) => ({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  });
  function Notification(title, opts) {
    this.title = title; Object.assign(this, opts || {}); notifications.push(this); this.close = () => {};
  }
  let perm = { v: 'default' };
  Object.defineProperty(Notification, 'permission', {
    get: () => perm.v, set: (v) => { perm.v = v; }, configurable: true,
  });
  Notification.requestPermission = () => { perm.v = 'granted'; return Promise.resolve('granted'); };

  const sandbox = {
    document: doc, location: { protocol: 'http:', href: 'http://localhost:8000/index.html' },
    isSecureContext: true, console, Notification, crypto: { randomUUID: () => 'uuid-' + (uid++) },
    localStorage: mkStore(store), sessionStorage: mkStore(session),
    fetch: () => Promise.reject(new Error('offline in harness')),
    setTimeout: (fn, ms) => nodeSetTimeout(fn, Math.min(ms || 0, 1)),
    clearTimeout: nodeClearTimeout,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    requestAnimationFrame: (fn) => nodeSetTimeout(() => fn(Date.now()), 0),
    AudioContext: function () {
      return {
        state: 'running', currentTime: 0, destination: {}, resume() {},
        createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }),
        createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: {}, type: '' }),
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  /* after contextifying, the global bindings live on the context object */
  Object.defineProperty(ctx, 'Notification', { value: Notification, writable: true, configurable: true });
  const setPermission = (v) => { perm.v = v; };
  return { ctx, byId, store, session, notifications, timers, doc, Notification, sandbox, setPermission };
}

function boot(env, seedTasks) {
  if (seedTasks) env.store.set('smart_todo_tasks', JSON.stringify(seedTasks));
  vm.runInContext(glassSrc, env.ctx, { filename: 'glass-card.js' });   // same global scope:
  vm.runInContext(uiSrc, env.ctx, { filename: 'ui.js' });              // const collisions would throw here
  return env;
}

const results = [];
function check(name, fn) {
  try { const v = fn(); results.push([v ? 'PASS' : 'FAIL', name, v === true ? '' : String(v)]); }
  catch (e) { results.push(['THROW', name, e && e.message]); }
}

/* ------------------------------------------------------------------- 1. 冷启动 */
const e1 = boot(makeEnv());
const $ = (env, id) => env.byId[id];
const list = (env) => $(env, 'task-list').children;

check('两个脚本同作用域加载无 SyntaxError', () => true);
check('冷启动：0 个任务 + 空状态可见', () => list(e1).length === 0 && $(e1, 'task-empty').hidden === false);
check('卡片序号为 //00', () => $(e1, 'card-index').textContent === '//00');
check('启动即启动 10s 轮询', () => e1.timers.some((t) => t.ms === 10000));

/* 空状态必须给"没有 API Key 也能试"的入口，否则 GitHub Pages 上的演示没人玩得下去 */
const emptyBtns = $(e1, 'task-empty').querySelectorAll('button');
check('空状态里有「填入示例数据」和「看离线解析效果」两个入口',
  () => {
    const labels = emptyBtns.map((b) => b.textContent);
    return labels.includes('填入示例数据') && labels.includes('看离线解析效果');
  });
{
  const btn = emptyBtns.find((b) => b.textContent === '填入示例数据');
  btn.dispatch('click', {});
  check('点「填入示例数据」后卡片里出现 4 条示例任务、空状态隐藏',
    () => list(e1).length === 4 && $(e1, 'task-empty').hidden === true);
  check('示例数据覆盖三种优先级（A/B/C 都能被看到）',
    () => {
      const tiers = new Set(list(e1).map((n) => n.querySelector('.task__tierVar').textContent));
      return tiers.has('A') && tiers.has('B') && tiers.has('C');
    });
  /* 名字太长会在卡片里折成两行（卡片正文宽约 250px），示例数据是门面，一条一行 */
  check('示例任务名都在 10 个汉字以内（不会折行）',
    () => {
      const rows = JSON.parse(e1.store.get('smart_todo_tasks') || '[]');
      const tooLong = rows.filter((r) => r.name.replace(/\s/g, '').length > 10).map((r) => r.name);
      if (tooLong.length) throw new Error('过长: ' + tooLong.join(' / '));
      return true;
    });
  check('示例数据能落进 localStorage（刷新后还在）',
    () => JSON.parse(e1.store.get('smart_todo_tasks') || '[]').length === 4);

  /* 示例数据是给别人截图/试用的门面：时间不能随点击时刻漂到凌晨 */
  check('示例任务的时间都在未来、且落在 7:00–23:00 之间',
    () => {
      const rows = JSON.parse(e1.store.get('smart_todo_tasks') || '[]');
      const timed = rows.filter((r) => r.time);
      if (timed.length !== 2) return false;
      return timed.every((r) => {
        const d = new Date(r.time);
        return d.getTime() > Date.now() && d.getHours() >= 7 && d.getHours() <= 23;
      });
    });
  check('示例任务的时间显示为「今天/明天 HH:MM」的正常钟点',
    () => {
      const pills = list(e1).map((n) => n.querySelector('.pill__val'))
        .filter(Boolean).map((p) => p.textContent);
      const timed = pills.filter((t) => t !== '未设时间');   // 两条不设时间的任务
      return pills.length === 4 && timed.length === 2 &&
        timed.every((t) => /^(今天|明天|\d+月\d+日) \d{2}:\d{2}$/.test(t));
    });
}

/* 示例数据不能堆叠：再点一次必须是"替换上一批示例"，而不是追加 */
{
  const e = boot(makeEnv());
  const sampleBtn = $(e, 'task-empty').querySelectorAll('button').find((b) => b.textContent === '填入示例数据');
  sampleBtn.dispatch('click', {});          // 第一次：4 条
  sampleBtn.dispatch('click', {});          // 第二次：应替换，不是 8 条
  check('再点一次「填入示例数据」是替换而不是追加（仍是 4 条）', () => list(e).length === 4);
  check('替换后卡片上只剩一批示例时间（没有过期的旧时间）', () => {
    const rows = JSON.parse(e.store.get('smart_todo_tasks') || '[]');
    return rows.filter((r) => r.sample).length === 4 &&
      rows.every((r) => !r.time || new Date(r.time).getTime() > Date.now());
  });
  check('用户自己清空后再填示例仍然正常（清空全部 → 填入示例）', () => {
    $(e, 'btn-clear-all').dispatch('click', {});
    if (list(e).length !== 0) return false;
    const again = $(e, 'task-empty').querySelectorAll('button').find((b) => b.textContent === '填入示例数据');
    again.dispatch('click', {});
    return list(e).length === 4;
  });
}
/* ------------------------------------------------- 2. 旧版 localStorage 继承 */
const now = Date.now();
const seeds = [
  { id: 'a', name: '写周报', time: new Date(now + 3600e3).toISOString(), priority: 'low', category: '工作', done: false, created: 1 },
  { id: 'b', name: '交房租', time: new Date(now - 60e3).toISOString(), priority: 'high', category: '生活', done: false, created: 2 },
];
const e2 = boot(makeEnv(), seeds);

check('旧键名 smart_todo_tasks 数据无缝继承', () => list(e2).length === 2);
check('按优先级排序：high 在前', () => list(e2)[0].dataset.id === 'b' && list(e2)[1].dataset.id === 'a');
check('统计文案正确', () => $(e2, 'card-stat').textContent === '2 项未完成 · 2 项定时');
check('卡片序号 //02', () => $(e2, 'card-index').textContent === '//02');

/* 时区回归：任务时间内部存 ISO（UTC），用户看到的是本地时间。
   曾经因为不区分「带 Z 的绝对时刻」和「模型给的本地时间」，每存读一次偏一个时区。 */
check('ISO(UTC) 时间读回来后仍是用户输入的本地钟点（时区不漂移）', () => {
  const t = new Date(2026, 9, 15, 16, 0, 0, 0);          // 用户输入的本地 16:00
  const e = boot(makeEnv(), [{ id: 'tz', name: '时区检查', time: t.toISOString(), priority: 'mid', done: false }]);
  const back = new Date(JSON.parse(e.store.get('smart_todo_tasks'))[0].time);
  return back.getHours() === 16 && back.getMinutes() === 0 && back.getDate() === 15;
});
check('模型返回的「本地时间」字符串（无 Z）按本地时区理解', () => {
  const e = boot(makeEnv(), []);
  $(e, 'nl-input').value = '明天下午3点交项目方案';
  $(e, 'btn-local').dispatch('click', {});
  const row = JSON.parse(e.store.get('smart_todo_tasks'))[0];
  return new Date(row.time).getHours() === 15;
});
const rowB = list(e2)[0];
check('卡片结构：勾选框 + 名称 + 优先级 tier 标',
  () => !!(rowB.querySelector('.task__check') && rowB.querySelector('.task__name') &&
    rowB.querySelector('.task__tier') && rowB.querySelector('.task__tierVar')));
check('折叠编辑器存在（时间 + 优先级控件）',
  () => !!(rowB.querySelector('.task__time') && rowB.querySelector('.task__pri')));
check('元信息行：倒计时 + 时间 pill + 删除',
  () => !!(rowB.querySelector('.task__count') && rowB.querySelector('.pill__val') && rowB.querySelector('.task__del')));
check('时间 pill 显示本地时间', () => /月|今天|明天/.test(rowB.querySelector('.pill__val').textContent));
check('优先级色值写入 --p / data-pri', () => rowB.dataset.pri === 'high');
check('优先级不再是彩色圆点，而是 A/B/C 字母标',
  () => rowB.querySelector('.task__tierVar').textContent === 'A' &&
    !/🔴|🟡|🟢/.test(rowB.querySelector('.task__tierVar').textContent));
check('低优先级用 C 标', () => list(e2)[1].querySelector('.task__tierVar').textContent === 'C');
check('标题已改为「智能待办清单」', () => /智能待办清单/.test(html));
check('菜单按钮与滑入菜单已删除',
  () => !/id="menu-open"/.test(html) && !/id="menu"/.test(html) && !/menu__link/.test(html));
check('设置面板关闭按钮改用 .sheet__close（不再引用 .menu__close）',
  () => /class="sheet__close"/.test(html) && !/menu__close/.test(html));

/* ---------------------------------------------------------- 3. 到点提醒链路 */
check('到点后在页面右下角生成提醒卡', () => $(e2, 'alert-layer').children.length === 1);
check('提醒卡带标题/正文/按钮', () => {
  const n = $(e2, 'alert-layer').children[0];
  return !!(n.querySelector('.alert__title') && n.querySelector('.alert__body') &&
    n.querySelector('.alert__row').children.length >= 3);
});
check('未授权时不发系统通知，只发页面内提醒', () => e2.notifications.length === 0);
check('已提醒的任务记入 smart_todo_notified',
  () => JSON.parse(e2.store.get('smart_todo_notified') || '{}').b === true);

/* 提醒卡上的「10 分钟后再提醒」不应立刻重复提醒 */
const snoozeBtn = $(e2, 'alert-layer').children[0].querySelector('.alert__row').children[1];
snoozeBtn.dispatch('click', {});
check('「10 分钟后再提醒」写进本次会话（刷新不会立刻重复提醒）',
  () => JSON.parse(e2.session.get('smart_todo_notified_snooze') || '{}').b > Date.now());
check('稍后提醒会清掉已提醒标记（到点后还会再响）',
  () => JSON.parse(e2.store.get('smart_todo_notified') || '{}').b !== true);

/* ---------------------------------------------------- 4. 勾选 / 排序 / 删除 */
const cb = rowB.querySelector('.task__check');
cb.checked = true; cb.dispatch('change', {});
check('勾选完成后重新渲染，done 样式生效', () => list(e2).some((n) => n.dataset.id === 'b' && n.classList.contains('task--done')));
check('完成的沉到未完成的后面', () => list(e2)[1].dataset.id === 'b');
list(e2)[1].querySelector('.task__del').dispatch('click', {});
check('删除按钮移除该条', () => list(e2).length === 1 && list(e2)[0].dataset.id === 'a');

/* -------------------------------------------------- 5. 通知：授权后的测试 */
e2.setPermission('granted');
check('权限切换后 ui.js 读到的是同一个权限',
  () => vm.runInContext('Notification.permission', e2.ctx) === 'granted');
const before = e2.notifications.length;
$(e2, 'btn-notify-test').dispatch('click', {});
check('测试通知：系统通知 + 页面内提醒卡',
  () => e2.notifications.length === before + 1 && $(e2, 'alert-layer').children.length === 2);
check('系统通知 silent: true（静音）', () => e2.notifications[e2.notifications.length - 1].silent === true);
check('通知诊断文案随权限更新', () => /浏览器权限已允许/.test($(e2, 'notify-hint').textContent));

/* ------------------------------------------------------------- 6. 设置面板 */
$(e2, 'settings-save').dispatch('click', {});
check('保存走旧键名 smart_todo_api_key', () => e2.store.has('smart_todo_api_key'));
check('保存走旧键名 smart_todo_model', () => e2.store.has('smart_todo_model'));

/* Escape：先关提醒卡，再关设置（菜单已删除，不应再有任何菜单相关引用） */
const e3 = boot(makeEnv());
$(e3, 'btn-settings-top').dispatch('click', {});
check('设置面板可打开', () => $(e3, 'settings').classList.contains('is-open'));
e3.doc.dispatchEvent('keydown', { key: 'Escape' });
check('Escape 关闭设置面板', () => !$(e3, 'settings').classList.contains('is-open'));
check('设置里有通知开关/测试/Windows 设置按钮',
  () => !!($(e3, 'btn-notify-enable') && $(e3, 'btn-notify-test') && $(e3, 'btn-win-settings') && $(e3, 'chk-alert')));

/* ------------------------------------------------------- 7. 离线解析（无网络） */
const e4 = boot(makeEnv());
$(e4, 'nl-input').value = '明天下午3点交项目方案，重要；顺便买菜';
$(e4, 'btn-local').dispatch('click', {});
check('离线解析新增任务并清空输入', () => list(e4).length === 2 && $(e4, 'nl-input').value === '');
check('离线解析能识别优先级/类别/时间', () => {
  const names = list(e4).map((n) => n.querySelector('.task__name').textContent);
  const tiers = list(e4).map((n) => n.querySelector('.task__tierVar').textContent);
  const cats = list(e4).map((n) => (n.querySelector('.badge') || {}).textContent);
  return names.length === 2 && tiers.includes('A') && cats.includes('工作');
});

/* --------------------------------------------------- 8. 页面内提醒卡开关 */
const e5 = boot(makeEnv());
$(e5, 'chk-alert').checked = false;
$(e5, 'chk-alert').dispatch('change', {});
check('关掉页面内提醒写 smart_todo_alert_inpage=0', () => e5.store.get('smart_todo_alert_inpage') === '0');

/* --------------------------------------------------- 9. file:// 打开时的诊断 */
const e6 = makeEnv();
e6.sandbox.location.protocol = 'file:';
e6.sandbox.location.href = 'file:///D:/x/index.html';
vm.runInContext(glassSrc, e6.ctx, { filename: 'glass-card.js' });
vm.runInContext(uiSrc, e6.ctx, { filename: 'ui.js' });
check('file:// 打开时给出「用 launcher.pyw」的诊断', () => /file:\/\/|launcher\.pyw/.test($(e6, 'permBanner').textContent));
check('file:// 下仍能渲染（不依赖系统通知）', () => !!$(e6, 'task-list'));

console.log('\n=== smart-todo · verify ===');
let bad = 0;
results.forEach(([s, n, extra]) => {
  if (s !== 'PASS') bad++;
  console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}${extra ? '  ->  ' + extra : ''}`);
});
console.log(`\n${results.length - bad}/${results.length} passed`);
if (bad) {
  console.log('有检查未通过：先看上面的 ✗ 行，再到 ui.js 里对应位置排查。');
}
process.exit(bad ? 1 : 0);

