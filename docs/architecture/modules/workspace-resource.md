<!-- architecture-module: workspace-resource -->

# WorkspaceResource 创作工作区

## 为什么是这样

一个 Project 只有一棵创作资源树。`WorkspaceResource` 同时表示目录、用户可编辑文字文件，以及
生产出的图片、音频和视频；不存在 Authoring File、CreativeResource、Episode Resource 或 Canvas
Card Resource 等平行实体。

Episode、Chapter、Scene、Shot、Canon 都是用户目录与文件内容，不是系统 scope、外键或第二状态机。
旧系统把 Resource、领域表、Canvas 节点、authoring file 和消息附件分别解释为创作事实，导致名称
匹配、最近记录和多条 current 关系互相竞争。

## 不变量

- **WR-01 — Catalog 是路径与存在性的唯一持久权威。** 稳定 `resourceId` 是身份，`(projectId,
  activePath)` 唯一约束当前路径。未删除资源有且只有一个路径；删除只清空当前路径并保留最后路径
  用于恢复。对象存储拥有文件内容，Runtime 文件夹只是与资源树无关的可销毁 scratch，Canvas 只是 View。
- **WR-02 — Project 是唯一作用域。** Resource 只有 `userId + projectId` 所有权。目录语义不产生
  系统 scope、外键或第二状态机。
- **WR-03 — 文件夹也是 Resource。** 虚拟根不持久化；每个非根父目录必须是同 Project 的未删除
  文件夹 Resource，因此空目录可持久化和显示。
- **WR-04 — 内容与语义按版本边界冻结。** 每个版本指向不可变对象。用户编辑只追加版本；生成结果由
  终态 materializer 追加版本。`resourceId + contentVersion` 是执行输入身份，当前路径只用于显示
  和审计。显式保存带注册 outputKind 的结构化内容时必须通过同一 Output schema；同一 Resource
  不能改成另一 outputKind。
- **WR-05 — 字段所有权明确。** Agent 只能通过显式 Operation 创建、移动、改名、软删除或保存内容；
  不可写 identity、status、Task、Lineage、模型、成本或系统投影。Runtime scratch、in-turn 专业结果
  与工具临时文件不会自动成为 Resource。
- **WR-06 — 持久写入只有显式入口。** 文档只经 `save_project_document`，媒体只经对应创建、上传、
  合并 Operation，异步结果只经 terminal materializer。Runtime 不投影资源树、不 capture 文件、
  不根据目录差异写回数据库。
- **WR-07 — Agent 只用项目相对路径寻址，Placement 仍由服务端拥有。** Agent 通过路径读取、建目录、
  移动和选择目标文件夹；生产工具只接收 `folderPath + 用户可见名称`。服务端在 Plan 前验证路径语法、
  现有目录树类型、schema 与最终路径冲突并派生用户可理解的最终文件路径；目标目录不存在不是 Agent
  的前置步骤，授权后的输出事务必须先经唯一 folder writer 原子补齐目录链，再预留 Resource。稳定
  `resourceId` 只承担身份，绝不拼入用户路径或名称。同名候选只使用可读、可排序的序号，其他路径
  冲突必须显式失败。Agent 不传 outputPath、内部 Resource ID 或媒体后缀协议；Runtime 路径永远
  不是项目路径。
