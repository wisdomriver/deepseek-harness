---
description: "飞书云文档面板：左栏「云文档」入口，打开最近文档、搜索、云空间文件夹、只读正文预览，并通过飞书插件的 lark-cli 做块级编辑。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-docs

[English](README.md) | 中文

## 摘要

`dsh-feishu-docs` 在左栏增加「云文档」入口，并打开一个面向当前登录用户飞书云文档的面板。飞书始终是唯一数据源：Host 面执行 `lark-cli drive` 与 `docs` 命令并以认证路由提供数据，浏览器面只渲染这些路由返回的内容。插件不向磁盘复制任何文档，没有本地文档库；每次写入都通过块级命令落到飞书。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把 bundle 装进 profile，然后在左栏打开「云文档」。面板有三个视图。「最近」列出最近 7 / 30 / 90 天打开过的文档，可按最近打开或最近修改排序。「搜索」提交不超过 30 个字符的关键词，可限定只看自己拥有的文档。「我的空间」浏览云空间根目录与文件夹，面包屑可回到根目录。列表行显示类型图标、命中高亮的标题、所有者、时间与类型；标题由文本分段渲染，从不使用 HTML。

打开文档后显示元数据、目录，以及「在飞书中打开」「复制链接」（2 秒内显示「已复制」）和重命名输入。点「查看正文」读取全文，超过 4000 字截断并标记。对 `docx` 文档或 wiki 节点，抽屉还提供「编辑内容」：读取块列表，逐块编辑纯文本、在文末追加 Markdown、二次确认后删除块；未保存的草稿只存在内存里，离开前会确认。基准版本过期时显示冲突提示并重新加载，草稿保留在编辑框；写入部分成功时展示服务端警告。新建文档需要标题、可选的 Markdown 正文与位置，创建完成后直接打开新文档。没有配置飞书应用或没有登录用户时，面板说明当前状态而不是报错；找不到 `lark-cli` 时也会明确提示。

Host 用桥接插件的共享缓存缓存列表 60 秒、文档 300 秒；「刷新」只失效当前视图的键，每次写入成功后失效该文档与列表的键。编辑期间冻结「刷新」与视图切换，避免基准版本漂移。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

Host 面在 Connection 的认证围栏内注册六个精确 Fetch 路由，只有 owner principal 能到达：`/api/feishu-docs/status`、`/recent`、`/search`、`/files`、`/document`（GET 读、POST 写）、`/documents`（POST 新建）。服务对象通过 `ctx.feishuBridge` 持有 CLI runner；`lark-cli` 由桥接插件惰性解析，所以可执行文件缺失只会让首个请求以 `cli-missing` 失败，而不会让插件加载失败。读操作从 `auth status` 重算 `missingScopes`；写操作一律不重试，因为 `docs +update` 没有幂等键。

写命令都带文档的 `revision_id` 作为 `--revision-id`；桥接插件把版本过期的拒绝映射为 `conflict`（HTTP 409）。追加的 Markdown 经标准输入提交（`--content -`），文档正文不会出现在进程参数里。块改写先在可编辑白名单中校验标签，再以 `<tag>转义文本</tag>` 作为参数提交；每次写后都重新取块列表，因为块 ID 会随版本变化。

| 文件 | 职责 |
|---|---|
| [`src/service.ts`](src/service.ts) | 文档与文件夹读取、块写入、重命名、新建、缓存、边界、错误映射 |
| [`src/blocks.ts`](src/blocks.ts) | `with-ids` XML 扫描、可编辑判定、实体解码、写回转义 |
| [`src/normalize.ts`](src/normalize.ts) | 高亮分段、类型映射、按码点截断 |
| [`src/routes.ts`](src/routes.ts) | 路由定义、查询与请求体校验 |
| [`src/client/controller.ts`](src/client/controller.ts) | 面板状态、列表读取、抽屉读取、草稿、冲突 |
| [`src/client/DocPanel.tsx`](src/client/DocPanel.tsx) | 标题行、视图分段、列表、状态卡片 |
| [`src/client/DocDetail.tsx`](src/client/DocDetail.tsx) | 元数据、目录、正文预览、链接、重命名、块编辑 |
| [`src/client/locales.ts`](src/client/locales.ts) | `feishuDocs` 文案，中文为键真源 |

| 读取 | 命令 |
|---|---|
| 最近文档 | `drive +search --opened-since <Nd> --sort open_time\|edit_time --page-size 20` |
| 搜索 | `drive +search --query <q> [--doc-types …] [--mine]` |
| 我的空间 | `drive files list [--folder-token t] [--order-by EditedTime\|CreatedTime] [--page-token p]` |
| 目录 / 正文 | `docs +fetch --doc <url> --scope outline\|full --doc-format markdown --detail simple` |
| 块列表 | `docs +fetch --doc <url> --scope full --detail with-ids --doc-format xml` |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- 飞书插件与共享 `lark-cli` 登录：[`@deepseek-ai/dsh-feishu`](../feishu/README.zh.md)
- 共享进程闸门、缓存与错误码：[`@deepseek-ai/dsh-feishu-bridge`](../feishu-bridge/README.zh.md)
- 认证 Fetch 路由：[`@deepseek-ai/dsh-client-connection`](../../client/connection/README.zh.md)
- 侧栏与主面板槽位：[`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.zh.md)、[`@deepseek-ai/dsh-client-ui-layout`](../../client/ui-layout/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无：云文档面板只渲染认证路由，不注册工具、提示段或请求上下文。

#### KV 缓存影响

无。不改变任何缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 只做块级编辑，且只支持 `docx` 文档与背后是 `docx` 的 wiki 节点；不提供整篇覆盖，因为那会丢失图片与评论。
- 只有 `h1`–`h6`、`p`、`li`、`code`、`quote` 块可编辑。含图片、表格、多维表格、白板、引用、任务、OKR、同步块或表格的块保持只读，并提示到飞书中修改。
- 改写块写回的是纯文本，块内的加粗、斜体与链接会变成纯文本。
- 不插入富文本块、不拖拽排序；不做评论、权限、上传下载、导出与内嵌图片读取。
- 文件夹浏览只做单层与分页；云空间根目录不做递归。
- 面板在加载时读取路由，可见时不轮询状态；不做实时协同。
- 目录与正文预览来自 CLI 的 Markdown，因此目标不是 `docx` 的 wiki 节点无法在面板中编辑。
