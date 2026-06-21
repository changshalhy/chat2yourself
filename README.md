# Chat2Yourself

Chat2Yourself 是一个本地优先的 AI 自我访谈工具。它把一次混乱的自我对话拆成几个温和阶段：先接住当下，再铺开事实、切换视角、命名模式，最后整理出阶段性自我画像和一个很小的下一步。

这个项目适合用来做个人复盘、情绪整理、想法澄清和低压力的周期回顾。它不是医疗、心理诊断或危机干预工具。

## 当前能力

- 六阶段自我访谈：入场校准、事实铺开、视角切换、模式命名、下一步轻触、收束保存。
- DeepSeek 对话：通过本地 Express 服务转发请求，API Key 只放在本机 `.env`。
- 阶段性自我画像：根据当前会话生成结构化报告，而不是固定模板硬套。
- 多会话资料库：支持本地搜索、按报告/收藏/待办筛选、按更新时间/创建时间/消息数排序。
- 进步记录：清晰度打分、关键句收藏、极小行动生成和完成状态。
- 周期回顾：聚合近 7 天、近 30 天或全部时间的主题、行动和清晰度变化。
- 导出与迁移：单次会话 Markdown/JSON 导出、周期回顾 Markdown 导出、全量 JSON 备份与恢复。
- 桌面壳工程：已接入 Tauri Windows 桌面开发和打包脚本。

## 下一版升级重点

我建议下一版优先做 `v0.6`，目标不是继续堆功能，而是把项目从“开发者能跑”升级到“普通 GitHub 用户也能放心下载、配置、使用”。

1. **桌面分发闭环**
   - 把 DeepSeek 调用从外部 Express 服务迁到 Tauri command，或把本地服务做成 Tauri sidecar。
   - 产出 Windows 安装包，减少用户手动开两个进程的成本。
   - 增加首次启动配置页，让用户在应用内填 API Key，而不是编辑 `.env`。

2. **配置与错误提示**
   - 在界面里明确显示后端连接、API Key、模型名和网络错误状态。
   - 对 `401`、余额不足、模型不存在、网络不可达分别给出可操作提示。
   - 支持从 UI 切换模型名和 Base URL，方便用户使用兼容 OpenAI 格式的其他服务。

3. **数据安全与迁移**
   - 给本地备份增加可选加密密码。
   - 增加“恢复前预览”，避免误覆盖当前浏览器里的数据。
   - 后续可考虑 IndexedDB，替代 `localStorage`，提升大量会话时的容量和可靠性。

4. **产品体验打磨**
   - 增加首次使用引导，但保持主界面直接可用。
   - 增加空状态示例，让用户知道第一句话可以怎么写。
   - 给阶段切换、生成画像、导出备份增加更清楚的 loading 与成功反馈。

5. **工程质量**
   - 拆分 `src/App.tsx`：把存储、导出、报告解析、会话筛选等逻辑移到独立模块。
   - 增加单元测试，重点覆盖备份恢复、报告格式归一化、Markdown 导出和会话筛选。
   - 增加 GitHub Actions：安装依赖、类型检查、构建、桌面预检。

## 从 GitHub 下载后怎么使用

### 方式一：推荐，开发模式运行网页版

适合所有想先试用或二次开发的人。

#### 1. 准备环境

需要：

- Node.js 20 或更高版本
- npm
- 一个可用的 DeepSeek API Key

#### 2. 下载项目

用 Git：

```powershell
git clone https://github.com/changshalhy/chat2yourself.git
cd chat2yourself
```

或者在 GitHub 页面点击 **Code -> Download ZIP**，解压后进入项目目录。

#### 3. 安装依赖

```powershell
npm install
```

#### 4. 创建本地配置

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

然后编辑 `.env`：

```dotenv
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
PORT=8787
```

如果你的 DeepSeek 账号没有开通示例里的模型，请把 `DEEPSEEK_MODEL` 改成你账号可用的模型名。

#### 5. 启动应用

```powershell
npm run dev
```

这个命令会同时启动：

- 本地 API 服务：http://127.0.0.1:8787
- Vite 前端页面：http://127.0.0.1:5173

浏览器打开 [http://127.0.0.1:5173](http://127.0.0.1:5173) 即可使用。

### 方式二：桌面开发模式

适合想调试 Tauri 桌面壳的人。

除了 Node.js 和 npm，还需要安装：

- Rust 和 Cargo
- Microsoft C++ Build Tools
- WebView2

先检查本机桌面打包环境：

```powershell
npm run desktop:preflight
```

启动桌面开发模式：

```powershell
npm run desktop:dev
```

更多说明见 [docs/DESKTOP_PACKAGING.md](docs/DESKTOP_PACKAGING.md)。

### 方式三：构建生产版本

验证 Web 构建：

```powershell
npm run build
```

尝试构建桌面包：

```powershell
npm run desktop:build
```

注意：当前桌面壳仍依赖本地 API 服务配置，尚未达到“下载一个安装包就能给非开发者直接用”的分发状态。这也是下一版最应该优先补齐的地方。

## 使用流程

1. 打开应用后，先在输入框里写下此刻最想整理的一团想法。
2. 通过阶段按钮切换访谈阶段，不需要严格按顺序推进。
3. 聊过几轮后，点击生成阶段性自我画像。
4. 收藏关键句，调整清晰度评分，确认或完成极小行动。
5. 在回顾中心查看一段时间内的主题、行动和清晰度变化。
6. 需要迁移数据时，使用全量备份；需要分享或留档时，导出 Markdown。

## 数据与隐私

- `.env` 已被 Git 忽略，API Key 不应提交到仓库。
- 会话记录默认保存在当前浏览器的 `localStorage` 中。
- 不同浏览器、不同设备之间不会自动同步数据。
- 发送消息或生成画像时，相关会话内容会经本地 Express 服务发送给配置的 DeepSeek API。
- 周期回顾在本地聚合，不会额外调用远程服务。
- 遇到即时危险、自伤或伤人风险时，请立刻联系当地紧急服务或身边可信任的人。

## 常见问题

### 页面提示后端未连接

确认 `npm run dev` 还在运行，并检查终端里是否显示 API 服务已经监听 `http://127.0.0.1:8787`。

### 提示 Missing DEEPSEEK_API_KEY

确认已经从 `.env.example` 复制出 `.env`，并在 `.env` 里填入真实 API Key。修改 `.env` 后需要重启 `npm run dev`。

### 模型请求失败

检查三件事：

- API Key 是否有效。
- `DEEPSEEK_BASE_URL` 是否正确。
- `DEEPSEEK_MODEL` 是否是当前账号可用的模型名。

### 换浏览器后看不到旧数据

这是当前设计。数据保存在原浏览器本地，需要先在原浏览器导出全量备份，再在新浏览器恢复。

## 开发脚本

```powershell
npm run dev                # 同时启动本地 API 与 Vite 前端
npm run dev:server         # 只启动 Express API
npm run dev:web            # 只启动 Vite 前端
npm run build              # TypeScript 检查、Vite 构建、服务端编译
npm run preview            # 预览 dist 构建产物
npm run desktop:preflight  # 检查 Tauri 桌面开发依赖
npm run desktop:dev        # 启动 Tauri 桌面开发模式
npm run desktop:build      # 构建 Tauri 桌面包
```

## 已知限制

- 当前还没有面向普通用户的一键安装包。
- 桌面壳已经接入，但模型调用仍走本地 Express API。
- 本地数据没有加密，备份文件也没有密码保护。
- 没有账号体系、云同步或多人共享能力。
- 这个工具不能替代专业心理咨询、医疗服务或紧急援助。
