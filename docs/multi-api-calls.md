# 多个 API 调用逻辑实现说明（BananaPod）

本文档记录 BananaPod 在「一次用户操作触发多个 API 调用」时的组织方式与关键实现点，便于后续新增接口、接入新 Provider 或扩展重试/取消/限流等能力。

## 目标与原则

- **把“编排逻辑”和“UI 状态”分离**：UI 只负责触发与展示；多 API 调用链路集中在 `services/`。
- **用统一接口屏蔽 Provider 差异**：对上层暴露同一套 `AiService` 方法；不同 Provider 内部可用不同的多步调用实现。
- **多步链路要可观测**：长任务用 `onProgress` 回调更新进度，便于 UI 反馈。
- **失败要可诊断**：服务层抛出包含上下文的错误信息；UI 层做用户友好提示（如 429 配额）。

## 代码入口与分层

- UI 编排入口：`App.tsx` 的 `handleGenerate`（决定走图片/视频、编辑/生成、选择哪个 Provider）。
- Provider 抽象：`services/ai/aiService.ts` 定义 `AiService`。
- Provider 选择与缓存：`services/ai/registry.ts` 的 `getAiService()`（按 `AiProviderId` 延迟创建并复用实例）。
- 具体实现：
  - Gemini：`services/geminiService.ts`（图片多模态、文生图、视频长任务）
  - NanoBanana：`services/nanoBananaService.ts`（创建任务 → 轮询结果 → 下载资源）

## 典型“多个 API 调用”模式

### 1）串行依赖：创建任务 → 轮询 → 下载（NanoBanana）

NanoBanana 的链路是经典的“异步任务”模型，必须按顺序调用多个接口：

1. **创建任务**：`NanoBananaAiService.createDrawTask(urls, prompt)`
2. **轮询任务状态/结果**：`NanoBananaAiService.pollDrawResult(id, onProgress?)`
3. **下载生成资源**：`NanoBananaAiService.urlToBase64(url)`（如果是 `data:` URL 则直接解析，否则 `fetch` 下载）

在 `editImage()` / `generateImageFromText()` 中体现为：

- `taskId = await createDrawTask(...)`
- `result = await pollDrawResult(taskId)`
- `await urlToBase64(result.urls[0])`

实现要点：

- **轮询间隔与超时**：通过 `pollIntervalMs` / `timeoutMs`（默认 2s / 180s）控制频率与最长等待。
- **“完成”判断要兼容字段差异**：`pickUrls()` / `pickStatus()` 兼容多种返回结构；`isDoneStatus()` 同时支持 “状态” 或 “urls 已返回” 两种完成信号。
- **错误尽早失败**：HTTP 非 2xx 或业务 `code !== 0` 立即抛错；状态为失败且无结果也抛错。

### 2）长任务轮询：启动生成 → 查询 operation → 下载（Gemini 视频）

Gemini 视频生成也是多步链路（服务端异步完成）：

1. 启动生成：`client.models.generateVideos(...)` 返回 `operation`
2. 轮询 operation：`client.operations.getVideosOperation({ operation })` 直到 `operation.done`
3. 取下载链接并下载视频：对 `operation.response...uri` 追加 key，再 `fetch` 下载 Blob

对应实现：`GeminiAiService.generateVideo()`（`services/geminiService.ts`）。

实现要点：

- **用 `onProgress` 给 UI “活着的反馈”**：每次轮询间隔（当前为 10s）更新提示语，避免用户误以为卡死。
- **最后一步下载也要处理失败**：下载响应 `!ok` 直接抛错，避免生成成功但下载失败无提示。

### 3）并行独立：批量准备数据 / 多请求并发

当多个请求彼此独立时，可以并行减少总耗时：

- 典型写法：`await Promise.all([...])`
- UI 中已有类似结构：`App.tsx` 在编辑模式下会把多个选中元素转换为 `ImageInput` 列表，再统一调用 `ai.editImage({ images, prompt, mask? })`

建议约定：

- **并行请求数量可控**：当未来需要对“每张图单独请求”时，建议引入并发上限（避免触发 429 或把浏览器打满）。
- **用 `Promise.allSettled` 聚合错误**：当“允许部分成功”时（例如批量生成缩略图），用 `allSettled` 返回每项结果与失败原因。

## 统一接口如何承载多步链路

上层只依赖 `AiService`：

- `editImage({ images, prompt, mask? })`
- `generateImageFromText({ prompt })`
- `generateVideo({ prompt, aspectRatio, image?, onProgress })`

Provider 内部可以是：

- 单次请求：例如 Gemini 图片编辑（一次 `generateContent`）
- 多步请求链：例如 NanoBanana（create → poll → download）
- 轮询操作：例如 Gemini 视频（generateVideos → getVideosOperation → download）

这种设计的价值是：**UI 不需要知道“到底调用了几个接口”**，只处理开始/结束/进度/错误。

## 错误处理与用户提示（建议做法）

- 服务层（`services/`）：
  - 抛错信息包含 provider 与上下文（当前 Gemini 已有 `Gemini API Error: ...` 形式；NanoBanana 也包含接口阶段）
  - 明确区分：网络失败、HTTP 失败、业务 code 失败、轮询超时、结果缺失
- UI 层（`App.tsx`）：
  - 针对配额/限流（如 429 或 `RESOURCE_EXHAUSTED`）转换为更友好的提示
  - 对长任务在 `finally` 中正确恢复 `isLoading`

## 可选增强（后续如果要做）

- **取消/中断**：为每条链路引入 `AbortController`，并在轮询 `sleep` 前检查 `signal.aborted`；UI 提供“取消生成”按钮。
- **重试与退避**：对幂等的 GET/查询类请求做有限重试；对 429/5xx 使用指数退避。
- **多 Provider 回退**：在 `services/ai/` 新增一个“聚合 service”，先调用主 Provider，失败（或不支持能力）后自动切到备选 Provider。

