# DeX Drive — Samsung DeX on the BMW iDrive 7 centre screen

*Українською: [README.md](README.md)*

> **Test version 0.1.0.** Built and tested on a PC (a fake phone, a fake renderer, a fake decoder). Not run in a car
> yet: see [What is tested, what is not](#what-is-tested-what-is-not).
> **Parked only.** Unofficial, not affiliated with BMW or Samsung, at your own risk ([LEGAL.md](../../LEGAL.md)).

A Samsung phone with **One UI 8 (Android 16)** connects to the head unit by USB or Wi‑Fi, and its **DeX** (a desktop
with windows, a taskbar and a keyboard) opens on the whole centre screen. The screen is a touchscreen: fingers
(several at once) work as on a tablet, and the iDrive controller as a laptop (touchpad, click, arrows). The head unit's GPU decodes the video, and the phone
does not mirror its own screen: DeX runs on a virtual display of its own.

## How it works

```
Phone (One UI 8)                           Head unit MGU (iDrive 7)
┌────────────────────────┐   USB / Wi‑Fi   ┌─────────────────────────────────────────────┐
│ scrcpy-server 5.0.1    │◄── ADB ────────►│ dex-drive-d (service, root)                 │
│  • virtual display     │   H.264 video   │  • ADB: usbfs or TCP 5555, its own RSA key  │
│    1832×720 → DeX      │────────────────►│  • dexdec: GPU (Intel Media SDK) → I420     │
│  • touch, scroll       │◄── control ─────│    → /dev/shm/mgu-video-dexdrive            │
└────────────────────────┘                 │ DeX Drive (app)                             │
                                           │  • mgu-render: a layer with the video, touch │
                                           └─────────────────────────────────────────────┘
```

- **scrcpy-server** (Genymobile, Apache‑2.0) runs on the phone over ADB, no root, and creates a new virtual display.
  One UI 8 shows DeX on it: the same thing `scrcpy --new-display` does on a PC.
- **dex-drive-d** is the service on the unit (Go, static): an ADB host without libusb (it takes only the phone's ADB
  interface; MTP and media stay the car's), copies the server to the phone, reads the video, passes touches back.
- **dexdec** is a hardware H.264 decoder on the unit's GPU (Intel HD 505, Media SDK), from RideTube's ytdec and
  waze-on-cluster. It writes the frames into mgu-render's video file.
- **DeX Drive** is the page in the iDrive menu and the layer over the screen, through mgu-render (the renderer
  RideTube uses).

## What you need

- An iDrive 7 head unit with root, the MGU Store and **mgu-render 0.6.11+** (the Store installs it; RideTube has it).
- For the iDrive controller: **Controller gate** (`mgu-inputgate`, source `cauliflowermossgrape/idrive7-apps`, in the
  Store's "Head-unit tools"). The Store installs it with DeX Drive; restart the unit after it.
- A Samsung phone with **One UI 8 or later** (Android 16). Older One UI cannot run DeX on a virtual display; the
  service says so.
- On the phone: **Developer options → USB debugging** on.
- For Wi‑Fi: ADB on port 5555 (below). USB needs nothing more.

## Install

1. Store → Settings → Sources: source `Zakh294/bmw-sugar-apps`, Channel **`main`** (as for SpeedCam) → Check now.
2. Store → **DeX Drive** → Install. The Store installs **DeX Drive service** (`dex-drive-d`), mgu-render and Controller gate with it.
3. **Restart the head unit** (Settings → Restart head unit): a new service starts only after a restart (the unit's
   recmgr). Until then the Store shows it as *restart pending*.

## First connection (USB)

1. Plug the phone into a USB port with data (the one for CarPlay / Android Auto / music).
2. Open **DeX Drive** in the apps menu → **Open DeX on the screen**.
3. The phone asks "Allow USB debugging?" for the key "BMW-iDrive@dex-drive" → tick **"Always allow from this
   computer"** → **Allow**. It does not ask again.
4. The phone may ask how to use the second screen: pick **DeX**.
5. DeX takes the screen a few seconds later. Bottom left: a button with four squares, back to DeX Drive's page
   (settings, "Stop"). The iDrive back arrow top left leaves, as it leaves any app.

Next time: plug in → open DeX Drive → DeX is on the screen (at once if the session is still alive).

## Wi‑Fi (no cable)

The service looks for the phone on port **5555** among the devices the unit sees (the phone on the car's hotspot
`DIRECT-BMW`, or the unit on the phone's hotspot through mgu-uplink). Port 5555 is opened:

- **by the car (simplest):** with "USB or Wi‑Fi", plug the phone in by USB once after it has started. The service
  opens port 5555 on it (as `adb tcpip 5555`; USB reconnects for a few seconds, the page says "Turning on ADB over
  Wi‑Fi…"). Until the phone restarts, no cable is needed;
- from a PC: `adb tcpip 5555` (the phone on USB), or
- on the phone itself: Termux (`pkg install android-tools`) or LADB through "Wireless debugging".

While the phone is on the cable, the service keeps its Wi‑Fi address and looks for it there later, else goes
through its whole Wi‑Fi network on port 5555. The phone and the car must share a network: the phone on the car's
hotspot, the car on the phone's, or both on one Wi‑Fi.

After the phone restarts, port 5555 is closed again (Android does that). Android 11+ "Wireless debugging" (pairing
code, TLS) is not supported yet. A phone with a fixed address can be written into
`/var/opt/dex-drive-data/phone-ip` (over SSH; one line `IP` or `IP:port`).

For Wi‑Fi, "Video quality: 4 Mbit/s" works better.

## Settings

| Setting | What it does |
|---|---|
| Мова / Language | Ukrainian or English |
| Phone connection | USB or Wi‑Fi (ADB 5555) / USB only |
| DeX scale | the virtual display's density: 120–240 dpi, lower = more fits, smaller |
| Frames per second | 30 or 60 |
| Video quality | 4 / 8 / 16 Mbit/s |
| Parked only | on: while driving (over 3 km/h) DeX hides, the session stays |
| The iDrive controller works DeX | knob, press and tilt are DeX's while it shows (below) |
| The controller's touchpad is DeX's pointer | the touchpad on the knob works as a laptop's |
| Turn the phone's screen off | after the start, turns off the phone's own screen (DeX keeps running); the power key turns it on |

Changing the scale, frames, quality or connection starts DeX again with them. (The settings' labels are in
Ukrainian in 0.1.0.)

## The iDrive controller

While DeX is on the screen, the controller works it (MENU / BACK and the on-screen back arrow leave, as always):

| Action | In DeX |
|---|---|
| A finger on the touchpad | moves DeX's pointer (a quicker move goes further) |
| A short tap on the touchpad | left click |
| A two-finger tap | right click (context menu) |
| Two fingers up / down | scroll (the content follows the fingers) |
| Turning the knob | scroll where the pointer is |
| Pressing the knob | click where the pointer is; held: a long press, with a finger on the touchpad: a drag |
| Tilt ↑ ↓ ← → | arrow keys |

The pointer goes where you last touched the screen. The touchpad works only in the controller's touch mode: DeX
Drive turns it on while DeX shows and off after (as the iDrive handwriting screen does).

## What is tested, what is not

**Tested on a PC** (`native/dex_drive/dexd`: `go test`, `test/dex_drive/*.js`):
- ADB: handshake, the key (Android's format and the signature, checked by a fake adbd as a real one checks them),
  the "allow" prompt, connecting again without it, `push` over sync, shell, streams with flow control;
- the scrcpy 5.0.1 protocol: the server's arguments, the video and control sockets, headers, touch, key and scroll
  messages, byte for byte from the server's source;
- video to the MGVF file through the fake decoder (the same `main.cpp`, no GPU);
- the app in the kit's stubbed head unit against a fake mgu-render: the layer's place, the video, multi-touch, the
  menu button, the knob held;
- `dexdec` built for the unit (x86‑64, glibc 2.27, `/lib/ld-linux-x86-64.so.2`), every Media SDK / VA import exported
  by the unit's libraries (by RideTube's symbol lists).

**Car only** (what may not work the first time):
- USB through usbfs on the unit (whether another process holds the phone; the car's wired Android Auto);
- hardware decoding of the phone's live stream (`dexdec`, decoding order for the lowest latency);
- whether One UI starts DeX on the virtual display by itself or asks;
- the left column's see-through (the iDrive back arrow over our layer), the knob's direction;
- the controller's touchpad (touch mode, the pointer's direction and speed): the signal values are what others
  measured in their cars, not yet tried on our G01.

## Something wrong

Logs on the unit (over SSH):

```sh
journalctl -u dex-drive-d -n 100          # the service
cat /var/opt/dex-drive-data/dexd.log      # the service: connection, phone, session
cat /var/opt/dex-drive-data/dexdec.log    # the decoder
journalctl -u mgu-render -n 50            # the renderer (did it take the video, does it show the layer)
```

| The page says | What to do |
|---|---|
| The dex-drive-d service is not running | install "DeX Drive service" and restart the unit |
| Looking for the phone on USB… | turn on "USB debugging"; try another cable / a data port |
| On the phone, press "Allow" | unlock the phone, confirm; "Forget this car's ADB key" makes it ask again |
| … needs One UI 8 (Android 16) | the phone runs older firmware: no DeX on a virtual display |
| the hardware decoder did not start | send `dexdec.log`: this is the part a PC cannot test |
| No mgu-render / cannot show video | install or update mgu-render (0.6.11+) |

## Remove

Store → Installed → DeX Drive → Remove, then DeX Drive service → Remove. The unit's ADB key stays in
`/var/opt/dex-drive-data` (delete the folder if you like); on the phone: Developer options → "Revoke USB debugging
authorisations".

## Licences

The app and the service: MIT. The decoder `dexdec`: GPL‑3.0‑or‑later (code from waze-on-cluster / RideTube).
scrcpy-server: Apache‑2.0, unchanged. Details: `native/dex_drive/prebuilt/NOTICE`.
