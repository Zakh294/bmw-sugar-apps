# DeX Drive — what's new

A short note on each version. The app's page in the MGU Store shows the same for the current version.
[Українська](CHANGELOG.md)

## 0.2.3 (2026-11-24)
- A pointer you can see: Android draws no cursor for a pointer we move (only with a physical mouse), so in the test
  the touchpad "moved something" no one could see. DeX Drive now draws the arrow over the picture, 8 s after a move.
- The knob without the controller gate: the car has the GPU renderer (`idrive7-renderd`) too, the gate then works
  for it and mgu-render gives no controller. DeX Drive now reads the car's own controller signal (FrontCCU). The
  iDrive menu under the picture hears it too, so "Stop", "Turn the phone's screen off" and "Forget the key" do nothing
  while DeX shows. The page says where the knob comes from.
- Wi‑Fi: while searching the page shows the phone's remembered address and the car's networks: one look tells
  whether they share one. The last error's time carries its zone (the unit's clock runs in UTC).
- The dex-drive-d 0.2.3 service.

## 0.2.2 (2026-11-23)
- Installs "Controller gate" with it (`mgu-inputgate` from the `cauliflowermossgrape/idrive7-apps` source, Head-unit
  tools): without it mgu-render does not give an app the controller, so knob, press and tilt did not reach DeX (car
  test). Restart the unit after the install (it loads into the iDrive menu).
- The page says when the controller is not reachable and when the controller's touchpad sends nothing.
- Wi‑Fi after the cable (the phone was not found): while the phone is on USB, the service keeps its Wi‑Fi address
  (`phone-ip.auto`) and knocks there later; no answer, it goes through its own Wi‑Fi network (/24) on port 5555, at
  most every 15 s, never the car's internal networks.
- The dex-drive-d 0.2.2 service.

## 0.2.1 (2026-11-23)
- Fixed: black instead of DeX (first car test: S26 Ultra, One UI 9, USB, 20 fps). The renderer opens the video file
  when it is named, and the app named it before the decoder had made it. Now named again once the decoder makes it or
  changes its size.
- The page says why the picture went away (a touch on the iDrive menu, an iDrive camera or video, mgu-render
  restarting) and shows the renderer's error, if any.
- The page keeps the last error ("Last error 17:40:01 …") while the service tries again: what the phone or the
  decoder said when DeX stopped. It used to show for a few seconds only.
- The dex-drive-d 0.2.1 service.

## 0.2.0 (2026-11-23)
- The iDrive controller works DeX like a laptop: the touchpad moves DeX's pointer, a tap clicks, a two-finger tap
  right-clicks, two fingers scroll; pressing the knob clicks where the pointer is (held: a long press, with the
  touchpad: a drag); tilts are arrow keys; turning scrolls.
- The touchpad's touch mode is on while DeX shows. Setting "The controller's touchpad is DeX's pointer".
- The dex-drive-d 0.2.0 service: a mouse pointer and clicks (left / right) in DeX.

## 0.1.1 (2026-11-23)
- The car opens port 5555: with "USB or Wi‑Fi", a phone plugged in by USB gets ADB on port 5555 (as
  `adb tcpip 5555`). Until the phone restarts, DeX finds it over Wi‑Fi: no cable, no PC, no Termux. Once per phone
  start; USB reconnects for a few seconds then.
- The dex-drive-d 0.1.1 service.

## 0.1.0 (2026-11-23)
- First test version: Samsung DeX (One UI 8) on the centre screen through scrcpy-server 5.0.1 with a
  virtual display, H.264 decoded on the unit's GPU (dexdec), shown through mgu-render.
- The phone by USB (usbfs, its ADB interface only) or over Wi‑Fi (ADB on port 5555, found among the unit's
  neighbours).
- Multi-touch, the iDrive knob scrolls, a menu button bottom left, the iDrive back arrow leaves.
- Settings: language, connection, scale (dpi), 30/60 fps, quality, parked only, the phone's screen off.
- The dex-drive-d 0.1.0 service (MIT) with the dexdec decoder (GPL‑3.0) and scrcpy-server (Apache‑2.0).
