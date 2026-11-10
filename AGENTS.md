# AGENTS.md —— 给 AI / 新同事的项目说明书

本文件描述这个仓库的**硬约束**与**踩过的坑**。动手前请通读一遍；与 `README.md` 冲突时以本文件为准
（README 面向使用者，本文件面向改代码的人）。

---

## 1. 这是什么

纯前端 PCB / SI 检查工作台：导入 EDA 导出的 TXT → 按规则做间距、约束、加工能力、扇出、铜皮检查 →
可视化 + 导出报告。**没有后端、没有构建步骤、没有 CDN 依赖**，浏览器直接跑。

技术栈只有两样：原生 HTML/CSS/JS + Node（仅用于静态服务与测试）。唯一 devDependency 是 `jsdom`。

## 2. 常用命令

```bash
npm install                 # 只装 jsdom
node serve.js 8000          # 静态服务，站点根 = pcb-checker/  → http://localhost:8000/
npm test                    # 全部：引擎单测 + 几何对拍 + 六个页面的 jsdom 全流程 UI 测试
npm run test:engine         # 只跑引擎（含 shapely 对拍）
npm run test:ui             # 只跑 UI（index / copper / dfm / fanout / pour / ui-prefs）
npm run bench               # 走线检查引擎性能对照（合成 15000 项）
```

**必须用 HTTP 打开页面**：示例数据走 `fetch('sample/...')`，`file://` 会被同源策略拦掉。

## 3. 目录与模块职责

```
serve.js                  零依赖静态服务器（根 = pcb-checker/，默认 0.0.0.0:8000）
pcb-checker/
  index.html              走线检查（**引擎内联在这个页面里**，没有独立 js 文件）
  copper.html             约束检查
  dfm.html                加工能力检查（含「规律分析」页签）
  fanout.html             扇出方案检查
  pour.html               铜皮检查
  unified.html            综合一体化检查（同一套引擎的合并视图，**不是** index 的替代品）
  pad-geom.js             精确几何内核：凸多边形 ⊕ 圆角焊盘 / 走线求距、包含判定、旋转
  dfm-check.js            DFM 间距引擎（孔-孔、走线-孔、盲埋孔层穿越）
  copper-check.js         约束检查引擎
  fanout-check.js         扇出聚类 / 模板匹配引擎
  pour-check.js           铜皮检查引擎（小面积、圆弧、异形泪滴等）
  ui-prefs.js             全站界面参数记忆（上次填写/选择的值即默认值）
  sample/                 示例数据 + shapely 几何基准夹具
  *-test.js               引擎单测、几何对拍、各页面 jsdom UI 测试
tools/oracle/gen-fixtures.py   用 shapely 重新生成几何基准（仅开发期需要 Python）
```

页面 ↔ 引擎依赖（改引擎时必须同时考虑这些页面）：

| 页面 | 依赖引擎 |
| --- | --- |
| index.html | 内联（不引用外部引擎文件） |
| copper.html | copper-check.js |
| dfm.html | pad-geom.js + dfm-check.js |
| fanout.html | fanout-check.js |
| pour.html | pour-check.js |
| unified.html | pad-geom + copper-check + dfm-check + fanout-check + pour-check |

## 4. 硬性约定（改代码前必读）

1. **中文 UI**，文案风格与现有页面保持一致（简洁、带单位、带括号解释）。
2. **不可信文本一律 `escHtml()`**：网表名、层名、Padstack、缺陷原因都来自外部 TXT。
   插入 `innerHTML` 前必须转义；导出 CSV/Excel 用原始值（不转义）。
   典型风险样例：`Net: <img src=x onerror=...>`。
3. **图表只用 CSS 或内联 SVG**，不引 ECharts / Chart.js / 任何 CDN，也不依赖 canvas 才能看懂的实现
   （jsdom 里 canvas 拿不到 2D 上下文，纯 CSS 才能被测试断言）。
4. **页面保持单文件**（HTML + 内联 CSS/JS）。共享逻辑才抽成 `*.js`，并带缓存版本号。
5. **引擎脚本的缓存版本号必须全站一致**：`*-check.js?v=N`、`pad-geom.js?v=N`。
   改动任一引擎文件后，把**所有页面**里的同名 `?v=` 一起 +1；新增外部脚本（如 `ui-prefs.js?v=1`）自带版本号。
   漏掉会出现「某页跑旧缓存、某页跑新代码」的隐蔽不一致。
