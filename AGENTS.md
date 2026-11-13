# AGENTS.md —— 改代码前必读

本文件是这个仓库的**硬约束**与**踩过的坑**，与 `README.md` 冲突时以本文件为准
（README 面向使用者，本文件面向改代码的人）。

---

## 1. 这是什么

纯前端 PCB / SI 检查工作台：导入 EDA 导出的 TXT → 按规则做走线、约束、加工能力、扇出、铜皮检查 →
可视化 + 导出报告。**没有后端、没有构建步骤、没有 CDN 依赖**，浏览器直接跑。

技术栈：原生 HTML / CSS / JS + Node（仅用于静态服务与测试）。唯一 devDependency 是 `jsdom`。

## 2. 常用命令

```bash
npm install                 # 只装 jsdom
npm run serve               # 静态服务，默认打开启动台 portal.html → http://localhost:8000/
npm run serve:pcb           # 默认打开走线检查 index.html
npm run serve:si            # 默认打开综合一体化检查 unified.html
npm test                    # engine + ui 全部测试，由 tools/run-tests.js 分组运行
npm run test:engine         # 只跑引擎（含 shapely 几何对拍）
npm run test:geometry       # 只跑几何对拍
npm run test:ui             # 只跑 UI
npm run bench               # 性能基准
node tools/run-tests.js ui pour   # 只跑文件名含 pour 的 UI 测试
```

**必须用 HTTP 打开页面**：示例数据走 `fetch('sample/...')`，`file://` 会被同源策略拦掉。

## 3. 工程化原则（以后都按这个做）

目标是**可读、可测、可替换**。任何新增或修改都先问：这段代码该放在哪个包？能不能单独测？

1. **一个文件一个职责**。文件名说明职责（`trace-rules.js`、`unified-fanout-viewer.js`），不用 `utils2.js`、`common.js`。
2. **体量上限**：单个 JS 文件 **≤ 600 行**（超过 800 行视为必须拆分），单个函数 **≤ 80 行**。
   新增功能时顺手把碰到的超标文件或函数拆开，不要继续往上堆。
   超标文件拆分后要用行数脚本复核（见 3.1），不要凭印象说“已拆完”。
3. **页面 = 薄 HTML + 一份 CSS + 若干页面包**。HTML 里不写内联 `<style>` / 大段 `<script>`；
   内联 `style=""` 只用于一次性的动态尺寸，布局与配色一律进样式表。
4. **逻辑分三层，依赖只能向下**：
   `packages/pages/<页面>`（DOM 与交互）→ `packages/engines/<引擎>`（纯计算，无 DOM）→ `packages/geometry`、`packages/shared`。
   引擎不得访问 `document` / `window`；页面包不得重新实现引擎已有的计算。
5. **长流程拆成阶段函数**。例如综合检查的 `buildInspectionContext` + `runTraceEngine` / `runCopperEngine` /
   `runDfmEngine` / `runFanoutEngine` / `runPourEngine`，调度函数只负责按序调用与刷新界面。
6. **每次改动都要有测试**：引擎改动补 `tests/engine`，交互改动补 `tests/ui`。重构类改动要给出**重构前后输出一致**的证据
   （例如固定样例的检查项数量与逐项判定）。
7. **小步提交**：每完成一个可验证的单元就测试并提交，不攒大提交。
8. **重复代码合并**：发现两处几乎相同的实现，抽到 `packages/shared` 或对应引擎，不要复制第三份。

## 4. 目录与模块职责

```
serve.js                          零依赖静态服务器（站点根 = pcb-checker/）
tools/
  run-tests.js                    分组运行 tests/{engine,ui,bench}
  oracle/gen-fixtures.py          用 shapely 重新生成几何基准（仅开发期需要 Python）
pcb-checker/
  portal.html                     启动台
  index.html copper.html dfm.html fanout.html pour.html unified.html     六个检查页（薄壳）
  assets/styles/
    tokens.css                    设计令牌：色板、字号、导轨与工具栏尺寸
    eda-shell.css                 三栏壳层：左导轨 / 阶段条 / 右工具栏 / 悬浮提示
    components.css                通用组件：卡片、按钮、表格、徽标、表单
    pages/<页面>.css              页面专属样式
  packages/
    geometry/                     精确几何内核（pad-primitives、pad-region）
    shared/                       dom-utils、xlsx-export、ui-prefs、eda-tooltip、eda-shell
    engines/<trace|copper|dfm|fanout|pour>/   五个检查引擎，UMD，Node 与浏览器通用
    pages/<页面>/                 页面包，经典脚本，按功能拆分
  sample/                         示例数据 + shapely 基准夹具
  tests/
    engine/*.test.js              引擎单测、几何对拍
    ui/*.test.js                  jsdom 页面测试
    bench/*.bench.js              性能基准
    helpers/open-page.js          jsdom 页面加载器：自动内联 <link> 与 <script src>
```

