# smart-todo

**Turn plain Chinese into structured todos — task name, time, priority and category — with an LLM, in a page that needs no build step and no backend.**

<p align="center">
  <img src="docs/screenshot.png" alt="Screenshot: plain-language input on the left, prioritised todo cards on the right"
       width="1100" style="margin: 12px auto">
</p>

**Online demo →** <https://weretyhot-ship-it.github.io/smart-todo/>

No API key? Click **“填入示例数据”** (fill sample data) or **“看离线解析效果”** (try the offline parser) on the empty card — both run entirely in the browser.

---

<a id="english"></a>

## English

### What it does

Type something like *“明天下午三点交论文，很重要；顺便买牛奶”* and the app calls an LLM to
split it into structured tasks — each with a **name, due time, priority and category** —
then sorts them by priority and reminds you when they come due.

**Demo:** <https://weretyhot-ship-it.github.io/smart-todo/>

- **LLM → structured JSON**: the prompt injects the current local time and weekday, so
  relative expressions (“tomorrow afternoon”, “next Monday”) resolve to real timestamps.
- **Unreliable output, handled at the boundary**: `extractJson()` tolerates markdown code
  fences and bare arrays, `normTask()` normalises every field, and the UI only ever
  receives clean data.
- **Works without a model**: a built-in regex parser needs no API key and no network. It is
  the fallback when the key is missing, the network is down, or the model times out.
- **Reminders that degrade well**: the Notification API plus an in-page reminder card with
  **complete / snooze 10 min / dismiss** actions and a soft Web Audio chime — a refused
  permission never means a missed task.
- **Local-first**: everything lives in the visitor's own `localStorage`. The site is static;
  the API key never leaves the user's browser and is never committed.

### Quick start

**Option 1 — local server (recommended; system notifications need it)**

```bash
python launcher.pyw          # starts a local static server and opens the browser
```

Then open <http://localhost:8000/index.html>.

> Why a local server: the Notification API is only available in a **secure context**
> (https or localhost). Opening the `.html` file directly via `file://` makes the browser
> refuse notifications **silently**. `launcher.pyw` exists to provide that secure origin.

**Option 2 — open the file directly**

Double-click `index.html`. Everything works except system notifications.

**Then**

