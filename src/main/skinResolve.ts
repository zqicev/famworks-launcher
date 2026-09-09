import axios from 'axios'
import { store } from './store'

interface Account { id: string; username: string; type: string; uuid?: string }

export interface ResolvedSkin { dataUrl: string; slim: boolean }

/** Скин активного аккаунта для 3D-модели в лаунчере. Источник — Ely.by по нику
 *  (работает и для ely-аккаунтов, и для оффлайн-ников, у кого там есть скин).
 *  Возвращает null, если скина нет — тогда рендер покажет дефолтного Steve. */
export async function getActiveSkin(): Promise<ResolvedSkin | null> {
  const accounts = (store.get('accounts') as Account[] | null) ?? []
  const activeId = store.get('activeAccountId') as string | null
  const acc = accounts.find(a => a.id === activeId) ?? accounts[0]
  const name = acc?.username?.trim()
  if (!name) return null

  const url = `https://skinsystem.ely.by/skins/${encodeURIComponent(name)}.png`
  try {
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: s => s === 200
    })
    const ct = String(resp.headers['content-type'] || '')
    if (!ct.includes('image')) return null
    const b64 = Buffer.from(resp.data).toString('base64')
    return { dataUrl: `data:image/png;base64,${b64}`, slim: false }
  } catch {
    return null // нет скина/сети — не ошибка, просто дефолт
  }
}
