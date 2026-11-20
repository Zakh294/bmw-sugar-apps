# bmw-sugar-apps — notes for agents

Own apps for the BMW iDrive 7 head unit (MGU), installed through MGU Store as a repo-tree source
(`Zakh294/bmw-sugar-apps`, branch `main`). The owner reads Ukrainian: docs and user-facing text in Ukrainian.

- Layout: `apps/<id>/` code only (subfolders there become data packs), `docs/<id>/`, `data/<id>/`, `tools/<id>/`,
  `test/<id>/`, shared `kit/`, `tools/store_build.py`, `test/lib/`. Root README lists every app with its version.
- Runtime is Node 8.16.2 on the car: no `?.`, `??`, `catch {}`, object spread, `fs.mkdirSync({recursive})` in app code.
  The Store build runs `tools/store_build.py <id>` with Python 3.12 on the car, then `kit/tools/build.py`.
- `kit/` is the vendored MGU App Kit (cauliflowermossgrape, MIT); keep it unchanged apart from
  `kit/runtime/fonts/cyrillic.json` (Ukrainian atlas, `tools/bake_ukrainian_font.py`).
- Work on `dev`; merge to `main` only when asked, tag `<id>-v<version>`. Bump `version` in `apps/<id>/app.json` for
  any change that should reach the car.
- Before pushing: `node test/<id>/*.js` and `python3 kit/tools/build.py --preview-only <id>`.
- Never commit SSH keys, tokens, VIN-specific backups (FA, SVT, coding, E-Sys files).
