# 多设备协同部署方案（waoowaoo）

本文整理“哪些组件继续放在本地电脑、哪些改成远程/集中”，目标是让多个设备可以协同完成同一个项目、同一个生成任务，并能看到同一份实时进度。

> 适用范围：源码开发、自托管 Docker、以及多机部署。
> 本地单机开发见 [`LOCAL_DEV_SETUP.zh-CN.md`](LOCAL_DEV_SETUP.zh-CN.md)；
> 正式安装、升级和备份见 [`docs/INSTALL.md`](docs/INSTALL.md)。

---

## 0. 结论摘要

一句话原则：

> **共享状态远程化，控制面单机固定，计算层分散，Codex 保持本地。**

| 组件 | 建议归属 | 是否必须共享 | 说明 |
| --- | --- | --- | --- |
| MySQL | 远程 / 集中 | 是 | 项目、任务、聊天 View、用户、Provider Key 密文的唯一事实源 |
| Redis | 远程 / 集中 | 是 | SSE 跨进程广播、连接租约、限流 |
| Temporal | 远程 / 集中 | 是 | 持久执行、重试、任务排队、跨设备 Worker 接单 |
| S3 / R2 / MinIO | 远程 | 是 | 图片、视频等媒体对象 |
| Web / Next.js | 一台常开主机 | 否（单实例） | 当前控制面只支持一个 Node 进程 |
| Codex runtime | 跟 Web 同机 | 否（本地） | 目前只有 `local` / `docker` driver；需要 Docker socket |
| Codex home | 跟 Web 同机、本地持久盘 | 否（本地） | 模型原生 Thread/history 的唯一权威 |
| Caddy / TLS | Web 主机边缘 | 否 | 提供 HTTPS、h2 和 SSE 入口 |
| Temporal Worker | 可分散到多台设备 | 否 | 无状态消费；只需能访问共享服务和 Web |
| 媒体处理 / ffmpeg | Worker 本地 | 否 | 使用本地临时目录、CPU 和磁盘 |
| 浏览器 | 任意设备 | 否 | 只访问 Web 的 HTTPS 地址 |

---

## 1. 当前状态与目标

当前项目的开发配置大致是：

- **MySQL / Redis / Temporal**：由 `COMPOSE_PROFILES=bundled-mysql,bundled-redis,bundled-temporal` 启动在本地 Compose 中。
- **S3**：已经指向远程 Cloudflare R2（`S3_ENDPOINT`、`S3_BUCKET` 等）。
- **Web + Codex runtime**：本地 Docker 或宿主机进程。
- **Worker**：本地 Compose 或 `start-service.sh worker`。

目标如果是“多设备协同完成同一个任务”，需要把 **MySQL、Redis、Temporal** 从“只在本机可见”变成“所有节点可访问的共享服务”；S3 已经是远程，保持即可。

如果目标只是“其他设备用浏览器打开同一台机器”，则不需要把中间件改成远程，直接使用单机部署 + 局域网/HTTPS 访问即可。

---

## 2. 组件分层

### 2.1 共享状态层：建议远程/集中

这些组件决定“任务是否存在于所有设备”。它们不一定要在公有云，可以放在 NAS、迷你主机、VPS 或托管服务，但必须是所有节点都能访问的同一套。

| 组件 | 作用 | 关键变量 | 注意事项 |
| --- | --- | --- | --- |
| MySQL | 业务事实源 | `DATABASE_URL`（宿主机进程）<br>`COMPOSE_DATABASE_URL`（Compose） | 需要 TLS、备份；schema 只允许一个 writer |
| Redis | SSE、限流、连接租约 | `REDIS_HOST`<br>`REDIS_PORT`<br>`REDIS_USERNAME`<br>`REDIS_PASSWORD`<br>`REDIS_TLS` | 建议密码 + TLS；不要直接暴露公网 |
| Temporal | 持久执行和任务队列 | `TEMPORAL_ADDRESS`<br>`TEMPORAL_NAMESPACE`<br>`TEMPORAL_TASK_QUEUE`<br>`TEMPORAL_TLS_ENABLED`<br>`TEMPORAL_API_KEY` | 所有 Worker 必须使用同一 namespace / task queue |
| S3 | 媒体对象 | `S3_ENDPOINT`<br>`S3_BUCKET`<br>`S3_ACCESS_KEY_ID`<br>`S3_SECRET_ACCESS_KEY`<br>`S3_FORCE_PATH_STYLE` | 当前 R2 可继续使用；注意 CORS 和签名方式 |

