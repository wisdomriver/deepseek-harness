/**
 * Feishu docs browser half: the sidebar entry and the panel it opens.
 * Data arrives through the injected face; components never touch `ctx`.
 * @module @deepseek-ai/dsh-feishu-docs/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.slots Context merge from the renderer, and the slot declarations of the shell.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DocsController } from './controller.ts'
import { DocIcon } from './DocIcon.tsx'
import { DocPanel } from './DocPanel.tsx'
import { en, zh, type DocsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Docs panel copy. */
    'feishuDocs': DocsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'feishuDocs'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'feishu-docs' as MainPanelId

/** Sidebar and locale services this plugin registers through. */
export const inject = ['slots', 'locale']

/**
 * Contribute the sidebar entry and the docs panel.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'feishu-docs: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new DocsController()
  ctx.effect(() => () => { controller.dispose() }, 'feishu-docs: controller')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ hooks: { docs: controller.store }, actions: controller.actions }),
  }, DocPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 120,
    label: () => t('panel'),
    locale: NS,
  }, DocIcon))
  // The panel is the plugin's only consumer of the routes; the first read happens at load
  // and later reads follow view changes and refreshes.
  controller.load()
}
