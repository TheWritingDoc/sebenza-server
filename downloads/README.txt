APK BUILD INSTRUCTIONS
======================

The gshop.apk file must be built from the Android project.

1. Build the web app:
   cd client
   npm run build
   npx cap sync android

2. Open client/android in Android Studio

3. Build → Build Bundle(s) / APK(s) → Build APK(s)

4. Copy the output APK here:
   cp client/android/app/build/outputs/apk/debug/app-debug.apk server/downloads/gshop.apk

5. Restart the server

The download button on the website points to /downloads/gshop.apk
