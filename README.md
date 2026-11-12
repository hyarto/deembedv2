# SI 工作台（PCB 综合检查工作台）

纯前端的 PCB / 信号完整性（SI）检查工作台：把 EDA 导出的 TXT 报告直接拖进浏览器，即可完成
**走线规则、约束、加工能力（DFM）、扇出方案、铜皮** 五类检查，并输出缺陷清单、2D 空间视图与 Excel/CSV 汇总报告。

所有数据都在浏览器本地解析处理，不上传任何服务器，也不需要后端服务。

> **要改代码？先看 [`AGENTS.md`](AGENTS.md)**：硬约束（转义、缓存版本号、参数记忆）、几何安全方向、
> jsdom 测试的坑与已知夹具数字都在那里。

## 页面一览

| 页面 | 作用 |
| --- | --- |
| `pcb-checker/portal.html` | 统一入口主页：同屏导航「PCB 五大专项独立检查页」与「SI 综合检查一体化工作台」两大入口 |
| `pcb-checker/index.html` | 走线检查：导入网络走线报告 → 概览 → 按出线层配规则（线宽组合 / 总线长 / 指定线宽线长 / 弧半径）→ 结果标注 → 差分对逐层线长差分析 |
| `pcb-checker/copper.html` | 约束检查：把铜皮 / 焊盘栈参数整理成可导入 EDA 的约束条件，并核对回读数据是否符合 |
| `pcb-checker/dfm.html` | 加工能力检查：孔到孔、走线到过孔的空间间距（Airgap）判定，含 2D 几何测量与逐层定位；盲埋孔按 `Padstack Defined` 起止层判定是否穿越当前走线层，不穿越的直接跳过；「规律分析」按**信号孔或走线**为对象归纳全板问题分布（层 / 网络 / 孔型 / Padstack 维度、亏欠量分档、对象排行与自动结论） |
| `pcb-checker/fanout.html` | 扇出方案检查：过孔自动聚类 + 刚体平移/旋转/镜像不变匹配，比对方案库判断扇出是否合规（可开启任意角度姿态，支持 30°/45° 等非正交扇出）；可同时导入走线数据，把走线与扇出孔群关联、按层着色，并支持纯走线模式 |
| `pcb-checker/pour.html` | 铜皮检查：铺铜覆盖、异型铜皮、参考层覆盖 / 超宽、孤立碎铜、最小圆弧半径五大项 |
| `pcb-checker/unified.html` | 综合一体化检查：一套数据同时跑五大引擎，输出统一缺陷清单、风险雷达与综合报告 |

页面布局统一为三栏：左列模块导航与工序流程，中列主视口，右列功能与检视工具栏。`unified.html` 复用 `packages/engines` 下的引擎分包（走线判定除外），不另写一份。

## 快速开始（统一入口与分模式启动）

```bash
npm run serve          # 默认打开统一入口主页 portal.html (http://localhost:8000/ ，端口可用 PORT=8080 覆盖)
npm run serve:pcb      # 默认直接进入 PCB 专项检查入口 index.html
npm run serve:si       # 默认直接进入 SI 综合一体化工作台 unified.html
```

或任意静态服务器：

```bash
cd pcb-checker && python3 -m http.server 8000
```

> 页面里的「示例数据」按钮通过 `fetch('sample/...')` 读取文件，因此必须用 HTTP 打开；
> 直接双击 HTML（`file://`）会被浏览器同源策略拦截。

## 界面参数记忆（全站）

六个页面原先只有「历史候选值」——加工能力页、铜皮页输入框旁边那排小圆钮（`4.01575 / 5 / 6 / 8`），
刷新后输入框本身仍回到 HTML 里写死的出厂值，每次重开工作台都要把阈值、焊盘直径、单位、模式、
勾选项重新填一遍。

现在由 `pcb-checker/packages/shared/ui-prefs.js` 统一接管（六页共用，无依赖、无 CDN）：

- 任何**填写数值 / 选择项**（`input[type=number|text|checkbox|radio]`、`select`）改动后，
  按「页面 + 元素 id」记进 `localStorage`（键 `pcbchecker.uiprefs.v1`）；
- 页面加载完成后自动回填**上次用过的值**并派发 `input` / `change`，
  页面内部 State、联动重绘、校验逻辑与用户手填一遍完全等价，因此刷新、关掉再打开、
  在页面之间来回跳转都保持生效；
- 下拉的选项是导入数据后才填充的（层名 / 网络名 / 方案名），恢复时会挂一个
  `MutationObserver` 等选项就绪再补填，不会「选了层、刷新后又回默认」；
- 不该记住的东西有明确边界：`textarea`（数据粘贴区 / 导出框）、只读与 `disabled` 控件、
  重复 id 的模板行内控件（例如逐对偶的复核勾选框），以及显式标了 `data-no-persist`
  的搜索框、筛选下拉、弹窗里的一次性录入框；
