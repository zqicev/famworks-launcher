import { Client, ILauncherOptions } from 'minecraft-launcher-core'

// Дочерний процесс: гоняет mclc-загрузку и запуск игры. Родитель может его убить,
// чтобы прервать скачивание ассетов Minecraft (у mclc нет своего API отмены).

const parentPort = (process as unknown as { parentPort: {
  on: (ev: string, cb: (e: { data: any }) => void) => void
  postMessage: (msg: any) => void
} }).parentPort

const PROGRESS_LABELS: Record<string, string> = {
  assets: 'Скачивание ресурсов',
  'assets-copy': 'Копирование ресурсов',
  natives: 'Нативные библиотеки',
  classes: 'Библиотеки',
  'classes-custom': 'Библиотеки Fabric',
  'classes-maven-custom': 'Библиотеки Fabric',
  'version-jar': 'Клиент Minecraft'
}

function send(msg: any) { parentPort.postMessage(msg) }
function progress(p: any) { send({ t: 'win', channel: 'install:progress', payload: p }) }

parentPort.on('message', async (e) => {
  const msg = e.data
  if (msg?.type !== 'launch') return
  const options = msg.options as ILauncherOptions

  const client = new Client()
  let currentLabel = 'Загрузка файлов'
  let lastTime = Date.now()
  let lastBytes = 0
  let lastSpeed = 0

  client.on('progress', (e2: any) => {
    currentLabel = PROGRESS_LABELS[e2.type] ?? e2.type
    progress({ phase: 'download', message: currentLabel, current: e2.task, total: e2.total })
  })

  client.on('download-status', (d: any) => {
    const now = Date.now()
    if (d.current < lastBytes) { lastBytes = 0; lastTime = now }
    const elapsed = (now - lastTime) / 1000
    if (elapsed >= 0.4) { lastSpeed = Math.max(0, (d.current - lastBytes) / elapsed); lastTime = now; lastBytes = d.current }
    const big = d.total > 1024 * 1024
    progress({
      phase: 'download', message: currentLabel,
      bytesDownloaded: big ? d.current : undefined,
      bytesTotal: big ? d.total : undefined,
      speedBps: big && lastSpeed > 0 ? lastSpeed : undefined
    })
  })

  let logTail = ''
  client.on('data', (data: any) => {
    const s = String(data)
    logTail = (logTail + s).slice(-8000) // храним хвост вывода на случай падения
    send({ t: 'win', channel: 'launch:log', payload: s })
  })
  client.on('close', (code: number) => { send({ t: 'close', code, tail: logTail }); process.exit(0) })

  try {
    const proc = await client.launch(options)
    send({ t: 'spawned', pid: (proc as { pid?: number } | undefined)?.pid ?? null })
  } catch (err: any) {
    send({ t: 'error', message: String(err?.message ?? err) })
    process.exit(1)
  }
})
