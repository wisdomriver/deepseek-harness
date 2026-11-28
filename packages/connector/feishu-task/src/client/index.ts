/**
 * Feishu tasks browser half: the sidebar entry and the panel it opens.
 * Data arrives through the injected face; components never touch `ctx`.
 * @module @deepseek-ai/dsh-feishu-task/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.slots Context merge from the renderer, and the slot declarations of the shell.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the optional ctx.pluginNavigation merge the connect prompt uses when the Plugins page is loaded.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { en, zh, type TaskLocaleKey } from './locales.ts'
import { TaskController } from './controller.ts'
import { TaskIcon } from './TaskIcon.tsx'
import { TaskPanel } from './TaskPanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tasks panel copy. */
    'feishuTask': TaskLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'feishuTask'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'feishu-task' as MainPanelId

/** Bundle whose Plugins page connects the Feishu account. */
const FEISHU_BUNDLE = '@deepseek-ai/dsh-feishu'

/** Sidebar and locale services this plugin registers through. */
export const inject = ['slots', 'locale']

/**
 * Contribute the sidebar entry and the tasks panel.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'feishu-task: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new TaskController()
  ctx.effect(() => () => { controller.dispose() }, 'feishu-task: controller')
  // The Plugins page provides its navigation only while the current Peer may use it.
  const pluginNavigation = createSnapshotStore(false)
  ctx.inject(['pluginNavigation'], (scope: ClientContext) => {
    scope.effect(() => {
      pluginNavigation.set(true)
      return () => { pluginNavigation.set(false) }
    }, 'feishu-task: plugin navigation presence')
  })
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { task: controller.store, pluginNavigation },
      actions: controller.actions,
      navigation: {
        connectFeishu: () => { ctx.get('pluginNavigation')?.openBundle(FEISHU_BUNDLE) },
      },
    }),
  }, TaskPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 110,
    label: () => t('panel'),
    locale: NS,
  }, TaskIcon))
  // The panel is the plugin's only consumer of the routes; the first read happens at load
  // and later reads follow view changes, searches, refreshes, and writes.
  controller.load()
}
