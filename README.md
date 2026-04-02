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

