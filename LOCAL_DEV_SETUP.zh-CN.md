# 本地开发环境初始化指南（macOS / Apple Silicon）

本文档记录在 macOS（Apple Silicon + Colima + Docker）上从零把 waoowaoo 跑起来的完整流程，
包含网络受限（Docker Hub / GitHub 直连不稳，需要本地 HTTP 代理）时的处理办法。

> 适用场景：源码方式本地开发，即 `npm run dev` → `scripts/dev-docker.sh` →
> `http://localhost:3001`。
> 生产/自托管部署请看 [`docs/INSTALL.md`](docs/INSTALL.md)。

---

## 0. 最终形态

启动后由 Docker Compose 运行以下容器（项目名 `waoowaoo`）：

| 容器 | 作用 | 端口 |
| --- | --- | --- |
| `waoowaoo-app-dev-1` | Next.js 16 开发服务器（Turbopack） | `127.0.0.1:3001 -> 3000` |
| `waoowaoo-temporal-worker-dev-1` | Temporal Worker | - |
| `waoowaoo-mysql-1` | MySQL 8.0 | `127.0.0.1:13306 -> 3306` |
| `waoowaoo-redis-1` | Redis 7 | 内部 |
| `waoowaoo-temporal-1` | Temporal Server | 内部 |
| `waoowaoo-minio-1` | MinIO（S3 兼容存储） | 内部 |
| `app-schema-dev` / `minio-init` / `temporal-*` | 一次性初始化任务 | - |

访问地址：**http://localhost:3001**（自动跳转到 `/zh`）

首次使用在首页点「创建账号」，或访问 `http://localhost:3001/zh/auth/signin`。
数据库与对象存储已由 `.env` 自动配置，不需要再进 `/zh/setup`。

---

## 1. 前置条件

- macOS 13+，Apple Silicon（Intel 也可，镜像/二进制需换 `x64`）
- 16GB 内存建议；Colima 虚拟机至少分配 **8GB**（2GB 会在 Next.js 编译时 OOM）
- 磁盘剩余 ≥ 30GB（镜像 + 构建缓存 + node_modules）
- Node.js 22.14+（项目 `.nvmrc` 为 22.14.0；24.x 实测可用）
- 本地 HTTP 代理（可选但强烈建议，例：`http://127.0.0.1:7890`）

检查：

```bash
node -v            # v22.14+ / v24.x
npm -v
uname -m           # arm64
```

### 1.1 安装/确认 Docker CLI 与 Compose 插件

Colima 只负责起 VM，「docker compose」「docker buildx」是 CLI 插件：

```bash
brew install docker
mkdir -p ~/.docker/cli-plugins

# 有代理时可直接从 GitHub 下载；无代理可换 ghfast.top / gh-proxy.com 等镜像前缀
curl -sSL -o ~/.docker/cli-plugins/docker-compose \
  "https://ghfast.top/https://github.com/docker/compose/releases/latest/download/docker-compose-darwin-aarch64"
curl -sSL -o ~/.docker/cli-plugins/docker-buildx \
  "https://ghfast.top/https://github.com/docker/buildx/releases/download/v0.38.2/buildx-v0.38.2.darwin-arm64"

chmod +x ~/.docker/cli-plugins/docker-compose ~/.docker/cli-plugins/docker-buildx
docker compose version
docker buildx version
```

> 如果下载到的是 9 字节的 `Not Found`，说明镜像前缀的 Release 路径不对，
> 先用 `curl -sSL .../releases/latest` 或 GitHub API 确认实际文件名。

---

## 2. 安装并配置 Colima

```bash
brew install colima
```

### 2.1 分配足够资源

```bash
colima start --cpu 4 --memory 8 --disk 100
```

参数会写回 `~/.colima/default/colima.yaml`。也可以直接编辑该文件：

```yaml
cpu: 4
memory: 8
disk: 100
vmType: vz
arch: aarch64
runtime: docker
```

### 2.2 配置代理（关键）

Docker daemon 和容器构建都需要代理。把代理写进 Colima VM 的环境变量：

