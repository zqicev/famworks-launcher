import RPC from 'discord-rpc'
import { store } from './store'

// Client ID Discord-приложения (Developer Portal → New Application → Application ID).
// Пустая строка = Rich Presence выключен.
const CLIENT_ID = '1520764701703798944'

let client: RPC.Client | null = null
let ready = false
const startTimestamp = Date.now()

export function initDiscord(): void {
  if (!CLIENT_ID) return
  try {
    client = new RPC.Client({ transport: 'ipc' })
    client.on('ready', () => { ready = true; restoreStatus() })
    client.login({ clientId: CLIENT_ID }).catch(() => {})
  } catch { /* Discord не запущен — игнорируем */ }
}

function setActivity(details: string, state: string): void {
  if (!client || !ready) return
  client.setActivity({
    details,
    state,
    startTimestamp,
    largeImageKey: 'logo',
    largeImageText: 'FamWorks',
    instance: false
  }).catch(() => {})
}

/** При старте: если какой-то экземпляр ещё жив (лаунчер перезапустили) — показываем «Играет». */
function restoreStatus(): void {
  const insts = (store.get('runningInstances') as { pid: number; modpackName: string }[] | null) ?? []
  const alive = insts.find(i => { try { process.kill(i.pid, 0); return true } catch { return false } })
  if (alive) setPlaying(alive.modpackName)
  else setIdle()
}

export function setIdle(): void {
  setActivity('В лаунчере', 'Выбирает сборку')
}

export function setPlaying(modpackName: string): void {
  setActivity('Играет', modpackName)
}
