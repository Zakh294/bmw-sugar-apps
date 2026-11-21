# Contributing

Thank you for helping. Issues and pull requests are welcome, in English or Ukrainian.

## Cameras

- **Ukraine:** the app follows the Patrol Police's official list; it is re-read every month. A wrong position there:
  open an issue with the camera's number and what is wrong.
- **Europe and the USA:** the data comes from OpenStreetMap. Add or fix the camera there (a node
  `highway=speed_camera`, with `maxspeed` and if you know it `direction`); the monthly build picks it up. Please do not
  edit `apps/speedcam_ua/packs/*.json` by hand: the next build overwrites it.
- **Country rules** (`tools/speedcam_ua/countries.py`, column `legal`): if a law changed, open an issue with a source
  (the law, a ministry or a motoring club). We keep the defaults on the safe side.

## Languages

Texts are in `apps/speedcam_ua/lang.js`: each line has eight entries in the order
`uk, en, de, pl, fr, it, es, cs`. To fix a translation, change that entry. To add a language: append an entry to every
line and to `LANGS` / `NATIVE`, add it to the `lang` setting in `app.json`, and run `python3 tools/bake_fonts_i18n.py`
if it needs letters the fonts lack. `node test/speedcam_ua/unit.js` checks that every text has every language.

## Code

- The head unit runs **Node 8.16.2**: no `?.`, `??`, `catch {}`, object spread, `fs.mkdirSync({ recursive })` in the
  app's code. The build step on the car runs Python 3.12.
- `kit/` is the vendored MGU App Kit; keep it unchanged apart from its font atlases (`tools/bake_fonts_i18n.py`).
- Before a pull request: `node test/speedcam_ua/unit.js`, `node test/speedcam_ua/e2e_drive.js`,
  `python3 test/speedcam_ua/packs_test.py` and `python3 kit/tools/build.py --preview-only speedcam_ua`.
- Work on `dev`; `main` is what cars install. Bump `version` in `apps/<id>/app.json` for a change that should reach
  the car.

## Never commit

Head unit SSH keys, tokens, VIN-bound backups (FA, SVT, coding, E-Sys files), Wi-Fi passwords, photos showing a VIN,
a number plate or your home's position.

By contributing you agree that your code is licensed under the MIT licence and data you add to OpenStreetMap under
its ODbL.
