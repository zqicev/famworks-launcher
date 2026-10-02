import { execFile } from 'child_process'
import { statfsSync } from 'fs'
import { totalmem } from 'os'
import { join } from 'path'
import { BrowserWindow, dialog, shell } from 'electron'
import type { MemoryHealth, PagefileInfo } from '../types/system'

// Почему это важно: Windows выдаёт программам память только в пределах «RAM + файл подкачки»
// (commit limit). Когда он исчерпан, JVM падает с «insufficient memory» / «Unable to allocate texture»,
// даже если физическая RAM ещё свободна. Автоматическая подкачка растёт сама, но только пока есть
// место на её диске - на забитом диске C игра вылетает при 16 ГБ RAM и любом -Xmx.

const MIN_PAGEFILE_MB = 4096      // меньше - считаем подкачку фактически отсутствующей
const NATIVE_OVERHEAD_MB = 2048   // сверх -Xmx: текстуры, драйвер видеокарты, Distant Horizons и т.п.
const CACHE_MS = 30_000

const PS_SCRIPT = `
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$u = @(Get-CimInstance Win32_PageFileUsage | ForEach-Object { @{ name = $_.Name; mb = [int]$_.AllocatedBaseSize } })
$s = @(); try { $s = @(Get-CimInstance Win32_PageFileSetting | ForEach-Object { @{ name = $_.Name; max = [int]$_.MaximumSize } }) } catch {}
@{ limitKb = [long]$os.TotalVirtualMemorySize; freeKb = [long]$os.FreeVirtualMemory; auto = [bool]$cs.AutomaticManagedPagefile; usage = $u; settings = $s } | ConvertTo-Json -Compress -Depth 4
`

interface RawInfo {
  limitKb: number
  freeKb: number
  auto: boolean
  usage: { name: string; mb: number }[]
  settings: { name: string; max: number }[]
}

function queryRaw(): Promise<RawInfo> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err)
        try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
      })
  })
}

function driveSpace(drive: string): { freeMb: number; totalMb: number } {
  try {
    const s = statfsSync(drive + '/')
    return { freeMb: Math.floor((s.bavail * s.bsize) / 1048576), totalMb: Math.floor((s.blocks * s.bsize) / 1048576) }
  } catch {
    return { freeMb: 0, totalMb: 0 }
  }
}

function analyze(raw: RawInfo): MemoryHealth {
  const ramMb = Math.round(totalmem() / 1048576)
  const usage = [...(raw.usage ?? [])]
  const settings = raw.settings ?? []

  // Автоматическая подкачка без файла (редко) - Windows создаст его на системном диске.
  if (!usage.length && raw.auto) usage.push({ name: `${process.env.SystemDrive ?? 'C:'}\\pagefile.sys`, mb: 0 })

  const pagefiles: PagefileInfo[] = usage.map(u => {
    const drive = u.name.slice(0, 2).toUpperCase()
    const { freeMb, totalMb } = driveSpace(drive)
    const setting = settings.find(s => s.name.toLowerCase() === u.name.toLowerCase())
    const systemManaged = raw.auto || !setting || setting.max === 0
    // Системная подкачка: максимум 3×RAM или 4 ГБ, но не больше 1/8 тома, и не ближе 1 ГБ к концу диска.
    const maxMb = systemManaged ? Math.min(Math.max(3 * ramMb, 4096), totalMb / 8) : setting!.max
    const growMb = Math.max(0, Math.floor(Math.min(maxMb - u.mb, freeMb - 1024)))
    return { path: u.name, drive, currentMb: u.mb, growMb, systemManaged, driveFreeMb: freeMb }
  })

  const growthMb = pagefiles.reduce((a, p) => a + p.growMb, 0)
  const potentialPagefileMb = pagefiles.reduce((a, p) => a + p.currentMb + p.growMb, 0)
  const health: MemoryHealth = {
    totalRamMb: ramMb,
    commitLimitMb: Math.round(raw.limitKb / 1024),
    commitFreeMb: Math.round(raw.freeKb / 1024),
    growthMb,
    pagefileAuto: raw.auto,
    pagefiles,
    potentialPagefileMb
  }

  if (!pagefiles.length) {
    health.issue = 'pagefile-off'
  } else if (potentialPagefileMb < MIN_PAGEFILE_MB) {
    const sm = pagefiles.find(p => p.systemManaged)
    if (sm) {
      health.issue = 'disk-low'
      health.issueDrive = sm.drive
      health.issueDriveFreeMb = sm.driveFreeMb
    } else {
      health.issue = 'pagefile-small'
    }
  }
  return health
}

let cache: { at: number; value: MemoryHealth | null } | null = null
let inflight: Promise<MemoryHealth | null> | null = null

/** Состояние памяти/подкачки. null - не Windows или запрос не удался (тогда ничего не проверяем). */
export async function getMemoryHealth(maxAgeMs = CACHE_MS): Promise<MemoryHealth | null> {
  if (process.platform !== 'win32') return null
  if (cache && Date.now() - cache.at <= maxAgeMs) return cache.value
  if (!inflight) {
    inflight = queryRaw()
      .then(analyze)
      .catch(() => null)
      .then(value => { cache = { at: Date.now(), value }; inflight = null; return value })
  }
  return inflight
}

const gb = (mb: number): string => (mb % 1024 === 0 ? String(mb / 1024) : (mb / 1024).toFixed(1))

/** Перед запуском: хватит ли Windows памяти на игру с таким -Xmx. false - пользователь отменил запуск. */
export async function confirmLaunchMemory(win: BrowserWindow, memoryMb: number): Promise<boolean> {
  const h = await getMemoryHealth(0)
  if (!h) return true
  const availableMb = h.commitFreeMb + h.growthMb
  if (availableMb >= memoryMb + NATIVE_OVERHEAD_MB) return true

  const parts = [
    `Сборке выделено ${gb(memoryMb)} ГБ, и ещё около ${gb(NATIVE_OVERHEAD_MB)} ГБ игре нужно на текстуры и драйвер видеокарты. Скорее всего, игра вылетит при загрузке или во время игры.`
  ]
  if (h.issue === 'disk-low') {
    parts.push(`На диске ${h.issueDrive} свободно всего ${gb(h.issueDriveFreeMb ?? 0)} ГБ - Windows не может увеличить файл подкачки. Освободите на нём хотя бы 10 ГБ.`)
  } else if (h.issue === 'pagefile-off' || h.issue === 'pagefile-small') {
    parts.push(`Файл подкачки ${h.issue === 'pagefile-off' ? 'отключён' : `ограничен ${gb(h.potentialPagefileMb)} ГБ`} - включите автоматический размер: «Параметры быстродействия» → «Дополнительно» → «Изменить».`)
  }
  parts.push('Закройте браузер и другие тяжёлые программы или уменьшите память сборки.')

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Мало памяти',
    message: `Windows сейчас может выделить игре только ${gb(availableMb)} ГБ`,
    detail: parts.join('\n\n'),
    buttons: ['Отмена', 'Запустить всё равно'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}

/** Открывает системные настройки: окно файла подкачки или очистку диска. */
export async function openMemorySettings(kind: 'pagefile' | 'storage'): Promise<void> {
  if (process.platform !== 'win32') return
  if (kind === 'storage') {
    await shell.openExternal('ms-settings:storagesense')
    return
  }
  // Через ShellExecute, не spawn: окну нужны права администратора (spawn падает с EACCES), UAC поднимет Windows.
  await shell.openPath(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'SystemPropertiesPerformance.exe'))
}
