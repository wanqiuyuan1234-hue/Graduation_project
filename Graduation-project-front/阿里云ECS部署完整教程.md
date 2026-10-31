# 阿里云 ECS 部署完整教程（CodeRAG 项目）

> 面向**新手**的从零到上线全流程文档，按步骤操作即可。
>
> 服务器：阿里云 ECS 经济型 e 实例（共享型）
> 规格：`ecs.e-c1m1.large` —— **2 核 CPU / 2 GiB 内存 / 40 GiB ESSD Entry 系统盘**
> 操作系统：以下命令默认按 **Ubuntu 22.04 / 24.04 LTS** 编写（文末附 Alibaba Cloud Linux 命令对照）

---

## 目录

1. [服务器现状概览](#1-服务器现状概览)
2. [用什么软件连接并启动服务器](#2-用什么软件连接并启动服务器)
3. [服务器基础配置](#3-服务器基础配置)
4. [环境配置：安装 Docker](#4-环境配置安装-docker)
5. [项目环境：编写 Docker 文件](#5-项目环境编写-docker-文件)
6. [上传项目到服务器](#6-上传项目到服务器)
7. [是否需要 Docker？启动项目](#7-是否需要-docker启动项目)
8. [验证与常用命令](#8-验证与常用命令)
9. [常见问题排查](#9-常见问题排查)
10. [2G 低配内存优化建议](#10-2g-低配内存优化建议)
11. [附录：Alibaba Cloud Linux 命令对照](#11-附录alibaba-cloud-linux-命令对照)

---

## 1. 服务器现状概览

### 1.1 你的配置意味着什么

- **2 核 2G 内存**：属于低配。前端（Next.js）+ 后端（FastAPI + ChromaDB）+ PostgreSQL 三个服务一起跑，内存会比较吃紧，**必须开启 swap（虚拟内存）**，否则容易 OOM 被杀进程。
- **40G 系统盘**：够用，但 Docker 镜像 + 数据库 + 代码会占十几 G，注意定期清理无用镜像。

### 1.2 最终架构（文字版）

```
用户浏览器
    │
    ▼
Caddy 反向代理（对外 80/443 端口）
    ├── /api/*  ──────────► 后端 FastAPI（:8000，内嵌 ChromaDB）
    │                           │
    │                           └──► PostgreSQL（:5432）
    └── 其余路径 ──────────► 前端 Next.js（:3000，standalone 产物）
```

> 解释：用户只访问一个入口（Caddy），由 Caddy 根据路径把请求分发给前端或后端，这样浏览器请求就是"同源"，**不会产生跨域（CORS）问题**。这是新手最容易踩坑的地方，用反向代理一次解决。

### 1.3 端口规划

| 服务         | 容器内端口 | 是否对外暴露       | 说明             |
| ------------ | ---------- | ------------------ | ---------------- |
| Caddy        | 80 / 443   | **是**（唯一对外） | 接收所有用户请求 |
| 前端 Next.js | 3000       | 否                 | 只给 Caddy 访问  |
| 后端 FastAPI | 8000       | 否                 | 只给 Caddy 访问  |
| PostgreSQL   | 5432       | 否                 | 只给后端访问     |

---

## 2. 用什么软件连接并启动服务器

服务器是"远程的电脑"，你需要用 **SSH** 协议远程登录。

### 2.1 先拿到三样东西

在阿里云控制台 → 云服务器 ECS → 实例列表，找到：

1. **公网 IP**（形如 `47.xx.xx.xx`）
2. **用户名**：Ubuntu 默认是 `root`（或你创建实例时设置的用户名）
3. **密码 / 密钥**：创建实例时设置的登录密码，或下载的 `.pem` 密钥文件

### 2.2 方式一：Windows 自带 PowerShell（无需装软件，最推荐新手先用这个）

Windows 10/11 自带 `ssh` 命令。打开 PowerShell，输入：

```powershell
ssh root@你的公网IP
```

首次连接会提示 `Are you sure you want to continue connecting?`，输入 `yes` 回车，然后输入密码（**输入密码时屏幕不显示，是正常的**，输完直接回车）。

登录成功后你会看到类似 `root@xxx:~#` 的提示符，说明已经连上服务器了。

### 2.3 方式二：图形化 SSH 工具（更直观，推荐新手装一个）

| 工具           | 特点                                       | 收费                 |
| -------------- | ------------------------------------------ | -------------------- |
| **FinalShell** | 国产，自带文件拖拽上传、资源监控，新手友好 | 免费（部分功能收费） |
| **Tabby**      | 美观，跨平台，免费开源                     | 免费                 |
| **MobaXterm**  | 功能全，内置文件传输                       | 免费版够用           |
| **Termius**    | 跨设备同步，界面好                         | 免费版够用           |

> 建议：先用 PowerShell 练手学会命令行，再用 FinalShell 做日常管理（它能把本地文件直接拖到服务器）。

### 2.4 方式三：阿里云自带"远程连接"

控制台点实例右侧的"远程连接"，可以在浏览器里直接进服务器终端。**适合忘了密码、SSH 连不上时的应急手段**。

---

## 3. 服务器基础配置

登录服务器后（`root@xxx:~#`），按顺序执行下面命令。

### 3.1 放行安全组端口（很重要，漏了会连不上）

这一步在**阿里云网页控制台**操作，不在服务器命令行里：

1. 进入 ECS 实例 → **安全组** → 配置规则 → 入方向 → 手动添加
2. 放行以下端口：

| 端口 | 用途       | 授权对象                           |
| ---- | ---------- | ---------------------------------- |
| 22   | SSH 登录   | 0.0.0.0/0（或你的家庭 IP，更安全） |
| 80   | 网页 HTTP  | 0.0.0.0/0                          |
| 443  | 网页 HTTPS | 0.0.0.0/0                          |

> 注意：**3000 / 8000 / 5432 不要放行**，它们只在内网被 Caddy 转发，暴露出去有安全隐患。

### 3.3 开启 swap（2G 内存必做！）

你的内存只有 2G，跑三个服务会紧张，务必用 swap（把硬盘当备用内存用）救命：

```bash
# 创建 4G 的 swap 文件（4G 是建议值，等于内存的 2 倍）
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# 让重启后自动生效
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 验证是否生效
free -h
```

看到 `Swap` 一行有 `4.0Gi` 就是成功了。

---

## 4. 环境配置：安装 Docker

> 强烈建议用 Docker 部署，原因见第 7 节。这一步把 Docker 装好。

### 4.1 安装 Docker（Ubuntu 官方脚本，一条命令）

```bash
curl -fsSL https://get.docker.com | sh
```

### 4.2 安装 Docker Compose 插件

```bash
# 从国内镜像源下载（速度快）
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://mirrors.aliyun.com/docker-toolbox/linux/docker-compose -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

### 4.3 配置镜像加速（国内服务器强烈建议，否则拉镜像很慢）

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com"
  ]
}
EOF
systemctl restart docker
```

### 4.4 启动 Docker 服务并设为开机自启

```bash
systemctl enable docker
systemctl start docker
```

### 4.5 验证安装

```bash
docker --version
docker compose version
```

两行都能打印出版本号，说明装好了。

---

## 5. 项目环境：编写 Docker 文件

> 你要写的 Docker 文件都在**本地项目**里，写好后再一并上传（见第 6 节）。

### 5.1 推荐的项目目录结构

```
Graduation-project/              # 项目总目录（前端 + 后端放一起）
├── docker-compose.yml           # 编排文件（核心）
├── Caddyfile                    # 反向代理配置
├── .env                         # 环境变量（密码、连接串等）
├── frontend/                    # —— 你现在的 Next.js 项目 ——
│   ├── Dockerfile
│   ├── .dockerignore
│   └── ...（src、package.json 等）
└── backend/                     # —— 你的 FastAPI 后端 ——
    ├── Dockerfile
    ├── requirements.txt
    └── ...（你的后端代码）
```

### 5.2 前端 Dockerfile（`frontend/Dockerfile`）

你的前端 `build` 脚本已经会把 static 和 public 复制进 standalone 产物，所以容器里只需跑 `node server.js`：

```dockerfile
# ---- 阶段1：安装依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 阶段2：构建 ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 阶段3：运行（只用 standalone 产物，体积最小）----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]
```

### 5.3 前端 `.dockerignore`（`frontend/.dockerignore`）

不写这个会把 node_modules、.next 等几个 G 塞进镜像：

```
node_modules
.next
db
download
tool-results
.screenshots
tests
*.png
*.md
```

### 5.4 后端 Dockerfile（`backend/Dockerfile`）

后端是 Python + FastAPI + ChromaDB（内嵌）+ tree-sitter：

```dockerfile
FROM python:3.10-slim

# tree-sitter 编译需要 gcc，先装上（装完可删，但为省事保留）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单，利用 Docker 缓存层，改代码不用重装依赖
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制后端代码
COPY . .

EXPOSE 8000

# 用 uvicorn 启动 FastAPI（生产模式，不要用 --reload）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

> 注意：`app.main:app` 要换成你后端实际的入口模块路径（比如你的 FastAPI 实例在 `backend/main.py` 里，就是 `main:app`）。

### 5.5 后端 `requirements.txt`（`backend/requirements.txt`）

```txt
fastapi
uvicorn[standard]
chromadb
tree-sitter
tree-sitter-python
psycopg2-binary
python-dotenv
pydantic
pydantic-settings
```

> 如果你的代码切片支持多种语言，再补对应 grammar：`tree-sitter-javascript`、`tree-sitter-typescript` 等。

### 5.6 docker-compose.yml（核心编排文件）

放在项目根目录：

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: coderag
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # 从 .env 读取
      POSTGRES_DB: coderag
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U coderag -d coderag"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://coderag:${POSTGRES_PASSWORD}@db:5432/coderag
      # ChromaDB 用内嵌模式（省内存，不额外起服务），数据存 /data/chroma
      CHROMA_PERSIST_DIR: /data/chroma
    volumes:
      - chroma:/data
    depends_on:
      db:
        condition: service_healthy
    # 2G 内存下限制后端内存，防止 OOM 拖垮整台机器
    mem_limit: 1g

  frontend:
    build: ./frontend
    environment:
      NODE_ENV: production
    depends_on:
      - backend

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
      - backend

volumes:
  pgdata:
  chroma:
  caddy_data:
  caddy_config:
```

> 关键点：容器之间用**服务名**通信（`db`、`backend`、`frontend`、`caddy`），**不要写 `localhost`**——容器网络里 localhost 指容器自己。

### 5.7 Caddyfile（反向代理配置）

放项目根目录（覆盖你项目里原来的那份）：

```
:80 {
    encode gzip

    # /api 开头 → 转发给后端
    handle /api/* {
        reverse_proxy backend:8000
    }

    # 其余路径 → 转发给前端
    handle {
        reverse_proxy frontend:3000
    }
}
```

> 后面能访问 HTTPS（443）时，把 `:80` 改成你的域名，Caddy 会自动申请免费 SSL 证书。

### 5.8 环境变量文件（`.env`）

放在项目根目录，**务必加入 `.gitignore`，不要提交到 git**：

```bash
POSTGRES_PASSWORD=换成你的强密码
```

> 这个 `POSTGRES_PASSWORD` 在 compose 里被 `${POSTGRES_PASSWORD}` 引用，实现密码只写一处。

---

## 6. 上传项目到服务器

> 先明确：**上传的是"源码"，不是"打包好的镜像"**。镜像是在服务器上由 Docker 现场构建的。

### 6.1 方式一：git（推荐，方便后续更新）

前提：你的项目已经用 git 托管（GitHub / Gitee / 阿里云 Code）。

```bash
# 在服务器上创建目录并 clone
mkdir -p /opt/project
cd /opt/project
git clone 你的仓库地址 .

# 以后更新代码，一条命令拉取
git pull
```

### 6.2 方式二：scp / rsync 直接传（不需 git）

在你的**本地 Windows PowerShell** 里执行：

```powershell
# scp 上传整个项目目录（会把当前目录内容递归传到服务器）
scp -r .\Graduation-project root@你的公网IP:/opt/project/
```

或装 `rsync` 做增量同步（只传变化部分，更快）：

```powershell
rsync -avz --exclude node_modules --exclude .next ./Graduation-project/ root@你的公网IP:/opt/project/
```

### 6.3 方式三：图形化工具（新手最省心）

用 **FinalShell** 或 **WinSCP**：

1. 新建连接，填公网 IP、用户名、密码
2. 左侧是本地文件，右侧是服务器文件
3. 把本地 `Graduation-project` 文件夹直接拖到服务器 `/opt/` 目录即可

> 三种方式任选其一。新手建议先用**方式三**（直观），熟悉后用**方式一**（好维护）。

### 6.4 上传后的目录检查

在服务器上确认：

```bash
cd /opt/project
ls -la
# 应该能看到 docker-compose.yml、Caddyfile、.env、frontend/、backend/
```

---

## 7. 是否需要 Docker？启动项目

### 7.1 为什么用 Docker（回答你的疑问）

- **"上传"≠"传镜像"**：你上传的是源码，Docker 在服务器上用 Dockerfile 现场打包成镜像再运行。
- 好处：环境一致（本地 Linux 容器和服务器 Linux 容器一样）、一条命令起停、数据库用官方镜像不用手动装、迁移方便。
- 对你这个"Python 后端 + Node 前端 + 两个数据库"的组合，**Docker 是最省心的选择**，强烈建议用。

### 7.2 首次启动（一条命令）

```bash
cd /opt/project

# 构建镜像（第一次较慢，2G 机器约几分钟到十几分钟）并后台启动
docker compose up -d --build
```

### 7.3 查看是否启动成功

```bash
docker compose ps
```

看到 4 个服务（`db`、`backend`、`frontend`、`caddy`）状态都是 `Up` 即成功。

### 7.4 打开网页

浏览器访问：`http://你的公网IP`，能看到前端页面就说明部署成功。

### 7.5 常用运维命令

```bash
docker compose ps                 # 查看服务状态
docker compose logs -f backend    # 实时看后端日志
docker compose logs -f frontend   # 实时看前端日志
docker compose restart backend    # 重启单个服务
docker compose down               # 停止并删除容器
docker compose up -d              # 重新启动（不重新构建）
docker compose up -d --build      # 重新构建并启动
docker compose down -v            # 停止并删除数据卷（慎用，会清空数据库）
```

---

## 8. 验证与常用命令

### 8.1 三层验证法

```bash
# 1. 容器都起来了？
docker compose ps

# 2. 后端健康吗？（在后端容器内自测）
docker compose exec backend curl -s http://localhost:8000/docs
# 看到 FastAPI 的 /docs 说明后端 OK

# 3. 数据库能连吗？
docker compose exec db psql -U coderag -d coderag -c "SELECT 1;"
```

### 8.2 端口检查

```bash
ss -tlnp | grep -E ':80|:443|:3000|:8000|:5432'
```

---

## 9. 常见问题排查

### 9.1 浏览器访问不了（但所有容器都 Up）

检查两点：

1. **安全组**是否放行了 80 端口（最常见的坑）。
2. 前端容器是否设置了 `HOSTNAME=0.0.0.0`（Node 默认绑 localhost，容器外访问不到）。

### 9.2 后端请求跨域报错（CORS）

不要靠改代码加 CORS 头，而是确认**所有请求都走 Caddy 的 80 端口**，通过 `/api/*` 转发。前端页面里的接口地址应是相对路径 `/api/...`，而不是 `http://后端IP:8000/...`。

### 9.3 内存不足 / 进程被杀（OOM）

2G 内存最容易遇到。排查：

```bash
# 看内存和 swap
free -h

# 看有没有进程被 OOM 杀掉
dmesg | grep -i "killed process"
```

解决：确认 swap 已开（第 3.3 节）、给后端加 `mem_limit`（已加 1g）、关掉无关进程。

### 9.4 拉取镜像很慢

确认第 4.3 节的镜像加速已配置。仍慢可给 Docker 配代理或换其它加速源。

### 9.5 改了代码不生效

先 `docker compose down` 再 `docker compose up -d --build`（必须带 `--build` 才会重新打镜像）。只 `restart` 不会应用代码改动。

---

## 10. 2G 低配内存优化建议

你的规格跑这套服务比较吃紧，建议照做：

1. **> 必做：开启 4G swap**（第 3.3 节）—— 这是保命操作。
2. **ChromaDB 用内嵌模式**（文档已按此配置），不要单独起 Chroma 服务，省一个进程的内存。
3. **给后端加 `mem_limit: 1g`**（compose 已配），前端可加 `mem_limit: 512m`。
4. **PostgreSQL 用 `alpine` 镜像**（已用），内存占用比完整版低。
5. **前端用 `node:*-alpine` 镜像**（已用），体积小、内存省。
6. **定期清理 Docker 无用资源**：

```bash
docker system prune -a   # 清理未使用的镜像、容器、网络
```

7. 如果确实顶不住，考虑**给 ECS 升级到 4G 内存**，或把向量库换到独立小实例。

---

## 11. 附录：Alibaba Cloud Linux 命令对照

如果你选的是 **Alibaba Cloud Linux 3.2104 LTS**（而非 Ubuntu），命令替换如下（思路完全一样，只是包管理器不同）：

| 操作      | Ubuntu                                    | Alibaba Cloud Linux 3 |
| --------- | ----------------------------------------- | --------------------- |
| 更新系统  | `apt update && apt upgrade -y`            | `dnf update -y`       |
| 装软件    | `apt install -y 包名`                     | `dnf install -y 包名` |
| 开启 swap | 同上（`fallocate`/`swapon` 通用）         | 同上                  |
| 装 Docker | `curl -fsSL https://get.docker.com \| sh` | 同上（脚本自动识别）  |

> 结论：无论哪个系统，**Docker 装好之后的操作完全一致**，因为后面都在容器里干活。差异只体现在装 Docker 之前的系统命令上。

---

## 快速上手清单（照做即可）

- [ ] 阿里云控制台放行 22 / 80 / 443 端口
- [ ] PowerShell `ssh root@公网IP` 登录
- [ ] 更新系统、设时区、开 4G swap
- [ ] 安装 Docker + Compose + 镜像加速
- [ ] 本地写好 Dockerfile / .dockerignore / docker-compose.yml / Caddyfile / .env
- [ ] 上传项目到服务器 `/opt/project`
- [ ] `cd /opt/project && docker compose up -d --build`
- [ ] 浏览器访问 `http://公网IP` 验证