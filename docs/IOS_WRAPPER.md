# Converting Pour List from Web App to iPhone App

This guide walks you through every step to take Pour List — currently a web app at pourlist.app — and publish it as a native iPhone app in Apple's App Store. The chosen approach is **Capacitor**, a tool that wraps an existing web app in a native iOS shell. You keep your existing codebase; you add a native layer on top.

**Time estimate:** 6–10 hours of work spread over several days (Apple review takes 24–48h by itself).  
**Financial cost:** $99/year Apple Developer Program membership.  
**Prerequisite knowledge:** Comfortable with terminal, basic understanding of Xcode, familiarity with how native iOS apps are structured.

---

## What We Are Doing and Why

An iPhone app is, at its lowest level, a directory of files with a specific structure that Apple understands. Capacitor creates a native iOS project that loads your web app inside a WebView — essentially an embedded Safari browser with no address bar.

```
Pour List web app (Next.js)
    ↓  (npm run build → static files)
Static files in /out directory
    ↓  (Capacitor sync copies these into the iOS project)
ios/ThePourList.xcodeproj (native shell with WebView)
    ↓  (Xcode builds into an .ipa archive)
App Store
```

**What this means practically:**
- Your Next.js React code runs exactly as it does today
- Supabase API calls work without any changes
- Mapbox renders in the WebView (WebGL works in Capacitor's embedded browser)
- Camera and GPS via web APIs work as-is

**What this doesn't automatically give you:**
- Push notifications (require a separate plugin, covered in Phase 6)
- Native UI animations that feel like Swift — but the current UI is already Tailwind/React, so this is moot
- App Store presence — that's what the wrapper gives you

**Important limitations to know before you start:**

1. **Service workers do not work in a Capacitor WebView.** This is a critical limitation. Service workers require HTTPS or `localhost` — they silently fail under the `file://` protocol that a Capacitor WebView uses. If Pour List's PWA relies on a service worker for offline functionality, that feature will silently break on device. The PWA install banner ("Add to Home Screen") still works, but offline caching via service worker will not. Do not depend on service worker-based offline mode in the iOS app.

2. **API routes (`/api/` routes) are excluded from static export.** Next.js API routes are server-side code and are not included in `output: 'export'`. If the app calls any internal Next.js API routes (e.g., `/api/parse-menu`, `/api/submit-menu`, etc.), those routes will be missing from the exported app. Pour List calls Supabase directly from the browser for all API functionality — so this doesn't affect Pour List. But if you add any new `/api/` routes in the future, they will silently not work on iOS. The fix is to move those endpoints to Supabase Edge Functions.

3. **`exportTrailingSlash: true` silently breaks links without trailing slashes.** This setting causes `next/link` to generate URLs with trailing slashes. Any hardcoded link in the codebase that doesn't have a trailing slash will produce a 404 on the iOS app. Before shipping, manually test every route transition in the app on a device to confirm no 404s.

---

## Step 0: Read This Entire Guide First

Before running a single command, read this guide in full. Some steps depend on earlier steps being done correctly. Skipping ahead will cause you to redo work.

---

## Phase 1: Understand What You're Starting With

Before making any changes, familiarize yourself with the current project structure.

### 1.1 The existing project layout

```
pourlist/
├── src/
│   ├── app/           ← Next.js App Router pages
│   ├── components/    ← React components (VenueDetail, Map, MenuCapture, etc.)
│   └── lib/           ← Utilities (Supabase client, GPS, parse-hh, analytics)
├── public/
│   ├── icon-192.png   ← PWA icon (192×192)
│   ├── icon-512.png   ← PWA icon (512×512)
│   └── manifest.json  ← PWA manifest
├── next.config.ts     ← Next.js configuration ← CRITICAL FILE
├── package.json
└── ...config files
```

The important file right now is `next.config.ts`. Open it and look for `output:`. This controls where the build output goes.

### 1.2 The critical question: Static Export vs. Server-Side Render

Next.js can work in two modes:

**Mode A: Server-Side Render (default)**  
`next build` outputs a Node.js server + client assets in `.next/` directory. This requires a running Node.js server to serve the app. Capacitor cannot host a Node.js server inside an iOS app.

**Mode B: Static Export**  
`next build` outputs only static HTML/CSS/JS files in `out/` directory. These are plain files that can be served from any static file server — including the file:// protocol inside an iOS WebView. This is what Capacitor needs.

### 1.3 Check your current config

Open `next.config.ts` (or `next.config.js`). Look for this line:

```typescript
output: 'export'
```

If that line exists, you are already configured for static export. Skip to Phase 2.

If it does not exist, you need to add it. Here is the full `next.config.ts` with the correct settings for Capacitor:

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Generate a pure static export — required for Capacitor
  output: 'export',

  // Exclude the ios/ and capacitor-related directories from the static export
  // (they don't belong in the output, they live outside /out)
  exportTrailingSlash: true,

  // Optional: ensures images and fonts work offline if you use next/image
  images: {
    unoptimized: true,
  },
}

