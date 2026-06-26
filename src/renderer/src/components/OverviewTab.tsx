import { Modpack } from '../../../types/modpack'
import styles from '../styles/OverviewTab.module.css'

interface Props { modpack: Modpack }

export default function OverviewTab({ modpack }: Props) {
  const totalMB = modpack.mods.reduce((s, m) => s + m.size_mb, 0)
  const sizeFmt = totalMB >= 1000
    ? `${(totalMB / 1024).toFixed(1)} ГБ`
    : `${totalMB.toFixed(0)} МБ`

  return (
    <div className={styles.wrapper}>
      <div className={styles.left}>
        <section className={styles.section}>
          <div className={styles.label}>ОПИСАНИЕ</div>
          <p className={styles.text}>{modpack.long_description || modpack.description}</p>
        </section>

        {modpack.changelog?.length > 0 && (
          <section className={styles.section}>
            <div className={styles.label}>ПОСЛЕДНИЕ ИЗМЕНЕНИЯ</div>
            <div className={styles.changelog}>
              {modpack.changelog.map(entry => (
                <div key={entry.version} className={styles.changelogRow}>
                  <span className={styles.version}>{entry.version}</span>
                  <span className={styles.changeDesc}>{entry.description}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className={styles.params}>
        <div className={styles.paramTitle}>ПАРАМЕТРЫ</div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>ЗАГРУЗЧИК</span>
          <span className={styles.paramVal}>
            {modpack.loader.charAt(0).toUpperCase() + modpack.loader.slice(1)}
          </span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>ВЕРСИЯ MC</span>
          <span className={styles.paramVal}>{modpack.mc_version}</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>РАЗМЕР</span>
          <span className={styles.paramVal}>{sizeFmt}</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>ОБНОВЛЕНО</span>
          <span className={styles.paramVal}>{formatDate(modpack.updated_at)}</span>
        </div>
        <div className={styles.paramRow}>
          <span className={styles.paramKey}>FABRIC API</span>
          <span className={styles.paramVal}>{modpack.fabric_api_version}</span>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}