```yaml
# ~/.colima/default/colima.yaml
env:
  HTTP_PROXY: http://127.0.0.1:7890
  HTTPS_PROXY: http://127.0.0.1:7890
  NO_PROXY: localhost,127.0.0.1,::1
```

```bash
colima restart
```

Colima 会自动把 `127.0.0.1` 重写为 VM 内的宿主机网关地址（常见为 `192.168.5.2`），
并生成 `/etc/docker/daemon.json`：

```json
{
  "proxies": {
    "http-proxy": "http://192.168.5.2:7890",
    "https-proxy": "http://192.168.5.2:7890",
    "no-proxy": "127.0.0.1,localhost,::1"
  }
}
```

验证代理在 VM 内可用：

```bash
colima ssh -- sh -c 'curl -sS -m 10 -x http://192.168.5.2:7890 -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/'
# 200
docker pull hello-world        # 能拉取即 daemon 代理正常
```

> **不要**再配置 `registry-mirrors`。实测 `docker.xuanyuan.me` 会对 `docker/dockerfile`
> 返回 403，`m.daocloud.io`、`1ms.run` 也可以但不稳定；走代理直连 Docker Hub 最可靠。

### 2.3 首次启动卡在下载 VM 镜像

若 `colima start` 卡在下载 Ubuntu 镜像，可手动下载后放进缓存目录：

```bash
# 路径形如：
# ~/Library/Caches/colima/caches/<sha512 前 40 位左右>
```

下载完成后必须校验 SHA-512 与 Colima 期望值一致，再重新 `colima start`。
更省事的办法是让终端全程走代理后再执行 `colima start`。

---

## 3. 准备代码依赖

```bash
git clone <repo>
cd waoowaoo
```

### 3.1 npm 镜像

创建 `.npmrc`（已在 `.gitignore` 中，不会提交）：

```ini
registry=https://registry.npmmirror.com
```

### 3.2 安装宿主机依赖

```bash
PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
npm ci --registry=https://registry.npmmirror.com --no-audit --no-fund
```

若 `ffmpeg-ffprobe-static` 的 postinstall 超时（直连 GitHub Release 很慢），
用本地 HTTP 镜像绕过：

```bash
VER=b6.1.2-rc.1
GH=https://ghfast.top/https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/$VER
DIR=/tmp/ffmirror/$VER
mkdir -p "$DIR"

curl -L --retry 3 -C - -o "$DIR/ffmpeg-darwin-arm64"  "$GH/ffmpeg-darwin-arm64"
curl -L --retry 3 -C - -o "$DIR/ffprobe-darwin-arm64" "$GH/ffprobe-darwin-arm64"
chmod 755 "$DIR"/*

# 本地静态服务器模拟原始 base url
(cd /tmp/ffmirror && python3 -m http.server 8899 --bind 127.0.0.1 &)

FFMPEG_FFPROBE_STATIC_BASE_URL=http://127.0.0.1:8899/ \
PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
npm ci --registry=https://registry.npmmirror.com --no-audit --no-fund

# 兜底：如果 install.js 仍然失败，安装包目录里手动放二进制
cp "$DIR/ffmpeg-darwin-arm64"  node_modules/ffmpeg-ffprobe-static/ffmpeg
cp "$DIR/ffprobe-darwin-arm64" node_modules/ffmpeg-ffprobe-static/ffprobe
chmod 755 node_modules/ffmpeg-ffprobe-static/ffmpeg node_modules/ffmpeg-ffprobe-static/ffprobe

# 完成后关闭临时服务器
pkill -f "http.server 8899"
```

验证：

```bash
node -e "const p=require('ffmpeg-ffprobe-static'); console.log(p.ffmpegPath, p.ffprobePath)"
node_modules/ffmpeg-ffprobe-static/ffmpeg -version | head -1
```

> npm 输出里的 `13 packages have install scripts not yet covered by allowScripts`
> 只是新版本 npm 的提示，不影响使用。

---

## 4. 生成 `.env`

```bash
cp .env.example .env
chmod 600 .env
```

