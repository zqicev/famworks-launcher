import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync, writeFileSync } from 'fs'
import { BrowserWindow } from 'electron'
import { Modpack } from '../types/modpack'
import { getModVersions } from './modrinth'
import { downloadModToDir } from './installer'

// Скины офлайн-игроков по нику: клиентский мод CustomSkinLoader тянет скины из
// TLauncher / Ely.by / Mojang (это его встроенные источники) по имени игрока.
const CSL_PROJECT = 'customskinloader' // slug на Modrinth
const MARKER = '.fwskins' // помечает, что CSL добавили мы (чтобы не трогать «родной» CSL сборки)

function emit(win: BrowserWindow, text: string): void {
  win.webContents.send('install:progress', { phase: 'download', message: text })
}

/** Синхронизирует наличие CustomSkinLoader в модах сборки под нужное состояние (вкл/выкл). */
export async function ensureSkinMod(modpack: Modpack, gameRoot: string, enabled: boolean, win: BrowserWindow): Promise<void> {
  const modsDir = join(gameRoot, 'mods')
  const markerPath = join(gameRoot, MARKER)
  const injected = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : ''

  if (!enabled) {
    // Убираем только то, что добавляли сами
    if (injected) {
      try { unlinkSync(join(modsDir, injected)) } catch { /* уже нет */ }
      try { unlinkSync(markerPath) } catch { /* ignore */ }
    }
    return
  }

  // Уже стоит (наш или из сборки) — ничего не делаем
  if (injected && existsSync(join(modsDir, injected))) return
  if (existsSync(modsDir) && readdirSync(modsDir).some(f => /customskinloader/i.test(f))) return

  emit(win, 'Загрузка скинов (CustomSkinLoader)…')
  const versions = (await getModVersions(CSL_PROJECT, modpack.mc_version, modpack.loader, 'mod')) as any[]
  if (!versions.length) {
    win.webContents.send('launch:log', { id: modpack.id, text: `[skins] нет версии CustomSkinLoader под ${modpack.loader} ${modpack.mc_version}` })
    return
  }
  const v = versions[0]
  const file = (v.files ?? []).find((f: any) => f.primary) ?? v.files?.[0]
  if (!file) return
  mkdirSync(modsDir, { recursive: true })
  await downloadModToDir(file.url, file.filename, modsDir, win, file.hashes?.sha512)
  writeFileSync(markerPath, file.filename)
}
