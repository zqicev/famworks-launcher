import { useState, useEffect } from 'react'
import { ModpackIndex, Modpack, ModpackSummary } from '../../../types/modpack'
import AccountPanel from './AccountPanel'
import styles from '../styles/Sidebar.module.css'

interface Props {
  index: ModpackIndex | null
  customPacks: Modpack[]
  selectedId: string | null
  seenUpdates: Record<string, string>
  onSelect: (id: string) => void
  onSettings: () => void
  onRefresh: () => void
  onCreate: () => void
  onDeleteCustom: (id: string) => void
  onImport: () => void
  onExport: (id: string) => void
  browserActive: boolean
  onOpenBrowser: () => void
}

const BrowserIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const ImportIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
const ExportIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)
const ImageIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
  </svg>
)

const DropdownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="12" height="12" viewBox="-6.5 -3 32 32" version="1.1">
    <path d="M18.813 11.406l-7.906 9.906c-0.75 0.906-1.906 0.906-2.625 0l-7.906-9.906c-0.75-0.938-0.375-1.656 0.781-1.656h16.875c1.188 0 1.531 0.719 0.781 1.656z"/>
  </svg>
)

export default function Sidebar({ index, customPacks, selectedId, seenUpdates, onSelect, onSettings, onRefresh, onCreate, onDeleteCustom, onImport, onExport, browserActive, onOpenBrowser }: Props) {
  const [version, setVersion] = useState('')
  const [icons, setIcons] = useState<Record<string, string>>({})
  useEffect(() => { window.api.appVersion().then(setVersion).catch(() => {}) }, [])
  useEffect(() => { window.api.packIcon.all().then(setIcons).catch(() => {}) }, [])

  const [showMapPacks, setShowMapPacks] = useState<boolean>(false);

  const setPackIcon = async (id: string): Promise<void> => {
    const r = await window.api.packIcon.pick(id).catch(() => null)
    if (r?.filename) setIcons(prev => ({ ...prev, [id]: r.filename! }))
  }

  const Avatar = ({ name, active, icon }: { name: string; active: boolean; icon?: string }): JSX.Element =>
    icon ? (
      <div className={styles.avatar}>
        <img className={styles.avatarImg} src={`fwbg://icon/${icon}`} alt="" />
      </div>
    ) : (
      <div className={styles.avatar} style={{ background: active ? 'var(--accent)' : 'var(--bg-active)' }}>
        <span style={{ color: active ? '#0a0a0a' : 'var(--text)' }}>{(name[0] ?? '?').toUpperCase()}</span>
      </div>
    )

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoRow}>
        <div className={styles.logo}>
          <span className={styles.logoF}>FAM</span>
          <span className={styles.logoW}>WORKS</span>
          {version && <span className={styles.version}>v{version}</span>}
        </div>
        <div className={styles.logoActions}>
          <button className={styles.iconBtn} onClick={onRefresh} title="Обновить список сборок">↻</button>
          <button className={styles.iconBtn} onClick={onSettings} title="Настройки">⚙</button>
        </div>
      </div>

      <div className={styles.scroll}>
        <div className={styles.navBlock}>
          <button className={`${styles.navBtn} ${browserActive ? styles.navActive : ''}`} onClick={onOpenBrowser} title="Поиск и установка контента">
            <span className={styles.navIcon}><BrowserIcon /></span>
            <div className={styles.navText}>
              <div className={styles.navTitle}>Браузер</div>
              <div className={styles.navSub}>Моды, паки, сборки</div>
            </div>
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>СБОРКИ</span>
            <span className={styles.count}>{index?.modpacks.filter((mpack) => !mpack.for_map).length ?? 0}</span>
          </div>
          <div className={`${styles.list} fw-stagger`}>
            {index?.modpacks.filter((mpack) => !mpack.for_map).map((pack) => {
              const hasUpdate = seenUpdates[pack.id] && seenUpdates[pack.id] !== pack.updated_at
              const active = selectedId === pack.id
              return (
                <button key={pack.id} className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => onSelect(pack.id)}>
                  <Avatar name={pack.name} active={active} icon={icons[pack.id]} />
                  <div className={styles.info}>
                    <div className={styles.name}>{pack.name}{hasUpdate && <span className={styles.updateBadge}>ОБНОВЛЕНО</span>}</div>
                    <div className={styles.meta}>{pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}</div>
                  </div>
                  <div className={styles.itemActions}>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); setPackIcon(pack.id) }} title="Сменить картинку сборки"><ImageIcon /></button>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); onExport(pack.id) }} title="Экспорт сборки в .fwpack"><ExportIcon /></button>
                  </div>
                  <div className={`${styles.dot} ${active ? styles.dotActive : ''}`} />
                </button>
              )
            })}
          </div>
        </div>

        {(index?.modpacks.filter((mpack) => mpack.for_map).length || 0 > 0) &&
          <div className={styles.section}>
            <div
              className={`${styles.sectionHeaderDropdown} ${showMapPacks && styles.dropdownActive}`}
              onClick={() => setShowMapPacks(!showMapPacks)}
            >
              <span>СБОРКИ ДЛЯ КАРТ</span>
              <span className={styles.dropdownWrap}>
                <span className={styles.count}>{index?.modpacks.filter((mpack) => mpack.for_map).length ?? 0}</span>
                <span className={styles.dropdownArrow}>
                  <DropdownIcon />
                </span>
              </span>
            </div>
            {showMapPacks && <div className={`${styles.list} fw-stagger`}>
              {index?.modpacks.filter((mpack) => mpack.for_map).map((pack) => {
                const hasUpdate = seenUpdates[pack.id] && seenUpdates[pack.id] !== pack.updated_at
                const active = selectedId === pack.id
                return (
                  <button key={pack.id} className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => onSelect(pack.id)}>
                    <Avatar name={pack.name} active={active} icon={icons[pack.id]} />
                    <div className={styles.info}>
                      <div className={styles.name}>{pack.name}{hasUpdate && <span className={styles.updateBadge}>ОБНОВЛЕНО</span>}</div>
                      <div className={styles.meta}>{pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}</div>
                    </div>
                    <div className={styles.itemActions}>
                      <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); setPackIcon(pack.id) }} title="Сменить картинку сборки"><ImageIcon /></button>
                      <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); onExport(pack.id) }} title="Экспорт сборки в .fwpack"><ExportIcon /></button>
                    </div>
                    <div className={`${styles.dot} ${active ? styles.dotActive : ''}`} />
                  </button>
                )
              })}
            </div>}
          </div>
        }

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>МОИ СБОРКИ</span>
            <div className={styles.headerActions}>
              <button className={styles.miniBtn} onClick={onImport} title="Импорт сборки из файла"><ImportIcon /></button>
              <button className={styles.addMini} onClick={onCreate} title="Создать сборку">+</button>
            </div>
          </div>
          <div className={`${styles.list} fw-stagger`}>
            {customPacks.length === 0 && (
              <button className={styles.createCard} onClick={onCreate}>
                <span className={styles.createPlus}>+</span>
                <div className={styles.createText}>
                  <div className={styles.createTitle}>Создать сборку</div>
                  <div className={styles.createSub}>Свои моды, паки и шейдеры</div>
                </div>
              </button>
            )}
            {customPacks.map((pack) => {
              const active = selectedId === pack.id
              return (
                <button key={pack.id} className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => onSelect(pack.id)}>
                  <Avatar name={pack.name} active={active} icon={icons[pack.id]} />
                  <div className={styles.info}>
                    <div className={styles.name}>{pack.name}</div>
                    <div className={styles.meta}>{pack.loader.charAt(0).toUpperCase() + pack.loader.slice(1)} · {pack.mc_version}</div>
                  </div>
                  <div className={styles.itemActions}>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); setPackIcon(pack.id) }} title="Сменить картинку сборки"><ImageIcon /></button>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); onExport(pack.id) }} title="Экспорт сборки в файл"><ExportIcon /></button>
                    <button className={styles.actBtn} onClick={(e) => { e.stopPropagation(); onDeleteCustom(pack.id) }} title="Удалить сборку"><span className={styles.del}>✕</span></button>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <AccountPanel />
    </aside>
  )
}
