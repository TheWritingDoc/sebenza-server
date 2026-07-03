# Sebenza — Mobile App (Capacitor)

The native Android/iOS apps are a **Capacitor wrap of the existing PWA**. They load
the live site (`https://sebenza-server.onrender.com`) inside a native WebView, so:

- Web changes ship instantly with a normal Render deploy — **no app-store resubmit
  needed** for UI/logic changes.
- Camera (`getUserMedia`), geolocation, and QR scanning run through the WebView with
  **native OS permissions** (declared in the manifests below).
- You only resubmit to the stores when you change native config (icons, permissions,
  Capacitor version, app id).

App identity: **appId `za.co.sebenza.app`**, **appName `Sebenza`** (`capacitor.config.json`).

---

## One-time setup

```bash
cd client
npm install          # installs Capacitor + plugins
npm run build        # produces the web assets Capacitor bundles as a fallback
npx cap sync         # copies assets + native plugin config into android/ (and ios/)
```

The `android/` project is committed. `ios/` must be generated on a **Mac** (see below).

## Android — build & release

Requires **Android Studio** + JDK 17.

```bash
cd client
npm run cap:android      # syncs and opens the project in Android Studio
```

In Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**,
create/select an upload keystore, then upload the `.aab` to the Google Play Console.

Permissions are already declared in `android/app/src/main/AndroidManifest.xml`:
`INTERNET`, `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`.

## iOS — build & release (Mac only)

```bash
cd client
npx cap add ios          # generates the ios/ project (run once, on a Mac)
npm run cap:ios          # syncs and opens Xcode
```

Add these usage strings to `ios/App/App/Info.plist` (App Store requires them or it
rejects the build):

```xml
<key>NSCameraUsageDescription</key>
<string>Sebenza uses your camera to take geo-tagged before/after proof photos for jobs.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Sebenza uses your location to show nearby jobs, share live location with the other party, and verify you're at the job site.</string>
```

Then in Xcode: set your Team/signing, **Product → Archive**, and upload to App Store
Connect.

## Updating the wrapped app

- **Web/logic change:** just deploy to Render. The apps pick it up on next launch.
- **Native change (icons, permissions, plugins, Capacitor upgrade):**
  `npm run build && npx cap sync`, rebuild in Android Studio / Xcode, resubmit.

## App icons & splash

Drop a 1024×1024 icon and a splash image in an `assets/` folder and run
`npx @capacitor/assets generate` (install `@capacitor/assets` first) to produce all
density variants for both platforms. Splash background is `#6366f1` (Sebenza indigo),
configured in `capacitor.config.json`.
