import axios from 'axios'
import { store } from './store'

interface Account { id: string; username: string; type: string; uuid?: string }

export interface ResolvedSkin { dataUrl: string; slim: boolean }

// Скачивает PNG по URL и заворачивает в data-URL. null при любой ошибке/не-картинке.
async function fetchPng(url: string): Promise<string | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: s => s === 200
    })
    if (!String(resp.headers['content-type'] || '').includes('image')) return null
    return `data:image/png;base64,${Buffer.from(resp.data).toString('base64')}`
  } catch {
    return null
  }
}

// Лицензионный скин с серверов сессий Mojang по UUID (для microsoft-аккаунтов).
// Профиль отдаёт base64-JSON в properties[textures] → textures.SKIN.url (+ model=slim).
async function mojangSkin(uuid: string): Promise<ResolvedSkin | null> {
  const id = uuid.replace(/-/g, '')
  try {
    const prof = await axios.get<{ properties?: { name: string; value: string }[] }>(
      `https://sessionserver.mojang.com/session/minecraft/profile/${id}`,
      { timeout: 8000, validateStatus: s => s === 200 }
    )
    const tex = prof.data.properties?.find(p => p.name === 'textures')
    if (!tex) return null
    const decoded = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8')) as {
      textures?: { SKIN?: { url: string; metadata?: { model?: string } } }
    }
    const skin = decoded.textures?.SKIN
    if (!skin?.url) return null
    const dataUrl = await fetchPng(skin.url)
    return dataUrl ? { dataUrl, slim: skin.metadata?.model === 'slim' } : null
  } catch {
    return null
  }
}

// Скин по нику из Ely.by (для ely-аккаунтов и оффлайн-ников, у кого там есть скин).
async function elySkin(name: string): Promise<ResolvedSkin | null> {
  const dataUrl = await fetchPng(`https://skinsystem.ely.by/skins/${encodeURIComponent(name)}.png`)
  return dataUrl ? { dataUrl, slim: false } : null
}

/** Скин активного аккаунта для 3D-модели в лаунчере.
 *  - microsoft: настоящий лицензионный скин с серверов Mojang по UUID;
 *  - ely / оффлайн: по нику из Ely.by.
 *  null → рендер покажет дефолтного Steve. */
export async function getActiveSkin(): Promise<ResolvedSkin | null> {
  const accounts = (store.get('accounts') as Account[] | null) ?? []
  const activeId = store.get('activeAccountId') as string | null
  const acc = accounts.find(a => a.id === activeId) ?? accounts[0]
  if (!acc) return null

  // Лицензия: только Mojang по UUID. При недоступности — дефолт, а НЕ чужой скин с Ely.by по нику.
  if (acc.type === 'microsoft' && acc.uuid) return mojangSkin(acc.uuid)

  const name = acc.username?.trim()
  return name ? elySkin(name) : null
}