export default nextConfig
```

**Why `exportTrailingSlash: true`:** Next.js links tend to look like `/venues/123` without a trailing slash. Static export requires trailing slashes (`/venues/123/`) for file-based routing to work correctly. This setting forces all routes to have trailing slashes, which makes the exported files work as proper HTML pages.

**Why `images.unoptimized: true`:** Next.js's image optimization pipeline requires a running Node.js server. With static export, `next/image` cannot optimize images on-the-fly. Setting this to `true` makes `next/image` output plain `<img>` tags with the `src` pointing directly to the original image files, bypassing the optimization pipeline. For an app where images come from Supabase (already optimized), this is fine.

**⚠️ Critical: Verify all image `src` values are absolute URLs.** When using `unoptimized: true`, if any `next/image` component has a relative `src` (e.g., `src="/venue-photos/xxx.jpg"`), it will resolve as a file path under `file://` on iOS and fail silently. Before shipping, search the codebase for any relative image URLs and convert them to absolute Supabase URLs. Test on physical hardware to confirm images load.

**Alternative:** You could use standard `<img>` tags throughout the app instead of Next.js's `next/image` component. This avoids the `unoptimized: true` requirement. But it's a significant refactor. If your current codebase uses `next/image`, use the `unoptimized: true` setting instead.

### 1.4 Verify the build produces the right output

Once you've added (or confirmed) `output: 'export`, run:

```bash
npm run build
```

After the build completes, check that an `out/` directory exists in the project root:

```bash
ls out/
# You should see: _next/  static/  index.html  (and possibly other files)
```

If `out/` exists and contains HTML/JS/CSS files, your build is correctly configured for Capacitor. If the build produces `.next/` instead of `out/`, the `output: 'export'` config is not taking effect — troubleshoot the config syntax before proceeding.

This is the most common failure point in the entire process. If your build still outputs to `.next/` after adding the config, do not proceed. Fix the config first.

---

## Phase 2: Set Up Your Apple Developer Account

Before you can build for a physical iPhone or submit to the App Store, you need an Apple Developer Program membership.

### 2.1 Enroll

Go to [developer.apple.com/programs](https://developer.apple.com/programs/) and click Enroll. There are two program types:

- **Individual** ($99/year) — for personal apps, you are the account holder
- **Organization** ($99/year) — for businesses with a D-U-N-S number

For Pour List, if you're publishing as an individual (your name), use the Individual enrollment. You'll need to provide your legal name and basic identity verification.

### 2.2 What you get

- A **Team ID** (a 10-character alphanumeric string, e.g., `XXXXXXXXXX`)
- Access to App Store Connect (appstoreconnect.apple.com)
- Ability to create distribution certificates and provisioning profiles
- The right to submit apps to the App Store

### 2.3 Note on timing

Enrollment can take 24–48 hours to process after you submit it. You cannot configure Xcode signing or submit to App Store Connect until the enrollment is complete. Start this step early. You can proceed with Steps 3–5 while waiting for enrollment to process.

---

## Phase 3: Install Capacitor

With your Apple Developer account pending, move on to setting up Capacitor locally.

### 3.1 Install Node dependencies

From the `pourlist/` directory:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
```

This installs three packages:
- `@capacitor/core` — the runtime that bridges web and native
- `@capacitor/cli` — the command-line tool for managing the project
- `@capacitor/ios` — the iOS platform plugin

### 3.2 Initialize Capacitor

```bash
npx cap init "The Pour List" "com.pourlist.app" --web-dir=out
```

This command takes two required arguments:
1. **App name** — `"The Pour List"` — this appears on the iPhone home screen
2. **App ID** — `"com.pourlist.app"` — a reverse-domain identifier. You can choose any valid domain you control; the convention is `com.yourcompany.yourapp`. This ID must be unique across all App Store apps and cannot be changed after you submit.