用下面的脚本一次性写入随机密钥和数据库连接串（**不要用 Perl 的 `s///` 去替换带有 `@`
的字符串**，`@127` / `@mysql` 会被 Perl 当作数组插值吞掉，最终得到
`mysql://user:pass.0.0.1:13306/...` 这种坏地址，报 `DATABASE_SETTINGS_URL_INVALID`）。

```bash
python3 - <<'PY'
import re, secrets, pathlib

p = pathlib.Path('.env')
s = p.read_text()

db_pw       = secrets.token_hex(24)
root_pw     = secrets.token_hex(24)
temporal_pw = secrets.token_hex(24)
minio_pw    = secrets.token_hex(24)
minio_app   = secrets.token_hex(24)
redis_pw    = secrets.token_hex(24)
nextauth    = secrets.token_hex(32)
cron        = secrets.token_hex(32)
enc_key     = secrets.token_hex(32)

values = {
    'MYSQL_PASSWORD':         db_pw,
    'MYSQL_ROOT_PASSWORD':    root_pw,
    'TEMPORAL_MYSQL_PASSWORD': temporal_pw,
    'MINIO_ROOT_PASSWORD':    minio_pw,
    'MINIO_APP_SECRET_KEY':   minio_app,
    'REDIS_PASSWORD':         redis_pw,
    'NEXTAUTH_SECRET':        nextauth,
    'CRON_SECRET':            cron,
    'API_ENCRYPTION_KEY':     enc_key,
    # 宿主机通过映射端口访问
    'DATABASE_URL':           f'mysql://waoowaoo:{db_pw}@127.0.0.1:13306/waoowaoo',
    # 容器内部通过服务名访问
    'COMPOSE_DATABASE_URL':   f'mysql://waoowaoo:{db_pw}@mysql:3306/waoowaoo',
}
for key, val in values.items():
    s, n = re.subn(rf'^{key}=.*$', f'{key}={val}', s, flags=re.M)
    assert n == 1, key

p.write_text(s)
print('ok: .env written')
PY

grep -cE '^(MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|TEMPORAL_MYSQL_PASSWORD|MINIO_ROOT_PASSWORD|MINIO_APP_SECRET_KEY|REDIS_PASSWORD|NEXTAUTH_SECRET|CRON_SECRET|API_ENCRYPTION_KEY|DATABASE_URL|COMPOSE_DATABASE_URL)=.+' .env
# 11
```

关键变量说明：

| 变量 | 说明 |
| --- | --- |
| `DEPLOYMENT_EDITION` | 必须是 `self-hosted` 或 `cloud`，否则启动脚本直接退出 |
| `DATABASE_URL` | 宿主机/本机脚本用，指向 `127.0.0.1:13306` |
| `COMPOSE_DATABASE_URL` | 容器内用，host 必须是 `mysql` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO 管理员 |
| `MINIO_APP_ACCESS_KEY` / `MINIO_APP_SECRET_KEY` | 应用访问 MinIO 的账号 |
| `S3_*` | 留空，self-hosted overlay 会从 `MINIO_*` 派生 |
| `WAO_SETUP_TOKEN` | 可选；数据库已配置后想重开 `/zh/setup` 时才需要 |
| `NEXTAUTH_URL` | 默认 `http://localhost:3001`，改端口时同步修改 |
| `DEV_APP_HOST_PORT` | 默认 `3001` |

> `.env` 已在 `.gitignore` 中，**永远不要提交或贴出真实 `.env`**。

---

## 5. 处理 MinIO 镜像

MinIO 官方 Docker Hub 仓库（`minio/minio`、`minio/mc`）已不可用，
Quay 匿名拉取也返回 401。可行方案是使用 Bitnami legacy 镜像并重打成 compose 期望的标签：

```bash
docker pull bitnamilegacy/minio:2025.7.23-debian-12-r5
docker pull bitnamilegacy/minio-client:2025.7.21-debian-12-r3

docker tag bitnamilegacy/minio:2025.7.23-debian-12-r5 \
           minio/minio:RELEASE.2025-09-07T16-13-09Z
docker tag bitnamilegacy/minio-client:2025.7.21-debian-12-r3 \
           minio/mc:RELEASE.2025-08-13T08-35-41Z
```

