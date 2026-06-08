# DeepSeek Token Dash — 设计文档

> 日期: 2026-06-08 | 状态: 已确认

## 一、产品定义

**一句话**: 实时监控 DeepSeek API token 消耗的 Windows 桌面应用，通过本地代理拦截请求自动采集数据，以竖屏悬浮窗 + 完整仪表盘 + 系统托盘三种形态呈现。

**核心价值**: 不用打开任何网页后台，token 消耗数据自动出现在屏幕上，像网速监控一样自然。

## 二、技术选型

| 层 | 技术 | 理由 |
|---|---|---|
| 桌面框架 | Tauri 2.x | 体积小 (~10MB)，Rust 后端，Windows 原生体验好 |
| 前端 | React + TypeScript | 生态丰富，图表库成熟 |
| UI 库 | Tailwind CSS + shadcn/ui | 美观组件，暗色主题开箱即用 |
| 图表 | recharts | 轻量 React 图表，够用 |
| 代理 | Rust (Tauri 内置) | HTTP 转发代理，拦截 response header |
| 存储 | SQLite (via rusqlite) | 嵌入式数据库，零配置 |
| 实时推送 | Tauri Event System | Rust 后端 → React 前端事件流 |

## 三、架构

```
用户代码 (Python/Node/...)
    │
    │  endpoint 改为 127.0.0.1:8800
    ▼
┌──────────────────────────────────┐
│  Tauri App (常驻后台)             │
│                                  │
│  ┌────────────┐  ┌───────────┐  │
│  │ Rust 代理   │  │ SQLite    │  │
│  │ 127.0.0.1  │──│ (记录)    │  │
│  │ :8800      │  │           │  │
│  └────────────┘  └───────────┘  │
│         │                        │
│         │ Tauri Events           │
│         ▼                        │
│  ┌────────────────────────────┐  │
│  │ React 前端                  │  │
│  │ • 悬浮窗 (半透明，置顶)      │  │
│  │ • 仪表盘 (竖屏 320px)       │  │
│  │ • 设置页                    │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────┐  ┌────────────────┐  │
│  │ 系统托盘│  │ Windows 通知   │  │
│  └────────┘  └────────────────┘  │
└──────────────────────────────────┘
         │
         │ 转发请求到真实 API
         ▼
    api.deepseek.com
```

### 数据流

1. 用户代码发送请求到 `http://127.0.0.1:8800/v1/chat/completions`
2. Rust 代理转发到 `https://api.deepseek.com/v1/chat/completions`，保持 path 和 headers 不变
3. DeepSeek 返回响应，header 中包含 `x-ds-usage` (token 信息)
4. Rust 代理提取 token 数据，写入 SQLite，通过 Tauri Event 推送给前端
5. 前端实时更新显示
6. 原始响应完整返回给用户代码，整个过程透明

## 四、界面设计

### 布局规格

- **宽度**: 320px（固定）
- **高度**: 自适应
- **主题**: 深色 (`#0f172a` 背景)
- **可停靠**: 屏幕右侧或左侧贴边

### 三态交互

#### 态一：悬浮窗（默认，最小化）
- 始终置顶，半透明
- 显示：实时速度 (大) + 今日花费 (小)
- 可拖拽移动位置
- 双击 → 展开为仪表盘
- 右键 → 快捷菜单

#### 态二：仪表盘（展开）
页面结构自上而下:
1. **标题栏**: 应用名 + 代理状态指示灯
2. **实时速度卡片**: 最大字号，核心指标
3. **三指标行**: 今日消耗 / 今日费用 / 预算%
4. **迷你趋势图**: 每小时用量 sparkline
5. **最近请求**: 模型名 + token 数，保留 3-5 条

#### 态三：设置页
三个 Tab 切换:
- 💰 预算 — 月预算额度、告警阈值、重置周期
- 🏷️ 价格 — 模型单价表，可增删改
- ⚙️ 代理 — 端口配置、Endpoint URL、开关项

### 系统托盘

- 图标: DeepSeek 鲸鱼 🐋
- 悬停 tooltip: "今日: 128.5k tokens · ¥3.42"
- 右键菜单: 打开仪表盘 / 设置 / 退出

### 告警通知

- Windows 原生 toast notification
- 触发条件: 用量达到预算阈值的 80%/90%/100%
- 点击通知 → 打开仪表盘

## 五、数据模型

### SQLite 表结构

```sql
-- 每次 API 请求的记录
CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,        -- Unix timestamp ms
    model TEXT NOT NULL,                -- e.g. "deepseek-chat"
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    cost REAL,                          -- 计算得出
    duration_ms INTEGER,                -- 请求耗时
    endpoint TEXT                       -- e.g. "/v1/chat/completions"
);

-- 应用设置
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 模型价格
CREATE TABLE model_pricing (
    model TEXT PRIMARY KEY,
    input_price_per_1m REAL NOT NULL,   -- 每百万 token 价格
    output_price_per_1m REAL NOT NULL,
    updated_at INTEGER
);
```

## 六、API 代理规范

### 支持的路径

透传所有 `/v1/*` 路径到 DeepSeek API，核心关注:
- `POST /v1/chat/completions` — 聊天补全（最常用）
- `POST /v1/embeddings` — 嵌入（如有）

### Token 提取

DeepSeek 在响应 header 中返回:
```
x-ds-usage: {"prompt_tokens": 852, "completion_tokens": 435, "total_tokens": 1287}
```

代理解析此 JSON，与请求模型名一起写入数据库。

### 费用计算

```
cost = (prompt_tokens / 1,000,000) * model_input_price
     + (completion_tokens / 1,000,000) * model_output_price
```

默认内置 DeepSeek 官方价格，用户可在设置中调整。

## 七、非功能需求

- **性能**: 代理延迟 < 5ms（纯转发，不阻塞）
- **资源**: 常驻内存 < 50MB
- **数据保留**: 默认保留 90 天，可配置
- **启动**: 支持开机自启（注册表 Run 键）
- **崩溃恢复**: 代理进程崩溃自动重启

## 八、开发阶段

| 阶段 | 内容 | 产出 |
|---|---|---|
| 1. 项目脚手架 | Tauri + React 初始化，Tailwind 配置 | 能跑的窗口 |
| 2. Rust 代理 | HTTP 转发代理，token 提取，SQLite 存储 | 代理可用 |
| 3. 前端仪表盘 | 竖屏布局，指标卡，实时更新 | 可视界面 |
| 4. 悬浮窗 | 置顶窗口，折叠/展开切换 | 桌面体验 |
| 5. 系统托盘 | 托盘图标，右键菜单 | 后台运行 |
| 6. 设置页 | 预算/价格/代理配置 | 完整功能 |
| 7. 告警通知 | 预算阈值检测 + Windows 通知 | 提醒功能 |
| 8. 打包发布 | Tauri build，安装包，自动更新 | 可分发的 exe |

## 九、后续可扩展（v2）

- 多 API Key 支持
- DeepSeek 之外支持 OpenAI / Claude 等多厂商
- 数据导出 CSV/JSON
- 悬浮窗皮肤/主题
- 远程 Webhook 推送（团队共享）
