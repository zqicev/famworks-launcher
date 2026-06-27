import axios, { AxiosInstance } from 'axios'
import { store } from './store'

const API = 'https://api.github.com'

function client(): AxiosInstance {
  const token = store.get('token') as string
  return axios.create({
    baseURL: API,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'famworks-editor'
    },
    timeout: 20000
  })
}

function repoPath(): { owner: string; repo: string; branch: string } {
  return {
    owner: store.get('owner') as string,
    repo: store.get('repo') as string,
    branch: store.get('branch') as string
  }
}

/** Проверка токена — возвращает логин пользователя или кидает. */
export async function validateToken(): Promise<{ login: string }> {
  const res = await client().get('/user')
  return { login: res.data.login }
}

/** Читает файл из репо. Возвращает текст + sha (или null если файла нет). */
export async function getFile(path: string): Promise<{ content: string; sha: string } | null> {
  const { owner, repo, branch } = repoPath()
  try {
    const res = await client().get(`/repos/${owner}/${repo}/contents/${path}`, {
      params: { ref: branch }
    })
    const content = Buffer.from(res.data.content, 'base64').toString('utf8')
    return { content, sha: res.data.sha }
  } catch (e: any) {
    if (e?.response?.status === 404) return null
    throw new Error(githubError(e, `чтение ${path}`))
  }
}

/** Создаёт или обновляет файл (коммит). sha обязателен при обновлении существующего. */
export async function putFile(path: string, content: string, message: string, sha: string | null): Promise<string> {
  const { owner, repo, branch } = repoPath()
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  }
  if (sha) body.sha = sha
  try {
    const res = await client().put(`/repos/${owner}/${repo}/contents/${path}`, body)
    return res.data.content.sha
  } catch (e: any) {
    throw new Error(githubError(e, `сохранение ${path}`))
  }
}

/** Удаляет файл (коммит). */
export async function deleteFile(path: string, message: string, sha: string): Promise<void> {
  const { owner, repo, branch } = repoPath()
  try {
    await client().delete(`/repos/${owner}/${repo}/contents/${path}`, {
      data: { message, sha, branch }
    })
  } catch (e: any) {
    throw new Error(githubError(e, `удаление ${path}`))
  }
}

interface ReleaseAsset {
  id: number
  name: string
  browser_download_url: string
}
interface Release {
  id: number
  upload_url: string
  assets: ReleaseAsset[]
}

/** Находит релиз по тегу, создаёт если нет. */
export async function ensureRelease(tag: string): Promise<Release> {
  const { owner, repo } = repoPath()
  try {
    const res = await client().get(`/repos/${owner}/${repo}/releases/tags/${tag}`)
    return res.data
  } catch (e: any) {
    if (e?.response?.status !== 404) throw new Error(githubError(e, `поиск релиза ${tag}`))
  }
  // Создаём релиз
  try {
    const res = await client().post(`/repos/${owner}/${repo}/releases`, {
      tag_name: tag,
      name: 'Кастомные моды',
      body: 'Хостинг кастомных .jar для сборок FamWorks.'
    })
    return res.data
  } catch (e: any) {
    throw new Error(githubError(e, `создание релиза ${tag}`))
  }
}

/** Загружает файл-ассет в релиз. Если ассет с таким именем есть — заменяет. */
export async function uploadAsset(
  release: Release,
  filename: string,
  data: Buffer
): Promise<string> {
  const { owner, repo } = repoPath()
  const token = store.get('token') as string

  // Удаляем существующий ассет с тем же именем (GitHub не даёт дубликаты)
  const existing = release.assets.find(a => a.name === filename)
  if (existing) {
    await client().delete(`/repos/${owner}/${repo}/releases/assets/${existing.id}`).catch(() => {})
  }

  // upload_url вида: https://uploads.github.com/.../assets{?name,label}
  const uploadBase = release.upload_url.replace(/\{.*\}$/, '')
  try {
    const res = await axios.post(`${uploadBase}?name=${encodeURIComponent(filename)}`, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/java-archive',
        'User-Agent': 'famworks-editor'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })
    return res.data.browser_download_url
  } catch (e: any) {
    throw new Error(githubError(e, `загрузка ${filename}`))
  }
}

function githubError(e: any, action: string): string {
  const status = e?.response?.status
  const msg = e?.response?.data?.message
  if (status === 401) return `Неверный или истёкший токен (${action})`
  if (status === 403) return `Нет прав на ${action}. Проверь scope токена (Contents: write)`
  if (status === 409) return `Конфликт версий при ${action} — обнови данные и повтори`
  if (status === 422) return `Ошибка данных при ${action}: ${msg ?? ''}`
  return `Ошибка GitHub при ${action}: ${msg ?? e?.message ?? status}`
}