The `--web-dir=out` flag tells Capacitor where to find the static files it will package. This must match the directory that `npm run build` produces.

After running this, you'll see a new file `capacitor.config.ts` at the project root. It looks like this:

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pourlist.app',
  appName: 'The Pour List',
  webDir: 'out',
  server: {
    // We'll configure this in Step 4.3 for development
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
  },
};

export default config;
```

### 3.3 Add the iOS platform

```bash
npx cap add ios
```

This creates the `ios/` directory — a complete Xcode project that wraps your web app. It includes:
- A `Podfile` (CocoaPods dependencies, managed by Capacitor)
- An `Info.plist` (iOS app metadata and permissions)
- Native Swift/Objective-C files that host the WebView

**Do not directly edit files inside `ios/`** except where this guide explicitly instructs. Capacitor overwrites native files on every `npx cap sync ios`. Any manual changes to Xcode project files (custom build settings, scheme changes, entitlements) will be silently wiped on `cap sync ios`. If you need to configure something not covered by `capacitor.config.ts`, you'll need to either find a Capacitor plugin that exposes it, or accept that the change requires re-application after every sync.

### 3.4 Security: Your API Keys Are Visible to Anyone Who Downloads the App

This is the most important security consideration for a Capacitor app.

When you build the web app, your Mapbox API token, Supabase anon key, and any other secrets embedded in the JavaScript bundle end up inside the IPA file. An IPA is just a ZIP archive — anyone who downloads your app from the App Store can unzip it, extract the JavaScript, and read any API keys or tokens embedded in it.

**For Pour List, two keys are at risk:**

1. **Mapbox token** — embedded in the client bundle. Anyone who extracts it could use your Mapbox account within your rate limits.
2. **Supabase anon key** — embedded in the client bundle. Anyone who extracts it can make API calls to your Supabase project within whatever RLS policies are in place.

**Mitigations — do these before shipping:**

**Mapbox:** Log into your Mapbox account and check the token's security settings. Set an HTTP referrer restriction (`*.pourlist.app`) if not already set. This won't prevent determined extraction, but prevents casual abuse of your token on other domains. Note: this doesn't fully protect the token — someone can still extract and use it from the app itself — but it limits the blast radius.

**Supabase:** This is the more critical one. Open the Supabase dashboard for your project → Authentication → Row Level Security (RLS). Verify that all tables have RLS enabled and that the anon key only has access to what a public user should have. Specifically:

- `venues` table: read = anyone (anon), write = trusted devices only via a device_hash check
- `photos` table: read = anyone, write = device_hash verification
- `track_events` / `venue_events`: insert = anyone (for analytics to work), read = restricted to your admin access only

If RLS is not currently enforced on your tables, this is the time to add those policies. The anon key in the client bundle is public by design — RLS is what makes it safe.

### 3.5 Create the Assets catalog

Capacitor generates a basic Assets catalog, but you need to provide the actual icon image files. iOS requires specific sizes:

| File | Size (px) | Purpose |
|------|-----------|---------|
| `Icon-1024.png` | 1024×1024 | App Store listing |
| `Icon-180.png` | 180×180 | iPhone @3x (Plus/Pro models) |
| `Icon-120.png` | 120×120 | iPhone @2x |
| `Icon-87.png` | 87×87 | iPhone @3x Settings |
| `Icon-80.png` | 80×80 | iPad @2x |
| `Icon-60.png` | 60×60 | iPhone @3x |
| `Icon-58.png` | 58×58 | iPhone @2x Settings |
| `Icon-40.png` | 40×40 | iPad @2x Spotlight |
| `Icon-20.png` | 20×20 | iPad @1x |

**Recommended approach:** Take your existing PWA icon (1024×1024 PNG) to [appiconcreator.com](https://appiconcreator.com) or [makeappicon.com](https://makeappicon.com) — upload the 1024×1024 source, and these tools generate all required sizes and arrange them in the correct folder structure. Download the result and copy the contents into:

```
ios/App/App/Assets.xcassets/AppIcon.appiconset/
```

Verify in Xcode: open the project, select Assets.xcassets in the project navigator, and confirm the AppIcon set is listed and has images.

### 3.6 Add `out/` to `.gitignore`

The `out/` directory is generated by `npm run build`. It should never be committed to git — it can contain large binary assets, build artifacts, and is fully re-creatable from source. Add it to `.gitignore` if it's not already there:

```bash
# In .gitignore — add if not present
out/
.next/
```

Skipping this step means the first time you run `git add .`, you'll commit a large `out/` directory, bloating your repository.

### 3.7 Build the web app and sync to iOS

Now that Capacitor is configured, every time you want to test your latest code on iOS:

```bash
npm run build
npx cap sync ios
```

`npm run build` produces the static files in `out/`. `npx cap sync ios` copies those files into the `ios/` project in the correct locations and updates the Capacitor runtime.

After syncing, open the project in Xcode:

```bash
npx cap open ios
```

This opens `ios/ThePourList.xcworkspace` in Xcode. (Always open the `.xcworkspace`, never the `.xcodeproj` — CocoaPods only loads correctly through the workspace.)

---

## Phase 4: Configure Xcode Project Settings

With the project open in Xcode, configure the signing and build settings.

### 4.1 Set your Development Team

In the project navigator (left pane), click the **root project** at the very top (it has the blue icon, not a file icon).

In the right pane, select the **Signing & Capabilities** tab.

Under **Team**, select your Apple Developer account from the dropdown. If your account doesn't appear, go to Xcode → Settings → Accounts → Add your Apple ID.

Check the **Automatically manage signing** checkbox.

Xcode will attempt to create a provisioning profile and signing certificate automatically. This requires your Apple Developer enrollment to be active. If you get an error here, return to Phase 2 and confirm your enrollment is complete.

### 4.2 Set the Bundle Identifier

The Bundle Identifier field (under Identity) shows `com.pourlist.app` — this is your App ID from when you ran `npx cap init`. **This is a one-way door.** Once you submit to App Store Connect with this bundle ID, it cannot be changed without deleting the app listing and creating a new one (which resets your ratings and reviews). It also cannot be transferred easily between individual and organization accounts.

Choose deliberately now. If you ever want to transfer the app to a company account (e.g., if Pour List becomes a business), you will need Apple's app transfer process, which has specific requirements. Plan for this decision.

Write down the bundle ID you use and store it somewhere safe.

### 4.3 Set the iOS Deployment Target

In the project settings, find **Deployment Target** under the iOS platform. Set it to **iOS 17.0** or higher.

> ⚠️ **Verify the current minimum before proceeding.** Apple changes the required minimum iOS version for App Store submissions periodically. At time of writing (April 2026), iOS 17 is the enforced minimum for new App Store submissions. Before you archive and upload, check Apple's current requirements at [developer.apple.com/support/requirements](https://developer.apple.com/support/requirements) — if Apple has raised the minimum since this guide was written, use the higher version. Setting a deployment target below Apple's current requirement causes an immediate rejection at upload time.

**Why iOS 17:** Apple has raised the minimum for new App Store submissions to iOS 17. iOS 17 also covers the majority of active devices and has full WebGL2 support, making Mapbox rendering more reliable. Older deployment targets (iOS 14, 15) will cause an immediate rejection at archive/upload time with no recourse — no amount of build configuration will override this.

**Why not higher than iOS 17:** Setting a higher minimum (e.g., iOS 18) excludes all users on older devices. iOS 17 strikes the right balance. You can always raise it in a future update once Apple's minimum changes.

### 4.4 Configure Info.plist permissions

For Pour List to work correctly, it needs specific permissions from the user. iOS requires you to declare these in the `Info.plist` file.

In Xcode, open `ios/App/App/Info.plist` (or find it in the project navigator under App → App). Add these entries by clicking the `+` button in the Custom iOS Target Properties section:

```xml
<!-- Camera — required for the menu scanning feature -->
<key>NSCameraUsageDescription</key>
<string>Pour List needs camera access to scan happy hour menus.</string>