Temporal 如果自建，它自己的 MySQL schema 应与 Temporal Server 放在一起，不要和业务库混用。业务库和 Temporal 库可以共用同一个 MySQL 实例，但 schema 分开。

### 2.2 控制面：建议固定在一台常开主机

这些组件不是“不能远程”，而是当前实现只支持单实例，或者依赖本机状态。把它们放在一台稳定的机器上，其他设备通过网络访问。

| 组件 | 原因 | 关键配置 |
| --- | --- | --- |
| Web / Next.js | `CRR-12`：Web 控制面只支持一个 Node 进程；多 replica 需要 owner 路由和 session affinity | `NEXTAUTH_URL`、`INTERNAL_APP_URL` |
| Codex runtime | 目前只有 `local` / `docker` driver，没有远程 Runtime 驱动 | `CODEX_RUNTIME_DRIVER`、`CODEX_RUNTIME_IMAGE` |
| Codex home | 原生 Thread/history 只存在本机持久目录，不能用 MySQL 聊天记录重建 | `CODEX_RUNTIME_HOST_ROOT` |
| Docker socket | 创建 Codex 容器所需，等于主机高权限入口 | `DOCKER_SOCKET_PATH` |
| Caddy / TLS | 对外 HTTPS、h2、SSE 入口 | `SELF_HOSTED_HOST`、`APP_BIND_ADDRESS` |
| `data/config` | `database.json` / `storage.json` 是本地文件且优先于 env | 优先改用环境变量 |

**关键结论：**

- 媒体生成任务可以跨设备、跨 Worker 完成。
- Assistant 对话的原生 thread 不能随便换机器；Web 换设备时，必须把整个 `CODEX_RUNTIME_HOST_ROOT` 一起迁移，或用共享存储挂载到完全相同的绝对路径。
- 不要把 Docker socket 暴露成远程服务。

### 2.3 计算层：可以分散到多台设备

| 组件 | 建议 | 说明 |
| --- | --- | --- |
| Temporal Worker | 每台设备都可以跑 | 无状态消费任务；只需出站访问 Temporal、MySQL、Redis、S3 和 Web |
| 媒体处理 | 在 Worker 本地 | ffmpeg 视频合并/探测使用本地临时目录，需要本地磁盘和 CPU |
| 浏览器 | 任意设备 | 只连 Web 的 HTTPS 地址 |
| 日志 / 临时文件 / 构建缓存 | 各自本地 | 不需要共享 |

Worker 节点不需要 Docker socket，也不需要 Codex runtime 镜像。它需要：

```dotenv
DATABASE_URL=mysql://...
REDIS_HOST=...
REDIS_PORT=...
REDIS_USERNAME=...
REDIS_PASSWORD=...
REDIS_TLS=...
TEMPORAL_ADDRESS=...
TEMPORAL_NAMESPACE=...
TEMPORAL_TASK_QUEUE=...
TEMPORAL_TLS_ENABLED=...
TEMPORAL_API_KEY=...
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
NEXTAUTH_SECRET=...
API_ENCRYPTION_KEY=...
CRON_SECRET=...
INTERNAL_APP_URL=<能访问到 Web 的地址>
```

### 2.4 继续保留在本地电脑

这些不建议远程化，或者远程化收益很低：

- **Docker socket**：`/var/run/docker.sock`，只放 Web 主机。
- **Codex runtime 镜像和容器**：跟 Web 主机。
- **`CODEX_RUNTIME_HOST_ROOT`**：本机持久盘；不要用 `/tmp`，也不要在设备间随便复制。
- **临时文件、ffmpeg 工作目录、日志**：各节点本地。
- **`node_modules`、`.next`、Docker build cache**：各节点本地。
- **`data/` 下的日志和本地配置**：各节点本地；配置优先用 env。
- **浏览器和本地开发工具**：本地。

---

## 3. 推荐拓扑

