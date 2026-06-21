# Chat2Yourself

一个本地优先的 AI 自我访谈工具。它通过分阶段追问帮助你整理混乱想法，并把访谈、画像、清晰度变化和极小行动保存在当前浏览器中。

## 当前能力

- 六阶段自我访谈流程
- DeepSeek 对话与阶段性画像
- 多会话、本地搜索、筛选与排序
- 关键句收藏、清晰度记录和极小行动
- 周期回顾、主题汇总与 Markdown 导出
- 全量 JSON 备份与恢复
- Tauri Windows 桌面壳工程

## 本地测试

需要 Node.js 20 或更高版本，以及一个可用的 DeepSeek API Key。

```powershell
git clone https://github.com/changshalhy/chat2yourself.git
cd chat2yourself
npm install
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
PORT=8787
```

启动前后端：

```powershell
npm run dev
```

然后打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

## 验证

```powershell
npm run build
npm run desktop:preflight
```

`npm run build` 验证前端、服务端 TypeScript 和 Vite 生产构建。桌面打包还需要 Rust、Cargo、WebView2 与 Microsoft C++ Build Tools，详见 [桌面打包说明](docs/DESKTOP_PACKAGING.md)。

## 数据与隐私

- `.env` 已被 Git 忽略，API Key 不应提交到仓库。
- 会话记录默认保存在当前浏览器的 `localStorage` 中。
- 发送消息或生成画像时，相关会话内容会经本地 Express 服务发送给配置的 DeepSeek API。
- 这是自我整理工具，不提供医疗诊断或紧急援助。遇到即时危险时，请联系当地紧急服务或身边可信任的人。

## 已知限制

- 当前桌面壳仍依赖本地 Express API，尚未提供可直接分发的 Windows 安装包。
- 不同浏览器或设备之间不会自动同步数据，请使用应用内备份与恢复功能迁移。