页面 ↔ 依赖（改引擎时必须同时考虑这些页面）：

| 页面 | 引擎与几何 |
| --- | --- |
| index.html | engines/trace |
| copper.html | engines/copper |
| dfm.html | geometry + engines/dfm |
| fanout.html | engines/fanout |
| pour.html | engines/pour |
| unified.html | geometry + copper + dfm + fanout + pour，走线判定在 `unified-runner.js` 与 `unified-trace-analysis.js` |

`index.html` 与 `unified.html` 的走线判定实现差异是**刻意保留**的，不要提合并方案。

## 5. 界面规范

### 5.1 三栏 EDA 布局（六个检查页一致）

- **左列导轨** `aside.eda-left-rail`：模块导航 `.navlinks` + 工序流程 `nav#tabs`。导航与功能入口只放左列，不放顶部。
- **中列视口** `.eda-center-col`：阶段条（面包屑 + 下一工序按钮）+ `main`。主视口只放当前工序的内容。
- **右列工具栏** `aside.eda-right-dock`：快捷执行、实时遥测、视口与参数记忆等**功能与工具**。工具按钮不要塞进卡片标题行。
- 工序要**渐进**：数据导入 → 规则 → 结果 → 视口 / 分析，前一步没完成时后一步给出明确的空状态，不报错。
- 工序用 `nav#tabs button[data-tab]`，按钮文案以 ①②③ 开头，按钮必须带 `data-tip`。
  面板 id 为 `data-tab` 的值或 `tab-` + 值。`eda-shell.js` 负责面包屑、`step-done` 标记、折叠记忆与 `Alt+1..9`。
- 新增工序时同步改对应 `tests/ui/*` 的工序数量断言和 `eda-shell-unify.test.js`。

### 5.2 视觉

- 色板（`tokens.css`）：底 `#f4f6f9`、卡片白、分隔线 `#e3e8ef`、正文 `#1f2937`、次要 `#6b7280`、强调 `#2563eb`（hover `#1d4ed8`）。
  不要再引入旧天蓝 `#0284c7`。
- 字号阶梯只用 11 / 12 / 13 / 14 / 15 / 16 / 18 / 22 px；卡片标题 15、小节标题 13、表格 13、辅助说明 12。
- 卡片：白底 + 1px `var(--line)` + 10px 圆角 + **无投影**；统计卡不填色，状态只用数字颜色与边框。
- `h1`~`h4`、`th` 里不放 emoji / 图标字符。
- 以上由 `tests/ui/theme-unify.test.js` 断言。

### 5.3 文案：不加括号解释，改用悬浮提示

- **界面上的标题、标签、表头、按钮、工序名后面不写括号解释**。需要补充说明时：
  - 静态元素：写在 `data-tip="..."`；
  - 标题旁需要独立提示点：`<span class="eda-tip" tabindex="0" data-tip="...">?</span>`。
- 悬浮气泡由 `packages/shared/eda-tooltip.js` 统一提供，不要再用原生 `title` 或自己写 CSS tooltip。
- 计量单位直接写 `mil`、`mm`，不加括号。选项 `<option>` 里不放括号说明。
- 脚本拼出的提示、标签、表头同样遵守，不要在 JS 里绕开。
- 括号可以出现在**数据本身**里（网络名、示例文本、公式、示例路径），这不算解释。

### 5.4 文案：禁止废话文学

界面文案、`data-tip`、提示信息、报错信息都只写**工程师能直接用的信息**：对象、条件、单位、阈值、动作、结果。

- 禁止：夸赞与自夸（「设计质量极佳」「强大的」「一站式」）、欢迎语、重复标题的副标题、
  「系统将自动……」这类不含判据的描述、提示语里的「成功」「！」、「一键」。
- 提示要给判据。例如写「间距 < 阈值判不符合，重叠判 ≤ 0」，不写「系统智能判定」。
- 空状态写下一步动作，例如「导入走线 TXT 后生成」，不写「暂无数据，敬请期待」。
- `README.md`、提交信息、PR 描述同样不写套话，写事实与数字。
- 由 `theme-unify.test.js` 断言黑名单词与 JS 提示里的「成功」「！」。