- 记忆里的值若已失效（下拉选项被删、数值非法、字段改版消失），一律保持出厂值，
  不会把控件写成空值；
- 想回退：右侧工具栏的视口区会多一个「恢复默认值」按钮（仅当本页确实存了记忆值时出现，
  按钮上带条数），点击即清空本页记忆并刷新；控制台也可用 `UiPrefs.clear()`（本页）/
  `UiPrefs.clearAll()`（全站）。

新增控件默认就会被记忆；不希望被记住的控件加 `data-no-persist` 属性即可。

## 界面布局与风格

- **三栏**：左导轨（模块导航 + 工序流程）/ 中视口（阶段条 + 当前工序）/ 右工具栏（快捷执行、实时遥测、视口与参数记忆）。左右栏可折叠，状态记忆；`Alt+1..9` 切换工序。
- **渐进工序**：数据导入 → 规则 → 结果 → 视口 / 分析，阶段条显示当前位置并提供「下一工序」。综合一体化检查共 6 个工序，规则配置独立成第 2 工序。
- **配色**：底 `#f4f6f9`、白卡片、分隔线 `#e3e8ef`、正文 `#1f2937`、次要 `#6b7280`、强调 `#2563eb`；状态只用语义色。
- **字号阶梯**：11 / 12 / 13 / 14 / 15 / 16 / 18 / 22 px。卡片白底、1px 边框、10px 圆角、无投影。
- **说明文字**：标题、标签、表头、按钮后不加括号解释，补充信息放在悬浮提示（`data-tip` 或标题旁的 `?`）。

样式分层：`assets/styles/tokens.css`（令牌）→ `eda-shell.css`（壳层）→ `components.css`（通用组件）→ `pages/<页面>.css`。
`tests/ui/theme-unify.test.js` 与 `eda-shell-unify.test.js` 跨页断言以上规则。

## 输入数据格式

EDA 导出的文本报告，主体是 `Item N < Via / Trace / Shape >` 段落，常用字段：

- `Total N Items` / `Item N <类型>` / `Set: ...` / `Subset: <层号>G01P`
- `Origin-xy: [x, y]`、`Seg xy: [...]`、`Arc seg: [...]`（坐标，单位 mil）
- `Padstack Name`、`Net`、`Width`、`Layer` 等
- 单个 `< Trace >` 内可含多段 `Seg` / `Arc seg`（如 `Trace Seg`），走线检查与扇出页都按多段解析，层别取 `Subset`、线宽取 `Width`
- 总线长优先取 `Length:`；单段项常见的 `Seg Length:` 也会被识别（多段时按段累加）；两者都没有时按线段/圆弧几何求和兜底
- `< Via >` / `< Shape >` / `< Text >` 等非走线 Item 不计入走线记录（只在页面上标注「另有 N 项未计入」），避免记录数、总线长、网络数被带偏

兼容 GBK 与 UTF-8 编码、CRLF 换行，也兼容旧的表格文本（Tab / 逗号分隔，含 网络 / 层 / 线宽 / 线长 列）。
`pcb-checker/sample/` 下提供了可直接加载的示例（走线、铜皮、过孔间距、SMA 扇出）。

## 数值精度与几何模型

所有判定都是**解析计算**，不做「多点采样近似」；浮点用 IEEE754 double，在万级 mil 尺度上
绝对误差 ~1e-12 mil，而工程容差是 1e-3 ~ 2 mil，差 9 个数量级以上——精度瓶颈从来不是浮点。

| 对象 | 模型 | 计算方式 |
| --- | --- | --- |
| 过孔焊盘 | 圆 / 长圆(椭圆) / 圆角矩形 / 矩形，可带旋转角 | 统一建模为「凸多边形 ⊕ 圆角半径」，形状间距离有闭式解 `max(0, dist(A,B) − ra − rb)`；矩形/椭圆焊盘不再被当成外接圆 |
| 走线段 | 中心线 + 线宽（胶囊） | 点-线段最短距离解析式 |
| 圆弧走线 | 圆心 / 半径 / 起止点 / 顺逆时针 | 按**扫掠角**判断垂足是否落在弧段内，取垂足或弧端点；与多边形焊盘求距时用弧上黄金分割细化，误差 < 1e-8 mil |
| 铜皮轮廓 | 直线段 + 圆弧段 | 按弦高 0.05 mil 自适应离散成闭合环：真实面积（鞋带公式）、面积加权质心、点在形内判定 |
| 空间索引 | 100 mil 哈希网格 + AABB 粗筛 | 720 万组对偶 < 1 s；非圆焊盘路径同样走网格，几十毫秒量级 |

几条容易踩的坑，引擎里已经处理：

