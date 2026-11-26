# SpeedCam — what's new

A short note on every version. The app's page in the MGU Store shows the same for the current version.
[Українська](CHANGELOG.md)

## 0.6.1 (2026-11-26)
- "HUD style" → "Camera and distance only": the projection shows a blinking camera in a red ring and the distance,
  without the speed and the limit sign (BMW's panel shows them). Over the limit the distance turns amber / red. The
  cluster and the map keep the chosen "Warning style".

## 0.6.0 (2026-11-23)
- "Warning style" setting: Classic (as before, the default), BMW (a countdown ring round the sign, thin white type,
  red that breathes over the limit), Minimal (the sign and the distance).
- BMW and Minimal: smaller and dimmer while the camera is more than 6 s away; full size nearer or over the limit.
- "Test", parked, goes through every step: quiet, near, over, well over.
- The camera databases screen no longer vanishes behind the main page after a second.

## 0.5.2 (2026-11-22)
- HUD: "Car speed on the HUD" can be switched off (BMW's panel shows it already); the warning then is compact: the
  sign, the camera, the distance and the bar.
- HUD: "Height on the HUD" moves the warning up or down to the level of BMW's panel.
- HUD: "Limit sign on the HUD": our sign hides while the car shows the same limit. The sign-recognition signal is
  searched for when the Store builds the app; the "CAR'S LIMIT" row on the page shows what was found.
- The Store shows what is new in the version (8 languages).

## 0.5.1 (2026-11-22)
- "No GPS signal (garage, tunnel?)" instead of "waiting for the navigation" once a position was there and went away.
- Roughly how many cars run the app: the monthly database index as a release with a download count.

## 0.5.0 (2026-11-21)
- Europe and the USA (OpenStreetMap), 8 languages, the language chosen by the country.
- The law: off in Germany, Switzerland and others, zones only in France.
- Databases chosen by country and state, updated once a month. Public documentation.

## 0.4.0 (2026-11-21)
- A chime through BMW's media player, 5 sounds, an alarm when over the limit.

## 0.3.x (2026-11-21)
- "Only when I'm over the limit", size, HUD brightness, dimmer at night, sound diagnostics.

## 0.2.0 (2026-11-19)
- The warning inside the Waze / Google map on the cluster.

## 0.1 (2026-11-18)
- First version: offline warnings for Ukraine's cameras on the HUD and the cluster.