- **WR-08 — 执行前冻结精确输入。** 调用方只提交有序的
  `resourceId + contentVersion + role + channel` 引用；数组顺序是公开输入的唯一顺序事实，服务端据此
  生成内部冻结位置、验证 Project 所有权并补充当时路径供显示与审计。执行、重试和 Lineage 都只
  消费冻结版本，不能在 Task 开始后重新按路径读取。
  视频编辑的裁剪范围与输出规格必须在提交前对同一媒体版本校验并冻结；执行不得用来源文件属性或生成请求时长替代用户编辑选择。
  裁剪必须在 30 fps 下至少形成一帧；超出来源时长或配乐来源/时间轴不匹配属于参数错误，返回公开字段的精确纠错路径。
  合成执行端还须核对冻结输入位置全局唯一、每段对应一个 edit、配乐不越过时间轴，以及 lifecycle 与单一输出身份一致。
  合成的可选 `cover={videoIndex,offsetSeconds}` 选择保留片段的起始帧或其内部时刻；索引从零开始，
  偏移相对裁剪后的片段。未指定时取第一段第一帧。提交前冻结片段索引、段内帧和最终时间轴帧号，
  原参数重试保留该选择。执行端从实际渲染视频按帧号提取 JPEG，与视频使用同一 Task 的稳定产物键
  上传。终态事务将 `posterMediaId` 和视频一起写入同一 `WorkspaceResourceVersion`；封面读取权限
  沿版本关系归属用户，画布使用受保护的 `/m/...` 作为 `posterUrl`，不把封面当成独立生成资源。
- **WR-09 — 一个异步终态 writer。** 生成 Operation 的 commit 事务预留 pending Resource 与 Task；
  Task 终态在同一事务物化版本、Lineage、Resource 状态、Task 终态与通知。replay 返回同一事实，
  不能生成第二 Resource 或重复计费。
  失败或取消的合成通过 `merge_videos.request.kind=retry` 重放冻结剪辑，修改剪辑后使用
  `revise_failed`；两者都指定原 `resourceId`，保留名称、路径、schema 与版本历史。画布携带
  `expectedTaskId` 固定展示过的失败尝试，提交事务再次比较原 Task 和失败状态，再原子绑定新 Task。
  新 Task 的去重键包含原失败 Task，支持连续失败后的再次重试；成功、pending、禁用及删除资源
  不可重试。同名新建仍显式报路径冲突，不得按名称自动覆盖或另起“修正版”规避。
  合成工具声明统一为对象根节点和 `request.kind=new/retry/revise_failed`，联合分支不得放在根上；
  Tool canonicalizer 将 new 转成原执行输入，API 原有顶层 name/output/videos 格式继续有效。
  canonicalizer 还必须原样接受已冻结的规范输入，保证 durable Activity 再次经过调用 authority 时
  不会把规范顶层字段误当成 Tool envelope 的额外字段；对外仍只发布 request envelope。
  通用 Tool schema 转换器遇到无法发布的根联合类型必须明确失败，不得静默发布空 properties。
- **WR-10 — 批量生产直接提交结构化 items。** `create_image`、`create_audio`、`create_video` 接收各自
  共享 schema 的批量 items；一次预检形成一个总报价和一个 Grant，再扇出 Task。不存在中间 Manifest
  文件或第二次“读取并提交”；成员有稳定 identity，部分失败只重跑失败成员。
- **WR-11 — 移动、删除、恢复只有一套语义。** 文件移动只改自身路径；文件夹移动原子改写完整子树。
  移动在 Project 锁内按当前路径解析并写入；Agent 的删除路径必须在审批前解析并冻结为
  `resourceId + workspacePath`，执行按 ID 定位并校验路径未变，禁止审批后重新按路径寻找目标。
  恢复以已删除 `resourceId` 选择精确删除批次，因为已删除路径不再唯一。活跃 Task 涉及的 Resource
  不可移动或删除；pending Resource 不可删除；恢复冲突必须显式给新路径，禁止静默改名。
- **WR-13 — 大项目按目录读取。** 列表与搜索用 cursor 分页和有界摘要，摘要来自版本行物化的预览
  列，列表路径零对象存储读取；完整正文只经单资源读取入口按需加载。规模上限必须明确失败，不能
  恢复静默截断。
- **WR-14 — 专业结果留在当前 Turn。** 主 Agent 构造一个 strict JSON 专业结果并把同一 items 直接
  提交对应媒体 Operation；只有用户明确要求保存文档时才调用 `save_project_document`。结果不因写入
  scratch 或出现在对话中自动生成 Canvas 资源。