## 6. 硬性约定

1. **中文 UI**，简洁、带单位。
2. **不可信文本一律 `escHtml()`**：网表名、层名、Padstack、缺陷原因都来自外部 TXT。
   插入 `innerHTML` 前必须转义；导出 CSV / Excel 用原始值。典型风险样例：`Net: <img src=x onerror=...>`。
3. **图表只用 CSS 或内联 SVG**，不引 ECharts / Chart.js / 任何 CDN。2D 视口用 canvas 的页面，
   关键数据必须同时有 DOM 可断言的形式（jsdom 拿不到 2D 上下文）。
4. **缓存版本号全站一致**：`<link>` 与 `<script src>` 的 `?v=N` 所有页面必须是同一个 N。
   改动任一样式或脚本包后，把**所有页面**的 `?v=` 一起 +1（`portal-and-controls.test.js` 会断言）。
5. **页面包是经典脚本**（共享全局作用域），脚本顺序在 HTML 里固定为：
   shared 基础 → geometry → engines → pages → `eda-tooltip` → `eda-shell` → `ui-prefs`。
   新增页面包文件要同步 HTML 的 `<script>` 列表；引擎是 UMD，可 `require` 进 Node 测试。
6. **给测试用的函数挂到 `window.*`**，页面包末尾已有导出块，跟着加。
7. **界面参数记忆**：新增的 `input[type=number|text|checkbox|radio]` / `select` 默认被
   `packages/shared/ui-prefs.js` 记住（按「页面 + 元素 id」，id 必须唯一）。
   搜索框、筛选下拉、弹窗一次录入、行内模板控件加 `data-no-persist`；`textarea` 自动排除。

### 6.1 从旧版规范保留的约束

1. **页签**用 `nav#tabs button[data-tab]` + 壳层统一的 click 监听，不要在页面包里再写自己的 `switchTab()`；
   新页签同步改页签数量断言（`tests/ui/*` 与 `eda-shell-unify.test.js`）。
   例外：`fanout` 页内的子视图切换函数 `switchTab('tabCanvas')` 是历史接口，测试在用，不要改名。
2. **跨页一致性靠测试守住，不靠记忆**：顶栏 / 壳层 / 配色 / 字号由 `eda-shell-unify.test.js`、`theme-unify.test.js` 跨页断言。
   改壳层样式只改 `eda-shell.css`，不要往页面 CSS 里写 `header{}`、`nav#tabs{}` 覆盖规则。
3. **旧色值不要写回**：`#0284c7`（天蓝）、`#f8fafc` 作页面底、`#0f172a` 作正文、`#64748b` / `#475569` 作次要文字。
   分组标题条用浅灰 `#f8fafc` + 下边框，不用彩色实心条；浅蓝底纹只用于悬停、拖放、状态徽标。
4. **重构不丢测试**：旧测试对不上新结构时，**迁移并改断言**，不要删。删除或合并用例必须在提交信息里列出理由与用例数。
   用例数基线见第 8 节，下降即视为回归。
5. **重构不丢文档**：改写 AGENTS.md 时合并而不是推翻；已踩的坑、已知夹具数字、判据口径一律保留，只修正已过时的部分。
6. **性能与功能都要测**：改动引擎或解析器后跑 `npm run bench`，并在真实浏览器里把每个页面的每个工序点一遍
   （`npm run smoke` 或手动），控制台零报错才算完成。

## 7. 数值与几何：安全方向不可反

DRC 类工具的底线是**宁可判危险，不可乐观**：

- 几何求距容差 **0.01 mil**；与 shapely 基准偏差超过它就算不通过；
- **重叠样本必须判为 ≤ 0**，不允许系统性乐观偏差；
- 圆弧按**扫掠角**判定，不能把弧背面的距离算成弧面距离；
- 盲埋孔按 `Padstack Defined` 起止层判定是否穿越当前走线层，**不穿越的直接跳过**，保持 fail-closed；
- 形状退化等价性：长圆 `w=h` ≡ 圆；圆角矩形 `corner = 短边/2` ≡ 长圆；旋转 90° 后距离不变。

改几何 / 判定逻辑后，**先跑 `npm run test:geometry`**，再看 UI 测试。

## 8. 测试怎么写

页面测试统一用 `tests/helpers/open-page.js`，它会把 `<link rel=stylesheet>` 与 `<script src>` 内联进 jsdom：

