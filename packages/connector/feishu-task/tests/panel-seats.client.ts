// Standard seats Slot components receive, so a spec can render the registered panel
// entries without the renderer. Nothing in the tasks panel reads these seats.

import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'

/**
 * A standard seat the tasks panel never reads.
 * @returns never; a panel that reads this seat needs a real value here.
 */
const unused = (): never => {
  throw new Error('the tasks panel reads no standard Slot seat')
}

/**
 * Every standard seat a Slot component receives.
 *
 * The tasks panel supplies its own data through the injected face, so a component that starts
 * reading a standard seat is a new requirement this table must answer with a real value.
 */
export const standardSeats = {
  useResource: unused,
  useWorkspaces: unused,
  useWorkspaceAccess: unused,
  useRemoteAccess: unused,
  useContextMenu: unused,
  usePanelInfo: unused,
  useSessionStatus: unused,
  useSessions: unused,
  useSessionRetainInfo: unused,
  useSessionAccess: unused,
}

/**
 * Build a selector hook over one fixed snapshot.
 * @param snapshot - the snapshot every selector reads.
 * @returns the hook a component receives from the framework binding.
 */
export function fixedHook<T>(snapshot: T): SnapshotSelectorHook<T> {
  return <S>(selector: (value: T) => S): S => selector(snapshot)
}