Bitnami 镜像默认以 **UID 1001** 运行，而新建的 named volume 属主是 root，
首次启动会报 `file access denied`。先修卷权限：

```bash
docker volume create waoowaoo_minio_data   # 卷名前缀 = COMPOSE_PROJECT_NAME，默认 waoowaoo
docker run --rm -v waoowaoo_minio_data:/data busybox:1.37 \
  sh -c 'chown -R 1001:0 /data'
```

> 如果你有可用的外部 S3/OSS，可跳过本节：把 `.env` 里的
> `COMPOSE_PROFILES` 去掉 `bundled-s3`，并直接配置 `S3_*`。

---

## 6. 构建镜像（需要代理时）

`scripts/dev-docker.sh` 内部调用 `docker compose build`，但没有把代理作为
build-arg 传进去。BuildKit 在 build 阶段不会继承宿主机的 `HTTP_PROXY`，表现为：

```
failed to authorize: DeadlineExceeded: context deadline exceeded
failed to solve: failed to resolve source metadata for docker.io/library/node:22-bookworm-slim
```

处理方法：生成一份临时启动脚本，在 `compose build` 行追加 build-arg（**不要改仓库文件**）：

```bash
python3 - <<'PY'
src = open('scripts/dev-docker.sh').read()
args = ('--build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" '
        '--build-arg HTTP_PROXY="${HTTP_PROXY:-}" '
        '--build-arg NO_PROXY="${NO_PROXY:-}"')
src = src.replace('compose build --no-cache $build_targets',
                  f'compose build --no-cache {args} $build_targets')
src = src.replace('compose build $build_targets',
                  f'compose build {args} $build_targets')
open('/tmp/dev-docker-proxy.sh', 'w').write(src)
PY

HTTPS_PROXY=http://192.168.5.2:7890 \
HTTP_PROXY=http://192.168.5.2:7890 \
NO_PROXY=localhost,127.0.0.1,192.168.5.2,registry.npmmirror.com \
WAO_DEV_ENV_FILE=.env sh /tmp/dev-docker-proxy.sh
```

说明：

- `192.168.5.2` 是 Colima VM 内看到的宿主机地址，可用
  `colima ssh -- grep host.lima.internal /etc/hosts` 确认。
- 首次构建会执行容器内 `npm ci`（约 5–15 分钟，取决于网络），生成：
  - `waoowaoo-development:local`
  - `waoowaoo-codex-runtime:development`
- 构建成功后脚本会在 `.runtime/dev-docker/` 写入 fingerprint；之后再次启动会跳过构建。
- 依赖文件（`package.json`/`package-lock.json`）变化会触发重建，因此后续重建仍需上面的
  代理 build-arg 方式。若网络已经畅通，直接 `npm run dev` 即可。

---

## 7. 启动

首次构建完成后：

```bash
npm run dev
```

等价于：

```bash
WAO_DEV_ENV_FILE=.env sh scripts/dev-docker.sh
```

看到以下日志即启动成功：

```
app-dev-1 | ▲ Next.js 16.3.4 (Turbopack)
app-dev-1 | - Local: http://localhost:3000
app-dev-1 | ✓ Ready in 219ms
```

访问：

```bash
curl -I http://localhost:3001/          # 307 -> /zh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/zh   # 200
```

---

## 8. 日常命令

为方便执行 `down` / `logs`，先导出 dev compose 需要的变量：

```bash
export COMPOSE_PROJECT_NAME=waoowaoo
export COMPOSE_PATH_SEPARATOR=:
export COMPOSE_FILE=docker-compose.yml:docker-compose.self-hosted.yml:docker-compose.dev.yml:docker-compose.self-hosted.dev.yml
export WAO_DEV_ENV_FILE=.env
export WAO_DEV_CODEX_RUNTIME_ROOT="$PWD/.runtime/codex"
export WAO_DEV_DEPENDENCY_FINGERPRINT=$(
  git hash-object package.json package-lock.json 2>/dev/null |
    git hash-object --stdin | cut -c1-16
)
```

