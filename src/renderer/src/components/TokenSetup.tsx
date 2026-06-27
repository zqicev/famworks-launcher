import { useState } from 'react'
import styles from '../styles/TokenSetup.module.css'

interface Props { onOk: (login: string) => void }

export default function TokenSetup({ onOk }: Props) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!token.trim()) return
    setBusy(true); setError('')
    await window.api.cfg.set('token', token.trim())
    const res = await window.api.cfg.validateToken()
    setBusy(false)
    if (res.ok) onOk(res.login ?? '')
    else setError(res.error ?? 'Не удалось проверить токен')
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>Редактор сборок</h1>
        <p className={styles.desc}>
          Вставь GitHub-токен с доступом <b>Contents: Read and write</b> к репозиторию
          <b> famworks-builds</b>. Токен хранится только на этом компьютере.
        </p>
        <input
          className={styles.input}
          type="password"
          placeholder="github_pat_..."
          value={token}
          onChange={e => { setToken(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus
        />
        {error && <div className={styles.error}>{error}</div>}
        <button className={styles.btn} onClick={submit} disabled={busy || !token.trim()}>
          {busy ? 'Проверка…' : 'Войти'}
        </button>
        <a className={styles.link} href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
          Создать токен →
        </a>
      </div>
    </div>
  )
}
