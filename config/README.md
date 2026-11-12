# 视频能力契约

`video-model-contracts.json` 是公共默认目录，不携带部署网关、私有模型别名或渠道绑定。原生视频 Provider 的内置能力继续由各自适配器提供。

兼容视频渠道使用共享数据目录中的 `data/config/video-model-contracts.json`。该文件替换公共目录，已被 Git 和 Docker 构建上下文忽略；应用与 worker 必须挂载同一份 `data`。不要把部署地址、模型别名或密钥写入公共目录，也不要把密钥写入契约。

`video-model-contracts.example.json` 仅演示结构，不自动启用。示例的端点、模型 ID、时长及参考图能力都是占位值，必须根据实际渠道文档核实后填写：

```sh
npm run video:contracts -- check /path/to/verified-contracts.json
npm run video:contracts -- import /path/to/verified-contracts.json
```

`import` 校验后原子写入本地数据目录，不修改公共默认目录。完成后重启应用和 worker；多实例部署需同步文件。`check` 不传路径时检查当前部署文件，不存在时检查公共目录。以上命令均不请求上游，也不提交付费生成任务。

契约应显式绑定 `provider` 实例 ID 和精确 `baseUrl`；相同模型名不代表不同网关拥有相同协议或能力。当前可执行协议是 `json-videos-v1`。未知协议、缺失契约和渠道不匹配都会令对应模型不可用。部署文件无效时记录 `LOCAL_VIDEO_CONTRACT_CATALOG_INVALID` 并回退公共目录，避免中断文本、图片及原生模型会话。

迁移已有目录时原样导入，保持渠道 ID、revision、模型、规则及端点不变，契约指纹也不变。实际变更能力或端点后，既有任务的契约快照仍会阻止使用新契约重放。

`outputSizes` 可按渠道文档声明每个分辨率、画幅对应的精确像素尺寸。仅有 `resolutionOptions` 时，不从 `720p` 等名称推断尺寸；验收记录 `resolutionCheck: not_declared`，继续检查时长、画幅和声明的音轨要求。`passed` 表示这些可验证的技术项通过，内容验收仍为 `pending`。
