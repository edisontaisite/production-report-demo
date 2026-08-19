# 使用 trixie（Debian 13，glibc 2.41）而非 bullseye（glibc 2.31）：
# sqlite3 的二进制需要 GLIBC_2.38，bullseye 无法满足会导致部署失败。
FROM node:22-trixie

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm install --production

# 复制所有服务器代码和数据库文件
COPY server ./server

# 确保默认数据库目录存在
RUN mkdir -p /app/server/db

# 数据持久化目录（可通过 volume / 挂载磁盘存放 SQLite，避免重启丢失）
RUN mkdir -p /data

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/production.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
