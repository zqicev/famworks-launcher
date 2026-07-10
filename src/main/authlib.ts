import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import axios from 'axios'
import { BrowserWindow } from 'electron'

// authlib-injector: JVM-агент, подменяющий Mojang-серверы авторизации/скинов на сторонние (Ely.by).
async function fetchAuthlibUrl(): Promise<string> {
  try {
    const { data } = await axios.get('https://authlib-injector.yushi.moe/artifact/latest.json', { timeout: 10000 })
    if (data?.download_url) return data.download_url as string
  } catch { /* фолбэк на GitHub */ }
  const { data } = await axios.get('https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest', {
    timeout: 10000, headers: { 'User-Agent': 'famworks-launcher' }
  })
  const asset = (data.assets || []).find((a: { name: string }) => /^authlib-injector-.*\.jar$/.test(a.name))
  if (!asset) throw new Error('Не найден authlib-injector в релизах')
  return asset.browser_download_url
}

/** Гарантирует наличие authlib-injector.jar в runtime; качает один раз. Возвращает путь. */
export async function ensureAuthlibInjector(installPath: string, win: BrowserWindow): Promise<string> {
  const dest = join(installPath, 'runtime', 'authlib-injector.jar')
  if (existsSync(dest)) return dest
  win.webContents.send('install:progress', { phase: 'download', message: 'Загрузка authlib-injector…' })
  const url = await fetchAuthlibUrl()
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxRedirects: 5 })
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, Buffer.from(res.data))
  return dest
}
