# Installable Lumora apps

Lumora is one web app, installable three ways. All of them work fully offline, and your data
never leaves your device.

| Where | What you get | How it's built |
| --- | --- | --- |
| Any modern browser | "Install app" in Lumora's footer (or the browser's install icon) | The web app itself (PWA), once it's hosted (see the main README) |
| Android phones and tablets | `Lumora-<version>-android.apk` | `apps/android` (Capacitor) |
| Windows | `Lumora-<version>-win-x64.exe` installer | `apps/desktop` (Electron) |
| Mac | `Lumora-<version>-mac-universal.dmg` | `apps/desktop` |
| Linux | `.AppImage` (runs anywhere) and `.deb` | `apps/desktop` |

## Getting the files

GitHub builds everything automatically (`.github/workflows/apps.yml`):

- **Every push**: open the repository's **Actions** tab, then the latest **Apps** run. The APK
  and installers are under **Artifacts** at the bottom of the page (you need to be signed in to
  GitHub).
- **Public download links**: tag a release and push the tag:
  ```sh
  git tag v0.6.0
  git push origin v0.6.0
  ```
  The files then appear on the repository's **Releases** page.

## Installing

- **Android**: open the `.apk` on the phone. Android asks once to allow installs from that
  source (your browser or Files app). Exports open the share sheet, so you can save them to
  Files, Drive or email.
- **Windows**: run the `.exe`. The app isn't code-signed yet, so SmartScreen may say "Windows
  protected your PC": choose **More info → Run anyway**.
- **Mac**: open the `.dmg` and drag Lumora to Applications. Because it isn't notarized yet, the
  first time **right-click the app → Open → Open**.
- **Linux**: `chmod +x Lumora-*.AppImage` and run it, or `sudo apt install ./Lumora-*.deb`.

The installed apps update when you install a newer file. The browser-installed version updates
itself.

## Building on your own computer

The packages copy the web app from the repository root (`node apps/copy-web.mjs`), so there is
nothing to keep in sync by hand. Version numbers come from the root `package.json`.

```sh
# Desktop: runs Lumora in a window, then builds an installer for your current system into apps/desktop/dist
cd apps/desktop && npm install && npm start
npm run dist

# Android: needs Android Studio (or the Android SDK) and Java 21
cd apps/android && npm install && npm run sync
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

Changed the logo? Run `python3 apps/android/make-icons.py` (needs Pillow) and replace
`apps/desktop/build/icon.png` (1024×1024).

## Signing the Android app (recommended before sharing widely)

Without a key, GitHub builds a *debug-signed* APK. It installs fine, but each build is signed
with a different throwaway key, so a newer APK can't install over an older one (uninstall first).
To fix that, create your own key once and give it to GitHub as secrets:

```sh
keytool -genkey -v -keystore lumora.jks -alias lumora -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 lumora.jks   # copy the output
```

In the repository: **Settings → Secrets and variables → Actions → New repository secret**:
`ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
(`lumora`) and `ANDROID_KEY_PASSWORD`. Keep `lumora.jks` safe and private: every future version
must be signed with it. The same key is needed to publish on Google Play.
