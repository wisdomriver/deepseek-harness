// Shared presentation fixtures: a locale lookup, a complete action stub, and a state factory.

import type { DocsActions, DocsViewState } from '../src/client/controller.ts'
import { en, type DocsLocaleKey } from '../src/client/locales.ts'

/**
 * Translate one key from the English dictionary.
 * @param key - dictionary key.
 * @param params - values interpolated into the copy.
 * @returns the copy.
 */
export const t = (key: DocsLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

/** Build a panel state with every required field defaulted. */
export function stateOf(overrides: Partial<DocsViewState> = {}): DocsViewState {
  return {
    phase: 'ready',
    view: 'recent',
    days: 30,
    sort: 'open',
    orderBy: 'EditedTime',
    query: '',
    mine: false,
    items: [],
    hasMore: false,
    loadingMore: false,
    crumbs: [],
    missingScopes: [],
    ...overrides,
  }
}

/**
 * Build a complete action stub.
 * @param overrides - actions a spec wants to observe.
 * @returns the stub.
 */
export function actionsStub(overrides: Partial<DocsActions> = {}): DocsActions {
  const noop = (): void => {}
  return {
    refresh: noop,
    setView: noop,
    setDays: noop,
    setSort: noop,
    setOrderBy: noop,
    setMine: noop,
    search: noop,
    loadMore: noop,
    openFolder: noop,
    goBack: noop,
    goRoot: noop,
    openDoc: noop,
    closeDoc: noop,
    retryDetail: noop,
    viewFull: noop,
    hideFull: noop,
    startEdit: noop,
    closeEdit: noop,
    editBlock: noop,
    startAppend: noop,
    updateDraft: noop,
    cancelDraft: noop,
    saveDraft: noop,
    deleteBlock: noop,
    rename: () => Promise.resolve(true),
    openCreate: noop,
    closeCreate: noop,
    submitCreate: noop,
    ...overrides,
  }
}
