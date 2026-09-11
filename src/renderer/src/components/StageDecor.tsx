import { useEffect, useRef } from 'react'
import styles from '../styles/CharacterStage.module.css'

// Частицы и прелоадер рисуем через requestAnimationFrame + performance.now() (реальное время),
// а НЕ через CSS-анимации. Причина: у части пользователей (зависит от связки монитор/GPU/драйвер,
// напр. на 75 Гц) composited CSS-анимации идут не по реальному времени и заметно ускоряются, хотя
// 3D-персонаж (delta-time) при этом в норме. rAF по performance.now() всегда корректен на любой
// частоте экрана, потому что прогресс считается от реального времени, а не от числа кадров.

interface P { left: string; type: 1 | 2; delay: number }
// Те же 5 частиц, что были в разметке (left + задержка фазы + размер по типу).
const PARTICLES: P[] = [
  { left: '12%', type: 1, delay: 0 },
  { left: '32%', type: 2, delay: 1.4 },
  { left: '58%', type: 1, delay: 3 },
  { left: '78%', type: 2, delay: 2.2 },
  { left: '90%', type: 1, delay: 4.1 }
]
// Параметры повторяют прежние @keyframes fwP1/fwP2 один-в-один.
const DUR = { 1: 7, 2: 9 } as const                                  // сек на цикл
const RISE = { 1: { from: 20, to: -300 }, 2: { from: 10, to: -340 } } as const // translateY, px
const PEAK = { 1: { at: 0.3, op: 0.85 }, 2: { at: 0.4, op: 0.7 } } as const     // пик прозрачности

/** Поднимающиеся частицы, анимированные реальным временем (независимо от частоты экрана). */
export function Particles(): JSX.Element {
  const refs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      const now = performance.now() / 1000
      for (let i = 0; i < PARTICLES.length; i++) {
        const el = refs.current[i]
        if (!el) continue
        const p = PARTICLES[i]
        const prog = (((now + p.delay) / DUR[p.type]) % 1 + 1) % 1
        const rise = RISE[p.type]
        const peak = PEAK[p.type]
        const y = rise.from + prog * (rise.to - rise.from)
        const op = prog < peak.at
          ? (prog / peak.at) * peak.op
          : peak.op * (1 - (prog - peak.at) / (1 - peak.at))
        el.style.transform = `translateY(${y}px)`
        el.style.opacity = String(op)
      }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className={styles.particles} aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <i
          key={i}
          ref={el => { refs.current[i] = el }}
          className={p.type === 1 ? styles.p1 : styles.p2}
          style={{ left: p.left }}
        />
      ))}
    </div>
  )
}

/** Крутящийся прелоадер, анимированный реальным временем (0.8с на оборот, как было в CSS). */
export function Spinner(): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      if (ref.current) ref.current.style.transform = `rotate(${(performance.now() / 800) * 360 % 360}deg)`
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return <span ref={ref} className={styles.spin} />
}
