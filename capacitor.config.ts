import type { CapacitorConfig } from '@capacitor/cli';

// Set CAP_ENV=local before `npx cap sync` / `npm run ios:sync:local` to point the native
// shell at your own machine's dev server (npm run dev) instead of production — see the
// ios:sync:local / android:sync:local package.json scripts. Any other value (or unset, the
// default) points at production. This file is executed by the Capacitor CLI at sync time, so
// this branch is baked into ios/App/App/capacitor.config.json / android's equivalent when you
// sync — re-run the matching sync script whenever you want to switch which one the app loads.
const isLocal = process.env.CAP_ENV === 'local';

// iOS Simulator shares the host Mac's network stack, so plain `localhost` reaches your dev
// server directly. The Android emulator does NOT — it's a separate VM, so `localhost` inside
// it means the emulator itself.
//
// DO NOT point the emulator at `10.0.2.2` (its host-loopback alias) — Chromium's WebView only
// treats `localhost`/`127.0.0.1` as a secure origin, not `10.0.2.2`. Off that allowlist, every
// secure-context-gated Web API disappears silently, including `crypto.randomUUID`, which
// Firestore's onSnapshot listeners and the login-options query use — the app loads but every
// data fetch fails with `crypto.randomUUID is not a function` and nothing renders (confirmed
// 2026-08-23: this is exactly what broke Android-local data fetching after it worked on iOS).
// Instead forward the emulator's own `localhost:3000` to the Mac's, so it's a real secure
// context exactly like iOS:
//   adb reverse tcp:3000 tcp:3000
//   npm run android:sync:local   (leave LOCAL_DEV_HOST unset — default 'localhost' is correct)
// `adb reverse` also works over USB for a physical Android device, same as above.
//
// A physical device with no `adb reverse` set up (or over Wi-Fi debugging) has no path to the
// Mac's localhost at all — it needs the Mac's actual LAN IP (e.g. 192.168.1.42) instead,
// reachable only while both are on the same network. That LAN IP is itself an insecure origin
// (same failure mode as 10.0.2.2 above), so this is a fallback for when adb reverse isn't an
// option, not a preferred path.
const localHost = process.env.LOCAL_DEV_HOST || 'localhost';

const config: CapacitorConfig = {
  appId: 'com.suvenexam.app',
  appName: 'Suven Edu Exam Portal',
  webDir: 'dist',
  server: isLocal
    ? {
        // Matches server.ts's PORT (server/config.ts) — must be running (`npm run dev`)
        // before you launch the native app, same as testing in a browser.
        url: `http://${localHost}:3000`,
        // Plain HTTP is blocked by iOS's App Transport Security by default; this is a local
        // dev-only exception, never used in the production branch above.
        cleartext: true
      }
    : {
        url: 'https://suven-examination-22304846047.asia-south1.run.app',
        androidScheme: 'https',
        // www.suvenexam.com redirects (301 -> suvenexam.com -> this same Cloud Run origin).
        // Capacitor's WebView doesn't tolerate a cross-origin redirect chain on its initial
        // load of server.url — it bounces out to the system browser instead of following it
        // internally (confirmed: this is what made the app open real Safari instead of
        // rendering in-app). Pointing url at the final origin directly avoids that entirely;
        // allowNavigation is kept as a safety net for any later in-app navigation to these
        // domains.
        allowNavigation: ['suvenexam.com', '*.suvenexam.com', 'suven-examination-22304846047.asia-south1.run.app']
      }
};

export default config;
