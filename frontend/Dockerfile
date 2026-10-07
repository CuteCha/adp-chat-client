# 构建阶段
# 镜像标签有意对齐本机已下载的 node:22-bullseye-slim，避免重新拉取
FROM node:22-bullseye-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# 运行阶段：纯静态 + nginx 反代后端（nginx:alpine 为本机已存在的标签）
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
