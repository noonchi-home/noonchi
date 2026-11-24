# NOONCHI Android

Scan the dashboard's connection QR inside the Android app. The app checks the hub's HTTPS `/mobile/` origin with a read-only `GET /api/setup` and then opens native Home, House Management, and Settings. Pairing also works before the first home is registered. A fresh app launch begins at the scanner. Use **서버 연결 끊기** in Settings to pair with another hub.

## Set up a home

- Use **집 관리** to find a supported home, confirm its floor plan, and open its prepared twin. Match the reference view, capture a photo, and confirm it. Saved views remain available for review or retake. Hold the phone in landscape to match the reference.
- Use **설정** to pair supported LG ThinQ appliances, select the input devices and test or live appliance mode, set the starting position and direction, or edit observation stations and their zones. The layout screen lists layout corrections and supports saving or resetting them. Use the web settings for the full layout editor. [Server and phone reference](../../docs/reference.md)
- The hub must provide a reference scene catalog for the selected home. A 404 from the catalog means the reference views are unavailable. With S3 signing enabled, Android uploads the JPEG and JSON label, then keeps a review copy on the phone. An HTTP 503 from the signing request saves the capture on the phone. A failed upload after signing shows a save error. [Reference photo setup](../../docs/deploy.md#reference-photos-and-optional-s3-uploads)

## Development

Use Node.js 22.13 or later and Expo Go for Android SDK 58. `apps/android` is a separate npm package. [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/) · [Install Expo Go](https://expo.dev/go)

```powershell
Set-Location apps/android
$env:EXPO_NO_DOTENV = '1'
npm --prefix ../.. run heavy -- npm ci
npm start
```

- Open the **Expo development QR** in Expo Go to load the Metro development app. Scan the **dashboard connection QR** inside the running NOONCHI app. The phone must be able to reach the hub's HTTPS origin.
- Expo Go supports development of the native screens. The signed installable APK includes the custom TWA bridge. [Expo native modules](https://docs.expo.dev/workflow/customizing/)
- Retry a denied scanner or reference-camera permission in the app. If Android blocks another prompt, grant camera access from **앱 설정 열기**. The native app follows the Android rotation setting.

## Start the WebXR camera

On the connected home, tap **클로이드 켜기**. The app reads `android_twa` from `/api/setup` and checks that its HTTPS `phone_url` and `assetlinks_url` share the same origin and port. Set `ANDROID_TWA_SHA256_FINGERPRINTS` on the camera service to the public SHA-256 certificate fingerprint of the installed `app.noonchi.android` APK. Chrome must verify `delegate_permission/common.handle_all_urls` for the exact camera origin. The sample deployment uses hub port 443 and AR port 8443. The app follows the URL returned by the hub. [Deployment and checks](../../docs/deploy.md#android-camera-twa) · [Digital Asset Links setup](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide/)

Use **카메라 켜기** on the opened page and grant camera permission. When immersive WebXR starts, the page requests a landscape lock. If the lock fails while the phone is in portrait, follow the prompt to rotate it. Align at the saved starting position. The page reads current commands in Korean and accepts scoped spoken or tapped replies where the browser supports speech. Android Back returns to the app. On the actual phone, check the address-bar-free TWA, rotation, camera and microphone permissions, tracking and audible speech. [WebXR step round trip](../../docs/architecture/webxr-roundtrip.md)

## Tests and local APK

Check for at least 3 GiB of available memory before tests or builds. Run the commands from `apps/android`, one heavy command at a time. [Android SDK setup](https://developer.android.com/about/versions/17/setup-sdk) · [Local Expo production builds](https://docs.expo.dev/guides/local-app-production/)

```powershell
npm --prefix ../.. run heavy -- npm test
npm --prefix ../.. run heavy -- npm run typecheck
npm --prefix ../.. run heavy -- npm run export:android
npm --prefix ../.. run heavy -- npm run prebuild:android
npm --prefix ../.. run heavy -- android\gradlew.bat -p android :app:assembleRelease --no-daemon --max-workers=1 -PreactNativeArchitectures=arm64-v8a
```

The local build uses JDK 21, Android SDK Platform 37.0, Build Tools 37.0.0, and NDK 27.1.12297006. Expo's generated Android project produces the locally signed test APK at `apps/android/android/app/build/outputs/apk/release/app-release.apk`. The release includes its JavaScript and splash assets. Network access is required from dashboard pairing onwards.

On Windows, the Android Gradle plugin can reject paths containing Korean characters. Copy the app source, `assets/`, and `package-lock.json` to an ASCII-only temporary path and run `npm ci`, `npm run prebuild:android`, then Gradle. In the temporary path, use the repository root's absolute path for `npm --prefix` so commands still use the shared `heavy` lock.

For Ninja's 260-character path error, merge these settings into the generated `android` and `defaultConfig` blocks in `android/app/build.gradle` and rerun Gradle. [CMake object path limit](https://cmake.org/cmake/help/v3.22/variable/CMAKE_OBJECT_PATH_MAX.html)

```groovy
android {
    externalNativeBuild {
        cmake { buildStagingDirectory = file("C:/nc") }
    }
    defaultConfig {
        externalNativeBuild {
            cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=240" }
        }
    }
}
```

The app reuses the team assets in `ui/public/brand/` and the existing `ui/public/icon-512.png` icon.
