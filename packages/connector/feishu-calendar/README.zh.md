---
description: "飞书日历面板：左栏「日历」入口，打开主日历的月视图、今日议程、事件详情，并通过飞书插件的 lark-cli 快速新建日程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-calendar

[English](README.md) | 中文

## 摘要

`dsh-feishu-calendar` 在左栏增加「日历」入口，并打开一个镜像当前登录用户主日历的面板。飞书始终是唯一数据源：Host 面执行 `lark-cli calendar` 命令并以认证路由提供数据，浏览器面只渲染这些路由返回的内容。插件不向磁盘复制任何日程，没有本地日历；在面板里新建的日程直接写入飞书。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 bundle 装进 profile，然后在左栏打开「日历」。面板以月网格展示主日历：每天最多列出三条日程，其余收在「还有 N 条」后面。箭头切换月份，今天回到当前月，刷新重新读取当前月，新建日程打开四项表单。点击事件块或今日议程行会打开详情抽屉。没有配置飞书应用或没有登录用户时，面板说明当前状态而不是报错；找不到 `lark-cli` 时也会明确提示。

当前月由一次 `calendar +agenda` 覆盖网格的 42 个格子，所以一个视图只起一次 CLI 进程；60 秒内的重复读取走内存缓存。详情按事件 id 走 `calendar +get`，重复日程的某个实例会额外读一次 master 以取得重复规则。新建通过 `calendar events create --data -` 经标准输入提交，标题不出现在进程命令行里，也不会创建会议或提醒。

配置在 Host 入口上：`binDir` 指定非默认的 `lark-cli`，`readTimeoutMs` 与 `writeTimeoutMs` 是命令预算，`maxConcurrency` 与 `queueLimit` 控制 CLI 并发闸门，`weekStart` 决定网格第一列。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

Host 面在 Connection 的认证栅栏内注册三条精确 Fetch 路由，只有 owner principal 能到达：`/api/feishu-calendar/status`、`/api/feishu-calendar/events`（GET 读一个月，POST 新建）和 `/api/feishu-calendar/event`（GET 读详情）。服务对象持有 CLI 运行器、带单飞的内存缓存和并发闸门；`lark-cli` 延迟解析，所以可执行文件缺失只会让首个请求以 `cli-missing` 失败，而不是让插件加载失败。

浏览器面在 `feishu-calendar` key 下注册 `main` 面板与对应的 `sidebar.panellist` 入口，并驱动一个快照 store：先状态、再当月日程。组件通过渲染器绑定的 `useCalendar` 读取快照，不接触 `ctx`。

| 文件 | 职责 |
|---|---|
| [`src/cli.ts`](src/cli.ts) | 可执行文件定位、子进程执行、JSON 信封提取 |
| [`src/service.ts`](src/service.ts) | 日历读取与新建、缓存、单飞、并发闸门、错误映射 |
| [`src/routes.ts`](src/routes.ts) | 路由定义、请求校验、响应信封 |
| [`src/client/controller.ts`](src/client/controller.ts) | 面板状态与当月读取 |
| [`src/client/CalendarPanel.tsx`](src/client/CalendarPanel.tsx) | 面板渲染 |
| [`src/client/locales.ts`](src/client/locales.ts) | `feishuCalendar` 文案，中文为 key 来源 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- 飞书插件与共享的 `lark-cli` 登录：[`@deepseek-ai/dsh-feishu`](../feishu/README.zh.md)
- 带认证的 Fetch 路由：[`@deepseek-ai/dsh-client-connection`](../../client/connection/README.zh.md)
- 左栏与主面板槽位：[`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.zh.md)、[`@deepseek-ai/dsh-client-ui-layout`](../../client/ui-layout/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

本插件不产生任何模型可见输入：不注册工具、不加提示词段落、不改请求上下文，读取的日程数据也不会进入模型请求。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 周/日视图、编辑、删除、RSVP、参会人、地点展示与会议链接均延后。
- 只读取主日历；新建只支持标题、起止时间与详情。
- 新建表单只用已加载的当月数据做重叠提示，最终以飞书为准。
- 客户端在面板注册时读取路由，而不是在面板首次可见时读取；可见时的状态轮询尚未实现。

-----

<a id="dev-note"></a>
## 开发者说明

本包使用 Host 与 Client 两个编译面：根 `tsconfig.json` 只做 solution，`tsconfig.host.json` 与 `tsconfig.client.json` 分别是两个叶子。构建用 `tsdown`（`clientBundle` 预设，`hostPhase: true`），产物为 `lib/index.js` 与 `lib/client.js`。
