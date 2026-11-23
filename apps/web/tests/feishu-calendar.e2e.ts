// Feishu calendar panel through the real Host and browser composition.
// A stand-in lark-cli answers status, agenda, and detail, and records the create body.
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const CALENDAR_DIR = fileURLToPath(new URL('../../../packages/connector/feishu-calendar', import.meta.url))

// One all-day event on the tenth of the month the browser shows, so the grid always holds it.
const now = new Date()
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const DAY = `${MONTH}-10`

// The stand-in keeps the create request body beside itself, which the scenario reads back.
const LARK_CLI = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const line = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const event = {
  event_id: 'event-1',
  summary: '设计评审',
  status: 'confirmed',
  is_exception: false,
  app_link: 'https://applink.feishu.cn/client/calendar/event/detail?event=event-1',
  start_time: { date: '${DAY}', timezone: 'Asia/Shanghai' },
  end_time: { date: '${DAY}', timezone: 'Asia/Shanghai' },
}
if (args[0] === 'auth' && args[1] === 'status') {
  line({ appId: 'cli_e2e', identities: { user: {
    status: 'ready', available: true, userName: '测试用户', openId: 'ou_e2e',
    scope: 'calendar:calendar.event:read calendar:calendar:read',
  } } })
} else if (args[0] === 'calendar' && args[1] === '+agenda') {
  line({ ok: true, identity: 'user', data: [event], meta: { count: 1 } })
} else if (args[0] === 'calendar' && args[1] === '+get') {
  line({ ok: true, identity: 'user', data: { ...event, event_organizer: { display_name: '测试用户' }, description: '来自替身 CLI 的详情' } })
} else if (args[0] === 'calendar' && args[1] === 'events' && args[2] === 'create') {
  const chunks = []
  process.stdin.on('data', (chunk) => { chunks.push(chunk) })
  process.stdin.on('end', () => {
    writeFileSync(join(__dirname, 'created.json'), Buffer.concat(chunks).toString('utf8'))
    line({ ok: true, identity: 'user', data: { event: { event_id: 'created-1' } } })
  })
} else {
  process.stderr.write('unexpected lark-cli arguments: ' + args.join(' ') + '\\n')
  process.exitCode = 1
}
`

// The stand-in runs through its shebang, which Windows cannot execute.
describe.skipIf(process.platform === 'win32')('web e2e: Feishu calendar panel', () => {
  let binDir: string
  let scaffold: WebScaffold
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'dsh-feishu-calendar-e2e-'))
    await writeFile(join(binDir, 'lark-cli'), LARK_CLI)
    await chmod(join(binDir, 'lark-cli'), 0o755)
    const overlay = join(binDir, 'calendar.overlay.yml')
    await writeFile(overlay, `- id: feishu-calendar\n  config:\n    binDir: ${JSON.stringify(binDir)}\n`)
    scaffold = await launchWebScaffold({
      extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay],
      profile: { packages: [{ dir: CALENDAR_DIR, enabled: true }] },
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

  it('opens the grid, reads a detail, and creates an event without a meeting', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feishu-calendar'))
    await page.getByRole('navigation', { name: '全局面板' }).getByRole('button', { name: '日历', exact: true }).click()
    await expect.poll(() => page.locator('[role="gridcell"]').count(), { timeout: 20_000 }).toBe(42)
    await page.getByRole('button', { name: /设计评审/ }).click()
    const detail = page.getByRole('dialog', { name: '设计评审' })
    await detail.waitFor({ timeout: 20_000 })
    expect(await detail.innerText()).toContain('Asia/Shanghai')
    expect(await detail.innerText()).toContain('测试用户')
    expect(await detail.innerText()).toContain('来自替身 CLI 的详情')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)

    await page.getByRole('button', { name: '新建日程', exact: true }).click()
    const form = page.getByRole('dialog', { name: '新建日程' })
    await form.getByRole('textbox', { name: '标题' }).fill('面板新建')
    await form.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => {
      const body = await readFile(join(binDir, 'created.json'), 'utf8').catch(() => '')
      return body
    }, { timeout: 20_000 }).toContain('面板新建')
    const body = JSON.parse(await readFile(join(binDir, 'created.json'), 'utf8')) as Record<string, unknown>
    expect(body).toMatchObject({ summary: '面板新建' })
    expect(body).not.toHaveProperty('vchat')
    expect(body).not.toHaveProperty('reminders')
    await page.getByText('面板新建', { exact: true }).first().waitFor({ timeout: 20_000 })
    expect(tripwire.pageErrors).toEqual([])
  })
})
