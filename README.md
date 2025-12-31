<div align="center">

<img width="1820" height="1024" alt="Group 343" src="https://github.com/user-attachments/assets/782dda02-7851-4619-8040-2575ac040799" />


# BananaPod ｜ 香蕉铺子 ｜ ZHO

</div>

<img width="1650" height="1777" alt="Group 345" src="https://github.com/user-attachments/assets/b78176f1-8c1e-4154-b330-7d0c16559bfb" />

## 🆕 全新 UI 、iPad/Apple Pencil 手绘支持、视频模式 和 新功能上线！



### 1）高级质感 UI + 新功能

<img width="1955" height="2029" alt="Group 378" src="https://github.com/user-attachments/assets/9d46f99a-3ecb-4b59-a611-03742257b0eb" />

  ✅局部重绘
  
  ✅提示词储存/复用系统
  
  ✅UI 支持高度定制化
  
  ✅中英双界面
  
  ✅多画板系统
  
  ✅图层系统
  
  ✅图片编辑系统
  
  ✅图片圆角

  
### 2）视频生成模式

https://github.com/user-attachments/assets/ab3742a4-52be-491d-86b3-78607db10d1e


### 3）iPad/Apple Pencil 手绘支持

<img width="3427" height="2294" alt="Group 407" src="https://github.com/user-attachments/assets/6af0b69c-ac6c-4664-adbe-3cff6de04799" />

<img width="2702" height="1814" alt="Group 405" src="https://github.com/user-attachments/assets/1fc2c57f-aa95-4364-8974-f6eb3bbb8a19" />


https://github.com/user-attachments/assets/980c2774-62ca-4730-984f-72531b595d5e



  




## 免提示词，内置玩法轻松选，一键构建创意画板

我的 Nano Banan 创意玩法大全：[Nano-Banana Creation ZHO](https://github.com/ZHO-ZHO-ZHO/ZHO-nano-banana-Creation)


### 功能主要包含两部分：

1）生成/编辑部分：支持多图框选 + 选择玩法直接生成/编辑

2）绘制部分，方便标注和手绘图作为输入



https://github.com/user-attachments/assets/83c96432-4246-4c1c-9087-6d0669acdaed




与 [香蕉超市｜Nano Bananary](https://github.com/ZHO-ZHO-ZHO/Nano-Bananary) 区别：

**1️⃣ 香蕉铺子｜BananaPod**

创作白板/画布

适合创意专业用户

方便多维度生成 构建灵感+创意体系


**2️⃣ 香蕉超市｜Nano Bananary**

窗口式玩法大全

适合所有用户

方便效果直出+连续编辑


# 在线体验

本项目支持在 Google AI Studio 在线体验：

https://ai.studio/apps/drive/1CsvkMqNnxdUrmJZYeSXNZDf6T1Yq2qQW

## 本地启动

**前置条件：** Node.js 18+（推荐使用 npm）

### 方式 A：开发模式（推荐）

前端使用 Vite（默认 `http://localhost:3000`），后端提供 API（默认 `http://localhost:8787`）。`./vite.config.ts` 已配置把 `/api` 代理到后端。

1. 安装依赖：
   `npm install`
2. 启动后端（需要设置管理员密码，用于登录/会话签名）：
   - macOS/Linux：
     `BANANAPOD_ADMIN_PASSWORD="your_password" npm run server`
   - Windows PowerShell：
     `$env:BANANAPOD_ADMIN_PASSWORD="your_password"; npm run server`
3. 另开一个终端启动前端：
   `npm run dev`
4. 打开 `http://localhost:3000`，登录后在「设置 / Gemini」里添加平台（`baseUrl`/`model`/`apiKey`）。
   - 配置会写入 `./.bananapod.config.json`（已在 `.gitignore` 中忽略，请勿提交到仓库）。

### 方式 B：生产模式（后端托管前端静态文件）

后端默认从 `./dist` 提供静态文件（`BANANAPOD_STATIC_DIR` 可覆盖）。

1. 构建前端：
   `npm run build`
2. 启动服务（同样需要先设置 `BANANAPOD_ADMIN_PASSWORD`）：
   `npm run start`
3. 打开 `http://localhost:8787`

### 常用环境变量

- `BANANAPOD_PORT` / `PORT`：后端端口（默认 `8787`）。若修改端口，需要同步调整 `./vite.config.ts` 的代理目标。
- `BANANAPOD_REQUIRE_AUTH_FOR_AI=0`：关闭 AI 接口登录校验（默认开启）。
- `BANANAPOD_STATIC_DIR`：静态文件目录（默认 `./dist`）。
- `BANANAPOD_CONFIG_PATH`：配置文件路径（默认 `./.bananapod.config.json`）。
- `BANANAPOD_LOG_FILE`：日志文件（默认 `./logs/bananapod.log`）。



## 更新日志

- 20250925

  全新 UI 、iPad/Apple Pencil 手绘支持、视频模式 和 新功能上线

  ✅局部重绘
  
  ✅提示词储存/复用系统
  
  ✅UI 支持高度定制化
  
  ✅中英双界面
  
  ✅多画板系统
  
  ✅图层系统
  
  ✅图片编辑系统
  
  ✅图片圆角

- 20250908
  
  创建项目 + 基础功能一步到位 + 内置玩法大全
  

## Stars 

[![Star History Chart](https://api.star-history.com/svg?repos=ZHO-ZHO-ZHO/BananaPod&type=Date)](https://star-history.com/#ZHO-ZHO-ZHO/BananaPod&Date)


## 关于我 | About me

📬 **联系我**：
- 邮箱：zhozho3965@gmail.com
  

🔗 **社交媒体**：
- 个人页：[-Zho-](https://jike.city/zho)
- Bilibili：[我的B站主页](https://space.bilibili.com/484366804)
- X（Twitter）：[我的Twitter](https://twitter.com/ZHO_ZHO_ZHO)
- 小红书：[我的小红书主页](https://www.xiaohongshu.com/user/profile/63f11530000000001001e0c8?xhsshare=CopyLink&appuid=63f11530000000001001e0c8&apptime=1690528872)

💡 **支持我**：
- B站：[B站充电](https://space.bilibili.com/484366804)
- 爱发电：[为我充电](https://afdian.com/a/ZHOZHO)


## Credits

[Gemini 2.5 Flash Image](https://gemini.google.com/app)
