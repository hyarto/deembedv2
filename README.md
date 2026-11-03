# SI 工作台（PCB 综合检查工作台）

纯前端的 PCB / 信号完整性（SI）检查工作台：把 EDA 导出的 TXT 报告直接拖进浏览器，即可完成
**走线规则、约束、加工能力（DFM）、扇出方案、铜皮** 五类检查，并输出缺陷清单、2D 空间视图与 Excel/CSV 汇总报告。

所有数据都在浏览器本地解析处理，不上传任何服务器，也不需要后端服务。

## 页面一览

| 页面 | 作用 |
| --- | --- |
| `pcb-checker/index.html` | 走线检查：导入网络走线报告 → 概览 → 按出线层配规则（线宽组合 / 总线长 / 指定线宽线长 / 弧半径）→ 结果标注 → 差分对逐层线长差分析 |
| `pcb-checker/copper.html` | 约束检查：把铜皮 / 焊盘栈参数整理成可导入 EDA 的约束条件，并核对回读数据是否符合 |
| `pcb-checker/dfm.html` | 加工能力检查：孔到孔、走线到过孔的空间间距（Airgap）判定，含 2D 几何测量与逐层定位；盲埋孔按 `Padstack Defined` 起止层判定是否穿越当前走线层，不穿越的直接跳过 |
| `pcb-checker/fanout.html` | 扇出方案检查：过孔自动聚类 + 刚体平移/旋转/镜像不变匹配，比对方案库判断扇出是否合规（可开启任意角度姿态，支持 30°/45° 等非正交扇出）；可同时导入走线数据，把走线与扇出孔群关联、按层着色，并支持纯走线模式 |
| `pcb-checker/pour.html` | 铜皮检查：铺铜覆盖、异型铜皮、参考层覆盖 / 超宽、孤立碎铜、最小圆弧半径五大项 |
| `pcb-checker/unified.html` | 综合一体化检查：一套数据同时跑五大引擎，输出统一缺陷清单、风险雷达与综合报告 |

页面之间通过顶部导航互相跳转，`unified.html` 复用四个独立引擎文件（`*-check.js`），逻辑只有一份。

## 快速开始

```bash
npm run serve          # 默认 http://localhost:8000/ ，端口可用 PORT=8080 覆盖
```

或任意静态服务器：

```bash
cd pcb-checker && python3 -m http.server 8000
```

> 页面里的「示例数据」按钮通过 `fetch('sample/...')` 读取文件，因此必须用 HTTP 打开；
> 直接双击 HTML（`file://`）会被浏览器同源策略拦截。

## 输入数据格式

EDA 导出的文本报告，主体是 `Item N < Via / Trace / Shape >` 段落，常用字段：

- `Total N Items` / `Item N <类型>` / `Set: ...` / `Subset: <层号>G01P`
- `Origin-xy: [x, y]`、`Seg xy: [...]`、`Arc seg: [...]`（坐标，单位 mil）
- `Padstack Name`、`Net`、`Width`、`Layer` 等
- 单个 `< Trace >` 内可含多段 `Seg` / `Arc seg`（如 `Trace Seg`），走线检查与扇出页都按多段解析，层别取 `Subset`、线宽取 `Width`

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

焊盘形状在 `dfm.html` 的「焊盘形状（可选）」里配置（默认圆形，与旧口径完全一致）；
`unified.html` 的综合检查目前仍使用圆形焊盘默认值。

## 测试

```bash
npm install
npm test               # 几何对拍 + 引擎单元测试 + jsdom 全流程 UI 测试
npm run test:engine    # 只跑引擎逻辑（含几何对拍）
npm run test:geometry  # 只跑几何内核 vs shapely 基准对拍
npm run test:ui        # 只跑 UI 交互
npm run bench          # 走线检查引擎性能对照（合成 15000 项数据）
```

测试通过 jsdom 载入真实页面并模拟点击，覆盖导入 → 规则 → 检查 → 导出 → 复验的完整链路。

**几何内核的独立验证**：`tools/oracle/gen-fixtures.py` 用 shapely(GEOS) 生成 180+ 组随机
焊盘/走线组合（圆形、长圆、圆角矩形、矩形 × 直线/圆弧，含重叠样本）作为基准值，写入
`pcb-checker/sample/geometry-oracle-fixtures.json`；`geometry-oracle-test.js` 逐条对拍，
要求偏差 < 0.01 mil、重叠必须判负、且不允许出现系统性乐观偏差（DRC 最怕把危险值算大）。
夹具已入库，CI 不需要 Python：

```bash
python3 -m venv .venv && .venv/bin/pip install shapely   # 仅在需要重新生成夹具时
.venv/bin/python tools/oracle/gen-fixtures.py
```

## 目录结构

```
serve.js                零依赖静态服务器（站点根 = pcb-checker/）
pcb-checker/
  index.html            走线检查
  copper.html           约束检查
  dfm.html              加工能力检查
  fanout.html           扇出方案检查
  pour.html             铜皮检查
  unified.html          综合一体化检查
  copper-check.js       约束检查引擎
  dfm-check.js          DFM 空间间距引擎
  fanout-check.js       扇出聚类 / 匹配引擎
  pour-check.js         铜皮检查引擎
  pad-geom.js           精确几何内核（凸多边形 ⊕ 圆角，焊盘/走线求距）
  sample/               示例数据（含 shapely 几何基准夹具）
  *-test.js             引擎、几何对拍与 UI 测试
  bench-perf.js         性能对照脚本
tools/oracle/
  gen-fixtures.py       用 shapely 生成几何基准夹具（开发期工具）
```

## 整理说明

本仓库最初的工作目录是开发过程中的现场快照，本次归档只保留可运行的成品、示例数据与测试：

- **移除** `dev/`：111 个一次性 `patch-*.py` / `fix-*.py` / 临时 `test-*.js` 脚手架脚本，都是改造 HTML 时的一次性补丁，改完即失效。
- **移除** `.config/`（Chromium 无头配置与缓存）和 `.sudo_as_admin_successful`：运行环境残留，与项目无关。
- **移除** `uploads/`：需求截图与重复的原始输入数据，其中真正需要的样本已归并进 `pcb-checker/sample/`。
- **移除** OCR 相关未接线代码（`vendor/tesseract*` 约 6.4 MB、`ocr_client.js`、`ocr_server.py`）：页面从未加载过这套 OCR，属于废弃试验；如需恢复可从提交历史取回。
- **移除** 未随包提供的大样本数据集入口（原先三个页面各有一个「加载 2.5MB 全板样本」按钮，指向不存在的 `sample/via_trce_airgap_data-2.txt`，点了必然报错）；对应测试用例保留，文件缺失时自动跳过。
- **修正** 测试脚本里指向开发机绝对路径（`/home/user/...`、`/tmp/npmtest/...`）的 jsdom 加载方式，改为常规 `require('jsdom')`。
- **修正** 走线检查结果页线宽组合的显示分隔符，与不符合原因说明、CSV 导出统一为 `→`（此前显示 `-`，与自身提示文案不一致）。

## 已知限制

- 全板级大样本数据集（数千项 / 百万级对偶）体积较大，未纳入仓库；需要时放入 `pcb-checker/sample/` 即可，对应测试会自动启用。
- 报告导出（Excel / CSV）在浏览器端生成，超大数据量下受浏览器内存限制。