1. Click **设置** (Settings) in the top-right corner and paste a
   [DeepSeek](https://platform.deepseek.com/) API key — stored only in your browser.
2. Type a sentence in the box on the left and click **智能拆解** (Decompose).
3. No key? Use **离线解析** (offline parse), or the sample-data button on the empty card.

On Windows you can also run `pythonw make-shortcut.pyw` once to get a desktop shortcut
with its own icon.

> **About notification permission**: every visitor must grant it once in their own browser.
> The permission is stored per browser and per site, so a page cannot request it on someone
> else's behalf — not even the author can do it for visitors. When it is not granted,
> reminders fall back to the in-page card (with a chime), so nothing is missed.

### Architecture

```
index.html        Page skeleton: elements and ids, no logic
styles.css        All presentation: layout, glass card, priority visuals
ui.js             All business logic: call the model → parse JSON → normalise → sort →
                  render → persist → remind
glass-card.js     One job only: copy the background video to a canvas each frame so the
                  glass card can "refract" it
launcher.pyw      Local static server + browser opener (for the secure-origin requirement)
make-shortcut.pyw Desktop shortcut with a generated icon (Windows, optional)
assets/           Static assets (icon)
tools/verify.mjs  Verification script (see below)
docs/             Screenshot used by this README
```

One data path, end to end:

```
input box → buildSystemPrompt() injects current time + parsing rules
          → fetch DeepSeek (JSON mode)
          → extractJson() pulls the JSON out (tolerates markdown / bare arrays)
          → normTask() normalises each task (time → ISO, priority → high|mid|low)
          → localStorage → sortTasks() → render() draws the cards
          → checkDue() every 10 s → system notification + in-page reminder card
```

### Four decisions worth reading

**1. Two classic scripts, one global scope, and a `const` collision**
`ui.js` and `glass-card.js` are plain `<script>` tags, so they share one global scope — and
both declared `const video`. The result: `ui.js` threw a SyntaxError, not a single line of
it ran, and the symptom was “all buttons do nothing” — easy to misdiagnose as broken event
wiring. Both files are now wrapped in IIFEs; `tools/verify.mjs` loads them into the same
context, so any future collision fails immediately.

**2. The Notification API is secure-origin only, and fails silently**
Opened via `file://`, notifications never appear and no error is raised. The fix has two
parts: `launcher.pyw` provides the `http://localhost` secure origin, and the page ships an
in-page reminder card as a fallback — plus a diagnostic that tells the user whether the
problem is the protocol, the browser permission, or the Windows notification settings.

**3. Model output is unreliable, so normalise at the boundary**
The prompt asks for JSON only, but real answers come wrapped in markdown fences, or as bare
arrays, with inconsistent time formats or Chinese priority words. `extractJson()` recovers
the JSON, `normTask()` / `normPriority()` collapse the fields into one shape, and the local
regex parser takes over if everything else fails. **Uncertainty stops at the boundary; the
cards only ever see clean data.**

**4. Verify with a script instead of refreshing the page**
See below.

### Verification

```bash
node tools/verify.mjs      # same as `npm test` — zero dependencies
```

It loads the page the way a browser does: reads the elements out of `index.html`, mocks a
minimal DOM, runs both scripts in a single global context, then executes 53 checks covering
global-scope collisions, legacy-data inheritance, priority sorting, time and time zones,
complete/delete, the reminder chain, notification fallback, the offline parser and the
sample data.

> This script is not decoration: the “all buttons do nothing” bug above was reproduced and
> located with it.

### Known limitations

- The API key is stored in the browser's `localStorage` and requests go straight from the
  page — a **BYOK (bring your own key)** trade-off to keep the app a single static folder.
  A production deployment should hold the key server-side.
- System notifications are unavailable when the page is opened via `file://`; the in-page
  reminder card still works.
- The background video is loaded from a third-party CDN, so an offline machine falls back
  to a plain background.
- No accounts, no multi-device sync; clearing site data removes the tasks too.

### Roadmap

- [ ] Import / export tasks as JSON, so local data is not a silo
- [ ] Versioned prompts plus a small evaluation set of real Chinese inputs, to compare prompt
  changes with numbers
- [ ] Streaming output (SSE) so decomposition is visible and cancellable
- [ ] A server-side proxy variant, keeping the API key out of the browser

### About this project

A small tool built during one winter break to practise **putting an LLM into a real, usable
interface**: prompt design, structured output, failure fallbacks, local persistence, and
browser-security pitfalls such as secure origins.

### License

[MIT](LICENSE)

---

<a id="中文"></a>

## 中文

### 它做什么

在输入框里写一句「明天下午三点交论文，很重要；顺便买牛奶」，它会调用大模型把这句话
拆成结构化的待办——每条都有 **任务名、时间、优先级、类别**——按优先级排好，到点提醒。

**在线演示：** <https://weretyhot-ship-it.github.io/smart-todo/>

- **大白话 → 结构化任务**：提示词里注入当前本地时间和星期，让「下午 / 明天 / 下周一」
  这类相对时间换算成具体时刻。
- **模型输出不可靠，在边界上统一收敛**：`extractJson()` 容忍 markdown 代码块和纯数组，
  `normTask()` 归一化每个字段，界面拿到的永远是干净数据。
- **没有模型也能用**：内置正则离线解析器，不需要 API Key、不需要网络，作为没填 Key、
  断网、模型超时时的兜底。
- **到点提醒可降级**：系统通知 + 页面内提醒卡（带「标记完成 / 10 分钟后再提醒 / 知道了」
  和 Web Audio 轻提示音），权限被拒也不会漏事。
- **本地优先**：所有数据只存在访问者自己的 `localStorage` 里，站点是纯静态的，
  API Key 不会离开用户浏览器、也不会进仓库。

### 快速开始

**方式一：本地服务（推荐，系统通知需要它）**

```bash
python launcher.pyw          # 起本地服务并自动打开浏览器
```

然后访问 <http://localhost:8000/index.html>。

> 为什么需要本地服务：`Notification` API 只在**安全来源**（https 或 localhost）可用，
> 直接双击 `.html` 的 `file://` 方式浏览器会**静默拒绝**通知。`launcher.pyw` 就是为了
> 提供这个安全来源。

**方式二：直接打开**

双击 `index.html` 即可使用（除了系统通知，其它功能都正常）。

**然后**

1. 点右上角「设置」，填入 [DeepSeek](https://platform.deepseek.com/) 的 API Key
   （只存在本机浏览器）。
2. 在左侧输入框写一句话，点「智能拆解」。
3. 没有 Key 也能先玩：点「离线解析」，或点卡片里的「填入示例数据」。

Windows 用户还可以运行一次 `pythonw make-shortcut.pyw`，在桌面生成一个带图标的快捷方式。

> **关于通知权限**：系统通知需要**每个访问者**在自己浏览器的提示里点一次「允许」——
> 权限由浏览器按「浏览器 + 网站」独立保存，网页无法代为开启，作者也无法替访客开。
> 未授权时，到点提醒会自动改用页面右下角的提醒卡（含提示音），不会漏事。

### 技术结构

```
index.html        页面骨架：元素与 id，不含任何逻辑
styles.css        全部外观：布局、玻璃卡片、优先级视觉
ui.js             全部业务逻辑：调模型 → 解析 JSON → 归一化 → 排序 → 渲染 → 持久化 → 提醒
glass-card.js     只做一件事：每帧把背景视频复制到画布，让玻璃卡"折射"它
launcher.pyw      起本地静态服务并打开页面（为了 Notification 的安全来源要求）
make-shortcut.pyw 在桌面生成带图标的快捷方式（Windows，可选）
assets/           图标等静态素材
tools/verify.mjs  验证脚本（见下文）
docs/             README 用到的截图
```

数据流只有一条：

```
输入框 → buildSystemPrompt() 注入当前时间与解析规则
       → fetch DeepSeek（JSON 模式）
       → extractJson() 抠出 JSON（容忍 markdown 代码块 / 纯数组）
       → normTask() 归一化每条任务（时间统一成 ISO、优先级收敛成 high|mid|low）
       → localStorage → sortTasks() → render() 画卡片
       → checkDue() 每 10 秒检查到点 → 系统通知 + 页面内提醒卡
```

### 四个技术决定（这个项目最值得看的部分）

**1. 两个脚本共享全局作用域，撞了 `const` 让整个文件不执行**

`ui.js` 和 `glass-card.js` 都是普通 `<script>`，共享同一个全局作用域，且各自声明了
`const video`。结果是 `ui.js` 整个文件抛出 SyntaxError、一行都不执行，表现却是
"所有按钮都没反应"——很容易误判成事件绑定问题。两个文件现在各自用 IIFE 包裹隔离作用域；
`tools/verify.mjs` 会把它们装进同一个上下文加载，一旦再次撞名立刻报错。

**2. Notification 只在安全来源可用，且失败是静默的**

`file://` 打开时通知永远不弹、也不报错。处理方式是：`launcher.pyw` 提供
`http://localhost` 这个安全来源，同时页面内准备了**兜底提醒卡**（带完成/稍后提醒按钮 +
Web Audio 提示音），并有一段诊断文案直接告诉用户问题出在协议、浏览器权限还是
Windows 通知设置上。

**3. 模型输出不可靠，所以在边界上做归一化**

提示词要求"只输出 JSON"，但仍会收到带 markdown 代码块、纯数组、时间格式不一致、
优先级写成中文的情况。`extractJson()` 负责抠出 JSON，`normTask()` / `normPriority()`
负责把字段收敛成统一格式，都失败时落到本地正则解析器。
**不确定性被挡在边界之外，卡片拿到的永远是干净数据。**

**4. 用脚本验证，而不是靠刷新页面肉眼检查**

见下节。

### 验证

```bash
node tools/verify.mjs      # 等价于 npm test，零依赖
```

它把页面按**网页真实的方式**加载：读出 `index.html` 里的元素、模拟最小 DOM、把两个脚本
装进同一个全局上下文执行，然后跑 53 项检查——覆盖语法冲突、旧数据继承、优先级排序、
时间与时区、勾选/删除、到点提醒链路、通知降级、离线解析、示例数据等。

> 这个脚本不是装饰：上面第 1 条那个"按钮全失灵"的 bug，就是在它这里被复现并定位到行的。

### 已知限制

- API Key 存在浏览器 localStorage，请求由前端直接发出 —— 这是 **BYOK（自带 Key）** 的
  取舍：为了保持"单文件可双击运行"，没有引入服务端代理。生产环境应由服务端持有密钥。
- 直接以 `file://` 打开时无法使用系统通知（浏览器限制），页面内提醒卡仍然工作。
- 背景视频引用第三方 CDN 资源，断网或对方下线时只剩纯色背景。
- 数据只在本机浏览器，没有账号、没有多端同步。
- 浏览器清除站点数据会连任务一起清掉。

### Roadmap

- [ ] 数据的导入 / 导出（JSON），避免本地数据成为孤岛
- [ ] 提示词版本化 + 一组真实中文输入的评测集，用数字比较 prompt 改动
- [ ] 流式输出（SSE），让拆解过程可见、可取消
- [ ] 服务端代理版，让 API Key 不进入浏览器

### 关于这个项目

一个寒假里做出来的工具型项目，用来练习"把大模型接进一个真实可用的界面"这件事：
提示词设计、结构化输出、失败兜底、本地持久化，以及浏览器安全来源这类容易踩的坑。

### License

[MIT](LICENSE)