<!-- Photo library read — required for selecting menu photos from your gallery -->
<key>NSPhotoLibraryUsageDescription</key>
<string>Pour List needs photo library access to select menu photos.</string>

<!-- Photo library write — required if the app can save venue photos or scans to the library -->
<key>NSPhotoLibraryAddUsageDescription</key>
<string>Pour List can save scanned menu photos to your library.</string>

<!-- Location — required to show nearby venues on the map -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>Pour List uses your location to show nearby happy hour venues.</string>

<!-- Export compliance — required for US App Store submission -->
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

**Why `NSPhotoLibraryAddUsageDescription`:** If the app ever saves a photo to the user's camera roll (e.g., saving a scanned menu preview), iOS requires this separate permission. Add it now even if not currently used — it costs nothing and future-proofs the feature.

**Why `ITSAppUsesNonExemptEncryption`:** Apple defines "encryption" broadly. Standard HTTPS traffic with Supabase may technically qualify as encryption under their definition. Setting `false` declares you are not using custom or non-exempt encryption. If Apple flags this during review, they may ask for export compliance documentation. If you ever add end-to-end encryption features (e.g., BitHookup's mesh messaging), you must set this to `true` and complete US Export Compliance (Bureau of Industry and Security registration). For Pour List as currently specified, `false` is correct.

### 4.6 Safe area and notch handling

The iPhone X and later (including all modern models) have a notch at the top and a home indicator at the bottom. Your app's content must be positioned so it doesn't get hidden behind these.

Capacitor automatically provides CSS environment variables for safe area insets. In your Tailwind or CSS, use these variables directly:

```css
/* Bottom padding to avoid the home indicator */
padding-bottom: env(safe-area-inset-bottom);

/* Top padding to avoid the notch */
padding-top: env(safe-area-inset-top);
```

You can add these inline if no global Tailwind class exists:
```tsx
<div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
  {/* content */}
</div>
```

**Verify** that your VenueDetail bottom sheet, the bottom "Back to Map" bar, and any modal or overlay elements have adequate bottom padding on iPhone models with no physical home button (iPhone X and later). Test on a physical device — the simulator may not accurately represent safe area rendering.

### 4.7 Runtime Permission Handling

Adding entries to Info.plist declares the permissions — but iOS also shows a runtime dialog when your app first tries to access the camera, location, or photo library. You must handle what happens when the user denies permission.

If a user taps "Don't Allow" on any permission:

- **Camera:** The browser API (`navigator.mediaDevices.getUserMedia`) will return a `NotAllowedError`. Your app will silently get a blank camera view with no indication why. You need to detect this and show a message.

- **Location:** The Geolocation API (`navigator.geolocation.getCurrentPosition`) will call the error callback. Your app should catch this and show a fallback state (e.g., "Location access denied — tap to enable in Settings").

- **Photo Library:** The browser will silently fail and return nothing.

**How to detect permission denial in JavaScript:**

```typescript
// Camera permission check
async function checkCameraPermission(): Promise<boolean> {
  const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
  return status.state === 'granted'
}

// Show a user-friendly message if denied
async function handleCameraWithFallback() {
  const hasPermission = await checkCameraPermission()
  if (!hasPermission) {
    setCameraError('Camera access denied. Enable in Settings → Pour List → Camera.')
    return
  }
  // proceed with camera
}
```

Also add a button in your app that deep-links to the iOS Settings app for your app:
```typescript
// Opens iOS Settings for this app
window.open('app-settings:')
```

Add this as a fallback option wherever you show permission error messages — it lets the user fix the permission without uninstalling and reinstalling the app.

### 4.6 Build for the first time — verify the shell compiles

In Xcode, select your **iPhone simulator** as the run destination (the iPhone dropdown near the top-left play button). Press **⌘B** to build (Product → Build). This compiles the native shell without running it.

If the build succeeds: Xcode has a valid signing profile and the project structure is correct. You're ready to run on a device.

If the build fails, the most common causes are:

| Error | Cause | Fix |
|-------|-------|-----|
| "No provisioning profile found" | Apple Developer account not connected, or enrollment not yet active | Recheck Step 4.1 and Phase 2 |
| "Signing for App requires a development team" | Team not selected | Select your team in Signing & Capabilities |
| "No module 'Capacitor'" | CocoaPods didn't install | Run `cd ios && pod install` |
| "No such module 'CapacitorCordova'" | Same as above | Same fix |

After fixing any build errors, proceed to Step 4.7.

### 4.7 Run on the iPhone Simulator

With the simulator selected, press **⌘R** to build and run. The simulator launches, opens the iOS home screen, then opens your app. You should see Pour List rendered in the Capacitor WebView.

**What to look for:**
- App icon appears on the simulator's home screen
- Launch screen (splash) shows briefly
- Pour List loads in the WebView
- Map renders (Mapbox WebGL works in simulator)
- No console errors in Xcode's debug console

### 4.8 Run on a physical iPhone

This is when you know the app works on real hardware.

1. Connect your iPhone to your Mac via USB cable
2. On your iPhone, if prompted, choose "Trust This Computer" and enter your passcode
3. In Xcode, select your **iPhone** from the device dropdown (it appears below the simulators section)
4. Press **⌘R**

The app installs on your iPhone and launches. The first time you do this, Xcode provisions the device with a development profile. It may take 1–2 minutes.

**What to look for on physical device:**
- Camera works (can take a photo in the scan flow)
- GPS works (location prompt appears and location is detected)
- Map loads (WebGL works on real hardware)
- No crashes

If the app crashes on launch, check Xcode's console for error messages. Common issues on physical device that don't appear in simulator: camera API errors, GPS permission loops, WebGL compatibility with specific iPhone GPU generations.

---

## Phase 5: Configure App Store Connect

Before you can submit to the App Store, you need to create the app listing in App Store Connect. You can do this while your enrollment is pending.

### 5.1 Create the App

Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → My Apps → "+" → New App.

Fill in these fields:

- **Platform:** iOS
- **App name:** The Pour List (or whatever you want to appear in the App Store)
- **Primary language:** English
- **Bundle ID:** Select your bundle ID from the dropdown — it will be `com.pourlist.app` (or whatever you set in Step 4.2)
- **SKU:** `pourlist-001` (or any internal identifier you want — not visible to users)

### 5.2 App Store Listing Details

**App Preview Screenshots** — Apple requires screenshots for specific device sizes. For iPhone, the required sizes are:
- 6.7" (iPhone 14 Pro Max, iPhone 15 Pro Max, iPhone 16 Pro Max): 1290×2796 px
- 6.5" (iPhone 11 Pro Max, XS Max): 1242×2688 px
- 5.5" (iPhone 8 Plus, 7 Plus, 6s Plus): 1242×2208 px

You can generate these by running the app on the respective simulator sizes, taking screenshots, and trimming to the exact pixel dimensions. Use the simulator's **File → Save Screen** (⌘S) to capture at full resolution.

> ⚠️ **Screenshot generator tools:** Several third-party tools exist for generating App Store screenshots, including "screenshot旅馆.com" (a Chinese-language tool). Before using any third-party screenshot service, verify it is reputable and doesn't inject unwanted metadata. Generating screenshots manually in the simulator is more reliable and requires no trust in a third party.

**App Description** — Write this for someone searching "Portland happy hour" or "best bars Portland." Example:

> Discover the best happy hour deals in Portland, Oregon. Browse venues on a live map, submit menus by scanning with your camera, and get details on drink specials, food discounts, and daily deals — all contributed by the community.
>
> No account required. Just open the app, find a venue, and scan the menu.

**Keywords** — A comma-separated list, max 100 characters. Example:
> Portland, happy hour, bars, drinks, food deals, HH, pub, tavern, restaurant

**Category:** Food & Drink

**Age Rating** — You must complete Apple's questionnaire. Pour List shows venue information (including possibly venues that serve alcohol), so the likely rating is **12+** or **17+** depending on how you answer the questions about user-generated content and references to alcohol. Choose accurately; Apple reviews this.

**Privacy Policy** — Required, even for free apps. You need a publicly accessible URL. Options:
- Use a privacy policy generator (Termly, iubenda) to create one, host it as a static page in your Next.js app at `/privacy`
- Or use a privacy policy hosting service
- The URL must be live before you can submit

### 5.3 Build and upload

Once your listing is configured in App Store Connect, go back to Xcode to create the archive and upload.

In Xcode:
1. Set **Scheme** to "The Pour List"
2. Set **Device** to "Any iOS Device (arm64)" — not a simulator
3. Select **Product → Archive**

The archive process takes 3–8 minutes. When it completes, the **Organizer** window opens (or go to Window → Organizer). Select your archive and click **Distribute App**.

Choose **App Store Connect** as the distribution method, follow the wizard (choose automatic signing throughout), and upload.

Once uploaded, go back to App Store Connect. Your build will appear under TestFlight → Build. It goes through a processing step (usually 5–15 minutes). Then you can add it to your listing and submit for review.

### 5.4 App Store Review

Apple reviews every app submission. Review time is typically **24–48 hours**.

**Common rejection reasons for web-wrapped apps:**

Apple has rejected apps that are "essentially a website in a webview with no native functionality." To minimize this risk:
- Ensure the app feels like a native experience (smooth scrolling, native-feeling navigation, app icon on home screen)
- All navigation uses iOS-native transitions where possible (Capacitor's default `push` transition in the WebView is fine)
- The app icon, splash screen, and manifest are all properly configured
- The app provides genuine value, not just a link to a mobile website

Pour List's feature set (map, camera scanning, GPS-based venue detection) gives you a legitimate argument that it uses device capabilities beyond what a simple website can do.

**If rejected:** Apple provides a rejection reason with a code and explanation. Read it carefully — most rejections are fixable. Common ones: missing privacy policy URL, screenshot sizes wrong, screenshot shows content that violates guideline 5.1.1 (alcohol-related content in screenshots requires age rating of 17+).

---

## Phase 6: Push Notifications — Deferred

> ⚠️ **This phase is intentionally deferred.** The steps below will get the client-side push notification infrastructure working (Capacitor plugin installed, token registered). However, the backend side — APNs certificate setup, a server to send notifications, and token management — is non-trivial and requires separate infrastructure. If you complete the steps below without the backend, your app will register for notifications but never receive any.
>
> If push notifications are a priority later, come back to this phase and complete it in full. The app does not need push notifications to function or to be approved by Apple. For now, omit Phase 6 entirely.

### 6.1 How push notifications work (overview)

Apple uses a service called **APNs** (Apple Push Notification service). When a user installs the app and grants notification permission, Apple's servers register the device and give you a **device token**. Your server (a Supabase Edge Function or a separate backend) sends a payload to Apple's APNs servers, which deliver it to the device.

Capacitor's Push Notifications plugin handles the device-side token registration. Your backend sends the actual notifications.

### 6.2 Install the plugin

```bash
npm install @capacitor/push-notifications
npx cap sync ios
```

### 6.3 Add plugin config to capacitor.config.ts

```typescript
const config: CapacitorConfig = {
  // ...existing config...
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}
```

### 6.4 Request permission in the app

In your app's root component (or in a dedicated notification setup function called at first launch):

```typescript
import { PushNotifications } from '@capacitor/push-notifications'

async function requestNotificationPermission() {
  const result = await PushNotifications.requestPermissions()
  if (result.receive === 'granted') {
    // Register with APNs — this fetches the device token
    await PushNotifications.register()
  }
}
```

The device token returned by `register()` is what you send to your backend to identify this device for future notifications. You would store this token in Supabase alongside the device hash.

### 6.5 What remains undone (for when you return to this)

To get push notifications fully working, you additionally need:
1. An **APNs Auth Key** (preferred) or **SSL Certificate** from your Apple Developer account (Certificates, Identifiers & Profiles → Keys)
2. A Supabase Edge Function that receives device tokens and sends payloads to the APNs API
3. A `notification_tokens` table in Supabase to store tokens per device_hash
4. Logic to trigger notifications (e.g., a cron job that queries venues with HH starting in 30 min, finds nearby users, and sends alerts)

Consider using **OneSignal** instead — it has a Capacitor plugin, handles all the APNs complexity, and has a free tier appropriate for an app at Pour List's scale. OneSignal's SDK replaces the manual APNs integration entirely.

---

## Phase 7: Ongoing Maintenance

### 7.1 The update workflow

Every time you make a change to the web app and want it available in the iOS app:

```bash
# 1. Make your changes in src/
git commit -m "What changed"

# 2. Build and sync to iOS
npm run build
npx cap sync ios

# 3. Open Xcode and submit a new archive
# Product → Archive → Organizer → Distribute
```

Apple's review process means each update takes 24–48 hours to go live. Plan accordingly — don't submit critical bug fixes the night before you need them live.

### 7.2 Updating Capacitor

Capacitor releases updates periodically. To update:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios@latest
npx cap sync ios
```

Test thoroughly in Xcode after every update. Capacitor uses semantic versioning and attempts to avoid breaking changes, but native SDK updates can occasionally introduce issues.

### 7.3 CocoaPods updates

Occasionally, CocoaPods (the dependency manager for the iOS native side) will need updating:

```bash
cd ios && pod install --repo-update
```

Run this if you see errors like "Unable to find a pod" after updating Capacitor.

---

## Troubleshooting Quick Reference

| Symptom | Most Likely Cause | Fix |
|---------|------------------|-----|
| App launches but shows blank white screen | `webDir` in capacitor.config.ts points to wrong directory | Verify `out/` exists and `webDir: 'out'` in config |
| App launches but shows blank white screen | Service worker intercepting requests (service workers don't work under `file://`) | Disable or deregister service worker in the app; the PWA ServiceWorkerRegister component needs to check if it's running in Capacitor and skip registration |
| App launches but shows blank white screen | Supabase auth token not persisting (auth loop) | Check if `@supabase/ssr` is used; it requires server-component context that doesn't exist in Capacitor. Use `@supabase/supabase-js` directly instead |
| App launches but shows blank white screen | Mapbox token rejected by WebView's user agent | Set the Mapbox token to allow all referrers, or test on physical hardware (simulator WebView has different user agent) |
| `npm run build` produces `.next/` instead of `out/` | `output: 'export'` not in next.config.ts | Add it and rebuild |
| Build fails with "No such module 'Capacitor'" | CocoaPods didn't install | `cd ios && pod install` |
| Camera doesn't work on physical device | NSCameraUsageDescription missing from Info.plist, or user denied permission | Add it (Step 4.4); add runtime permission handling (Step 4.7) |
| GPS doesn't work | NSLocationWhenInUseUsageDescription missing from Info.plist, or user denied permission | Add it (Step 4.4); add runtime permission handling (Step 4.7) |
| Archive upload rejected by App Store Connect | Bundle ID mismatch between Xcode and App Store Connect | Ensure both use `com.pourlist.app` |
| Archive upload rejected by App Store Connect | iOS deployment target below Apple's minimum (currently iOS 17) | Set deployment target to iOS 17 or higher |
| App rejected as "web wrapper" | Insufficient native feel | Explicitly frame Pour List's native features (camera, GPS, Mapbox) as counter-arguments to Apple's 4.7 rejection; add a custom splash screen; ensure app icon is unique; configure haptic feedback for key interactions |
| Map renders in simulator but not on physical device | WebGL issue on specific GPU generation | This is expected — simulator WebGL is unreliable. Only testing on physical hardware is definitive |
| Some routes load, others 404 | `exportTrailingSlash: true` with hardcoded links missing trailing slashes | Find and fix all hardcoded links; add trailing slashes to any `href` attributes |
| Privacy policy URL rejected by App Store Connect | Privacy policy page uses server-side logic (not included in static export) | The privacy page must be a pure static page (`page.tsx` with no server components). Test that `out/privacy/` exists and loads before submitting |

---

## What Capacitor Cannot Do (Know Your Limits)

Capacitor wraps a web app — it does not make the app native. There are things Capacitor cannot provide:

- **Background processing** — The app cannot run code while in the background (no background location tracking for real-time proximity alerts). For that you need a truly native app or a service like Beacon (bluetooth beacon hardware).

- **Native UI quality** — Transitions and scrolling feel like a web app inside Safari, not like a Swift-written UIKit app. For Pour List's UI, this is acceptable. For an app where UI polish is the primary differentiator (e.g., a design tool), it would not be.

- **App Store search ranking** — Having an app in the App Store doesn't automatically rank you in search. The App Store SEO problem is similar to Google SEO — app title, keywords, description, and downloads all factor in.

- **Widget support** — iOS widgets require a native WidgetKit extension. Capacitor cannot generate widgets. If you wanted a "next happy hour starting soon" widget, that would need to be a separate native module.

For Pour List, none of these limitations materially impact the product. The app is primarily a content browsing and camera-scanning tool. Capacitor is the right tool for this use case.

---

## Checklist Summary

Before each submission, verify:

- [ ] `output: 'export'` is in next.config.ts
- [ ] `npm run build` produces `out/` (not `.next/`)
- [ ] `npx cap sync ios` completes without errors
- [ ] Info.plist has all required permissions (camera, location, photo library read/write, encryption declaration)
- [ ] App icon is present in Assets.xcassets
- [ ] Bundle ID is deliberately chosen and matches App Store Connect listing
- [ ] iOS deployment target is iOS 17 or higher (verify against Apple's current minimum)
- [ ] Privacy policy URL is live and accessible
- [ ] Privacy policy page confirmed to be in `out/` (no server-side logic used)
- [ ] Age rating questionnaire completed in App Store Connect
- [ ] Screenshots are the correct pixel dimensions for the listed device sizes
- [ ] Xcode archive builds successfully for "Any iOS Device (arm64)"
- [ ] Mapbox token has HTTP referrer restriction set (`*.pourlist.app`)
- [ ] All Supabase tables have RLS policies — verify before shipping (see Phase 3.4 security section)
- [ ] All `next/image` components use absolute URLs (not relative paths)
- [ ] Service Worker registration is conditionally disabled in Capacitor context (or accepted as non-functional)
- [ ] Runtime permission denial handling is implemented for camera, location, and photo library
- [ ] Bundle ID one-way door noted and recorded (see Phase 4.2)