---
description: "飞书任务面板：左栏「任务」入口，按截止日期分组的待办、我负责与已完成列表，支持行内完成与通过飞书插件的 lark-cli 快速新建任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-task

[English](README.md) | 中文

## 摘要

`dsh-feishu-task` 在左栏增加「任务」入口，并打开一个镜像当前登录用户飞书任务的面板。飞书始终是唯一数据源：Host 面执行 `lark-cli task` 命令并以认证路由提供数据，浏览器面只渲染这些路由返回的内容。插件不向磁盘复制任何任务；在面板里完成或新建的任务直接写入飞书。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把 bundle 装进 profile，然后在左栏打开「任务」。面板按截止日期分组列出任务——逾期、今天、明天、本周内、更晚、无截止日期——每组和标题行都显示条数。视图切换读取全部未完成任务、分配给你的任务或已完成任务；搜索框在停止输入 300 毫秒后向飞书查询，清空搜索回到缓存的视图。每行左侧是完成圆点，点击标题打开详情抽屉，其中有截止时间、完成时间、创建者、负责人、关注者、任务清单、子任务数、父任务与描述；抽屉里的「完成 / 重开」按钮与「在飞书中打开」链接同样可用。没有配置飞书应用或没有登录用户时，面板说明当前状态而不是报错，并给出可打开飞书插件页的入口；找不到 `lark-cli` 时也会明确提示。

一个列表视图只发一次 `task +search` 调用，60 秒内的重复读取走内存缓存；一次详情读取只发一次 `task tasks get` 调用，缓存 300 秒。完成、重开与新建分别走 `task +complete`、`task +reopen` 和带幂等键的 `task +create`，每次写成功后清空全部任务缓存。

本包需要同一个 profile 里的飞书桥接插件（`@deepseek-ai/dsh-feishu-bridge`）：`lark-cli` 位置、命令预算、共享进程闸门与内存缓存都归它管。只装面板而不装桥接，面板不会激活。面板本身没有配置项。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

Host 面在 Connection 的认证栅栏内注册三条精确 Fetch 路由，只有 owner principal 能到达：`/api/feishu-task/status`、`/api/feishu-task/tasks`（GET 读一个视图，POST 新建）和 `/api/feishu-task/task`（GET 读详情，POST 完成或重开）。每个处理函数只返回数据或抛 `FeishuError`；信封、HTTP 状态与 requestId 由桥接插件的 `panelRoutes` 补上。这里的服务只保留命令拼装与字段归一：它调用 `feishuBridge.run`，在「我负责」视图里读取账号的 openId，把读结果按 `task:` 前缀存进共享缓存，并在写操作后统一失效。

列表行的 `due_at` 是不带时区的本地墙钟时间，Host 按设备本地时区解析成时刻后序列化；详情的 `due.timestamp` 本身是绝对时刻，并附带 `is_all_day`。浏览器按该时刻的本地日期分组，这与飞书客户端对同一值的处理一致。

浏览器面在 `feishu-task` key 下注册 `main` 面板与对应的 `sidebar.panellist` 入口，并驱动一个快照 store：先状态、再当前视图。组件通过渲染器绑定的 `useTask` 读取快照，不接触 `ctx`。完成操作先乐观标记该行，写入失败时回滚标记；成功后在 Host 已失效缓存的前提下重新读取列表。

| 文件 | 职责 |
|---|---|
| [`src/service.ts`](src/service.ts) | 任务命令拼装、字段归一、缓存键与失效 |
| [`src/routes.ts`](src/routes.ts) | 路由定义与请求校验，复用桥接的路由包装 |
| [`src/paths.ts`](src/paths.ts) | 路由路径常量 |
| [`src/client/controller.ts`](src/client/controller.ts) | 面板状态、列表与详情读取、完成与新建 |
| [`src/client/groups.ts`](src/client/groups.ts) | 按本地日期分组截止时间 |
| [`src/client/TaskPanel.tsx`](src/client/TaskPanel.tsx) | 面板渲染 |
| [`src/client/TaskDetail.tsx`](src/client/TaskDetail.tsx) | 详情抽屉 |
| [`src/client/CreateTaskDialog.tsx`](src/client/CreateTaskDialog.tsx) | 新建表单 |
| [`src/client/locales.ts`](src/client/locales.ts) | `feishuTask` 文案，中文为 key 来源 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- 飞书插件与共享的 `lark-cli` 登录：[`@deepseek-ai/dsh-feishu`](../feishu/README.zh.md)
- 本面板使用的进程闸门、缓存与错误码：[`@deepseek-ai/dsh-feishu-bridge`](../feishu-bridge/README.zh.md)
- 带认证的 Fetch 路由：[`@deepseek-ai/dsh-client-connection`](../../client/connection/README.zh.md)
- 左栏与主面板槽位：[`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.zh.md)、[`@deepseek-ai/dsh-client-ui-layout`](../../client/ui-layout/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无：任务面板只渲染认证路由，不注册工具、提示段或请求上下文。

#### KV 缓存影响

无。不改变任何缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 新建表单只采集一个截止日期，因此计时截止会落在该本地日的结束时刻；最终时刻以飞书为准。
- 列表读取 CLI 的默认单页条数，「已完成」只保留收到的最新 50 条；分页与服务端截止区间筛选延后。
- 飞书详情只返回任务清单 GUID 与成员 id，面板因此显示缩写 id；子任务列表、成员姓名、方向键导航与面板可见时的状态轮询均延后。
