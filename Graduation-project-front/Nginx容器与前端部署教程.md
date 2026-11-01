# Nginx 容器 + 前端容器 部署完整教程

> 适用场景：阿里云 ECS（2 核 2G，Ubuntu）、前端为 Next.js 16（standalone 输出）、Nginx 与前端**分别运行在两个 Docker 容器**、通过公网 IP 访问前端。
>
> 阅读对象：零基础。全文按顺序执行即可，每一步都写了"为什么"和"怎么验证"。

---

## 0. 先理解整体架构

最终部署结构如下：

```
        公网用户
           │  访问 http://服务器公网IP
           ▼
  ┌─────────────────────┐
  │  nginx 容器          │  ← 唯一对外暴露 80 端口
  │  监听 80，反向代理    │
  └──────────┬──────────┘
             │ 内网访问 http://frontend:3000
             ▼
  ┌─────────────────────┐
  │  frontend 容器       │  ← Next.js standalone（不对外暴露）
  │  监听 3000           │
  └─────────────────────┘
```

两个容器接在同一个 **自定义 Docker 网络** `coderag-net` 上，Nginx 就能用容器名 `frontend` 直接访问前端容器，无需暴露 3000 端口到公网。

**为什么要把 Nginx 和前端拆成两个容器？**

- 一个容器只跑一个进程，职责清晰、排错容易；
- Nginx 可以独立重启/改配置，不影响前端；
- 前端容器不需要对外暴露端口，更安全。

---

## 1. 第一步：服务器准备

### 1.1 登录服务器

在你本地 Windows 的 PowerShell 里执行（把 IP 换成你的）：

```powershell
ssh root@你的公网IP
```

如果没有密码登录，就按阿里云控制台给的密码；首次登录会提示修改密码。

> 也可以按你之前文档里的方式，用 FinalShell 等图形工具连接。

### 1.2 放行 80 端口（阿里云安全组）

控制台 → 实例 → 安全组 → 配置规则 → 入方向 → 添加：

| 协议 | 端口范围 | 授权对象  |
| ---- | -------- | --------- |
| TCP  | 80/80    | 0.0.0.0/0 |

> 如果以后要上 HTTPS，再放行 `443/443`。
> 80 不放行，后面浏览器会显示"无法访问此网站"，这一步最容易漏。



### 1.6 创建目录 + 自定义网络

```bash
# 存放镜像包、nginx 配置
mkdir -p /opt/coderag/images
mkdir -p /opt/coderag/nginx/conf.d

# 创建两个容器共享的网络
docker network create coderag-net
```

验证网络：

```bash
docker network ls
```

应能看到 `coderag-net`。

---

## 2. 第二步：本地编写 Dockerfile 和 .dockerignore

> 这一步在**你本地 Windows 的电脑上**操作，目录是项目根目录 `c:\no_space_demand\Graduation-project-front`。
>
> 前提：本地已安装 **Docker Desktop**（Windows 版），并已启动（任务栏有小鲸鱼图标且为运行状态）。

### 2.1 创建 `Dockerfile`

在项目根目录新建 `Dockerfile`，内容如下（内容已针对本项目 `next build` + `standalone` 定制）：

```dockerfile
# ---------- 1. 安装依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. 构建 ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 3. 运行 ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 关键：必须绑 0.0.0.0，否则容器外访问不到
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# standalone 产物（项目 build 脚本已把 static 和 public 复制进去）
COPY --from=builder /app/.next/standalone ./
# 再显式复制一次，防止 build 脚本变化导致缺失
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

**为什么用多阶段构建？**

- 第 1 阶段装依赖、第 2 阶段编译、第 3 阶段只带"运行需要的最小文件"，最终镜像小、启动快。
- 最终镜像里**不包含源码**，只包含编译产物。

**为什么必须 `HOSTNAME=0.0.0.0`？**

Next.js standalone 的 `server.js` 默认绑定 `localhost`。而 Docker 会给容器注入一个 `HOSTNAME` 环境变量（值为容器主机名），如果不覆盖，Nginx 从外部连过来会连不上。写成 `0.0.0.0` 表示监听所有网卡。

### 2.2 创建 `.dockerignore`

在项目根目录新建 `.dockerignore`（防止把无关文件塞进镜像，导致镜像变大、构建变慢）：

```
node_modules
.next
.git
.idea
.vscode
*.md
*.png
*.tar
db
download
tool-results
agent-ctx
```

> 说明：`node_modules` 会被排除，因为镜像构建时会在容器内用 `npm ci` 重新安装，不依赖本地依赖。

---

## 3. 第三步：本地构建前端镜像

在本地 PowerShell（**项目根目录**）执行：

```powershell
cd c:\no_space_demand\Graduation-project-front

