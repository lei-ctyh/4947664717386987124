# 平台容灾（多平台代理商）

目标：同一“模型厂商”配置多个平台代理商（不同 Base URL / API Key），当某个平台失败则立即切换到下一个平台，保证生图稳定性。

## 约定

- UI 只选择“模型厂商”（例如 Gemini / NanoBanana），不提供平台选择。
- 平台切换不做重试：某个平台调用失败（任何原因）就切换。
- 由于不同平台代理商之间**不能继续轮询同一个任务 id**，切换平台会从头重新发起整次请求。

## 环境变量

所有列表均支持 `,` 或换行分隔；顺序即优先级。

### NanoBanana

- `VITE_NANO_BANANA_BASE_URLS`
- `VITE_NANO_BANANA_API_KEYS`

### Gemini

- `VITE_GEMINI_BASE_URLS`
- `VITE_GEMINI_API_KEYS`

数量不一致时按索引配对，不足的一侧使用第一个值补齐。

