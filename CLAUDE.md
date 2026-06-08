# DeepSeek Token Dash

Windows 桌面应用，实时监控 DeepSeek API token 消耗。Tauri 2 + React + Rust 代理。

## 常用命令

```bash
pnpm install                        # 安装前端依赖
pnpm build                          # 前端构建
pnpm tauri dev                      # 开发模式（热更新）
pnpm tauri build                    # 发布构建
cargo build --manifest-path src-tauri/Cargo.toml    # 仅 Rust 调试构建
cargo build --release --manifest-path src-tauri/Cargo.toml  # 仅 Rust 发布构建
```

## 架构

```
用户代码 → 127.0.0.1:8800 (Rust 代理) → api.deepseek.com
              │
              ├── 从 response header x-ds-usage 提取 token
              ├── SQLite 存储
              └── Tauri Event → React 前端实时更新
```

## 关键文件

- `src/App.tsx` — 主应用，监听 Tauri events
- `src/components/Dashboard.tsx` — 320px 竖屏仪表盘
- `src/components/SettingsPage.tsx` — 设置页（预算/价格/Key/代理）
- `src/components/FloatingWidget.tsx` — 置顶悬浮窗
- `src-tauri/src/lib.rs` — Tauri commands, DB, 系统托盘
- `src-tauri/src/proxy.rs` — HTTP 代理 + token 提取 + 预算告警
- `src-tauri/tauri.conf.json` — 窗口配置（main 320x600, floating 140x60）
- `docs/specs/` — 设计文档

## 注意事项

- Windows 专用，Rust 工具链必须是 `stable-x86_64-pc-windows-msvc`（不能用 GNU）
- `.npmrc` 设了 `node-linker=hoisted`，不要删
- Tauri notification 插件配置在 `tauri.conf.json` 中必须为 `null`
- 代理在独立线程中运行自己的 tokio runtime
- pnpm 的 bin shims 在此环境可能不生效，用 `node node_modules/.../bin/xxx` 作为后备

## API Key 管理

代理自动从 `Authorization: Bearer <key>` 提取 Key，首次见到自动注册。用户可在设置中补充标签和颜色标记。Key 明文不存，只存 SHA256 哈希。
