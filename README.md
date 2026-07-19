# 中转 API 测试工具

一个 macOS 桌面应用,用来**检测中转 API 服务商有没有造假**:伪流式、缓存命中、套壳小模型、限流、偷工减料。测完给一个 0-100 综合评分和一句话结论,普通人也能看懂。

> 中转 API = 你买的第三方 OpenAI 兼容接口,不是官方直连。有些中转会偷偷降速、伪装流式、命中缓存、甚至换更弱的模型——这个工具就是来验真伪的。

## 9 个测试维度

| 维度 | 在测什么 |
|---|---|
| ⚡ 响应速度 | 流式 TTFB(首字节延迟) |
| 🌊 流式吞吐 | Token/s 估算 |
| 📡 流式真实性 | 是真逐 token 生成,还是一次性返回后伪装成流式 |
| 🔒 缓存嫌疑 | 同一题问 3 次,响应是否完全一致(缓存命中) |
| 🧠 智能能力 | 水桶问题,且判定是否真解出而非只命中关键词 |
| 🔁 并发稳定 | 5 次并发,看成功率与延迟抖动、是否排队限流 |
| 🔍 偷工减料 | 固定答案题用两种表述问,看是否换弱模型/降 max_tokens/截断 |
| 📏 上下文长度 | 2K/8K/32K 递增,看是否拒绝或偷偷截断 |
| 🎫 用量透明 | usage 字段是否存在且合理,多次同输入是否稳定 |

每项给一个**人话评级**(飞快/正常/偏慢/极慢 之类),再汇总成 0-100 分 + 红绿灯(推荐/可用/谨慎/不推荐)+ 一句话结论。

## 安装

### 方式一:直接下载(推荐,免装环境)

去 [Releases](../../releases) 下载对应架构的 `.dmg`:
- Apple Silicon(M1/M2/M3)→ `中转API测试-1.0.0-arm64.dmg`
- Intel Mac → 用源码自行打包(见下)

打开 dmg,把「中转API测试」拖到「应用程序」文件夹。**首次打开会被 macOS 拦**(应用未签名),处理方式:
- 右键点 app → 选「打开」→ 确认对话框再点「打开」
- 或终端执行:`xattr -cr "/Applications/中转API测试.app"`

### 方式二:从源码运行

```bash
git clone https://github.com/Zainal328/apitest-mac-.git
cd apitest-mac-
npm install
npm run dev
```

> ⚠️ 如果在 Claude Code 或某些 IDE 终端里 `npm run dev` 报 `Cannot read properties of undefined (reading 'whenReady')`,是 `ELECTRON_RUN_AS_NODE` 环境变量所致,用这个命令启动:
> ```bash
> env -u ELECTRON_RUN_AS_NODE npm run dev
> ```

## 使用

1. 填入 Base URL、API Key、模型 ID
2. **或者**:把服务商给你的任意文本粘进顶部「一键粘贴识别」框,点「识别并填充」,自动提取 URL / Key / 模型 ID(支持中英文混排、带标签或乱序)
3. 点「开始完整测试」,等 2-5 分钟跑完 9 组测试
4. 看顶部的综合评分 + 一句话结论,红绿灯总览一眼判断能不能用
5. 下方每项指标都有人话评级;「详细原始数据」可展开看完整 JSON

### 历史记录

每次测试自动保存(最多 50 条)。每条可:
- **重测**——一键填回 URL 和模型(Key 不存,需手填),直接重跑
- **复制配置**——把 URL + 模型拷到剪贴板(出于安全,Key 永不保存或复制)
- **选中对比**——勾 2 条,看指标变化(适合对比「优化前 vs 优化后」)

## 自己打包

```bash
# macOS .app(同时出 Intel + Apple Silicon)
env -u ELECTRON_RUN_AS_NODE npx electron-builder --mac --arm64 --x64

# macOS .dmg 安装镜像(Apple Silicon)
env -u ELECTRON_RUN_AS_NODE npx electron-builder --mac dmg --arm64

# Windows portable exe(需在 Windows 机器或有 Wine 的环境)
npm run build:win
```

产物在 `dist/`。

## 关于准确性

- **Token/s 是按字符估算**的(中文约 1 字 1 token),不等同于服务商内部真实 tokenizer 计数。要核账单必须看 usage 字段或服务商日志。
- 综合评分基于阈值经验,不是官方标准,只作横向对比参考。
- 流式真实性检测的是「行为特征」(chunk 数、窗口、首块占比),99% 能识破伪装,但不是绝对保证。

## 技术栈

Electron 33 + Fastify 5,纯原生 JS 无前端框架。主进程启 Fastify 本地服务(127.0.0.1),渲染进程通过 HTTP 调用,隔离干净。

## License

私有项目,未设开源协议。
