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

-----

<a id="use-this-package"></a>
## 使用本包

把 bundle 装进 profile，然后在左栏打开「日历」。面板以月网格展示主日历：每天最多列出三条日程，其余收在「还有 N 条」后面。箭头切换月份，今天回到当前月，刷新重新读取当前月，新建日程打开四项表单。点击事件块或今日议程行会打开详情抽屉，其中「编辑」「删除」可改写或移除日程；重复日程会先询问作用范围。没有配置飞书应用或没有登录用户时，面板说明当前状态而不是报错；找不到 `lark-cli` 时也会明确提示。

当前月由一次 `calendar +agenda` 覆盖网格的 42 个格子，所以一个视图只起一次 CLI 进程；60 秒内的重复读取走内存缓存。详情按事件 id 走 `calendar +get`，重复日程的某个实例会额外读一次 master 以取得重复规则。新建通过 `calendar events create --data -` 经标准输入提交，标题不出现在进程命令行里，也不会创建会议或提醒。

本包需要同一个 profile 里的飞书桥接插件（`@deepseek-ai/dsh-feishu-bridge`）：`lark-cli` 位置、命令预算、共享进程闸门与内存缓存都归它管。只装面板而不装桥接，面板不会激活。本包自己的配置只有 `weekStart`，决定网格第一列。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

Host 面在 Connection 的认证栅栏内注册三条精确 Fetch 路由，只有 owner principal 能到达：`/api/feishu-calendar/status`、`/api/feishu-calendar/events`（GET 读一个月，POST 新建）和 `/api/feishu-calendar/event`（GET 读详情）。每个处理函数只返回数据或抛 `FeishuError`；信封、HTTP 状态与 requestId 由桥接插件的 `panelRoutes` 补上。这里的服务只保留日历命令拼装与归一：它调用 `feishuBridge.run`，把读结果按 `calendar:` 前缀存进共享缓存，并在写操作后统一失效。

浏览器面在 `feishu-calendar` key 下注册 `main` 面板与对应的 `sidebar.panellist` 入口，并驱动一个快照 store：先状态、再当月日程。组件通过渲染器绑定的 `useCalendar` 读取快照，不接触 `ctx`。

| 文件 | 职责 |
|---|---|
| [`src/service.ts`](src/service.ts) | 日历命令拼装、字段归一、缓存键与失效 |
| [`src/routes.ts`](src/routes.ts) | 路由定义与请求校验，复用桥接的路由包装 |
| [`src/paths.ts`](src/paths.ts) | 路由路径常量 |
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

无：日历面板只渲染认证路由，不注册工具、提示段或请求上下文。

#### KV 缓存影响

无。不改变任何缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 周/日视图、RSVP、参会人、地点展示与会议链接均延后。
- 只读取主日历；新建只支持标题、起止时间与详情。
- 新建表单只用已加载的当月数据做重叠提示，最终以飞书为准。
- 客户端在面板注册时读取路由，而不是在面板首次可见时读取；可见时的状态轮询尚未实现。
