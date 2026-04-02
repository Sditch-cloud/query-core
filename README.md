# query-core

本工程基于 Tauri + React + TypeScript（Vite）搭建，用于演示本地文件导入与关键字检索的桌面应用。

**主要文件**
- 配置: [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)
- 权限/能力: [src-tauri/gen/schemas/capabilities.json](src-tauri/gen/schemas/capabilities.json)
- 前端入口: [src/App.tsx](src/App.tsx)
- 项目声明: [package.json](package.json)

## 前提环境（Windows）
- Node.js（建议 >=18）
- Rust（通过 `rustup` 安装，需能运行 `cargo build`）
- Visual C++ Build Tools（安装“Desktop development with C++”，用于 Rust 链接）
- Microsoft Edge WebView2 Runtime（运行时依赖）

## 安装与本地开发
1. 安装 JS 依赖：
```bash
npm install
```
2. 启动前端开发服务器：
```bash
npm run dev
```
3. 在另一终端启动 Tauri 开发模式（热重载）：
```bash
npx tauri dev
```

## 打包为原生应用（Windows）
1. 先构建前端静态文件：
```bash
npm run build
```
2. 使用 Tauri 打包（会调用 Rust 编译器并生成安装包）：
```bash
npx tauri build
```
打包结果通常位于 `src-tauri/target/release/bundle/` 下（包含平台对应的安装器或可执行文件）。

## 权限与 capability
项目使用 Tauri 的 capability（能力）系统控制前端对核心 API 与插件的访问，配置文件在 [src-tauri/gen/schemas/capabilities.json](src-tauri/gen/schemas/capabilities.json)。若需修改窗口权限，优先通过能力文件/`tauri.conf.json` 调整，不要随意直接修改生成的 schema 文件。

## GitHub Actions 自动打包发布
已添加工作流文件：`.github/workflows/release.yml`。

### 触发方式
- 推送语义化版本 Tag（如 `v0.1.0`）时自动触发。
- 也支持在 GitHub Actions 页面手动触发（`workflow_dispatch`）。

### 发布步骤
1. 更新版本号（建议保持 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 一致）。
2. 提交代码并打 Tag：
```bash
git add .
git commit -m "release: v0.1.0"
git tag v0.1.0
git push origin main --tags
```
3. 等待 Actions 完成后，在 GitHub Releases 页面可看到自动创建的 Release 和安装包附件。

### 注意事项
- 当前工作流默认在 `windows-latest` 打包，适合你当前的 Windows 发布需求。
- 使用的是仓库内置 `GITHUB_TOKEN` 自动创建 Release，无需额外配置私有 Token。

