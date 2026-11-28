---
description: "飞书桥接插件：为飞书面板插件提供唯一的 lark-cli 进程闸门、内存缓存与稳定错误码。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-bridge

[English](README.md) | 中文

<a id="summary"></a>
## 摘要

`dsh-feishu-bridge` 是所有飞书面板插件共用的 Host 面能力。它提供 `ctx.feishuBridge`：解析受管 `lark-cli`、在共享并发闸门后逐条执行命令、从任一输出流读出 JSON 信封、把失败映射为十二个稳定错误码，并由同一个最近最少使用缓存提供数据。它自身不注册任何路由、也不注册左栏入口：只装它而不装面板，界面上不会多出任何东西。

<a id="table-of-contents"></a>
## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="使用本包"></a>
<a id="use-this-package"></a>
## 使用本包

面板插件依赖本包并注入服务：

```ts
ctx.inject(['feishuBridge'], (scope) => {
  const result = scope.feishuBridge.run({ command: ['task', '+search'], mode: 'read' })
})
```

桥接插件由自己的 Cordis patch 行挂载。配置写在插件条目上：`binDir` 指向不在 `@larksuite/cli` 包内的 `lark-cli`；`readTimeoutMs` 与 `writeTimeoutMs` 分别约束读、写命令；`maxConcurrency` 与 `queueLimit` 控制进程闸门；`cacheLimit` 控制共享缓存容量。所有面板读同一份配置，一处改动对全部面板生效。

调用必须声明 mode。读命令用 `readTimeoutMs`，可传 `retry: 'transient'` 在超时后重试一次；写命令用 `writeTimeoutMs` 且永不重试，因为超时的写入可能已经落库。支持 `--data -` 的命令可以走 stdin，内容不会出现在进程命令行里。

失败带一个稳定错误码：`invalid-input`、`not-found`、`not-configured`、`not-connected`、`permission-denied`、`cli-missing`、`timeout`、`busy`、`upstream`、`unknown-outcome`、`conflict`、`internal`。每个码对应一个 HTTP 状态，面板按码给本地化文案，不透传 CLI 原文。

-----

<a id="实现说明"></a>
<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节——点击展开</summary>

插件入口是函数插件：解析一次 `Config`，用延迟解析的可执行文件构造服务，并以 `feishuBridge` 名字提供。`lark-cli` 在首次调用时才解析，所以可执行文件缺失只会让首个请求以 `cli-missing` 失败，而不是让插件加载失败。

命令经 `spawn` 执行（`windowsHide`），两个输出流各保留至多 8 MiB，用计时器执行墙钟预算并在超时时终止进程，`ENOENT` 的启动错误归为 `cli-missing`。信封解析优先标准输出、回退标准错误——`lark-cli` 的失败信封写在标准错误；打印过进度行再输出 JSON 的命令仍可解析。成功与否以信封的 `ok` 判定，不看退出码。

面板用 `panelRoutes` 包装自己的路由处理器，得到 `ctx.connection.fetch.register` 需要的结构化路由：包装层补上 `requestId`、`{ ok, data }` / `{ ok: false, error }` 信封、由错误码表决定的 HTTP 状态，并为每次失败记一行诊断——只有面板、方法、路径与错误码，不含任何飞书内容。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 函数插件入口、配置、提供服务 |
| [`src/cli.ts`](src/cli.ts) | 可执行文件解析、子进程、JSON 定位 |
| [`src/envelope.ts`](src/envelope.ts) | 信封读取与失败到错误码的映射 |
| [`src/errors.ts`](src/errors.ts) | `FeishuError`、十二个错误码、HTTP 状态 |
| [`src/cache.ts`](src/cache.ts) | TTL 缓存、LRU 淘汰、单飞加载 |
| [`src/limits.ts`](src/limits.ts) | 进程闸门 |
| [`src/routes.ts`](src/routes.ts) | 路由包装：信封、状态、requestId、诊断 |
| [`src/types.ts`](src/types.ts) | 请求、结果、账号、缓存与路由类型 |

</details>

-----

<a id="延伸阅读"></a>
<a id="further-exploration"></a>
## 延伸阅读

- 飞书插件（`@deepseek-ai/dsh-feishu`）负责登录与 CLI 安装；本桥接插件只读取其结果状态。
- 基于本桥接插件的面板插件：飞书日历、任务、云文档。

-----

<a id="模型体验"></a>
<a id="model-experience"></a>
## 模型体验

无：桥接插件只为浏览器面板执行 `lark-cli` 命令，不注册工具、提示段或请求上下文。

#### KV 缓存影响

无。不改变任何缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 日志是插件入口接到 `ctx.logger` 的回调，尚无按调用导出的指标。
- 写操作不内置幂等辅助：幂等键由各面板按自己的 CLI 命令传入，超时的写入以 `unknown-outcome` 提示用户到飞书确认。
- 冲突码目前靠 API 错误码与消息措辞判定；云文档服务的确切冲突码尚未观测到，`envelope.ts` 为此保留了一个空的错误码集合。

-----
