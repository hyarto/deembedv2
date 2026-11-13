# TODO —— 重构后最终检查（对比 origin/main）

基线：`origin/main`（d108bd0）与 `refactor/modular-eda-workbench` 各跑全部测试，按用例名逐项比对。
状态：`[ ]` 未处理　`[~]` 处理中　`[x]` 已修复并推送

## A. 测试覆盖对比

main：16 个脚本，通过用例合计 372；分支：27 个脚本，全部通过。
逐名比对后，以下为**真实丢失**（不含仅因去括号改名的用例）。

| # | 来源（main） | 丢失内容 | 状态 |
| --- | --- | --- | --- |
| A1 | copper-rule-import-test.js「页面渲染」组 10 条 | 导入后 22 个约束卡 / 5 个类标题；提示「22 条约束 / 44 列参数」；表头可编辑与来源注记；约束指引分组 BGA 16 / SMA Top 3 / SMA bottom 3；约束指引横排；chip 链接；综合页约束指引同规则；命名说明落页尾；说明卡在约束卡之后；② 页无 emoji | [x] 新增 tests/ui/copper-sets-render.test.js，11 条通过 |
| A2 | nav-unify-test.js「综合一体化同步 DFM 分层规则与扇出预览特征」 | 分层间距规则表、孔盘到孔盘阈值、扇出分色图例、表格型 TXT 在综合页 22 条分 5 组、命名说明位置、叠层数提示、分层规则模板生成 2 行 | [x] 新增 tests/ui/unified-rules-sync.test.js，6 条通过 |
| A3 | nav-unify-test.js 六页「页签条 5 个页签、统一文案、可切换」 | 分支只剩 eda-shell-unify 7 条，未逐页断言页签数与切换 | [x] eda-shell-unify 逐页增加逐工序点击断言（单一 active 页签与面板） |
| A4 | theme-unify-test.js | 正文基准字号 14px；统计卡不填色且标签 12px / 数值 22px；表格正文 13px 且无旧 slate 色；卡片标题 15 / 小节标题 13 | [ ] |
| A5 | bench-perf.js | 已迁入 tests/bench/copper-grid.bench.js，行为保留，但无耗时断言 | [ ] |

已确认**没有丢失**：ui-test 的 5 条（仅去括号改名）、portal 缓存版本号（改名）、GBK 解码 2 条（`decodeTxt` → `decodeBuffer`）。

## B. 重构引入的问题

| # | 问题 | 位置 | 状态 |
| --- | --- | --- | --- |
| B1 | AGENTS.md 自述仍有超标项：`unified.html` 1337 行、`fanout.html` 663、`dfm.html` 635；`unified.css` 892、`eda-shell.css` 755；函数 > 80 行 55 个 | 全仓库 | [ ] |
| B2 | `tests/bench/*.bench.js` 不在 `npm test`，回归时容易漏跑 | tools/run-tests.js | [ ] |
| B3 | 删除了静态说明：dfm `patHint`、fanout `pnlAdvice`、`viewSchemeBottomHint`（缩放 / 拖拽 / 测距操作提示）。操作提示对使用有帮助，应改为 data-tip 保留 | dfm.html / fanout.html | [ ] |
| B4 | 真实浏览器冒烟只在 `tools/browser-smoke.js`，依赖不入库，未接入测试分组 | tools | [ ] |

## C. 环境说明

- 浏览器冒烟需 playwright + chromium；沙箱无 root，通过 Debian 镜像解压 .so 并设 `LD_LIBRARY_PATH` 运行，冒烟 7/7 页通过。