# 构建镜像，打标签 coderag-frontend:v1
docker build --platform linux/amd64 -t coderag-frontend:v1 .
```

参数说明：

- `--platform linux/amd64`：确保构建出的镜像能在阿里云 x86 服务器上运行（Windows 上一般默认就是 amd64，写上更保险）。
- `-t coderag-frontend:v1`：给镜像起名字和版本号。
- `.`：表示用当前目录作为构建上下文。

构建过程可能需要 3~10 分钟（下载 node 镜像 + 安装依赖 + 编译 Next）。看到最后输出 `naming to ... coderag-frontend:v1` 即成功。

验证：

```powershell
docker images
```

应能看到 `coderag-frontend` 和 `v1` 标签。

> **为什么在本地构建，而不是在服务器上构建？**
> 你的服务器只有 2G 内存，`next build` 编译时很吃内存，容易 OOM 卡死。本地构建好镜像再上传，是最稳的方式。

---

## 4. 第四步：导出镜像并上传到服务器

### 4.1 导出为 tar 文件

```powershell
docker save coderag-frontend:v1 -o coderag-frontend-v1.tar
```

生成的 `coderag-frontend-v1.tar` 大约 150~300MB，在项目根目录下。

### 4.2 上传到服务器

```powershell
scp .\coderag-frontend-v1.tar root@你的公网IP:/opt/coderag/images/
```

> Windows 10/11 自带 `scp`，第一次连接会提示确认指纹，输入 `yes`，再输入服务器密码。

如果文件较大、网络慢，建议先在服务器装 `lrzsz` 或直接用 `rsync`。`scp` 对几百 MB 文件足够用。

### 4.3 在服务器上加载镜像

登录服务器后执行：

```bash
cd /opt/coderag/images
docker load -i coderag-frontend-v1.tar
```

验证：

```bash
docker images
```

能看到 `coderag-frontend:v1` 即成功。加载完可以删除 tar 省磁盘（40G 盘要省着用）：

```bash
rm -f /opt/coderag/images/coderag-frontend-v1.tar
```

---

## 5. 第五步：运行前端容器

在服务器上执行：

```bash
docker run -d \
  --name frontend \
  --network coderag-net \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  coderag-frontend:v1
