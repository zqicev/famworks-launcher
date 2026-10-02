// Состояние памяти Windows для предупреждений о вылетах (только win32).

export interface PagefileInfo {
  path: string
  drive: string           // «C:»
  currentMb: number       // текущий размер файла
  growMb: number          // на сколько ещё может вырасти (упирается в свободное место или свой максимум)
  systemManaged: boolean  // размер выбирает Windows (растёт сам, пока есть место на диске)
  driveFreeMb: number
}

export interface MemoryHealth {
  totalRamMb: number
  commitLimitMb: number   // сколько Windows может выделить программам сейчас: RAM + текущая подкачка
  commitFreeMb: number    // из них свободно прямо сейчас
  growthMb: number        // на сколько ещё может вырасти подкачка в сумме
  pagefileAuto: boolean   // «Автоматически выбирать объём файла подкачки»
  pagefiles: PagefileInfo[]
  potentialPagefileMb: number // до скольких подкачка может дорасти в сумме
  // disk-low - подкачка автоматическая, но расти некуда (диск забит); pagefile-small/off - ручная настройка
  issue?: 'disk-low' | 'pagefile-small' | 'pagefile-off'
  issueDrive?: string
  issueDriveFreeMb?: number
}
