# 员工产量上报系统（Web 演示）

前后端一体的产量上报演示系统。

- **后端**：Node.js + Express + SQLite（`sqlite3`），REST API
- **员工端**：`server/public/index.html` — 产量上报、实时工价小计、自动填充
- **管理端**：`server/public/admin.html` — 报表统计、员工/制单管理、CSV 导出
- **数据**：统一存于服务器 SQLite 数据库（`server/db/production.db`），员工端与管理端共享

## 本地运行

```bash
npm install
npm start
```

访问：
- 员工端：http://localhost:3000/
- 管理端：http://localhost:3000/admin.html
- API：http://localhost:3000/api

> 首次启动会自动初始化数据库；如需手动重建，执行 `npm run init-db`。

## 功能

- 工号带出员工信息（种子工号 1001~1004）
- 制单/工序联动，自动带出单价与剩余产量
- 实时工价小计
- 提交后扣减剩余产量，数据写入服务器数据库
- 下次提交自动填充上次明细
- 管理端：报表列表（筛选/分页）、统计汇总、员工/制单管理、CSV 导出
- 一键重置演示数据

## 种子数据

- 员工：1001~1004
- 制单：MO-20260801 / 02 / 03

## 部署

见 [DEPLOY.md](DEPLOY.md)，支持 Render 一键部署 / Docker。
