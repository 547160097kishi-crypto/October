/**
 * 无头 Chrome 驱动（CDP / ws），给开发期做交互验证用。
 *
 * 用法：
 *   node scripts/dev-browser.mjs <scenario.mjs> [url]
 *
 * scenario.mjs 默认导出一个 async ({ page, wait, shot, log }) => {...}
 *   page.eval(js)  -> 在页面里执行表达式/函数体，返回可序列化结果
 *   page.goto(url) -> 导航
 *   shot(name)     -> 存到 analysis/screenshots/<name>.png
 *   wait(ms)       -> 真实等待
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
]
const PORT = 9333
const SHOT_DIR = path.resolve('analysis/screenshots')

const { existsSync } = await import('node:fs')

const scenarioPath = process.argv[2]
const url = process.argv[3] || 'http://localhost:3000/'
if (!scenarioPath) {
  console.error('用法: node scripts/dev-browser.mjs <scenario.mjs> [url]')
  process.exit(1)
}
mkdirSync(SHOT_DIR, { recursive: true })

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) throw new Error('未找到 Chrome/Edge')
const userDataDir = mkdtempSync(path.join(tmpdir(), 'wb-cdp-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* 等浏览器起来 */
    }
    await sleep(250)
  }
  throw new Error('CDP 未就绪')
}

const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 128 * 1024 * 1024 })
await new Promise((res, rej) => {
  ws.once('open', res)
  ws.once('error', rej)
})

let msgId = 0
const pending = new Map()
const events = []
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  } else if (msg.method) {
    events.push(msg)
  }
})

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

const logs = []
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || [])
      .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
      .join(' ')
    logs.push(`[${msg.params.type}] ${text}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    logs.push(`[exception] ${d.exception?.description || d.text}`)
  } else if (msg.method === 'Log.entryAdded') {
    logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`)
  }
})

const page = {
  async goto(u) {
    await send('Page.navigate', { url: u })
    await sleep(1200)
  },
  async eval(expression) {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
    }
    return res.result?.value
  }
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(SHOT_DIR, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

const wait = sleep
const log = (...a) => console.log(...a)

try {
  await page.goto(url)
  const scenario = (await import(pathToFileURL(path.resolve(scenarioPath)).href)).default
  await scenario({ page, wait, shot, log })
} catch (err) {
  console.error('SCENARIO FAILED:', err.message)
  process.exitCode = 1
} finally {
  if (logs.length) {
    console.log('\n--- console ---')
    for (const l of logs.slice(-40)) console.log(l)
  }
  ws.close()
  chrome.kill()
  await sleep(300)
}