### 方案 A：常开主机 + 远程共享状态（推荐）

适合个人或小团队，家里有 NAS / 迷你主机 / 常开台式机。

```text
┌──────────────────────────────────────────────┐
│ 共享状态层（常开主机 / NAS / VPS）           │
│  - MySQL                                     │
│  - Redis                                     │
│  - Temporal Server（或 Temporal Cloud）      │
│  - S3 / R2 / MinIO                           │
└──────────────────────┬───────────────────────┘
                       │ 内网 / VPN / TLS
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼─────────────────────┐  ┌────▼──────────────────────┐
│ 控制面（一台常开主机）       │  │ 计算节点（可选，多台）     │
│  - Web / Next.js（单实例）   │  │  - Temporal Worker         │
│  - Codex runtime + Docker    │  │  - ffmpeg / 媒体处理       │
│  - Codex home               │  │  - 只出站访问共享服务      │
│  - Caddy / TLS              │  │                           │
└───────┬─────────────────────┘  └───────────────────────────┘
        │ HTTPS
┌───────▼─────────────────────┐
│ 客户端（任意设备浏览器）     │
└─────────────────────────────┘
```

推荐理由：

- Web 和 Codex 保持单实例，避免 `CRR-12` 的多进程问题。
- Worker 可以横向加机器，媒体任务自然分摊。
- 共享状态集中，数据只有一份。
- 笔记本可以只做浏览器或 Worker，不承担关键状态。

### 方案 B：全托管

适合经常在外网、不想维护家庭网络。

```text
VPS：Web + Caddy + Codex runtime
托管 MySQL / 托管 Redis / Temporal Cloud / R2
本地设备：浏览器 + 可选 Worker
```

优点：地址稳定、备份和 TLS 简单。
缺点：成本更高，跨境网络延迟需要评估。

### 方案 C：单机 + 浏览器访问

只是多设备打开同一个页面，不需要多机计算：

```text
一台电脑：全部服务
其他设备：浏览器访问
```

需要设置：

```dotenv
APP_BIND_ADDRESS=0.0.0.0
SELF_HOSTED_HOST=<局域网 IP 或域名>
NEXTAUTH_URL=https://<同一个地址>:1443
```

限制：这台电脑休眠/关机，协同就中断。

---

## 4. 关键配置

### 4.1 所有节点必须一致

```dotenv
NEXTAUTH_SECRET=<所有节点一致>
API_ENCRYPTION_KEY=<所有节点一致>
CRON_SECRET=<所有节点一致>
WAO_SETUP_TOKEN=<如果使用 setup 页面则一致>
```

原因：

- `NEXTAUTH_SECRET`：JWT session、部分内部 token 派生。
- `API_ENCRYPTION_KEY`：数据库里的 Provider Key、`data/config/database.json`、`storage.json` 都用它加密。换掉后旧密文无法解密。
- `CRON_SECRET`：Temporal Worker 完成任务后回调 Web：
  `POST ${INTERNAL_APP_URL}/api/internal/codex-runtime/follow-up`
- `WAO_SETUP_TOKEN`：数据库已配置后重新打开 setup 页面时需要。

建议保持一致的行为开关：

```dotenv
DEPLOYMENT_EDITION=self-hosted
PROVIDER_CREDENTIAL_MODE=user-key
BILLING_MODE=OFF
LLM_STREAM_EPHEMERAL_ENABLED=true
```

如果所有节点提供相同的联网搜索能力，`OPENAI_API_KEY` 和 `OPENAI_WEB_SEARCH_MODEL` 也应一致。

### 4.2 Web 节点

```dotenv
NEXTAUTH_URL=https://app.example.com
INTERNAL_APP_URL=https://app.example.com
CODEX_RUNTIME_DRIVER=docker
CODEX_RUNTIME_HOST_ROOT=/srv/wao/codex-runtime
CODEX_RUNTIME_WAO_BASE_URL=<Codex 容器能访问到的 Web 地址>
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

注意：

- `NEXTAUTH_URL` 必须与浏览器实际访问的地址一致。
- `INTERNAL_APP_URL` 必须是 Worker 能访问到的 Web 地址；如果 Web 在 Compose 内，常见是 `http://app:3000`，但远程 Worker 不能解析 `app`。
- `CODEX_RUNTIME_WAO_BASE_URL` 必须是 Codex 容器能访问到的地址，不是浏览器地址。
- `CODEX_RUNTIME_HOST_ROOT` 必须是绝对路径，且 Docker daemon 能看到同一路径；生产环境应放在持久盘，不要用 `/tmp`。

