import { useState, useEffect } from 'react'
import styles from '../styles/DevTab.module.css'

interface DevCfg { debug: boolean; port: number; projectPath: string; ideaPath: string }

export default function DevTab({ modpackId }: { modpackId: string }) {
  const [cfg, setCfg] = useState<DevCfg>({ debug: false, port: 5005, projectPath: '', ideaPath: '' })
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    window.api.dev.get(modpackId).then(setCfg).catch(() => {})
  }, [modpackId])

  const patch = async (p: Partial<DevCfg>) => {
    const next = await window.api.dev.set(modpackId, p)
    setCfg(next)
  }

  const flash = (text: string, ok: boolean) => {
    setNotice({ text, ok })
    setTimeout(() => setNotice(null), 4000)
  }

  const pickProject = async () => {
    const p = await window.api.dev.pickProject()
    if (p) patch({ projectPath: p })
  }
  const pickIdea = async () => {
    const p = await window.api.dev.pickIdea()
    if (p) patch({ ideaPath: p })
  }
  const openIde = async () => {
    const r = await window.api.dev.openIntelliJ(modpackId)
    flash(r.ok ? 'Открываю в IntelliJ…' : (r.error ?? 'Не удалось открыть'), r.ok)
  }
  const genConfig = async () => {
    const r = await window.api.dev.runConfig(modpackId)
    flash(r.ok ? 'Конфиг отладки создан в проекте (.idea/runConfigurations)' : (r.error ?? 'Ошибка'), r.ok)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        Инструменты мододела: запуск сборки с подключаемым отладчиком и интеграция с IntelliJ IDEA.
        Тестируй свой мод прямо внутри этой сборки.
      </div>

      {/* Отладка */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>Отладка (JDWP)</div>
            <div className={styles.cardSub}>Игра запустится с открытым портом отладки — подключишься из IntelliJ.</div>
          </div>
          <button
            className={`${styles.switch} ${cfg.debug ? styles.switchOn : ''}`}
            onClick={() => patch({ debug: !cfg.debug })}
            title="Запускать с отладкой"
          ><span className={styles.knob} /></button>
        </div>

        <div className={styles.row}>
          <label className={styles.rowLabel}>Порт</label>
          <input
            className={styles.input}
            style={{ width: 90 }}
            type="number"
            value={cfg.port}
            onChange={e => setCfg(c => ({ ...c, port: Number(e.target.value) || 5005 }))}
            onBlur={() => patch({ port: cfg.port })}
          />
          <span className={styles.attachHint}>
            В IntelliJ: <b>Run → Attach to Process</b> → localhost:{cfg.port} (или готовый конфиг ниже)
          </span>
        </div>
      </section>

      {/* Проект мода / IntelliJ */}
      <section className={styles.card}>
        <div className={styles.cardTitle}>Проект мода (IntelliJ IDEA)</div>

        <div className={styles.pathRow}>
          <div className={styles.pathBox}>
            {cfg.projectPath || <span className={styles.dim}>Папка проекта не выбрана</span>}
          </div>
          <button className={styles.btn} onClick={pickProject}>Выбрать</button>
        </div>

        <div className={styles.pathRow}>
          <div className={styles.pathBox}>
            {cfg.ideaPath || <span className={styles.dim}>Путь к idea64.exe (необязательно)</span>}
          </div>
          <button className={styles.btn} onClick={pickIdea}>IntelliJ</button>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnAccent} onClick={openIde} disabled={!cfg.projectPath}>Открыть в IntelliJ</button>
          <button className={styles.btn} onClick={genConfig} disabled={!cfg.projectPath}>Создать конфиг отладки</button>
        </div>
        <p className={styles.foot}>
          «Создать конфиг отладки» кладёт в проект готовый <b>Remote JVM Debug</b> на порт {cfg.port} —
          после этого в IntelliJ появится кнопка запуска отладчика, жать её после старта игры.
        </p>
      </section>

      {notice && <div className={`${styles.notice} ${notice.ok ? styles.noticeOk : styles.noticeErr}`}>{notice.text}</div>}
    </div>
  )
}