```

参数说明：

| 参数                       | 作用                                                  |
| -------------------------- | ----------------------------------------------------- |
| `-d`                       | 后台运行                                              |
| `--name frontend`          | 容器名，Nginx 后面靠这个名字访问它                    |
| `--network coderag-net`    | 接入和 Nginx 同一个网络                               |
| `--restart unless-stopped` | 服务器重启后自动拉起                                  |
| `--log-opt ...`            | 限制日志大小，防止 40G 盘被日志写满                   |
| 没有 `-p`                  | **故意不映射端口**，前端只在内网被 Nginx 访问，更安全 |

验证：

```bash
docker ps
```

能看到 `frontend` 状态为 `Up`。

查看启动日志（如果容器起不来，看这里）：

```bash
docker logs -f frontend
```

应看到类似 `▲ Next.js 16 ... Ready in ...` / `Listening on 0.0.0.0:3000` 的输出。

> 如果日志里报错、容器反复重启，先执行 `docker logs frontend` 看具体报错，再对照第 9 节排查。

---

## 6. 第六步：部署 Nginx 容器并配置反向代理

### 6.1 在服务器上创建 Nginx 配置

```bash
cat > /opt/coderag/nginx/conf.d/default.conf <<'EOF'
server {
    listen 80;
    server_name _;

    charset utf-8;
    client_max_body_size 20m;

    # ---------- gzip 压缩 ----------
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               application/xml image/svg+xml;

    # ---------- Next.js 静态资源：长缓存 ----------
    # /_next/static 下的文件名带哈希，内容变化即换名，可放心长久缓存
    location /_next/static/ {
        proxy_pass http://frontend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # ---------- 其余所有请求转发给前端 ----------
    location / {
        proxy_pass http://frontend:3000;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 兼容 WebSocket / 长连接
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 流式响应（后续接后端 SSE 时需要）
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
```

**逐行解释几个关键点：**

| 配置                              | 作用                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `listen 80`                       | 监听 80 端口                                                    |
| `server_name _`                   | 匹配任意域名/直接 IP 访问                                       |
| `proxy_pass http://frontend:3000` | 转发到名为 `frontend` 的容器（Docker 网络内可直接用容器名解析） |
| `proxy_set_header Host $host`     | 把用户访问的域名传给前端，Next 生成正确的绝对链接               |
| `X-Forwarded-For` / `X-Real-IP`   | 让后端/前端能拿到真实客户端 IP                                  |
| `proxy_buffering off`             | 关闭缓冲，聊天流式输出（SSE）才能逐字显示                       |
| `/_next/static/` 单独处理         | 静态资源加长缓存，加速二次访问                                  |

> 如果以后要接后端（FastAPI 等），在这一段里再加一个 location（见附录 B）。

### 6.2 拉取并运行 Nginx 容器

```bash
docker run -d \
  --name nginx \
  --network coderag-net \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  -p 80:80 \
  -v /opt/coderag/nginx/conf.d/default.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

| 参数           | 作用                                                               |
| -------------- | ------------------------------------------------------------------ |
| `-p 80:80`     | 把容器 80 端口映射到服务器 80 端口（唯一对外暴露的端口）           |
| `-v ...:ro`    | 挂载配置文件，`ro` 表示容器内只读，改配置只需改宿主机文件再 reload |
| `nginx:alpine` | 官方轻量 Nginx 镜像（约 20MB）                                     |

> `nginx:alpine` 官方镜像默认就包含 `/etc/nginx/conf.d/default.conf`，我们把它挂载覆盖成自己的配置。

### 6.3 校验配置并重载

用 `nginx -t` 检查配置语法：

```bash
docker exec nginx nginx -t
```

输出 `syntax is ok` / `test is successful` 才说明配置没问题。

然后重载使配置生效（第一次启动其实已经生效，改配置后才需要 reload）：

```bash
docker exec nginx nginx -s reload
```

---

## 7. 第七步：验证外网访问

### 7.1 服务器本机测试

```bash
curl -I http://localhost
```

期望返回：

```
HTTP/1.1 200 OK
Server: nginx/...
Content-Type: text/html; charset=utf-8
```

如果是 `502 Bad Gateway`，说明 Nginx 通了但连不上前端（看第 9 节）。

### 7.2 公网访问

浏览器打开：

```
http://你的公网IP
```

能看到 CodeRAG 前端页面即部署成功。

### 7.3 确认容器状态

```bash
docker ps
```

应有 `frontend` 和 `nginx` 两个容器都在 `Up` 状态，且 `nginx` 显示 `0.0.0.0:80->80/tcp`。

---

## 8. 第八步：日常更新发布流程

以后你改了前端代码，重新发布按这个流程：

**本地（Windows）：**

```powershell
cd c:\no_space_demand\Graduation-project-front

# 1. 重新构建，版本号递增（v2、v3...）
docker build --platform linux/amd64 -t coderag-frontend:v2 .

# 2. 导出
docker save coderag-frontend:v2 -o coderag-frontend-v2.tar

# 3. 上传
scp .\coderag-frontend-v2.tar root@你的公网IP:/opt/coderag/images/
```

**服务器：**

```bash
cd /opt/coderag/images

# 1. 加载新镜像
docker load -i coderag-frontend-v2.tar

# 2. 删除旧前端容器（Nginx 不用动）
docker rm -f frontend

# 3. 用新镜像重新创建前端容器
docker run -d \
  --name frontend \
  --network coderag-net \
  --restart unless-stopped \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  coderag-frontend:v2

# 4. 清理旧镜像和无用文件（可选，省磁盘）
docker image prune -f
rm -f /opt/coderag/images/coderag-frontend-v2.tar
```

> Nginx 是配置文件挂载的，改 Nginx 配置只要改宿主机文件后执行 `docker exec nginx nginx -s reload`，**不需要重建容器**。

---

## 9. 第九步：常见问题排查

| 现象                                                  | 原因                              | 解决                                                                                                              |
| ----------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 浏览器"无法访问此网站 / 连接被拒绝"                   | 阿里云安全组没放行 80             | 安全组入方向添加 `TCP 80`，授权 `0.0.0.0/0`                                                                       |
| `502 Bad Gateway`                                     | Nginx 正常，但连不上 frontend     | 1) `docker ps` 确认 frontend 在运行；2) `docker logs frontend` 看前端是否报错；3) 确认两者都在 `coderag-net` 网络 |
| Nginx 起不来，`host not found in upstream "frontend"` | frontend 容器不存在或不在同一网络 | 先启动 frontend，再启动 nginx；检查 `--network coderag-net` 是否都加了                                            |
| 前端容器反复重启                                      | Next 启动失败（缺文件/端口占用）  | `docker logs frontend` 看具体报错                                                                                 |
| 页面能开但白屏/资源 404                               | standalone 产物缺 static          | 检查 Dockerfile 里 `COPY .next/static` 和 `public` 是否存在                                                       |
| 修改配置后不生效                                      | 没 reload                         | `docker exec nginx nginx -s reload`                                                                               |
| 服务器重启后访问不了                                  | 容器没设自启                      | 运行时加 `--restart unless-stopped`                                                                               |
| 磁盘满了                                              | 镜像/日志堆积                     | `docker system df` 查看；`docker image prune -a`；检查日志限制                                                    |
| `docker build` 卡在 npm ci                            | 网络问题                          | 本地开代理或配 Docker 镜像源；保证本地能访问 npm                                                                  |

**查看日志的标准姿势：**

```bash
docker logs --tail 100 frontend     # 前端最近 100 行
docker logs --tail 100 nginx        # Nginx 最近 100 行
docker exec nginx nginx -t          # 检查 nginx 配置
docker network inspect coderag-net  # 看网络里有哪些容器
```

---

## 10. 附录 A：用 docker-compose 简化管理（可选）

上面的 `docker run` 命令很长，用 compose 可以把两个容器声明在一个文件里，一条命令起停。适合你后期维护。

在服务器 `/opt/coderag/` 下创建 `docker-compose.yml`：

```yaml
services:
  frontend:
    image: coderag-frontend:v2
    container_name: frontend
    restart: unless-stopped
    networks:
      - coderag-net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  nginx:
    image: nginx:alpine
    container_name: nginx
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/conf.d/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - frontend
    networks:
      - coderag-net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

networks:
  coderag-net:
    external: true
```

使用方式：

```bash
cd /opt/coderag
docker compose up -d      # 启动
docker compose ps         # 查看状态
docker compose restart nginx
docker compose down       # 停止（不加 -v，不影响数据）
```

> 注意 compose 里的 `image` 要和 `docker load` 进来的标签一致。

---

## 11. 附录 B：后续对接后端（预留在 Nginx 里）

等你后端（FastAPI + 向量库）也部署到服务器后，在 `default.conf` 里 `location / { ... }` **之前**加这一段：

```nginx
# ---------- 后端 API 转发 ----------
location /api/ {
    proxy_pass http://backend:8000;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 聊天流式输出（SSE）必须关闭缓冲
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

然后：

1. 后端容器名必须是 `backend`，并加入 `coderag-net` 网络；
2. `docker exec nginx nginx -s reload` 生效。

> 注意：Nginx 的 `location /api/` 优先级高于 `location /`，所以 `/api/*` 会先被这条规则匹配，不会落到前端。这也意味着前端 Next.js 里原有的 `/api/chat`、`/api/retrieve` 路由会被 Nginx 抢先转发到后端，正好符合"前端不再当假后端"的目标。

---

## 12. 附录 C：升级到 HTTPS（可选）

有了域名后，最简单是用 `certbot` 的 Nginx 方式，或直接用 Caddy 替换 Nginx。这里给 certbot 路线：

```bash
apt install -y certbot python3-certbot-nginx

# 先在宿主机安装 nginx（仅用于 certbot 自动配置），或手动申请证书
certbot --nginx -d coderag.你的域名.com
```

> 但你的 Nginx 在容器里，certbot 自动改配置不生效。更省事的做法是：
>
> 1. 用 certbot 单独容器申请证书，或手动获取证书；
> 2. 把证书挂载到 Nginx 容器；
> 3. 在配置里加 `listen 443 ssl;` 和证书路径、并做 80 → 443 跳转。
>
> 如果觉得麻烦，可以直接把 Nginx 容器换成 **Caddy 容器**，在 Caddyfile 里写域名就自动 HTTPS，零证书管理。

---

## 13. 完整命令速查（服务器端）

```bash
# 一次性执行：网络 + 运行前端 + 运行 Nginx
docker network create coderag-net 2>/dev/null || true

docker run -d --name frontend --network coderag-net --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 coderag-frontend:v1

docker run -d --name nginx --network coderag-net --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p 80:80 \
  -v /opt/coderag/nginx/conf.d/default.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine

# 验证
docker ps
curl -I http://localhost
docker exec nginx nginx -t
```

---

## 14. 检查清单（部署完对照一遍）

- [ ] 阿里云安全组已放行 TCP 80
- [ ] 服务器已安装 Docker，`docker -v` 有输出
- [ ] 已创建 `coderag-net` 网络
- [ ] 本地 `Dockerfile`、`.dockerignore` 已创建
- [ ] 本地 `docker build` 成功，`docker images` 能看到 `coderag-frontend:v1`
- [ ] 镜像已 `docker save` → `scp` → `docker load` 到服务器
- [ ] `frontend` 容器运行中，日志显示 `0.0.0.0:3000`
- [ ] `nginx` 容器运行中，`docker ps` 显示 `80->80`
- [ ] `/opt/coderag/nginx/conf.d/default.conf` 已创建且 `nginx -t` 通过
- [ ] `curl -I http://localhost` 返回 200
- [ ] 浏览器 http://公网IP 能打开页面
- [ ] 两个容器都加了 `--restart unless-stopped`