### 4.3 Worker 节点

```dotenv
INTERNAL_APP_URL=https://app.example.com
TEMPORAL_NAMESPACE=waoowaoo
TEMPORAL_TASK_QUEUE=waoowaoo-runtime
TEMPORAL_WORKER_DEPLOYMENT_NAME=waoowaoo
```

Temporal Worker 版本的约束：

- 所有 Worker 使用同一个 `TEMPORAL_WORKER_DEPLOYMENT_NAME`。
- `TEMPORAL_WORKER_BUILD_ID` 必须与代码/镜像对应；生产环境不能使用 `local`。
- 使用内置 Compose Temporal 时，生产升级使用 `scripts/temporal/worker-rollout.sh`，不要让每台设备各自 bootstrap。该脚本通过 `temporal-admin` 容器连接固定的 `temporal:7233`，不适用于远程 Temporal / Temporal Cloud。
- 源码开发不要和正式环境共用 namespace。

### 4.4 `data/config` 的优先级

`src/lib/runtime-config/files.ts` 中：

- 默认目录：`data/config`
- 可通过 `WAO_RUNTIME_CONFIG_DIR` 覆盖
- `database.json` 和 `storage.json` 会**覆盖** `DATABASE_URL` / `S3_*` 环境变量

多设备部署时：

- 推荐统一使用环境变量，不使用网页 setup 保存的本地文件。
- 如果已经保存过，要么同步文件，要么删除后统一用 env。
- 删除前必须确认新的 `DATABASE_URL` / `S3_*` 正确，并做好备份。

### 4.5 Docker Compose 与宿主机进程的变量差异

| 启动方式 | 数据库变量 | Temporal 地址 |
| --- | --- | --- |
| `npm run dev` / `docker-compose.dev.yml` | `COMPOSE_DATABASE_URL` | 硬编码 `temporal:7233` |
| 正式 Compose | `COMPOSE_DATABASE_URL` | `TEMPORAL_ADDRESS`（Compose 内默认 `temporal:7233`） |
| `scripts/start-service.sh` / 宿主机 Node | `DATABASE_URL` | `TEMPORAL_ADDRESS` |

因此：

- **远程 Temporal 不能直接靠 `npm run dev` 生效**；要么改用 `sh scripts/start-service.sh dev`，要么写 Compose override。
- 远程 Worker 如果不在同一个 Compose 网络，必须覆盖 `INTERNAL_APP_URL`，不能依赖默认的 `http://app:3000`。

---

## 5. 迁移步骤

建议按以下顺序改造，每一步都可单独验证。

### 5.1 S3

当前已经是远程 R2，确认：

- 所有节点能访问 `S3_ENDPOINT`。
- `S3_BUCKET` 存在且权限正确。
- 如果使用 `signed-https`，配置桶 CORS。
- 如果使用 `PROVIDER_MEDIA_INPUT_TRANSPORT=public-https`，确认 endpoint 是公网 HTTPS。

### 5.2 MySQL

1. 在常开主机 / 托管服务创建 MySQL 数据库和用户。
2. 从当前库导出并导入：

```bash
mysqldump --single-transaction --routines --triggers \
  -h 127.0.0.1 -P 13306 -u <user> -p <database> > waoowaoo.sql

mysql -h <remote-host> -P 3306 -u <user> -p <database> < waoowaoo.sql
```

3. 设置 `DATABASE_URL`（宿主机）或 `COMPOSE_DATABASE_URL`（Compose）。
4. 只让一个节点执行 schema 变更：

```bash
npm run db:push
```

不要多台设备同时启动 `start-service.sh` 并同时跑 `db:push`。注意
`scripts/start-service.sh` 每次启动都会执行 `db:push`；多 Worker 部署时，建议先在一个
节点完成 schema 同步，其他节点改用已固定 schema 的镜像/迁移，或至少避免多台机器同时首次启动。