6. **页签**用 `nav#tabs button[data-tab]` + 现有的那个 click 监听器里分支，
   不要新写 `switchTab()`；新页签记得同步改 `dfm-ui-test.js` 之类的页签数量断言。
7. **给测试用的函数挂到 `window.*`**（页面里已有 `window.XXX = ...` 的导出块，跟着加）。
8. **界面参数记忆**：新增的 `input[type=number|text|checkbox|radio]` / `select` 默认就会被
   `ui-prefs.js` 记住（按「页面 + 元素 id」，id 必须唯一）。
   - 不希望被记住的（搜索框、筛选下拉、弹窗一次录入、行内模板控件）加 `data-no-persist`；
   - `textarea`（数据粘贴区 / 导出框）自动排除，不要为它加记忆；
   - 动态填充选项的下拉（层名/网络名）无需特殊处理，`ui-prefs.js` 会等选项就绪再回填。

9. **顶栏与页签条全站统一**：六个页面 `<style>` 末尾各有一块
   `/* ===== 全站统一顶栏 + 页签条（六个检查页共用同一份） ===== */`，**内容必须逐字一致**
   （`nav-unify-test.js` 会做跨页比对）。页面只保留各自不同的「标题 / 副标题 / 页签文案」，
   样式一律回到这块统一规则里改；不要再往页面局部写 `header{}` / `nav#tabs{}` 之类的规则。

10. **界面风格全站统一，基准页 = `index.html`（走线检查）**：改任何一个页面的视觉，
    都要先看走线检查页长什么样，六页保持一致（`theme-unify-test.js` 跨页断言）。
    - **主色板**：底色 `--bg:#f4f6f9`、卡片 `#fff`、分隔线 `--line:#e3e8ef`、
      正文 `--text/--txt:#1f2937`、次要文字 `--sub:#6b7280`、强调 `--pri/--accent:#2563eb`
      （hover `#1d4ed8`）。旧的 `#0284c7`（天蓝）、`#f8fafc`（页面底）、`#0f172a`（正文）、
      `#64748b` / `#475569`（次要文字）不要再往回写。
    - **字号阶梯**：正文 14px、卡片标题（`h2` / `.card-title`）15px、小节标题（`h3`）13px、
      表格与表格正文 13px、辅助说明 `.hint` 12px。标题字号只能写在样式表里，
      不要用行内 `style="font-size:..."` 打特例。
    - **卡片**：白底 + `1px solid var(--line)` + `10px` 圆角 + `16px` 内边距，**不加投影**。
    - **不要多余的填充色**：统计卡 / 指标卡一律白底，状态只用数字颜色和边框区分；
      分组的彩色实心标题条（如旧的 `.set.SMA .hd` 深绿 / 深蓝条）一律换成浅灰 `#f8fafc` + 下边框；
      浅蓝底纹（`#f0f9ff` / `#e0f2fe` / `#eff6ff`）只在悬停、拖放、状态徽标这类「有含义」的地方保留。
    - **标题前不加图标**：`h1`~`h4` 及 `.card-title` 里不要放 emoji 或 SVG 图标，
      文案直接以中文/序号开头（页签里的 ①②③ 是文案不是图标，保留）。

## 5. 数值与几何：安全方向不可反

DRC 类工具的底线是**宁可判危险，不可乐观**：

- 几何求距容差 **0.01 mil**；与 shapely 基准的偏差超过它就算不通过；
- **重叠样本必须判为 ≤ 0**，不允许出现「系统性乐观偏差」（`geometry-oracle-test.js` 专门断言这点）；
- 圆弧按**扫掠角**判定，不能把弧背面的距离算成弧面距离；
- 盲埋孔按 `Padstack Defined` 起止层判定是否穿越当前走线层，**不穿越的直接跳过**
  （这里曾经 fail-open 漏检，务必保持 fail-closed）；
- 形状退化等价性要对：长圆 `w=h` ≡ 圆；圆角矩形 `corner = 短边/2` ≡ 长圆；旋转 90° 后距离不变。

改几何 / 判定逻辑后，**先跑 `npm run test:geometry`**，再看 UI 测试。

## 6. 测试怎么写（jsdom 的坑都在这）

测试用 `fs.readFileSync` 读页面 HTML，再 `new JSDOM(html, {runScripts:'dangerously'})` —— 这意味着
**页面里的 `<script src="xxx.js">` 不会自动加载**，必须在测试里手动注入：

