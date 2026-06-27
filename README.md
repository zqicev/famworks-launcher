# FamWorks Modpack Editor

Внутренний инструмент для создания и управления сборками лаунчера FamWorks.
Живёт в ветке **`editor`** репозитория лаунчера (отдельно от кода лаунчера).

Работает через **GitHub API** — читает и пишет `modpacks/*.json` в репозитории
`famworks-builds`, заливает кастомные `.jar` в его Releases. Локальный git и клон
репозитория сборок не нужны.

## Что умеет

- Вход по GitHub-токену (хранится локально, не в репо)
- Список сборок из `famworks-builds`, создание новой
- Редактирование метаданных (версии, описание, changelog)
- Моды:
  - поиск и добавление из **Modrinth** (версия пинится: `download_url` + `sha512`)
  - загрузка **кастомного `.jar`** → автозаливка в Release `mods` + расчёт sha512
  - тоггл required/optional, категория, удаление
- **Сохранить** → коммит `<id>.json` + обновление `index.json` + `updated_at` (всё через API)

## Запуск (через git worktree, не трогая лаунчер)

Из папки лаунчера один раз:
```bash
git fetch origin
git worktree add ../famworks-editor editor
cd ../famworks-editor
npm install
npm run dev
```
Дальше просто `npm run dev` в папке `famworks-editor`.

## Токен

Нужен GitHub-токен с доступом **Contents: Read and write** к `famworks-builds`
(classic: `public_repo`; fine-grained: Contents R/W). Тот же тип, что для релизов
лаунчера. Вводится при первом запуске.

## Сборка .exe (опционально)

```bash
npm run dist
```
Инструмент только для себя — подпись/автообновление не настраивались.
