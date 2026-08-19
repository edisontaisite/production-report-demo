FROM node:22-bullseye

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm install --production

# 复制所有服务器代码和数据库文件
COPY server ./server

# 确保数据库目录存在
RUN mkdir -p /app/server/db

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
