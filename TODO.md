# 模块化工程重构与现代 EDA 工作台升级 TODO

本文件用于跟踪 `refactor/modular-eda-workbench` 临时分支的分阶段重构、UI 改造与回归验证进度。每完成并验证一个模块即阶段性提交更新，最终合入前执行 Cleanup 清理。

## 阶段总览

- [x] **Stage 1：基线恢复与引擎分包落盘**
  - [x] 抽离设计令牌与三栏壳层样式：`pcb-checker/assets/styles/{tokens,eda-shell,components}.css`
  - [x] 抽离精确几何包：`pcb-checker/packages/geometry/{pad-primitives,pad-region,index}.js`
  - [x] 抽离共享基础设施包：`pcb-checker/packages/shared/{dom-utils,xlsx-export,ui-prefs,eda-tooltip,eda-shell}.js`
  - [x] 抽离五大检查引擎包：`pcb-checker/packages/engines/{trace,copper,dfm,fanout,pour}/*`
  - [x] 建立模块化引擎单测与网格基准测试：`pcb-checker/tests/{engine,bench}/*`（全部通过）

- [x] **Stage 2：共用测试加载器与统一入口页 `portal.html` 重构**
  - [x] 建立支持 `<link>` 与 `<script src>` 解析的 JSDOM 页面加载辅助模块 `pcb-checker/tests/helpers/open-page.js`
  - [x] 抽离 `pcb-checker/assets/styles/pages/portal.css`
  - [x] 重构 `pcb-checker/portal.html` 为现代 EDA 启动台，移除括号解释改为 `data-tip` 悬浮提示，清除冗余套话文案

- [x] **Stage 3：走线检查模块 `index.html` 拆分与三栏 EDA 重构**
  - [x] 抽离页面样式 `pcb-checker/assets/styles/pages/trace.css`
  - [x] 将 2455 行内联脚本拆分为 `pcb-checker/packages/pages/trace/{trace-state,trace-overview-ui,trace-rules-ui,trace-results-ui}.js`，复用 `TraceEngine` 与 `XlsxExport`
  - [x] 重构 `index.html` 为左导轨 + 中视口渐进工序 + 右遥测/工具栏三栏结构，括号说明全量迁移至 `data-tip`
  - [x] 通过走线引擎与走线 UI 全流程测试

- [x] **Stage 4：约束检查模块 `copper.html` 拆分与三栏 EDA 重构**
  - [x] 抽离页面样式 `pcb-checker/assets/styles/pages/copper.css`
  - [x] 将 1841 行内联脚本拆分为 `pcb-checker/packages/pages/copper/{copper-state,copper-sets-ui,copper-results-ui}.js`，复用 `CopperCheck` 与 `ConstraintParser`
  - [x] 重构 `copper.html` 为三栏渐进式 EDA 布局，括号说明全量迁移至 `data-tip`，清除冗余描述文案
  - [x] 通过约束规则导入与约束 UI 全流程测试

- [x] **Stage 5：加工能力检查模块 `dfm.html` 拆分与三栏 EDA 重构**
  - [x] 抽离页面样式 `pcb-checker/assets/styles/pages/dfm.css`
  - [x] 将 2456 行内联脚本拆分为 `pcb-checker/packages/pages/dfm/{dfm-config,dfm-results-ui,dfm-canvas-viewer}.js`，复用 `PadGeom` 与 `DfmCheck`
  - [x] 重构 `dfm.html` 为三栏渐进式 EDA 布局，括号说明全量迁移至 `data-tip`，清除冗余描述文案
  - [x] 通过 DFM 引擎与 DFM UI 全流程测试

- [x] **Stage 6：扇出方案检查模块 `fanout.html` 拆分与三栏 EDA 重构**
  - [x] 抽离页面样式 `pcb-checker/assets/styles/pages/fanout.css`
  - [x] 将 3942 行内联脚本拆分为 `pcb-checker/packages/pages/fanout/{fanout-state,fanout-library-ui,fanout-results-ui,fanout-canvas-viewer}.js`，复用 `FanoutChecker`
  - [x] 重构 `fanout.html` 为三栏渐进式 EDA 布局，括号说明全量迁移至 `data-tip`，清除冗余描述文案
  - [x] 通过扇出引擎与扇出 UI 全流程测试

- [x] **Stage 7：铜皮检查模块 `pour.html` 拆分与三栏 EDA 重构**
  - [x] 抽离页面样式 `pcb-checker/assets/styles/pages/pour.css`
  - [x] 将 2105 行内联脚本拆分为 `pcb-checker/packages/pages/pour/{pour-state,pour-results-ui,pour-canvas-viewer}.js`，复用 `PourChecker`
  - [x] 重构 `pour.html` 为三栏渐进式 EDA 布局，括号说明全量迁移至 `data-tip`，清除冗余描述文案
  - [x] 通过铜皮引擎与铜皮 UI 全流程测试

- [x] **Stage 8：综合一体化工作台 `unified.html` 拆分与三栏 EDA 重构**
  - [x] 抽离 959 行内联样式至 `pcb-checker/assets/styles/pages/unified.css`，页面壳层样式回归 `eda-shell.css`
  - [x] 将 5913 行内联巨型脚本拆分为 `pcb-checker/packages/pages/unified/unified-*.js` 共 20 个按功能命名的页面包（约束解析、默认规则、状态、数据导入、示例数据、五类规则 UI、扇出方案库/命名/查看/导入导出、调度、仪表盘、2D 视口、规则文件读写、报告导出、启动）
  - [x] 480 行 `runMasterInspection` 拆为 `buildInspectionContext` + 五个独立引擎阶段函数，复用五大引擎分包
  - [x] 重构 `unified.html` 为左导轨（模块导航 + 六工序）+ 中视口 + 右工具与遥测栏，规则配置独立成工序，括号说明迁移至 `data-tip`，删除冗余文案
  - [x] 新增 `tests/ui/unified-ui.test.js`；联检结果与重构前基线逐项一致（88 项 / 69 不符合）

- [ ] **Stage 9：测试体系与性能基准包化整理及旧巨型文件清理**
  - [ ] 迁移并升级 UI 回归测试至 `pcb-checker/tests/ui/{trace-ui,copper-ui,dfm-ui,fanout-ui,pour-ui,ui-prefs,eda-shell-unify,theme-unify,portal-and-controls}.test.js`
  - [ ] 迁移走线性能基准至 `pcb-checker/tests/bench/trace-engine.bench.js`
  - [ ] 移除根目录旧单体文件（`pad-geom.js`、`*-check.js`、`ui-prefs.js`、`*-test.js`、`bench-perf.js`），更新 `package.json` 脚本入口
  - [ ] 运行全量 `npm test` 与 `npm run bench` 性能校验

- [ ] **Stage 10：文档工程化规范更新、最终 Cleanup 与提交 PR**
  - [ ] 更新 `AGENTS.md`：工程化分包架构规范、禁止括号解释统一改用悬浮 `data-tip`、左导轨+中视口+右工具栏渐进式 EDA 规范、禁止废话文学
  - [ ] 同步更新 `README.md` 目录与使用说明
  - [ ] 清理临时 `TODO.md`，确认工作区干净、`npm test` 全绿、HTTP 服务正常，提交 PR 至 `main`
