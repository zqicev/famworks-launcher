import styles from '../styles/SettingsModal.module.css'

interface Props {
  onChoose: (enable: boolean) => void
}

// Показывается один раз при первом запуске. Неотменяемая: нужно сделать выбор (без крестика/клика мимо).
export default function FirstRunBackupModal({ onChoose }: Props): JSX.Element {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal} style={{ width: 440 }}>
        <div className={styles.header}>
          <h2 className={styles.title}>Автосохранение сборок</h2>
        </div>
        <div className={styles.body}>
          <p className={styles.hint} style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Лаунчер может автоматически делать резервные копии сборок (миры, настройки, конфиги модов)
            после игры - чтобы вернуться назад, если что-то сломается. Копии занимают место на диске.
          </p>
          <p className={styles.hint} style={{ margin: 0 }}>
            Включить автосохранение? Позже это можно изменить в настройках - сразу для всех сборок или
            для каждой отдельно.
          </p>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={() => onChoose(false)}>Не включать</button>
          <button className={styles.saveBtn} onClick={() => onChoose(true)}>Включить</button>
        </div>
      </div>
    </div>
  )
}
