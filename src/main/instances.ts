import { UtilityProcess } from 'electron'
import { spawn } from 'child_process'
import { store } from './store'

// Реестр запущенных экземпляров игры. Экземпляров может быть несколько (одной или разных сборок).
// worker есть у экземпляров, запущенных в ЭТОЙ сессии; null — у «осиротевших» (лаунчер перезапустили,
// а игра ещё жива): их мы восстанавливаем из store по живому pid и убиваем по pid.

export interface RunningInstance {
  instanceId: string
  modpackId: string
  modpackName: string
  account: string        // ник аккаунта, под которым запущен экземпляр (для стоп-списка)
  pid: number
  startedAt: number
  worker: UtilityProcess | null
  userKilled: boolean    // экземпляр закрыл пользователь кнопкой — не показываем диагностику краша
}

/** То, что уходит в рендерер (без worker). */
export interface InstanceInfo {
  instanceId: string
  modpackId: string
  modpackName: string
  account: string
  startedAt: number
}

const instances: RunningInstance[] = []
let listener: (() => void) | null = null

/** Подписка рендерера на изменения списка (для live-обновления кнопок). */
export function onInstancesChange(fn: () => void): void { listener = fn }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function persist(): void {
  store.set('runningInstances', instances.map(i => ({
    instanceId: i.instanceId, modpackId: i.modpackId, modpackName: i.modpackName,
    account: i.account, pid: i.pid, startedAt: i.startedAt
  })))
}

function changed(): void { persist(); listener?.() }

export function addInstance(i: RunningInstance): void { instances.push(i); changed() }

export function removeInstance(instanceId: string): RunningInstance | undefined {
  const idx = instances.findIndex(i => i.instanceId === instanceId)
  if (idx < 0) return undefined
  const [rm] = instances.splice(idx, 1)
  changed()
  return rm
}

export function getInstance(instanceId: string): RunningInstance | undefined {
  return instances.find(i => i.instanceId === instanceId)
}

export function instancesForPack(modpackId: string): RunningInstance[] {
  return instances.filter(i => i.modpackId === modpackId)
}

export function anyInstances(): boolean { return instances.length > 0 }

/** Список для рендерера. Заодно отсеиваем мёртвые «осиротевшие» экземпляры (без worker) по pid. */
export function listInstances(): InstanceInfo[] {
  let pruned = false
  for (let k = instances.length - 1; k >= 0; k--) {
    if (!instances[k].worker && !pidAlive(instances[k].pid)) { instances.splice(k, 1); pruned = true }
  }
  if (pruned) changed()
  return instances.map(i => ({
    instanceId: i.instanceId, modpackId: i.modpackId, modpackName: i.modpackName,
    account: i.account, startedAt: i.startedAt
  }))
}

/** Убивает дерево процессов игры по pid (java + дочерние). */
function killPid(pid: number): void {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
    else process.kill(pid, 'SIGKILL')
  } catch { /* уже мёртв */ }
}

/** Останавливает один экземпляр по instanceId (кнопка «стоп»). Помечает как userKilled,
 *  чтобы не показывать диагностику краша. Для осиротевших (без worker) сразу убираем из реестра. */
export function killInstance(instanceId: string): boolean {
  const inst = getInstance(instanceId)
  if (!inst) return false
  inst.userKilled = true
  killPid(inst.pid)
  if (!inst.worker) removeInstance(instanceId) // осиротевший — события close не будет, чистим сами
  return true
}

/** Восстановление после перезапуска лаунчера: живые из store остаются как осиротевшие, мёртвые — прочь. */
export function reattachInstances(): void {
  const stored = (store.get('runningInstances') as Omit<RunningInstance, 'worker' | 'userKilled'>[] | null) ?? []
  instances.length = 0
  for (const s of stored) {
    if (pidAlive(s.pid)) instances.push({ ...s, worker: null, userKilled: false })
  }
  persist()
}
