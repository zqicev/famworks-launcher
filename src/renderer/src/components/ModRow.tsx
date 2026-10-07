import { memo, useState } from 'react'
import { Mod } from '../../../types/modpack'
import { modSource, projectUrl } from '../lib/source'
import styles from '../styles/ModRow.module.css'

interface Props {
  mod: Mod
  type: 'mod' | 'resourcepack' | 'shader'
  icon?: string | null
  author?: string | null
  authorAvatar?: string | null         // аватар автора (Modrinth); иначе — кружок с инициалом
  version?: string | null              // версия из архива (фоллбэк к mod.version)
  filename?: string                    // реальное имя файла на диске (у famworks отличается от mod.filename)
  enabled: boolean
  notInstalled?: boolean
  channel?: 'test' | 'release'         // переключатель ветки только для famworks + право тестера
  onChannel?: (mod: Mod, channel: 'test' | 'release') => void
  onToggle: (mod: Mod, enabled: boolean) => void
  onDelete: (mod: Mod) => void
}

const LinkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

function ModRow({ mod, type, icon, author, authorAvatar, version, filename, enabled, notInstalled, channel, onChannel, onToggle, onDelete }: Props) {
  const locked = mod.required || !!notInstalled
  const [broken, setBroken] = useState(false)
  const [avaBroken, setAvaBroken] = useState(false)
  const src = modSource(mod)
  const url = projectUrl(mod, type)
  const projectId = mod.modrinth_id ?? (mod.curseforge_id != null ? String(mod.curseforge_id) : '')
  const file = filename ?? mod.filename
  const ver = (version ?? '').trim()
  const displayAuthor = author || (src === 'local' ? 'Локальный' : src === 'famworks' ? 'FamWorks' : '')

  // Открываем страницу проекта во встроенном браузере лаунчера (не во внешнем).
  const open = (): void => {
    if (!url) return
    window.dispatchEvent(new CustomEvent('fw:open-project', { detail: { source: src, type, id: projectId } }))
  }

  return (
    <div className={`${styles.row} ${!enabled ? styles.disabled : ''}`}>
      <div
        className={`${styles.lead} ${url ? styles.clickable : ''}`}
        onClick={url ? open : undefined}
        role={url ? 'link' : undefined}
        title={url ? 'Открыть страницу проекта в браузере лаунчера' : undefined}
      >
        <div className={styles.avatar} style={{ opacity: enabled ? 1 : 0.4 }}>
          {icon && !broken
            ? <img src={icon} alt="" className={styles.avatarImg} loading="lazy" onError={() => setBroken(true)} />
            : mod.name[0].toUpperCase()}
        </div>
        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{mod.name}</span>
            {mod.required && <span className={styles.req}>обязательный</span>}
            {notInstalled && <span className={styles.pending}>не установлен</span>}
          </div>
          {displayAuthor && (
            <div className={styles.authorRow}>
              {authorAvatar && !avaBroken
                ? <img className={styles.authorAva} src={authorAvatar} alt="" loading="lazy" onError={() => setAvaBroken(true)} />
                : <span className={styles.authorAvaFallback}>{displayAuthor[0].toUpperCase()}</span>}
              <span className={styles.author}>{displayAuthor}</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.mid}>
        {ver && <span className={styles.version}>{ver}</span>}
        <span className={styles.file} title={file}>{file}</span>
      </div>

      <div className={styles.actions}>
        {channel && onChannel && (
          <div className={styles.channel} title="Ветка мода с портала FamWorks">
            {(['release', 'test'] as const).map(ch => (
              <button
                key={ch}
                className={`${styles.channelBtn} ${channel === ch ? styles.channelOn : ''}`}
                onClick={() => channel !== ch && onChannel(mod, ch)}
              >{ch}</button>
            ))}
          </div>
        )}

        {url && (
          <button className={styles.iconBtn} onClick={open} title="Открыть страницу проекта в браузере лаунчера"><LinkIcon /></button>
        )}

        {!mod.required && !notInstalled && (
          <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => onDelete(mod)} title="Удалить"><TrashIcon /></button>
        )}

        <button
          className={`${styles.toggle} ${enabled ? styles.toggleOn : ''} ${locked ? styles.toggleLocked : ''}`}
          onClick={() => !locked && onToggle(mod, !enabled)}
          title={notInstalled ? 'Скачается при установке' : mod.required ? 'Обязательный мод' : enabled ? 'Выключить' : 'Включить'}
        >
          <span className={styles.thumb} />
        </button>
      </div>
    </div>
  )
}

export default memo(ModRow)
