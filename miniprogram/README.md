# 微信小程序版（员工端）

员工产量上报的微信小程序版本，对接与网页版相同的后端 API（数据互通）。

## 目录结构

```
miniprogram/
├── project.config.json    # 开发者工具配置（AppID 占位）
├── app.json / app.js / app.wxss
├── sitemap.json
├── utils/
│   ├── api.js             # wx.request 封装（BASE_URL 在此修改）
│   └── util.js
└── pages/
    ├── report/            # 产量上报页
    └── history/           # 我的上报（历史记录）
```

## 功能

- 工号带出员工信息（姓名/工厂/组别，自动记忆工号）
- 订单 / 工序联动，自动带出单价与剩余产量
- 实时工价小计
- 提交扣减剩余产量，数据写入服务器
- 提交后自动填充上次明细
- 「我的上报」查看最近 20 条记录
- 「后台管理」标签页：内嵌网页管理后台（web-view），与网页版同一份数据

## 数据同步

小程序与网页版共用同一后端 API 与数据库：
- 网页后台添加的员工/订单/工序 → 小程序重新进入上报页自动加载
- 小程序提交的上报 → 网页后台报表实时可见

## 后台入口（web-view）限制

- **仅企业主体小程序支持 web-view 组件**（个人主体不支持，展示时可先使用开发者工具预览，正式发布需企业主体）
- 上线前需在微信公众平台配置 **业务域名**：
  1. 公众平台 → 开发管理 → 开发设置 → 业务域名
  2. 添加 `https://production-report-demo-jswx.onrender.com`
  3. 下载微信生成的**校验文件**，把文件名和内容提供给开发者放入后端 `server/public/` 目录并重新部署

## 运行步骤

1. **安装微信开发者工具**（[下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)）
2. **导入项目**：开发者工具 → 导入项目 → 选择本 `miniprogram/` 目录
3. **AppID**：`project.config.json` 里是占位值 `touristappid`（游客模式）
   - 正式开发请替换为你自己的小程序 AppID（微信公众平台 → 开发管理）
4. **后端地址**：`utils/api.js` 中 `BASE_URL` 已指向 Render 公网服务
   - 本地调试可改为 `http://127.0.0.1:3000`
5. **开发阶段**：开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」
   - 真机预览同样需要在「本地设置」勾选，或使用预览二维码时选择「不校验」

## 上线配置

正式发布前需要在 **微信公众平台 → 开发管理 → 开发设置 → 服务器域名** 配置：

- **request 合法域名**：`https://production-report-demo-jswx.onrender.com`

> ⚠️ 注意：
> - Render 免费版实例 15 分钟无访问会休眠，首次请求需 30-60 秒唤醒，可能影响体验（可升级付费版或换成国内服务器）
> - 企业内部使用建议使用企业主体小程序；个人主体小程序类目有限制

## 后端 API 一览（已实现，无需改动）

| 接口 | 说明 |
|------|------|
| `GET /api/employees/:id` | 工号查员工 |
| `GET /api/orders` | 订单列表 |
| `GET /api/orders/:orderNo/processes` | 订单工序列表 |
| `POST /api/reports` | 提交上报 |
| `GET /api/reports/history/:empId` | 上报历史 |
