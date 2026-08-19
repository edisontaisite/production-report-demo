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
   - **Plan**: `Free`（每月 750 小时免费）
   - **Build Command**: 自动检测（无需填写）
   - **Start Command**: 自动检测（无需填写）

4. **环境变量**（自动配置，无需手动设置）  
   - `PORT`: Render 自动注入
   - `NODE_ENV`: production

5. **健康检查**  
   - Health Check Path: `/api/health`

6. **部署**  
   点击 "Create Web Service"，等待 3-5 分钟自动构建和部署

### 方式二：通过 render.yaml 自动部署

1. 项目根目录已包含 `render.yaml` 配置文件
2. 在 Render Dashboard 中选择 "Blueprint" 方式创建
3. 选择仓库后自动读取配置并部署

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

## ⚠️ 免费版注意事项

1. **休眠机制**：15 分钟无活动后自动休眠，下次访问需要 30-60 秒唤醒
2. **每月限制**：750 小时免费运行时间（够一个月持续运行）
3. **数据持久化**：SQLite 数据库会在服务重启后重置，升级付费版本可挂载持久存储

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