```js
const html = fs.readFileSync(path.join(__dirname, 'dfm.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'http://localhost/dfm.html' });   // 需要 localStorage 时别用 file://
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, 'pad-geom.js'), 'utf8'));   // 顺序与页面一致
w.eval(fs.readFileSync(path.join(__dirname, 'dfm-check.js'), 'utf8'));
w.__SYNC_CHECK__ = true;                                                 // 关掉异步，测试才能同步断言
```

要点：

- `new JSDOM(...)` 返回时 `document.readyState` 仍是 `loading`，页面自己的 `DOMContentLoaded`
  逻辑（含 `ui-prefs.js` 的回填）**要等一个 tick**：`await new Promise(r => setTimeout(r, 50))`。
- 不要用 `JSDOM.fromFile` / `url: 'file://...'` 跑页面脚本：页面函数会取不到；
  需要 `localStorage` 时必须给 `http://` 源。
- `jsdom` 不会触发 `<img onerror>`，XSS 类断言请数节点，别等回调。
- 页面默认阈值是 **0**，直接 `runCheck()` 得到 0 缺陷。要造缺陷必须同时设置
  阈值与焊盘直径，例如 `dfm-ui-test.js` 里的 6/6 + GND 7.906 / 信号 9.94。
- 断言失败先确认**口径**（阈值、焊盘、是否过滤 GND），再怀疑实现；
  不要为了让测试变绿去改数字——先算清楚期望值是怎么来的。

已知夹具事实（`sample/via_trace_airgap_sample.txt`：97 Item / 71 Trace / 26 Via）：

| 条件 | 结果 |
| --- | --- |
| 阈值 GND 6 / 信号 6，焊盘 GND 7.906 / 信号 9.94 | 42 处缺陷，11 个过孔对象 |
| 阈值 GND 6 / 信号 6，焊盘 GND 7.906 / 信号 12.0 | 44 处缺陷，12 个过孔对象 |
| 默认规则（阈值 0） | 0 处缺陷 |

## 7. 已知坑（都真踩过）

- `dfm.html` 的页签是 `data-tab` + 内联监听器，**没有** `switchTab()` 函数。
- `dfm.html` 的 Trace 对象字段是 `len`（不是 `length`），也没有 `segments` 数组。
- `rule.widths` 必须是数组；`recViol` 是 `Map`；`CopperCheck.parseBoardItems` 返回 `{}` 不是数组。
- 模板循环渲染的行内控件 id 会重复（例如逐对偶的复核勾选框），任何「按 id」的逻辑都要防重。
- `test.js` 用正则从 `index.html` 提取内联脚本：**必须用非贪婪**，否则会把页面末尾的
  `<script src="...">` 一起吞进来，报 `SyntaxError: Unexpected token '<'`。
- 大样本数据集（数个 MB）不入库；引用前先 `fs.existsSync`，缺失就跳过（已有用例这么做）。
- 页面之间不要「统一」成一套引擎：`index.html` 与 `unified.html` 的实现差异是**刻意保留**的，
  不要提合并方案。

## 8. 提交与 PR

- 提交信息用**中文约定式**：`feat(dfm): …`、`fix(geometry): …`、`test(ui): …`、`docs: …`，
  正文写清「原来怎样 / 现在怎样 / 为什么」，并附上关键验证数字。
- 每个任务一个分支，PR 到 `main`；PR 描述包含：背景、改动清单、样例数据实测数字、测试结果。
- **合并前 `npm test` 必须全绿**（当前基线：几何 7 / 走线 41 / DFM 22 / 扇出 7 / 铜皮 11 /
  集成 21 / 115 / 23 / 17 / 16 / 参数记忆 21）。
- 不要提交 `node_modules/`、临时脚本、开发机绝对路径（`/home/xxx/...`、`/tmp/...`）、
  `dev/`、`uploads/`、截图等过程产物。

## 9. 交付标准

一个改动算「完成」，需要同时满足：

1. 功能在**真实浏览器**（`node serve.js` + 页面）里可用，控制台无报错；
2. `npm test` 全绿，且**新增行为有对应用例**（不是只跑旧用例）；
3. 中文 UI 、`escHtml()`、无 CDN、无构建步骤；
4. 改引擎 → 全站 `?v=` 已 +1；
5. README / 本文件里与该改动相关的描述同步更新。
