// Feishu panels through the real Host and browser composition.
// A stand-in lark-cli answers the task and document commands and records the writes.
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const PACKAGES = fileURLToPath(new URL('../../../packages/connector/', import.meta.url))

// The stand-in records each write beside itself, which the scenarios read back.
const LARK_CLI = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const line = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const task = {
  guid: 'task-1',
  summary: '评审需求',
  status: 'todo',
  due_at: '2026-12-02 08:00:00',
  created_at: '2026-11-20 10:00:00',
  updated_at: '2026-11-28 09:00:00',
  url: 'https://applink.feishu.cn/client/todo/task?guid=task-1',
  members: [{ id: 'ou_e2e', role: 'assignee', type: 'user' }],
}
const doc = {
  entity_type: 'DOC',
  title_highlighted: '季度<h>复盘</h>',
  summary_highlighted: '',
  result_meta: {
    token: 'doc-1',
    url: 'https://example.test/docx/doc-1',
    doc_types: 'DOCX',
    owner_name: '测试用户',
    edit_user_name: '测试用户',
    update_time_iso: '2026-11-28T08:00:00Z',
    last_open_time_iso: '2026-11-28T09:00:00Z',
    icon_info: '',
  },
}
const scope = 'task:task:read task:task:write docx:document:readonly docs:document.content:read drive:drive.metadata:readonly search:docs:read wiki:node:read'
if (args[0] === 'auth' && args[1] === 'status') {
  line({ appId: 'cli_e2e', identities: { user: { status: 'ready', available: true, userName: '测试用户', openId: 'ou_e2e', scope } } })
} else if (args[0] === 'task' && args[1] === '+search') {
  line({ ok: true, identity: 'user', data: { items: [task], has_more: false, page_token: '' } })
} else if (args[0] === 'task' && args[1] === 'tasks' && args[2] === 'get') {
  line({ ok: true, identity: 'user', data: { task } })
} else if (args[0] === 'task' && (args[1] === '+complete' || args[1] === '+reopen')) {
  writeFileSync(join(__dirname, 'task-write.json'), JSON.stringify({ command: args[1], args }))
  line({ ok: true, identity: 'user', data: { status: 'done', completed_at: '2026-11-28 10:00:00', already_completed: false } })
} else if (args[0] === 'drive' && args[1] === '+search') {
  line({ ok: true, identity: 'user', data: { results: [doc], total: 1, has_more: false, page_token: '' } })
} else if (args[0] === 'drive' && args[1] === 'files') {
  line({ ok: true, identity: 'user', data: { files: [], has_more: false } })
} else if (args[0] === 'docs' && args[1] === '+fetch') {
  const detail = args.includes('with-ids')
  const content = detail
    ? '<fragment><h2 id="blk-1">一、结论</h2><p id="blk-2">正文段落</p></fragment>'
    : '## 一、结论\\n\\n正文段落'
  line({ ok: true, identity: 'user', data: { document: { document_id: 'doc-1', revision_id: 7, content } } })
} else if (args[0] === 'docs' && args[1] === '+update') {
  const chunks = []
  process.stdin.on('data', (chunk) => { chunks.push(chunk) })
  process.stdin.on('end', () => {
    writeFileSync(join(__dirname, 'doc-write.json'), JSON.stringify({
      args,
      stdin: Buffer.concat(chunks).toString('utf8'),
    }))
    line({ ok: true, identity: 'user', data: { document: { revision_id: 8, new_blocks: [] }, result: 'success', updated_blocks_count: 1, warnings: [] } })
  })
} else if (args[0] === 'calendar' && args[1] === '+agenda') {
  line({ ok: true, identity: 'user', data: [], meta: {} })
} else {
  process.stderr.write('unexpected lark-cli arguments: ' + args.join(' ') + '\\n')
  process.exitCode = 1
}
`

// The stand-in runs through its shebang, which Windows cannot execute.
describe.skipIf(process.platform === 'win32')('web e2e: Feishu task and document panels', () => {
  let binDir: string
  let scaffold: WebScaffold
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'dsh-feishu-panels-e2e-'))
    await writeFile(join(binDir, 'lark-cli'), LARK_CLI)
    await chmod(join(binDir, 'lark-cli'), 0o755)
    const overlay = join(binDir, 'bridge.overlay.yml')
    await writeFile(overlay, `- id: feishu-bridge\n  config:\n    binDir: ${JSON.stringify(binDir)}\n`)
    scaffold = await launchWebScaffold({
      extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay],
      profile: {
        packages: [
          { dir: join(PACKAGES, 'feishu-bridge'), enabled: true },
          { dir: join(PACKAGES, 'feishu-calendar'), enabled: true },
          { dir: join(PACKAGES, 'feishu-task'), enabled: true },
          { dir: join(PACKAGES, 'feishu-docs'), enabled: true },
        ],
      },
    })
    browser = await chromium.launch()
    context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (binDir !== undefined) await rm(binDir, { recursive: true, force: true })
  })

  it('lists tasks and records a completion through the bridge', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feishu-task'))
    const nav = page.getByRole('navigation', { name: '全局面板' })
    await nav.getByRole('button', { name: '任务', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: /评审需求/ }).count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await page.getByRole('button', { name: '完成「评审需求」' }).click()
    await expect.poll(async () => readFile(join(binDir, 'task-write.json'), 'utf8').catch(() => ''), { timeout: 20_000 })
      .toContain('+complete')
    expect(tripwire.pageErrors).toEqual([])
  })

  it('lists documents, shows an outline, and appends a paragraph over stdin', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feishu-docs'))
    const nav = page.getByRole('navigation', { name: '全局面板' })
    await nav.getByRole('button', { name: '云文档', exact: true }).click()
    await page.getByRole('button', { name: /季度复盘/ }).click()
    const drawer = page.getByRole('dialog', { name: /季度复盘/ })
    await drawer.waitFor({ timeout: 20_000 })
    expect(await drawer.innerText()).toContain('一、结论')
    await drawer.getByRole('button', { name: '编辑内容' }).click()
    await page.getByRole('button', { name: '追加一段' }).click()
    const field = page.getByRole('textbox', { name: /追加/ }).last()
    await field.fill('补充一句结论')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => readFile(join(binDir, 'doc-write.json'), 'utf8').catch(() => ''), { timeout: 20_000 })
      .toContain('补充一句结论')
    const write = JSON.parse(await readFile(join(binDir, 'doc-write.json'), 'utf8')) as {
      args: string[]
      stdin: string
    }
    expect(write.args).toContain('append')
    expect(write.args).toContain('--revision-id')
    expect(write.stdin).toContain('补充一句结论')
    expect(tripwire.pageErrors).toEqual([])
  })
})
