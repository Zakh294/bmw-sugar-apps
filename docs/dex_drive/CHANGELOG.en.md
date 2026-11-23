# DeX Drive — what's new

A short note on each version. The app's page in the MGU Store shows the same for the current version.
[Українська](CHANGELOG.md)

## 0.1.0 (2026-11-23)
- First test version (branch `dev`): Samsung DeX (One UI 8) on the centre screen through scrcpy-server 5.0.1 with a
  virtual display, H.264 decoded on the unit's GPU (dexdec), shown through mgu-render.
- The phone by USB (usbfs, its ADB interface only) or over Wi‑Fi (ADB on port 5555, found among the unit's
  neighbours).
- Multi-touch, the iDrive knob scrolls, a menu button bottom left, the iDrive back arrow leaves.
- Settings: language, connection, scale (dpi), 30/60 fps, quality, parked only, the phone's screen off.
- The dex-drive-d 0.1.0 service (MIT) with the dexdec decoder (GPL‑3.0) and scrcpy-server (Apache‑2.0).