| 操作 | 命令 |
| --- | --- |
| 查看状态 | `docker compose ps` |
| 看应用日志 | `docker compose logs -f app-dev` |
| 看 Worker 日志 | `docker compose logs -f temporal-worker-dev` |
| 停止（保留数据） | `docker compose down` |
| 停止并删数据卷（慎用） | `docker compose down -v` |
| 重启应用 | `docker compose restart app-dev temporal-worker-dev` |
| 强制重建镜像（网络畅通时） | `WAO_DEV_FORCE_REBUILD=1 npm run dev` |
| 强制重建镜像（需代理） | `WAO_DEV_FORCE_REBUILD=1` 走第 6 节的临时脚本 |

> `docker compose down` 在 dev 配置下会校验 `WAO_DEV_*` 必填变量，
> 不导出上面的变量会报 `required variable ... is missing a value`。

---

## 9. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `docker: unknown command: docker compose` | 缺 Compose 插件 | 安装到 `~/.docker/cli-plugins/docker-compose` |
| `cross-env: command not found` | 宿主机依赖未装 | 按第 3.2 节 `npm ci` |
| `pull access denied for minio/mc` | 官方 MinIO 镜像已下线 | 用 Bitnami legacy 重打标签（第 5 节） |
| MinIO 日志 `file access denied` / `Unable to initialize backend` | 数据卷属主不是 UID 1001 | `chown -R 1001:0 /data`（第 5 节） |
| `Error: DATABASE_SETTINGS_URL_INVALID` | 连接串被 Perl `@` 插值破坏 | 用第 4 节的 Python 脚本重写 `.env` |
| `app-dev` 启动几十秒后 `Exited (0)` / `OOMKilled=true` | Colima 内存不足（默认 2GB） | `colima stop && colima start --memory 8 --cpu 4` |
| 构建 `failed to authorize: DeadlineExceeded` | BuildKit 未走代理 | 用第 6 节的 build-arg 补丁脚本 |
| `403 Forbidden ... docker.xuanyuan.me` | 镜像加速器不支持 blob 路径 | 删除 registry-mirrors，改用代理直连 |
| `ffmpeg-ffprobe-static` 安装 `Request timed out` | GitHub Release 直连超时 | 用第 3.2 节本地镜像 + `FFMPEG_FFPROBE_STATIC_BASE_URL` |
| 首页 307 但 `/zh` 连接被拒 | 应用容器已退出（OOM） | 看 `docker inspect ... .State.OOMKilled`，加内存后重启 |
| `WAO_DEV_DEPENDENCY_FINGERPRINT is missing` | 绕过启动脚本直接用了 compose | 使用 `npm run dev`，或导出第 8 节变量 |

---

## 10. 检查清单

启动前逐项确认：

- [ ] `colima status` 显示 running，VM 内存 ≥ 8GB
- [ ] `docker info` 里 daemon 代理可用（`docker pull hello-world` 成功）
- [ ] `docker compose version` / `docker buildx version` 可用
- [ ] `.env` 存在且权限 `600`，`DEPLOYMENT_EDITION=self-hosted`
- [ ] `DATABASE_URL` 指向 `127.0.0.1:13306`，`COMPOSE_DATABASE_URL` 指向 `mysql:3306`
- [ ] `.env` 中所有 `*_PASSWORD`、`*_SECRET*` 已替换为随机值（无空值）
- [ ] MinIO 两个镜像标签已重打，`waoowaoo_minio_data` 卷属主为 `1001:0`
- [ ] `node_modules/ffmpeg-ffprobe-static/{ffmpeg,ffprobe}` 存在且可执行
- [ ] `.runtime/dev-docker/*.fingerprint` 已生成（或准备首次构建）

启动后确认：

- [ ] `docker compose ps`：mysql/redis/temporal healthy，app-dev/worker Up
- [ ] `docker logs waoowaoo-minio-init-1` 出现 `MinIO bucket 'waoowaoo' is ready.`
- [ ] `curl -I http://localhost:3001/` 返回 307
- [ ] `curl -o /dev/null -w '%{http_code}' http://localhost:3001/zh` 返回 200
- [ ] 首页可以打开「创建账号」/「登录」