### 5.3 Redis

1. 在常开主机 / 托管服务启动 Redis，开启密码，必要时开启 TLS。
2. 设置 `REDIS_HOST`、`REDIS_PORT`、`REDIS_USERNAME`、`REDIS_PASSWORD`、`REDIS_TLS`。
3. 确认所有节点能连通，且延迟在可接受范围。

### 5.4 Temporal

1. 选择 Temporal Cloud 或自建 Temporal Server。
2. 创建 namespace，例如 `waoowaoo`。
3. 设置 `TEMPORAL_ADDRESS`、`TEMPORAL_NAMESPACE`、`TEMPORAL_TASK_QUEUE`。
4. 如果使用 TLS/API Key，设置 `TEMPORAL_TLS_ENABLED`、`TEMPORAL_API_KEY`。
5. 初始化 Worker 版本。以下脚本仅限使用内置 Compose Temporal 的部署：

```bash
sh scripts/temporal/worker-rollout.sh bootstrap blue
sh scripts/temporal/worker-rollout.sh status
```

远程 Temporal / Temporal Cloud 请在管理节点安装 Temporal CLI，使用同一
`TEMPORAL_ADDRESS`、namespace 及服务要求的 TLS/API Key 认证参数。先启动具有唯一
build ID 的 Worker，确认其 poller 已注册，再使用 CLI 的
`worker deployment set-current-version --deployment-name <deployment> --build-id <build-id>`
设置 Current Version。升级时保留旧 Worker，直到旧版本 drainage 状态为 `drained`
再停止。由一个管理节点负责版本切换；不要运行上述内置 rollout 脚本。

内置 Temporal 的具体升级流程见 [`docs/INSTALL.md`](docs/INSTALL.md) 和 `scripts/temporal/worker-rollout.sh`。

### 5.5 统一密钥与配置

1. 所有节点设置一致的 `NEXTAUTH_SECRET`、`API_ENCRYPTION_KEY`、`CRON_SECRET`。
2. 检查每台机器是否存在 `data/config/database.json`、`data/config/storage.json`。
3. 如果存在且不希望它覆盖 env，先备份再删除，或设置 `WAO_RUNTIME_CONFIG_DIR` 到统一位置。

### 5.6 固定 Web 主机

1. 选一台常开机器作为 Web/Codex 主机。
2. 把 `CODEX_RUNTIME_HOST_ROOT` 放在持久盘。
3. 如果需要换机，先停止旧 Web，再迁移整个 `CODEX_RUNTIME_HOST_ROOT`。
4. 不要同时运行两个 Web 副本。

### 5.7 增加 Worker

在其他设备上：

```bash
npm ci
# 配置 .env（共享服务 + 密钥 + INTERNAL_APP_URL）
sh scripts/start-service.sh worker
```

如果使用 Docker Compose，确保 Worker 容器能访问共享服务，并覆盖：

```yaml
services:
  temporal-worker-blue:
    environment:
      INTERNAL_APP_URL: https://app.example.com
```

### 5.8 入口与安全

1. 设置 `APP_BIND_ADDRESS=0.0.0.0`（或指定网卡地址）。
2. 设置 `SELF_HOSTED_HOST` 为其他设备可解析的域名/IP。
3. Caddy 使用 `tls internal` 时，每台设备都要信任它的 root CA；或者使用真实域名证书。
4. 设置 `TRUSTED_PROXY_HOPS`（Caddy 后通常为 1；前面还有代理时按实际层数）。
5. MySQL、Redis、Temporal 只走内网 / VPN / TLS，不要直接暴露公网。

---

## 6. 运行时约束与常见坑

### 6.1 Web 只能单进程

`docs/architecture/modules/codex-runtime-rollout.md` 的 `CRR-12`：

> Web 控制面目前只支持一个 Node 进程；媒体 Worker 可以独立横向扩展。多 replica 需要先增加按 owner 的请求路由和 session affinity。

因此：

- 推荐 **1 个 Web + N 个 Worker**。
- 不要把两个 Web 实例放在负载均衡后面。
- Worker 完成任务后的 follow-up 必须落到持有 Codex runtime 的那个 Web。

### 6.2 Codex home 是本地状态

