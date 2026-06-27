// Генерирует build/icon.png и build/icon.ico из build/icon.svg.
// Запуск: node scripts/generate-icon.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const svg = readFileSync(join(buildDir, 'icon.svg'))

// 256x256 PNG — для Linux и как источник иконки окна
const png256 = await sharp(svg, { density: 384 }).resize(256, 256).png().toBuffer()
writeFileSync(join(buildDir, 'icon.png'), png256)

// .ico для Windows — набор размеров
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(
  sizes.map(s => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
)
const ico = await pngToIco(pngs)
writeFileSync(join(buildDir, 'icon.ico'), ico)

console.log('Иконки сгенерированы: build/icon.png, build/icon.ico')
