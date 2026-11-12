# 可迁移 SI 工作台 Workspace

这是一个可独立复制的项目工作区，保留完整应用源码、示例文件、运行服务、开发依赖锁文件和测试。

## 文件结构

- `pcb-checker/`：六个检查页面、检查引擎、测试和示例数据。
- `package.json` / `package-lock.json`：运行与测试命令、锁定依赖。
- `serve.js`：本地静态服务器。
- `tools/`、`AGENTS.md`：开发辅助工具与维护说明。
- `.config/`、`dev/`：可选的本地配置/开发笔记位置，不含机器凭据。
- `uploads/`：可放置本地 EDA 导出文件；应用不会自动上传此目录。

## 运行

需要 Node.js 18 或更高版本。在本目录执行：

```sh
npm ci
npm run serve
```

浏览器访问 `http://localhost:8000/`。开发验证可运行 `npm test`。

`node_modules/` 和 `.git/` 未打包：依赖可用 `npm ci` 重建，版本控制历史不会影响工作台运行。
Ubuntu 的 `.sudo_as_admin_successful` 是主机权限标记，不属于应用或可迁移项目文件，因此未复制。
