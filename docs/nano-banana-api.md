# Nano Banana API（BananaPod 使用说明）

> 说明：该文档为历史保留。当前主程序已收敛为仅支持 Gemini 格式服务；NanoBanana 不再作为默认/可选 Provider。

BananaPod 当前以 Nano Banana 接口参数为标准（`prompt / urls / aspectRatio / imageSize` 等），并通过轮询 `/v1/draw/result` 获取生成结果。

## Base URL

- Host（海外）：`https://api.grsai.com`
- Host（国内直连）：`https://grsai.dakka.com.cn`

示例（Host + Path）：

- `https://grsai.dakka.com.cn/v1/draw/nano-banana`

## 鉴权

请求头示例：

```json
{
  "Content-Type": "application/json",
  "Authorization": "Bearer apikey"
}
```

## 1) 创建任务：Nano Banana 绘画接口

- Method：`POST`
- Path：`/v1/draw/nano-banana`

### Request Body（JSON）

| 字段 | 类型 | 必填 | 示例 | 说明 |
|---|---|---:|---|---|
| `model` | `string` | 是 | `"nano-banana-pro"` | 模型名 |
| `prompt` | `string` | 是 | `"提示词"` | 提示词 |
| `urls` | `string[]` | 否 | `["https://example.com/a.png"]` | 参考图 URL 或 Base64（多个表示多参考图） |
| `aspectRatio` | `string` | 否 | `"auto"` | 输出图像比例（见下方列表） |
| `imageSize` | `string` | 否 | `"1K"` | 输出图像大小（见下方列表） |
| `num` | `number` | 否 | `4` | 出图张数（`1~4`）；BananaPod 的“出图张数”会传这个字段 |
| `webHook` | `string` | 否 | `"-1"` | 回调地址；填 `"-1"` 表示不使用回调，立即返回 `id`（用于轮询） |
| `shutProgress` | `boolean` | 否 | `false` | 是否关闭进度回复（建议配合 `webHook` 使用） |

#### `aspectRatio` 支持值

- `auto`（默认）
- `1:1`
- `16:9`
- `9:16`
- `4:3`
- `3:4`
- `3:2`
- `2:3`
- `5:4`
- `4:5`
- `21:9`

#### `imageSize` 支持值

- `1K`（默认）
- `2K`
- `4K`

注意：分辨率越高，生成时间越长。

### Request 示例

```json
{
  "model": "nano-banana-pro",
  "prompt": "提示词",
  "aspectRatio": "auto",
  "imageSize": "1K",
  "num": 4,
  "urls": [
    "https://example.com/example.png"
  ],
  "webHook": "-1",
  "shutProgress": false
}
```

### Response 示例（返回任务 id）

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "id": "id"
  }
}
```

## 2) 获取结果：轮询接口

- Method：`POST`
- Path：`/v1/draw/result`

### Request 示例

```json
{
  "id": "xxxxx"
}
```

### Response 示例（成功）

```json
{
  "id": "xxxxx",
  "results": [
    {
      "url": "https://example.com/example.png",
      "content": "这是一只可爱的猫咪在草地上玩耍"
    }
  ],
  "progress": 100,
  "status": "succeeded",
  "failure_reason": "",
  "error": ""
}
```

说明：

- `results`：结果数组，可能包含多张图片（BananaPod 会按 `results[].url` 依次取图）
- `status`：常见值 `running / succeeded / failed`
- `progress`：`0~100`

## BananaPod 代码位置

- NanoBanana 请求实现：`services/nanoBananaService.ts`
- 轮询与取图：`services/nanoBananaService.ts`
- UI 参数（出图张数 / 比例 / 尺寸）：`components/PromptBar.tsx`

## 平台容灾（多平台代理商）

BananaPod 支持同一“模型厂商”配置多个平台代理商（不同 Base URL / API Key），当某个平台失败会立即切换到下一个平台重新发起请求（不支持跨平台继续轮询）。

### 必填环境变量（NanoBanana）

- `VITE_NANO_BANANA_BASE_URLS`：逗号/换行分隔的 Base URL 列表（按优先级顺序）
- `VITE_NANO_BANANA_API_KEYS`：逗号/换行分隔的 API Key 列表（按索引与 Base URL 配对；数量不一致时用第一个补齐）

示例：

```bash
VITE_NANO_BANANA_BASE_URLS=https://grsai.dakka.com.cn,https://api.grsai.com
VITE_NANO_BANANA_API_KEYS=sk-xxx,sk-yyy
```
