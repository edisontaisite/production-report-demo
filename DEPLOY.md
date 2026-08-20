# 部署指南

## 🚀 Render 一键部署（推荐）

### 方式一：通过 Dashboard 部署

1. **访问 Render**  
   前往 [render.com](https://render.com) 并登录

2. **创建新服务**  
   - 点击 "New +" → "Web Service"
   - 连接 GitHub 仓库：`edisontaisite/production-report-demo`
   - 或直接使用公开仓库 URL

3. **配置服务**  
   - **Name**: `production-report-demo`
   - **Environment**: `Docker`
   - **Plan**: `Starter`（付费）
   - **Build Command**: 自动检测（无需填写）
   - **Start Command**: 自动检测（无需填写）

   > ⚠️ **不要选 Free 套餐。** Free 不支持挂载持久化磁盘，SQLite 数据库文件
   > 会随容器重建而丢失 —— 每次重新部署，全部工资数据清零。

4. **挂载持久化磁盘**（必须，否则数据不保留）  
   - Disks → Add Disk
   - **Name**: `data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB

5. **环境变量**  
   - `PORT`: Render 自动注入
   - `NODE_ENV`: `production`
   - `DB_PATH`: `/data/production.db` ← 指向持久盘，必须设置
   - `ADMIN_PASSWORD`: 自己设一个管理后台口令。留空的话服务每次启动会随机
     生成一个并打印到日志，重启后失效

6. **健康检查**  
   - Health Check Path: `/api/health`

7. **部署**  
   点击 "Create Web Service"，等待 3-5 分钟自动构建和部署

### 方式二：通过 render.yaml 自动部署

1. 项目根目录已包含 `render.yaml` 配置文件（已含 Starter 套餐、1GB 持久盘、`DB_PATH`）
2. 在 Render Dashboard 中选择 "Blueprint" 方式创建
3. 选择仓库后自动读取配置并部署
4. 部署后到 Environment 里填上 `ADMIN_PASSWORD`（`render.yaml` 里标了 `sync: false`，不会写进代码库）

> **推荐用这种方式**，套餐和磁盘都由 `render.yaml` 定义好，不会漏配。

---

## 📱 部署后访问

部署成功后，Render 会提供一个地址，格式如：
```
https://production-report-demo.onrender.com
```

- **员工端**: `https://your-app.onrender.com/`
- **管理端**: `https://your-app.onrender.com/admin.html`
- **API**: `https://your-app.onrender.com/api`

---

## ⚠️ 数据与运维

1. **数据库**：SQLite，整个库就是一个文件，位于持久盘上的 `/data/production.db`。
   只要磁盘挂对了，重启和重新部署都不会丢数据。
2. **不要用 Free 套餐**：Free 不能挂持久盘，数据库文件随容器重建而消失，
   每次发版工资数据清零。
3. **自动备份**：服务启动后先备一份，之后每 24 小时一份，存放在 `/data/backups/`，
   自动保留最近 14 份。管理后台「数据备份」页可以查看、手动生成和下载。
4. **异地备份要人工做**：上面的备份和数据库在同一块盘上，只能防误操作和逻辑错误，
   **挡不住整块磁盘丢失**。建议定期从后台把备份文件下载到本地或公司网盘。
5. **休眠**：Starter 套餐不休眠。（Free 套餐 15 分钟无活动会休眠，唤醒需 30-60 秒，
   代码里放宽的请求超时就是为此保留的。）

---

## 🔄 更新部署

推送代码到 GitHub main 分支后，Render 会自动触发重新部署：

```bash
git add .
git commit -m "更新功能"
git push origin main
```

---

## 🐳 其他部署方式

### Docker 本地运行

```bash
docker build -t production-report .
docker run -p 3000:3000 production-report
```

访问: http://localhost:3000

### VPS 部署

```bash
# 1. 克隆仓库
git clone https://github.com/edisontaisite/production-report-demo.git
cd production-report-demo

# 2. 安装依赖
npm install --production

# 3. 启动服务
npm start

# 4. 使用 PM2 保持运行（可选）
npm install -g pm2
pm2 start server/index.js --name production-report
pm2 save
pm2 startup
```

---

## 🧪 本地测试

```bash
npm install
npm start
```

访问:
- 员工端: http://localhost:3000
- 管理端: http://localhost:3000/admin.html

---

## 📊 健康检查

```bash
curl https://your-app.onrender.com/api/health
```

预期返回:
```json
{"status":"ok","time":"2026-08-19T05:29:24.283Z"}
```