- **WR-15 — MCP 直接消费持久事实。** MCP Operation 直接从 Catalog、Version、Task 与配置读取权威
  状态；调用前后没有 Runtime 文件 flush/refresh，也没有“资源指针同步中”生命周期。工具提交成功
  后，pending/ready/failed 只由 Resource 与 Task View 表达。
- **WR-16 — 创作内容不在服务端编译。** 专业 JSON 必须包含完整最终 Provider-ready 创作输入、创作
  身份与创作参数：图片/视频使用 Prompt，结构化音乐使用 Composition Plan 与 cue timing。画幅只有
  一个 owner：资产图片由资产格式策略固定；其他图片/视频 item 可显式声明自己的画幅，未声明时由
  Project 画幅 owner 解析；调用方不得给资产图片传画幅，也不得让 Project 画幅以外的默认值静默出现。
  Planner 在任何 Plan、报价、Resource 或 Task 副作用前严格校验、选择正式模型、解析精确引用并
  逐字冻结；禁止依据 schemaId 追加 Prompt 或猜资产类型。
- **WR-17 — 项目生产事实由系统投影。** 当前 Project 配置与生产 registry 只有一个 resolver；
  项目展示事实进入 Turn 上下文，模型能力与可填写参数进入版本化工具契约，不形成 workspace 文件、
  Skill 能力副本或 Agent 可写配置。缺必需能力时停止而非猜测；新计划校验发现版本并冻结真实参数，
  已冻结的生产和重试只消费原 Snapshot，不读取后续参数配置。
- **WR-18 — 项目投影有唯一持久水位。** Project 级单调 revision 与每次 Resource 创建、内容或
  生命周期更新、移动、删除、恢复以及 Assistant 持久事实更新在同一事务推进，各领域 writer 复用
  唯一水位写入口。正式 View 暴露
  自己读取到的下界 revision；在线通知只优化延迟，客户端以服务端持久水位校验正式 Query 是否落后，
  不得把 Pub/Sub 到达、连接仍为 OPEN、历史消息或本地 timer 当作投影完整性的证明。

## 权威入口

三个业务入口，route/UI/MCP/CLI 都只能调用它们，不能直接写 Resource、Version 或 Lineage：

1. WorkspaceResource persistence：folder、显式保存、move、soft delete、restore、reserve、
   materialize（`src/lib/workspace-resource/**`）
2. 产出 Resource 的 Operation registry：直接批量创建图片/音频/视频、上传/导入、合并与显式保存文档
3. Task terminal materializer：异步成功、失败与取消

## 踩过的坑

- 删除首版把路径直接当 identity；旧 View 与并发移动之间可能误删后来占用同一路径的另一个 Resource
  → path 是 Agent 的位置语言而不是删除 identity → 模型路径在审批前解析并冻结 ID 与当时路径，执行
  只按 ID 定位且校验路径未变（WR-11）。
- 文本版本最初只用 `resourceId + version` 作为对象 key，且在事务提交前上传；事务回滚后同版本不同
  内容的重试会覆盖对象，而数据库仍保留旧摘要 → 版本不可变性被对象覆盖打破 → 对象 key 包含内容
  SHA-256，宁可留下待回收的未引用对象。
- 16 位 compact 幂等 hash 被写进要求完整 SHA-256 的输入字段，四类媒体 Task 在 Provider 调用前
  确定性失败；失败终态又先解析同一畸形 payload，Task、Resource 与冻结额度永久停在处理中 →
  两种 hash 混用 + 终态解析耦合成功路径 → fingerprint 与请求 identity 分离，失败终态只用
  canonical target 结算。
- 媒体 Task 在 Agent Turn 结束后异步物化版本，而 baseline 把所有 `currentVersion` 变化都视为
  Agent 写冲突，未变的媒体指针也报漂移 → 前台与后台 writer 共用同一 CAS 维度 → 文本按版本 CAS，
  媒体指针只以 identity/路径/存在性/类型参与。
