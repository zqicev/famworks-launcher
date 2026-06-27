// Встраивает иконку в exe вручную (electron-builder с signAndEditExecutable:false
// не запускает rcedit, иначе падает winCodeSign на macOS-симлинках).
const path = require('path')
const _rcedit = require('rcedit')
const rcedit = _rcedit.rcedit || _rcedit.default || _rcedit

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await rcedit(exe, { icon: path.join(__dirname, '..', 'build', 'icon.ico') })
}
