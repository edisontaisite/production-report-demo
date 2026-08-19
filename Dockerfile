FROM node:18

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm install --production

# 复制服务器代码
COPY server ./server

# 设置环境变量
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