`CODEX_RUNTIME_HOST_ROOT/codex-homes/...` 保存模型原生 Thread/history。

- 媒体任务：不依赖 Codex home，可以跨设备。
- Assistant 对话：不能靠 MySQL 聊天记录重建原生 thread。
- 换 Web 设备时，必须迁移整个 `CODEX_RUNTIME_HOST_ROOT`，或使用共享存储挂载到完全相同的绝对路径。
- 不要把 `CODEX_RUNTIME_HOST_ROOT` 放在 `/tmp`。

### 6.3 SSE 连接数限制

`src/lib/sse/connection-lease.ts` 当前限制：

- 每用户 8 条连接
- 每用户每项目 4 条连接
- 全局 2000 条连接

多设备、多标签页同时打开同一个项目时，容易占满“每项目 4 条”。第 5 个连接会拿不到租约。需要关闭不用的标签页，或按实际使用调整限制。

### 6.4 `INTERNAL_APP_URL` 与 `CRON_SECRET`

Temporal Worker 通过 HTTP 回调 Web：

```text
POST ${INTERNAL_APP_URL}/api/internal/codex-runtime/follow-up
Authorization: Bearer ${CRON_SECRET}
```

所以：

- 远程 Worker 必须能访问 `INTERNAL_APP_URL`。
- 所有节点的 `CRON_SECRET` 必须一致。
- 基础 Compose 默认 `INTERNAL_APP_URL=http://app:3000`，只适合同一个 Compose 网络内的 Worker。

### 6.5 数据库连接池与 Worker 资源

- 每个 Node 进程有自己的 Prisma 连接池；Worker 多了要关注 MySQL `max_connections`。
- 必要时在数据库 URL 中设置 `connection_limit`。
- 视频合并/探测会在 Worker 本地临时目录运行 ffmpeg，需要足够的临时磁盘和 CPU。

### 6.6 S3 访问方式

- `MEDIA_OBJECT_DELIVERY=authenticated-proxy`：浏览器媒体请求走应用，所有 Web 节点都要能访问 S3。
- `MEDIA_OBJECT_DELIVERY=signed-https`：浏览器直接使用限时签名链接，需要配置桶 CORS。
- `PROVIDER_MEDIA_INPUT_TRANSPORT=public-https`：Provider 需要能访问公网 HTTPS 的 S3 endpoint。

### 6.7 安全边界

- Web 主机挂载 Docker socket，等于高权限入口；不要无鉴权暴露到公网。
- MySQL、Redis、Temporal 不要直接开公网端口。
- 推荐使用 VPC、Tailscale、WireGuard、SSH 隧道或托管服务的私有网络。
- Redis 开启密码/TLS；Temporal 使用 TLS/API Key；MySQL 使用 TLS。
- `data/config` 和 `.env` 含加密密钥材料，按 secret 管理，不要提交到 Git。

---

## 7. 验收清单

- [ ] 设备 A 创建项目并发起一个生成任务。
- [ ] 设备 B 打开同一个项目，能看到任务和 SSE 实时进度。
- [ ] 停掉设备 A 的 Worker，启动设备 B 的 Worker，任务能继续完成。
- [ ] 生成中刷新页面，能从持久 watermark 续上，不丢尾段。
- [ ] 重启 Web（同一台设备），已有 Assistant 对话能 resume。
- [ ] Temporal UI 确认 Worker deployment 有 Current Version，旧版本可以 drained。
- [ ] 两台设备同时登录、同时打开同一项目，确认 SSE 连接数限制符合预期。
- [ ] 确认所有节点使用相同的 `NEXTAUTH_SECRET`、`API_ENCRYPTION_KEY`、`CRON_SECRET`。
- [ ] 确认没有节点使用旧的 `data/config/database.json` 或 `storage.json` 覆盖新配置。

---

## 8. 备份与回滚

需要备份的内容：

| 内容 | 说明 |
| --- | --- |
| MySQL | 业务库；自建 Temporal 时还包括 Temporal 的 schema |
| S3 桶 | 用户媒体对象，不是缓存 |
| `data/config` | 如果仍在使用网页保存的数据库/存储配置 |
| `CODEX_RUNTIME_HOST_ROOT` | 原生 Thread/history；迁移 Web 时必须一起迁移 |
| `.env` / secrets | `NEXTAUTH_SECRET`、`API_ENCRYPTION_KEY`、`CRON_SECRET` 等 |
| Caddy 的命名卷 | `caddy_data`、`caddy_config`；影响已信任的 CA |

