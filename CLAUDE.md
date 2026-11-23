# bmw-sugar-apps — notes for agents

Own apps for the BMW iDrive 7 head unit (MGU), installed through MGU Store as a repo-tree source
(`Zakh294/bmw-sugar-apps`, branch `main`). The owner reads Ukrainian: talk to him in Ukrainian. The repository is
meant to be public: README.md / LEGAL.md / CONTRIBUTING.md in English (README.uk.md, docs/<id>/README.md in Ukrainian,
docs/<id>/README.en.md in English); keep both languages in step.

- Layout: `apps/<id>/` code only (subfolders there become data packs, e.g. `apps/speedcam_ua/packs/`), `docs/<id>/`,
  `data/<id>/`, `tools/<id>/`, `test/<id>/`, shared `kit/`, `tools/store_build.py`, `test/lib/`. Both root READMEs
  list every app with its version.
- Runtime is Node 8.16.2 on the car: no `?.`, `??`, `catch {}`, object spread, `fs.mkdirSync({recursive})` in app code.
  The Store build runs `tools/store_build.py <id>` with Python 3.12 on the car, then `kit/tools/build.py`.
- `kit/` is the vendored MGU App Kit (cauliflowermossgrape, MIT); keep it unchanged apart from its font atlases
  `kit/runtime/fonts/{cyrillic,label,bold,light}.json`, extended with Ukrainian and European letters by
  `tools/bake_fonts_i18n.py` (existing glyphs untouched; Ubuntu fonts from google/fonts `ufl/ubuntu`).
- SpeedCam: texts in 8 languages in `apps/speedcam_ua/lang.js` (unit test checks every entry); countries and legal
  modes in `tools/speedcam_ua/countries.py`; camera packs built by `tools/speedcam_ua/build_packs.py`.
- The workflow `.github/workflows/camera-packs.yml` rebuilds the packs monthly and **commits to `main`**; merge
  `origin/main` into `dev` before working, so pack updates don't conflict. Pushing to branch `actions/packs` runs it
  there (testing the workflow).
- Work on `dev`; merge to `main` only when asked. Before moving `main` past a version that worked in the car, keep it as
  branch `release/<id>-<version>` (tag pushes are refused by the agent git proxy; branches work and the Store can use
  them). Bump `version` in `apps/<id>/app.json` for any change that should reach the car, and with it the "What's new" part of
  its Store `description` + `texts` (8 languages, ≤ 1000 characters; SpeedCam's unit test checks the version is named)
  and `docs/<id>/CHANGELOG.md` / `CHANGELOG.en.md`.
- Before pushing: `node test/<id>/*.js`, `python3 test/<id>/*.py` and `python3 kit/tools/build.py --preview-only <id>`.
- DeX Drive (`apps/dex_drive`, Node 8 app) + its Store tool `dex-drive-d` (`native/dex_drive`, listed in
  `mgu-repo.json` "components"): `dexd/` Go service (ADB over usbfs/TCP, scrcpy-server 5.0.1 protocol, ctl socket),
  `dexdec/` GPU decoder (GPL-3.0, C++ from RideTube's ytdec, built with zig for glibc 2.27), `prebuilt/` = what the car
  installs (committed binaries + component.json; bump its version with any change there, and the app's
  "requires"). Rebuild: `sh tools/dex_drive/build_native.sh`. Tests: `cd native/dex_drive/dexd && go test ./...`,
  `node test/dex_drive/unit.js`, `python3 kit/tools/build.py --preview-only dex_drive && node test/dex_drive/app_e2e.js`.
- Never commit SSH keys, tokens, VIN-specific backups (FA, SVT, coding, E-Sys files), photos with a VIN, a plate or the
  owner's home position.
