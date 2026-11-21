# Legal notice, disclaimer and data licences

*Українською — нижче.*

## Disclaimer

The software in this repository is provided **"as is", without warranty of any kind**, express or implied
(see [LICENSE](LICENSE), MIT). The authors and contributors are **not liable** for any claim, damage, fine, loss
of warranty, defect of the vehicle or its software, accident or other liability arising from the software, its
data or its use.

- **Not affiliated with BMW.** These are unofficial, community-made apps. BMW, iDrive and ConnectedDrive are
  trademarks of BMW AG; Waze and Google Maps are trademarks of their owners. They are named only to describe
  compatibility.
- **Installing them needs root access to the head unit** (through the third-party MGU Store). That is a modification
  of your vehicle's software: it may affect the manufacturer's warranty, and it is done entirely at your own risk.
  These apps only read vehicle data and do not write to the car's control units, but no software is free of faults.
- **Informational only.** Camera locations and speed limits may be incomplete, outdated or wrong. Always follow the
  road signs, the speed limits and the traffic rules. The driver alone is responsible for how the vehicle is driven.
- **Not legal advice.** The table below summarises our understanding, to choose safe defaults. Laws change and differ
  between countries. **You must check the law of every country you drive in** and switch the warnings off where they
  are not allowed. Using the app where it is prohibited is your own responsibility.
- **Do not operate the app while driving.** Change settings only when the vehicle is stationary.

## Speed camera warnings and the law (defaults of SpeedCam)

| Where | Default in the app | Why |
|---|---|---|
| Germany | **off** | StVO § 23 (1c) forbids a driver to use a device or app that warns of speed checks (fine EUR 75 and a point); OLG Karlsruhe (2023): also when a passenger's phone warns |
| Switzerland, Liechtenstein | **off** | any device warning of speed checks is prohibited, even carrying one may be |
| Cyprus, North Macedonia | **off** | speed camera warning services are not permitted there (TomTom does not offer them) |
| France | **zones only** | only "danger zones" may be announced, never the camera's place: the app shows a zone from 2 km (4 km at motorway speed), without the distance |
| Other countries of Europe, Ukraine, USA | on | GPS-based warnings of fixed cameras are generally allowed; **check the local rules** (some US states and countries restrict radar detectors, which this app is not) |

Where the default is **off**, the owner can switch the warnings on in *Settings → Countries where warnings are not
allowed → On: at my own responsibility*. By doing so you confirm that you have checked the law and accept full
responsibility.

## Data licences

- **Ukraine:** the official list of automatic traffic enforcement devices of the National Police of Ukraine
  (Patrol Police, <https://patrolpolice.gov.ua/automatic_fixation/informatsiya-pro-vstanovleni-kaf/>), public
  information, converted to coordinates; re-downloaded monthly.
- **Europe and the USA:** © **OpenStreetMap contributors**, <https://www.openstreetmap.org/copyright>. The camera packs
  built from it (`apps/speedcam_ua/packs/*.json` except `ua.json`) are a derived database and are made available
  under the **Open Database Licence 1.0** (ODbL, <https://opendatacommons.org/licenses/odbl/1-0/>). If you use or
  share them, attribute OpenStreetMap and keep them under the ODbL. Missing or wrong cameras: fix them in
  OpenStreetMap (`highway=speed_camera`), the next monthly build picks them up.
- **Code:** MIT ([LICENSE](LICENSE)). `kit/`: MGU App Kit, MIT (cauliflowermossgrape). `cluster_render_client.js`:
  MPL-2.0 (Robert Nisipeanu). Fonts: Ubuntu Font Licence 1.0, SIL OFL (files beside the fonts).

## Privacy

The apps work offline. The only network access is SpeedCam's monthly update: an HTTPS request to
`raw.githubusercontent.com` for the camera packs (GitHub sees the car's IP address, as with any download). No
position, VIN or other data is sent anywhere. Logs stay on the head unit.

---

# Правова інформація, відмова від відповідальності та ліцензії даних

## Відмова від відповідальності

Програми в цьому репозиторії надаються **«як є», без жодних гарантій**, явних чи неявних (див. [LICENSE](LICENSE),
MIT). Автори й учасники **не відповідають** за будь-які претензії, шкоду, штрафи, втрату гарантії, несправність
автомобіля чи його програм, ДТП чи іншу відповідальність, що виникли через програми, їхні дані чи їх використання.

- **Не від BMW.** Це неофіційні додатки спільноти. BMW, iDrive і ConnectedDrive — торгові марки BMW AG, Waze і Google
  Maps — їхніх власників. Їх названо лише для опису сумісності.
- **Для встановлення потрібен root-доступ до головного блока** (через сторонній MGU Store). Це зміна програм
  автомобіля: вона може вплинути на гарантію виробника і робиться цілком на твій ризик. Додатки лише читають дані
  машини й нічого не записують у блоки керування, але програм без помилок не буває.
- **Лише довідково.** Розташування камер і ліміти можуть бути неповними, застарілими або хибними. Завжди дотримуйся
  знаків, обмежень швидкості й ПДР. За керування автомобілем відповідає лише водій.
- **Це не юридична порада.** Таблиця вище — наше розуміння, щоб вибрати безпечні налаштування за замовчуванням. Закони
  змінюються й різняться між країнами. **Перевір закон кожної країни, де їдеш**, і вимкни попередження там, де вони
  заборонені. Використання там, де це заборонено, — твоя відповідальність.
- **Не налаштовуй додаток під час руху.** Змінюй налаштування лише на зупинці.

Де за замовчуванням попередження **вимкнені** (Німеччина, Швейцарія, Ліхтенштейн, Кіпр, Північна Македонія), їх
можна ввімкнути: *Налаштування → Країни, де попередження заборонені → Увімкнено: відповідальність на мені*. Так ти
підтверджуєш, що перевірив закон і береш усю відповідальність на себе. У Франції показується лише «зона контролю»,
без місця камери.

**Дані:** Україна — офіційний перелік Національної поліції (патрульна поліція), публічна інформація. Європа та США —
© учасники OpenStreetMap, ODbL 1.0: пакети з цих даних поширюються за ODbL, з посиланням на OpenStreetMap.

**Приватність:** додатки працюють офлайн. Єдиний вихід у мережу — щомісячне оновлення баз SpeedCam з
`raw.githubusercontent.com`. Ні позиція, ні VIN, ні інші дані нікуди не надсилаються.