回滚建议：

1. 先停止新 Worker 领取新任务。
2. 保留旧 Worker 直到已执行工作 drained。
3. 回滚应用镜像/代码。
4. 恢复数据库和必要配置。
5. 不要把 `docker compose down -v` 当作升级/回滚步骤。

---

## 9. 环境变量模板

以下只是模板，`<...>` 需要替换为实际值；密钥不要提交到 Git。

补充：

- 如果 Redis 在内网且未启用 TLS，把 `REDIS_TLS` 留空或设为 `false`。
- 如果 Temporal 在内网且未启用 TLS，把 `TEMPORAL_TLS_ENABLED=false` 并留空 `TEMPORAL_API_KEY`。
- 如果使用 Temporal Cloud，`TEMPORAL_ADDRESS` 通常是 `<namespace>.tmprl.cloud:7233`，并必须启用 TLS。

### 9.1 共享节点（Web + Worker 都需要）

```dotenv
# 共享状态
COMPOSE_PROFILES=
DATABASE_URL=mysql://<user>:<password>@<mysql-host>:3306/waoowaoo
COMPOSE_DATABASE_URL=mysql://<user>:<password>@<mysql-host>:3306/waoowaoo

REDIS_HOST=<redis-host>
REDIS_PORT=6379
REDIS_USERNAME=<redis-user>
REDIS_PASSWORD=<redis-password>
REDIS_TLS=true

TEMPORAL_ADDRESS=<temporal-host>:7233
TEMPORAL_NAMESPACE=waoowaoo
TEMPORAL_TASK_QUEUE=waoowaoo-runtime
TEMPORAL_TLS_ENABLED=true
TEMPORAL_API_KEY=<temporal-api-key>
TEMPORAL_WORKER_DEPLOYMENT_NAME=waoowaoo

S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
S3_FORCE_PATH_STYLE=true
MEDIA_OBJECT_DELIVERY=authenticated-proxy
PROVIDER_MEDIA_INPUT_TRANSPORT=public-https

# 全节点一致
NEXTAUTH_SECRET=<same-secret>
API_ENCRYPTION_KEY=<same-key>
CRON_SECRET=<same-cron-secret>
WAO_SETUP_TOKEN=<setup-token>
```

### 9.2 Web 节点额外配置

```dotenv
NEXTAUTH_URL=https://<app-host>
INTERNAL_APP_URL=https://<app-host>
CODEX_RUNTIME_DRIVER=docker
CODEX_RUNTIME_HOST_ROOT=/srv/wao/codex-runtime
CODEX_RUNTIME_IDLE_TIMEOUT_MS=900000
CODEX_RUNTIME_IMAGE=<codex-runtime-image@sha256:...>
CODEX_RUNTIME_NETWORK=waoowaoo_codex-runtime
CODEX_RUNTIME_CPU_LIMIT=2
CODEX_RUNTIME_MEMORY_BYTES=2147483648
CODEX_RUNTIME_PIDS_LIMIT=256
CODEX_RUNTIME_WAO_BASE_URL=<codex-container-reachable-web-url>
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

### 9.3 Worker 节点额外配置

```dotenv
INTERNAL_APP_URL=https://<app-host>
TEMPORAL_WORKER_DEPLOYMENT_NAME=waoowaoo
TEMPORAL_WORKER_BUILD_ID=<immutable-build-id>
TEMPORAL_WORKER_VERSIONING_ENABLED=true
```

---

## 10. 最终判断口诀

- 要跨设备看到同一份事实 → **远程/共享**：MySQL、Redis、Temporal、S3
- 要本机 Docker / 本地持久状态 → **本地**：Web、Codex runtime、Codex home、Docker socket
- 要更多算力 → **分散**：Temporal Worker、媒体处理
- 只是多设备打开页面 → **单机部署 + 浏览器访问**即可，不必大改

> 共享状态远程化，控制面单机固定，计算层分散，Codex 保持本地。
