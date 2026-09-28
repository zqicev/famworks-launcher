/** Голова скина (лицо + слой шапки) из 64x64-скина. Обрезка размеронезависимая: CSS-фон в %,
 *  pixelated. Первый фон — шапка (сверху), второй — лицо. Заполняет родителя (100%). */
export default function SkinHead({ url }: { url: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        width: '100%',
        height: '100%',
        backgroundImage: `url("${url}"), url("${url}")`,
        backgroundSize: '800% 800%, 800% 800%',
        backgroundPosition: '71.4286% 14.2857%, 14.2857% 14.2857%',
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated'
      }}
    />
  )
}
