# Fridge display — Fire HD 8 setup

The board lives at **`/kiosk`**. It shows what needs eating first and what is
planned for tonight, in type meant to be read from across the kitchen, and it
updates itself — Firestore pushes changes straight to it, so there is nothing to
refresh and no polling to configure.

This page is the tablet half: getting a Fire HD 8 to boot into it and stay there.

---

## 1. Sign in once, on the tablet

Open the app in Silk, sign in normally, and leave it signed in. Firebase keeps
the session in IndexedDB, so it survives reboots and does not need re-entering.

Then go to **Settings → Fridge Display** and turn on **"Use this device as the
fridge display"**. That is per-device, so your phone is unaffected. With it on,
this tablet drifts back to the board a couple of minutes after anyone stops
touching it — otherwise the next person finds whatever half-filled form the last
person walked away from.

## 2. Let the tablet install apps from outside the Appstore

Fire tablets have no Google Play, and Silk cannot run as a true kiosk. Fully
Kiosk Browser is the usual answer for wall-mounted Android.

**Settings → Security & Privacy → Apps from Unknown Sources** → enable it for
Silk. (On older Fire OS: **Settings → Security → Apps from Unknown Sources**.)

## 3. Install Fully Kiosk Browser

In Silk, go to `https://www.fully-kiosk.com` and download the APK, then open it
from the notification shade to install. The free version does everything needed
here.

## 4. Point it at the board

In Fully Kiosk, **Settings → Web Content Settings**:

| Setting            | Value                                      |
| ------------------ | ------------------------------------------ |
| Start URL          | your app's URL + `/kiosk`                  |
| Enable JavaScript  | on                                         |
| Enable DOM Storage | on — **required**; the sign-in lives there |

Leave "Clear Cache on Start" and "Clear Cookies on Start" **off**. Either will
sign the tablet out on every boot.

## 5. Make it behave like a fixture

**Settings → Device Management**:

- **Keep Screen On** — on. This is the real fix; the app also asks the browser
  for a wake lock, but a browser is allowed to refuse and Fire OS often does.
- **Screen Off Timer** — 0 (never), or set a schedule if you would rather it
  sleep overnight.
- **Screensaver** — off, unless you want the screen to dim between visits.

**Settings → Kiosk Mode**:

- **Kiosk Mode** — on. This is what stops a passing tap escaping into Fire OS.
- **Set a Kiosk PIN.** Write it down. Without it you cannot get out of kiosk
  mode without a factory reset.

**Settings → Advanced Web Settings**:

- **Auto-Reload on Idle** — leave **off**. The board is already live, and a
  reload throws away the wake lock and re-downloads the app for nothing.

**Settings → Power Settings**:

- **Start on Boot** — on, so a power cut does not leave a blank fridge.

## 6. Mount it

Any tablet wall mount with a magnetic or adhesive fridge plate. Two things worth
getting right:

- **Keep the charging port reachable.** This is a screen that is on all day; it
  needs to stay plugged in.
- **Landscape.** The board is laid out for it — 1280×800 with the food that
  needs eating in the wider column.

---

## Getting back out

Tap the small icon in the top-right of the board for the full app. To leave
Fully Kiosk entirely, tap the screen seven times quickly and enter the PIN.

## If the screen keeps going dark

The board says so at the bottom when it could not get a wake lock from the
browser. That is expected on Fire OS — **Fully Kiosk → Device Management → Keep
Screen On** is what actually holds it, and the Fire's own
**Settings → Display → Screen Timeout** should be set to the longest option as
a backstop.

## If it signs itself out

Almost always "Clear Cookies on Start" or "Clear Cache on Start" left on in
Fully Kiosk, or DOM Storage disabled. The sign-in lives in browser storage; wipe
it on boot and the tablet asks for a password every morning.

## A note on battery

A tablet held at 100% charge on a wall for years will swell its battery
eventually. If you want to be careful about it, Fully Kiosk can stop charging
above a set level on some devices, or put the charger on a smart plug and let it
cycle between roughly 40% and 80%. This is a hardware habit, not something the
app can manage.
