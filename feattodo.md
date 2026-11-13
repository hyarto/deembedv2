# feattodo —— 旧主线 pcb-checker.7z 新增功能合并进度

来源：release `feat-old-main` 的 `pcb-checker.7z`（35 个文件，扁平的重构前结构）。
基线核对：压缩包 21 个文件与旧主线 `d108bd0` 逐字节一致；有差异的 7 个文件为
`dfm-check.js` `dfm-test.js` `dfm-ui-test.js` `dfm.html` `fanout.html` `pour.html` `unified.html`。
状态：`[ ]` 未开始　`[~]` 进行中　`[x]` 已合并并推送

## 差异归类

| 文件 | 内容 | 处理 |
| --- | --- | --- |
| dfm-check.js | 解析选项 `padstackRules`：按 Padstack 覆盖焊盘直径与一钻直径 | 合并，见 F1 |
| dfm-test.js | 上条的引擎用例 | 合并，见 F1 |
| dfm.html | Padstack 尺寸覆盖表、孔盘对并入明细表、缺陷模式归并与列筛选、未复核筛选、返回明细、规则 JSON 导出窗口 | 合并，见 F2~F6、F10 |
| dfm-ui-test.js | 上述 UI 用例 | 合并，见 F7 |
| fanout.html pour.html unified.html | 关闭按钮的 `×` 与「删除」文字被清空、`fanout-check.js?v=6` 退回 `?v=5` | 退化改动，不合并 |
| unified.html | 导出弹窗下载按钮绑定方式改写（闭包绑定，旧版为全局变量） | 待核对，见 F8 |

## 任务

| # | 内容 | 状态 |
| --- | --- | --- |
| F0 | 建分支、克隆、解压、三方比对、本文件 | [x] |
| F1 | 引擎：`padstackRules` 覆盖焊盘与一钻直径 + 引擎用例 | [x] |
| F2 | 配置页：Padstack 尺寸覆盖表（自动列出、逐项覆盖、勾选批量应用、全选）；全局默认值输入框改隐藏；规则快照读写 padstackRules；新页面包 dfm-padstack-rules.js；UI 用例 3 条 | [x] |
| F3 | 结果页：孔盘到孔盘缺陷并入统一明细表，去掉独立孔盘卡片；表列由 13 列改 9 列；新页面包 dfm-results-pairs.js（过滤 / 分页 / 行渲染拆成小函数） | [x] |
| F4 | 结果页：「未复核不满足」筛选（视图一、视图二都生效）、总复核、返回检查结果明细按钮与位置记忆（dfm-result-nav.js）、孔对定位与画布高亮、过孔总览低细节绘制（dfm-canvas-vias.js） | [x] |
| F5 | 分析页：缺陷模式归并（引擎纯函数 buildDfmDefectPatternAnalysis）、线到孔 / 孔到孔两张模式表、列筛选弹层（dfm-pattern-modes.js、dfm-pattern-filter-popover.js）；旧四个下拉与旧图表收进隐藏容器；引擎用例 3 条、UI 用例 12 条 | [x] |
| F6 | 大样本保护：孔盘缺陷超过 1000 时禁止「全部显示」，退回每页 200 条 | [x] |
| F7 | 测试：迁入 dfm-ui-test 新增用例并适配重构后的 tests/ui。核对结果：旧 dfm-ui-test 里按名字查不到的 6 条（10 mil 孔盘对 8 条、列筛选、归并、分页位置、Padstack 批量、返回保留定位行）已逐条对应到 dfm-regression / dfm-ui / dfm-pattern-modes / dfm-results-merge 的同义用例，断言覆盖不少于旧版 | [x] |
| F8 | unified.html 导出弹窗下载逻辑核对；综合页是否需要同步 padstackRules。结论：压缩包里综合页没有任何 padstackRules 相关改动，引擎选项可选、不传则行为不变，不同步；导出弹窗只是下载按钮改成每次 openModal 重绑 onclick 并删掉 downloadModalContent，功能等价，重构后保留「全局下载函数 + 弹窗名状态」，不合并（见 D9） | [x] |
| F10 | 规则保存：点击保存后弹出可复制的 JSON 导出窗口（dfmRuleExportDialog），受限 iframe 拦截下载时仍可取到内容；新页面包 dfm-rule-export.js；rules-io 旧用例迁移并新增 2 条 | [x] |
| F9 | 文档与缓存版本号：AGENTS.md / README.md 同步（用例基线、已知坑、dfm.html 行数 628、综合页不传 padstackRules），全站 `?v=11` → `?v=12`（153 处），`npm run check` 32 个脚本全绿 | [x] |

## 与旧版压缩包的有意偏离

| # | 旧版行为 | 本次处理 | 原因 |
| --- | --- | --- | --- |
| D1 | 孔到孔行序号 `totalRecords + start + i + 1`，其中 `start` 已含 `totalRecords`，序号被重复累加 | 序号 = 全部线到孔记录数 + 页起点 + i + 1，跨页连续 | 旧公式在第 1 页就得到 2 倍偏移 |
| D2 | 「未复核」筛选下视图一（按网络聚合）不过滤，所有网络都显示 | 只保留至少有一条未复核缺陷的网络 | 与视图二语义一致 |
| D3 | 批量应用无选择时 `alert()` 弹窗 | 改为面板内状态行 `#padstackBulkHint` | 不阻塞页面，可被测试断言 |
| D4 | 导出窗口全部内联样式、依赖页面 `showToast` | 样式进 dfm.css，反馈走窗口内状态行 | AGENTS 3.3；dfm 页没有 toast |
| D5 | 按钮「只看不满足（未复核）」、表头「走线（所在层 / 网络）或配对过孔…」带括号解释 | 改为「未复核不满足」「走线或配对过孔」，解释进 data-tip | AGENTS 5.3 |
| D7 | 筛选弹层的外点关闭逻辑 `onOutside` 反复重挂监听，且无 Esc | 重写：Esc 立即生效，外点监听延后一拍挂接并在弹层移除时自动卸载 | 避免监听泄漏 |
| D8 | dfm.css 追加 200 余行会超 600 行 | 新增样式放入 dfm-panels.css，dfm.css 不变；dfm.html 压缩新表头保持在封顶 636 行内 | AGENTS 3.2 |
| D6 | 缩放按钮、关闭按钮、删除按钮文字被抹掉；`fanout-check.js?v=6` 退回 `?v=5` | 不合并 | 压缩包里的退化改动 |
| D9 | 综合页 openModal 每次重绑下载按钮 onclick，并删掉 downloadModalContent | 保留重构后的 downloadModalContent + 弹窗文件名状态 | 压缩包写法功能等价，但按钮 HTML 仍写 onclick=downloadModalContent()，函数被删后若有别的入口显示弹窗会报错 |
