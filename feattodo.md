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
| F3 | 结果页：孔盘到孔盘缺陷并入统一明细表，去掉独立孔盘卡片；表列由 13 列改 9 列 | [ ] |
| F4 | 结果页：「只看不满足（未复核）」筛选、复核标记、返回检查结果明细按钮与位置记忆 | [ ] |
| F5 | 分析页：缺陷模式归并（线到孔 / 孔到孔）与列筛选弹层 | [ ] |
| F6 | 大样本保护：孔盘缺陷超过 1000 时禁止「全部显示」 | [ ] |
| F7 | 测试：迁入 dfm-ui-test 新增用例并适配重构后的 tests/ui | [ ] |
| F8 | unified.html 导出弹窗下载逻辑核对；综合页是否需要同步 padstackRules | [ ] |
| F10 | 规则保存：点击保存后弹出可复制的 JSON 导出窗口（dfmRuleExportDialog），受限 iframe 拦截下载时仍可取到内容 | [ ] |
| F9 | 文档与缓存版本号：AGENTS.md / README.md 同步，`?v=` 全站 +1，`npm run check` 全绿 | [ ] |