- **圆弧不能一律用 `|d − r|`**：点落在弧的缺口方向时，最近点是弧端点而不是弧面上的垂足。铜皮检查与 DFM 都按扫掠角判定。
- **铜皮不能只看包围盒**：L 形 / 带孔铜皮的包围盒中心并不在铜皮上，判定「点在形内」必须走轮廓多边形。
- **孤立碎铜不能只看「质心 30 mil 内有过孔」**：改为轮廓内点判定 + 同层过滤，无几何数据时才退回近似。
- **单段圆弧 + 一段弦（D 形铜皮）不是圆**：整圆快捷路径要求弧扫掠角 = 360°。
- **盲埋孔不能拿所有层做判定**：过孔的 `Padstack Defined` 起止层不穿越当前走线层时（例如 L1–L3 盲孔 vs L12 走线），必须整对跳过，否则会把不相干层误判为间距不足。
- **但"判不出来"绝不能等于"不用查"**：只有当过孔跨度与走线层**都能解析成层号**时才允许跳过。层名是 `SIGA`、`MID1` 这类非数字命名时，宁可全部检查并在提示里标出「N 处对偶层名无法解析，已按全部检查处理」——漏检比多检危险得多（旧版本此处直接跳过，会给出"0 处超标"的假干净结果）。

焊盘形状在 `dfm.html` 的「焊盘形状（可选）」里配置（默认圆形，与旧口径完全一致）；
`unified.html` 的综合检查目前仍使用圆形焊盘默认值。

## 测试

```bash
npm install
npm test               # 引擎测试 + jsdom 全流程 UI 测试（tools/run-tests.js 分组运行）
npm run test:engine    # 只跑引擎逻辑（含几何对拍）
npm run test:geometry  # 只跑几何内核 vs shapely 基准对拍
npm run test:ui        # 只跑 UI 交互
npm run bench          # 约束检查网格索引性能对照（合成 15000 项数据）
```

测试通过 jsdom 载入真实页面并模拟点击，覆盖导入 → 规则 → 检查 → 导出 → 复验的完整链路；
`tests/ui/ui-prefs.test.js` 单独覆盖六个页面的参数记忆（落盘、跨刷新回填、`data-no-persist` 边界、
脏数据防护、跨页隔离、恢复按钮）。

**几何内核的独立验证**：`tools/oracle/gen-fixtures.py` 用 shapely(GEOS) 生成 180+ 组随机
焊盘/走线组合（圆形、长圆、圆角矩形、矩形 × 直线/圆弧，含重叠样本）作为基准值，写入
`pcb-checker/sample/geometry-oracle-fixtures.json`；`tests/engine/geometry-oracle.test.js` 逐条对拍，
要求偏差 < 0.01 mil、重叠必须判负、且不允许出现系统性乐观偏差（DRC 最怕把危险值算大）。
夹具已入库，CI 不需要 Python：

```bash
python3 -m venv .venv && .venv/bin/pip install shapely   # 仅在需要重新生成夹具时
.venv/bin/python tools/oracle/gen-fixtures.py
```

## 目录结构

```
serve.js                          零依赖静态服务器（站点根 = pcb-checker/）
tools/
  run-tests.js                    分组运行 tests/{engine,ui,bench}
  oracle/gen-fixtures.py          用 shapely 生成几何基准夹具（开发期工具）
pcb-checker/
  portal.html                     启动台
  index.html copper.html dfm.html fanout.html pour.html unified.html     六个检查页
  assets/styles/                  tokens / eda-shell / components 与 pages/<页面>.css
  packages/
    geometry/                     精确几何内核（凸多边形 ⊕ 圆角，焊盘 / 走线求距）
    shared/                       dom-utils、xlsx-export、ui-prefs、eda-tooltip、eda-shell
    engines/                      trace / copper / dfm / fanout / pour 五个检查引擎
    pages/                        各页面的交互脚本，按功能拆分（unified 含 20 个文件）
  sample/                         示例数据（含 shapely 几何基准夹具）
  tests/                          engine / ui / bench 与 helpers/open-page.js
```

## 输入与显示安全

页面处理的是外部导入的 EDA 文本，网表名、层名等字段都属不可信输入。所有插入 `innerHTML` 的
动态文本（网表、层别、Padstack、缺陷原因）都经过 `escHtml()` 转义，`Net: <img src=x onerror=...>`
这类内容只会以字面量显示，不会执行；CSV/Excel 导出仍输出原始值，不受转义影响。

样式与脚本包统一带缓存版本号（如 `packages/engines/dfm/dfm-engine.js?v=7`），全站所有 `?v=` 必须是同一个值，
否则会出现「某页跑旧缓存、某页跑新代码」的不一致。**改动任一样式或脚本包后，把所有页面的 `?v=` 一起 +1。**

## 已知限制

- 全板级大样本数据集（数千项 / 百万级对偶）体积较大，未纳入仓库；需要时放入 `pcb-checker/sample/` 即可，对应测试会自动启用。
- 报告导出（Excel / CSV）在浏览器端生成，超大数据量下受浏览器内存限制。
