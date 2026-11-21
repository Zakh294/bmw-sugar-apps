# BMW Sugar Apps — власні додатки для iDrive 7 (MGU)

Тут лежать наші додатки для головного блока MGU (iDrive 7) через [MGU Store](https://github.com/robertnisipeanu/mgu-store). Це одне джерело Store, з якого ставиться будь-який додаток. Блок збирає їх сам із вихідного коду, так само як `bimmer-lab/apps`.

## Додатки

| Додаток | Папка | Версія | Що робить | Опис |
|---|---|---|---|---|
| SpeedCam UA | `apps/speedcam_ua` | 0.3.0 | офлайн-попередження про 426 камер автофіксації на HUD, приладці та всередині мапи Waze / Google | [docs/speedcam_ua](docs/speedcam_ua/README.md) |

## Підключення до машини

1. **Токен для Store** (репозиторій приватний, тож це потрібно один раз). На GitHub: Settings → Developer settings → Fine-grained tokens → доступ лише до `bmw-sugar-apps`, права Contents: Read-only. Далі на ноутбуці в PowerShell (машина на хотспоті `DIRECT-BMW`):
   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/robertnisipeanu/mgu-store/main/deploy/install.ps1))) token --identity $HOME\.ssh\mgu_root_key
   ```
2. **Джерело:** Store → Settings → **Add source** → `Zakh294/bmw-sugar-apps` → **Branch** `main` → **Check now**.
3. Вибери додаток у Store → **Install**.
4. **Оновлення:** Installed → **Update all**. Store бачить нову версію, коли в `apps/<id>/app.json` зростає `version`.

Якщо раніше було додано джерело `Zakh294/bmw-speedcam-ua`, прибери його: GitHub уже перенаправляє стару назву сюди, а два джерела з тими самими додатками не потрібні.

## Гілки

- **`main`** — стабільна. Саме її підключаєш у машині.
- **`dev`** — для перевірки нового. Щоб потестувати, у Store заміни гілку джерела на `dev`, а після перевірки поверни `main`. Обидві гілки одночасно не підключай: додатки там з однаковими id, і Store ставить ту версію, що новіша.
- Нове спершу йде в `dev`, після перевірки в машині — у `main`.
- **Точки відкату** — гілки `release/<id>-<версія>`, наприклад `release/speedcam_ua-0.2.0`: стан, який уже працював у машині. Щоб відкотитися, в Store заміни гілку джерела на таку гілку → Check now. Store поставить ту версію, якщо вона новіша за встановлену; інакше спершу видали додаток (Installed → Remove) і постав знову. Щоб повернутися на свіже, знову вибери `main`.

Релізи (готові `.tgz`) тут не використовуються. Додатки збираються в самій машині, бо частина збірки залежить від конкретного блока: SpeedCam UA шукає GPS у його каталозі інтерфейсів.

## Структура

```
mgu-repo.json            опис для Store: кожна папка apps/* — окремий додаток
kit/                     MGU App Kit (cauliflowermossgrape, MIT) + український шрифт
tools/store_build.py     спільний крок збірки в машині, далі kit/tools/build.py
tools/bake_ukrainian_font.py
apps/<id>/               код додатка: app.json, main.js, icon.png, модулі .js
docs/<id>/               опис, інструкції, картинки
data/<id>/               дані додатка у вихідному вигляді (бази, експорти)
tools/<id>/              скрипти додатка (імпорт даних, діагностика по SSH)
test/<id>/, test/lib/    тести; спільні заглушки в test/lib
```

## Новий додаток

1. `apps/<id>/app.json`: унікальні `id` і 4-символьний `loggingId`, `version`, `mguHmi: ["ID7"]`, `signals`, `screens`, `settings`. За зразок бери `apps/speedcam_ua/app.json` і [довідку App Kit](https://github.com/cauliflowermossgrape/idrive7-apps).
2. `apps/<id>/main.js` + `icon.png` 140×140.
3. **Папок усередині `apps/<id>/` не роби**, крім даних для пакування: збірка упаковує кожну підпапку як data pack. Документацію клади в `docs/<id>/`, вихідні дані — в `data/<id>/`.
4. Код має працювати на **Node 8.16.2**, як на блоці: без `?.`, `??` і `catch {}`. Скрипти збірки в машині запускає Python 3.12.
5. Перевірка: `python3 kit/tools/build.py --preview-only <id>` і тести в `test/<id>/`.
6. Рядок у таблиці вище.

## Чого тут ніколи не має бути

SSH-ключі блока, токени, VIN-прив'язані бекапи (FA, SVT, кодування, файли E-Sys), паролі Wi-Fi.

## Ліцензії

Наш код — MIT ([LICENSE](LICENSE)). `kit/` — MIT (cauliflowermossgrape). `cluster_render_client.js` — MPL-2.0 (Robert Nisipeanu). Шрифти — SIL OFL / Ubuntu Font Licence (файли поруч зі шрифтами). Ліцензії даних — в описі кожного додатка.

Неофіційні додатки, не від BMW. Ставиш на свій ризик.