- 专业 Skill 各自手写字段示例，执行层又是另一份 strict 权威，真实 worker 写出的字段被拒；错误
  投影还剥掉了字段级 issue，模型转而猜路径反复重试 → 同一契约两份表示 → 三种媒体直接复用同一
  Output Registry schema，失败返回有界字段 corrections。后来公开引用又同时要求数组顺序和手写
  `position`，且 corrections 仍读取 null 规范化前的父级 union issue，真实字段错误再次被藏住 →
  上一版只限制了错误输出大小，没有删除重复顺序事实，也没有规定投影发生在规范化之后 → 公开引用
  只保留数组顺序，服务端生成冻结位置，corrections 只消费最终规范化输入的叶子 issue（WR-08）。
- 文件型 Manifest、Agent outputPath、必须 mkdir、`.resource` 媒体指针与 MCP 前后同步串成多级协议；
  任一层字段、路径或同步状态漂移都会在真实生产中表现为参数失败或“资源仍在同步”，此前修复只补
  单个校验点所以换形式复发 → 删除整条文件/指针协议，公开输入只保留批量 items、目标文件夹路径、
  名称与版本引用，服务端一次完成精确路径解析、placement、预检、报价和提交（WR-06/07/08/10/15）。
- 上一版虽删除了 Agent 的“必须 mkdir”协议，Plan 仍把目标目录已存在当作 Placement 前提，模型只要
  直接提交新语义目录就会在保存、生成或合并前失败 → 只删除 Prompt 步骤，没有删除服务端同一前提
  → Plan 只校验路径与现有树冲突，授权后的输出事务统一调用既有 folder writer 原子补齐目录链（WR-07/09）。
- 路径优先切换虽把内部 `resourceId` 从 Agent 输入移除，服务端仍把 ID 后缀拼进最终 Catalog 路径，
  View 又从该路径生成名称，内部身份因而继续泄漏给用户 → 上一版只收紧了输入边界，没有分开身份与
  位置语义 → `resourceId` 只承担身份，Placement 生成可读路径，同名冲突在 Plan 前显式拒绝（WR-01/07）。
- 删除文件/指针协议时仍保留 Runtime 内的 `system/project.json` 并把它和 Catalog 路径混为一谈；
  边界只能稳定拒绝并显示参数失败 → 上一版只删除 writer，没删除竞争命名空间 → Runtime 永远只是
  scratch，生产上下文直接注入，`get_resource(path)` 只解析 Catalog 的项目相对路径（WR-07/17）。
- Canvas 的资源刷新先后补过 target 映射、终态 replay、连接 CLOSED 重建和 Created 影响范围，但在线
  连接仍把易失 Pub/Sub 当成完整性交接；消息静默丢失且连接保持 OPEN 时只能靠手动刷新恢复 → 上一版
  每次只补一个通知分支，没有给正式 Resource View 持久水位 → 所有 Resource writer 同事务推进唯一
  revision，心跳只比较水位并失效正式 Query（WR-18）。

### Workflow participation

`WorkspaceResource.workflowEnabled` defaults to true and is independent of generation
status and deletion. `set_resource_workflow` is a reversible, non-billable API Operation
for files. It preserves paths, immutable versions and lineage, advances the project
projection revision in the same transaction, and returns the normal mutation receipt.
Pending files cannot be toggled.

The canvas and content manager explicitly include disabled files for viewing and
comparison. Default assistant discovery, runtime context and production progress
exclude them. Explicit reads, previews and downloads remain available. Disabled files
cannot be attached to a generation draft or accepted as inputs for new work. Submission
rechecks current participation under the project lock, including previously prepared
plans and retries. Already accepted jobs continue using their frozen input versions;
disabling an input does not invalidate historical lineage or cancel downstream jobs.