```js
const { openPage, tick } = require('../helpers/open-page');
const ctx = openPage('unified.html', { syncCheck: true });   // syncCheck 关掉异步，便于同步断言
const { w, d } = ctx;
await tick(150);                                              // 等 DOMContentLoaded 与 ui-prefs 回填
w.loadUnifiedSampleData(); w.runMasterInspection();
// ctx.errors 收集页面运行期脚本错误；seedStorage / beforeParse 可预置 localStorage
```

要点：

- `new JSDOM(...)` 返回时 `document.readyState` 仍是 `loading`，页面 `DOMContentLoaded` 逻辑（含 `ui-prefs` 回填）要等一个 tick。
- 不要用 `JSDOM.fromFile` 或 `file://` 跑页面脚本；需要 `localStorage` 时必须给 `http://` 源（`openPage` 已处理）。
- 用正则从 HTML 提取内联脚本时必须**非贪婪**，否则会把后面的 `<script src>` 一起吞进来，报 `SyntaxError: Unexpected token '<'`。
- 页面脚本里的顶层 `const` / `let` 不在 `window` 上，要读用 `w.eval('名字')`。
- `jsdom` 不触发 `<img onerror>`，XSS 断言请数节点，不要等回调。
- 页面默认阈值是 0，要造缺陷必须同时设阈值与焊盘直径。
- 断言失败先确认**口径**（阈值、焊盘、是否过滤 GND），再怀疑实现；不要为变绿去改期望数字。
- 重构要保证行为不变：用固定样例（`loadUnifiedSampleData()` + `runMasterInspection()`）
  记录检查项 id 与判定，重构前后逐项比对。当前基线：88 项、69 项不符合
  （走线 16 / 约束 45 / DFM 11 / 扇出 1 / 铜皮 15）。

已知夹具事实（`sample/via_trace_airgap_sample.txt`：97 Item / 71 Trace / 26 Via）：

| 条件 | 结果 |
| --- | --- |
| 阈值 GND 6 / 信号 6，焊盘 GND 7.906 / 信号 9.94 | 42 处缺陷，11 个过孔对象 |
| 阈值 GND 6 / 信号 6，焊盘 GND 7.906 / 信号 12.0 | 44 处缺陷，12 个过孔对象 |
| 默认规则（阈值 0） | 0 处缺陷 |

## 9. 已知坑

- 模板循环渲染的行内控件 id 会重复（例如逐对偶的复核勾选框），任何「按 id」的逻辑都要防重。
- `rule.widths` 必须是数组；`recViol` 是 `Map`；`CopperCheck.parseBoardItems` 返回 `{}` 不是数组。
- DFM 的 Trace 对象字段是 `len`（不是 `length`），也没有 `segments` 数组。
- 大样本数据集（数个 MB）不入库；引用前先 `fs.existsSync`，缺失就跳过。
- 页面之间不要“统一”成一套引擎：`index.html` 与 `unified.html` 的实现差异是刻意保留的。
- 拆分时 UMD 引擎在浏览器与 Node 里导出方式不同：页面包用全局名（`ConstraintParser`、`FanoutChecker`），测试用 `require`；
  新增导出两边都要验证。
- 经典脚本里同名函数后者覆盖前者，拆分文件时先 `grep -n "^function 名字"` 确认没有重复定义。
- 拆分经典脚本后顶层 `const` 的初始化顺序依赖脚本顺序：被初始化代码引用的默认值文件要排在前面。

## 10. 提交与 PR

- 提交信息用**中文约定式**：`feat(dfm): …`、`fix(geometry): …`、`refactor(unified): …`、`test(ui): …`、`docs: …`，
  正文写「原来怎样 / 现在怎样 / 为什么」，并附关键验证数字。
- 每个任务一个分支，PR 到 `main`；PR 描述含：背景、改动清单、样例数据实测数字、测试结果。
- **合并前 `npm test` 必须全绿**。
- 不提交 `node_modules/`、临时脚本、开发机绝对路径、`dev/`、`uploads/`、截图等过程产物。

## 11. 交付标准

一个改动算「完成」，需要同时满足：

1. 功能在真实浏览器（`npm run serve` + 页面）里可用，控制台无报错；
2. `npm test` 全绿，且**新增行为有对应用例**；
3. 中文 UI、`escHtml()`、无 CDN、无构建步骤；
4. 符合第 3 节工程化原则：文件与函数未超标、职责单一；
5. 符合第 5 节界面与文案规范：左导航、右工具、`data-tip`、无括号解释、无废话；
6. 改了样式或脚本包 → 全站 `?v=` 已 +1；
7. README 与本文件里相关描述同步更新。
