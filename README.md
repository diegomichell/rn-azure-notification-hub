# rn-azure-notification-hub

[![npm](https://img.shields.io/npm/v/rn-azure-notification-hub.svg)](https://www.npmjs.com/package/rn-azure-notification-hub)
[![CI](https://github.com/diegomichell/rn-azure-notification-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/diegomichell/rn-azure-notification-hub/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/rn-azure-notification-hub.svg)](./LICENSE)

An [Expo Module](https://docs.expo.dev/modules/overview/) that wraps Microsoft's official
[Azure Notification Hubs](https://learn.microsoft.com/azure/notification-hubs/) client SDKs for
**iOS** and **Android**, and exposes their installation-based API to React Native.

It is a thin, faithful wrapper: registration, tags, templates, user ids, installation expiry,
enable/disable, notification delivery, and — importantly — the SDKs' *custom installation
management* mode, which lets you register devices through your own backend so no hub connection
string ever ships inside your app.

| | |
| --- | --- |
| iOS | [`AzureNotificationHubs-iOS`](https://github.com/Azure/azure-notificationhubs-ios) `3.1.5` (`MSNotificationHub`), iOS/tvOS 16.4+ |
| Android | [`com.microsoft.azure:notification-hubs-android-sdk`](https://github.com/Azure/azure-notificationhubs-android) `2.0.0` (`NotificationHub`), minSdk 24 |
| Expo SDK | Built and tested against **SDK 57** (React Native 0.86, new architecture). SDK 54–56 use the same module API and should work, but are not covered by CI. |
| Platforms | iOS, tvOS, Android. Web throws a descriptive `UnavailabilityError` rather than silently no-oping. |

---

## Contents

- [Installation](#installation)
- [Azure setup](#azure-setup)
- [Quick start](#quick-start)
- [Registering through your own backend](#registering-through-your-own-backend)
- [Tags](#tags)
- [Templates](#templates)
- [Receiving notifications](#receiving-notifications)
- [Coexisting with other FCM libraries](#coexisting-with-other-fcm-libraries)
- [Permissions](#permissions)
- [Config plugin](#config-plugin)
- [API reference](./docs/API.md)
- [Advanced](#advanced)
- [Troubleshooting](#troubleshooting)
- [What this wrapper does *not* cover](#what-this-wrapper-does-not-cover)

---

## Installation

```sh
npx expo install rn-azure-notification-hub
```

Then add the config plugin to your app config:

```json
{
  "expo": {
    "plugins": [
      ["rn-azure-notification-hub", { "apsEnvironment": "development" }]
    ],
    "ios": {
      "bundleIdentifier": "com.example.app"
    },
    "android": {
      "package": "com.example.app",
      "googleServicesFile": "./google-services.json"
    }
  }
}
```

This module contains native code, so it does **not** work in Expo Go. Build a
[development build](https://docs.expo.dev/develop/development-builds/introduction/):

```sh
npx expo run:ios
npx expo run:android
```

<details>
<summary>Bare React Native (no Expo config plugin)</summary>

The Expo Modules API works in bare React Native apps that have
[`expo` installed](https://docs.expo.dev/bare/installing-expo-modules/). After
`npm install rn-azure-notification-hub` and `pod install`, add manually what the config plugin
would have added:

- **iOS** — the Push Notifications capability (`aps-environment` entitlement) and the
  `remote-notification` background mode.
- **Android** — `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` (the
  library's own manifest already declares it), plus `google-services.json` and the
  `com.google.gms.google-services` Gradle plugin.

</details>

## Azure setup

1. Create a Notification Hub in the Azure portal.
2. **APNs** — upload a token-based (`.p8`) key or a certificate under *Settings → Apple (APNS)*.
   Match the environment to the `apsEnvironment` you build with: `development` builds talk to the
   APNs sandbox, `production` builds (TestFlight, App Store) talk to production.
3. **FCM** — under *Settings → Google (FCM v1)*, upload the service account JSON for your Firebase
   project. The legacy FCM HTTP API that older hubs used was decommissioned in June 2024; hubs must
   be on **FCM v1**.
4. Copy the **`DefaultListenSharedAccessSignature`** connection string from *Access Policies*.

> [!WARNING]
> Only ever ship the **listen-only** connection string. `Manage` and `Send` policies allow reading
> and deleting every registration in the hub, and anything inside an app bundle can be extracted.
> Better still, ship no connection string at all — see
> [Registering through your own backend](#registering-through-your-own-backend).

## Quick start

```ts
import * as AzureNotificationHub from 'rn-azure-notification-hub';

// 1. Subscribe before starting, so nothing is missed.
const subscription = AzureNotificationHub.addNotificationReceivedListener((notification) => {
  console.log(notification.title, notification.body, notification.data);
});

// 2. Start the SDK. On iOS this triggers the system permission prompt.
await AzureNotificationHub.startAsync({
  connectionString: process.env.EXPO_PUBLIC_ANH_CONNECTION_STRING!,
  hubName: 'my-hub',
});

// 3. Target this device.
await AzureNotificationHub.addTagsAsync(['sports', 'news']);
await AzureNotificationHub.setUserIdAsync('user-42');

// 4. Inspect what was registered.
const installation = await AzureNotificationHub.getInstallationAsync();
console.log(installation.installationId, installation.pushChannel);

// Later…
subscription.remove();
```

Every mutating call schedules an installation upsert, which the native SDKs debounce (~2s) and
retry. Watch the result with:

```ts
AzureNotificationHub.addInstallationSavedListener(({ installation }) => {
  console.log('registered with hub', installation.installationId);
});

AzureNotificationHub.addInstallationSaveFailedListener(({ message }) => {
  console.warn('registration failed', message);
});
```

## Registering through your own backend

Both native SDKs support handing installation upserts to the app instead of contacting Azure
directly. Your backend holds the connection string, and the app ships with none.

```ts
import * as AzureNotificationHub from 'rn-azure-notification-hub';

AzureNotificationHub.addInstallationUpsertRequestListener(async ({ requestId, installation }) => {
  try {
    const response = await fetch('https://api.example.com/notification-installations', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(installation),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    AzureNotificationHub.completeInstallationUpsert(requestId);
  } catch (error) {
    // Reported through `addInstallationSaveFailedListener`; the SDK retries later.
    AzureNotificationHub.completeInstallationUpsert(requestId, String(error));
  }
});

await AzureNotificationHub.startAsync({ installationManagement: true });
```

Your backend then forwards the installation to the hub's
[Installation REST API](https://learn.microsoft.com/rest/api/notificationhubs/create-overwrite-installation)
using a `Manage` policy that never leaves your servers.

Register the listener **before** calling `startAsync`. Every request must be acknowledged exactly
once with `completeInstallationUpsert`; anything unanswered after
`installationUpsertTimeout` (default 30s) is reported as a failure and retried later.

## Tags

Tags are the primary targeting mechanism: the backend sends to `sports`, and every installation
carrying that tag receives it.

```ts
await AzureNotificationHub.addTagAsync('sports');
await AzureNotificationHub.addTagsAsync(['news', 'weather']);
await AzureNotificationHub.removeTagAsync('weather');

console.log(await AzureNotificationHub.getTagsAsync()); // ['news', 'sports']

await AzureNotificationHub.clearTagsAsync(); // e.g. on sign-out
```

Limits imposed by the service: 120 characters per tag, no commas, 60 tags per installation.

## Templates

Templates let one backend payload expand into platform-native payloads, so a broadcast does not
need to know whether a device is on APNs or FCM.

```ts
import { Platform } from 'react-native';

await AzureNotificationHub.setTemplateAsync('genericMessage', {
  body: Platform.select({
    ios: '{"aps":{"alert":{"title":"$(title)","body":"$(message)"}}}',
    android: '{"message":{"notification":{"title":"$(title)","body":"$(message)"}}}',
  })!,
  tags: ['news'],
});

console.log(await AzureNotificationHub.getTemplatesAsync());
await AzureNotificationHub.removeTemplateAsync('genericMessage');
```

The backend then sends `{ "title": "...", "message": "..." }` and the hub fills in the placeholders.

> [!NOTE]
> `getTemplatesAsync()` and `clearTemplatesAsync()` have no equivalent on the Android SDK's public
> surface; this library reads the SDK's own template store to provide them. See
> [`AzureNotificationHubInternals.java`](./android/src/main/java/com/microsoft/windowsazure/messaging/notificationhubs/AzureNotificationHubInternals.java).

## Receiving notifications

```ts
const subscription = AzureNotificationHub.addNotificationReceivedListener((notification) => {
  // notification.title, notification.body, notification.data, notification.buffered
});
```

When it fires:

| | iOS | Android |
| --- | --- | --- |
| App in foreground | ✅ | ✅ |
| Notification tapped | ✅ | ✅ (data payloads) |
| Data-only push, app backgrounded | ✅ (with `remote-notification` background mode) | ✅ |
| Data-only push, app not running | Buffered¹ | Buffered¹ |

¹ Notifications that reach the native SDK before JavaScript is listening are held (up to 32, oldest
dropped) and replayed with `buffered: true` as soon as a listener attaches. Whether the OS hands a
push to a process that is not running at all is up to the OS — iOS delivers silent pushes on a
best-effort budget, and Android delivers data messages unless the app is force-stopped.

This library reports notifications to your app — it does **not** draw them. Notification-type
payloads are drawn by the OS while the app is backgrounded. To display something yourself for a
foreground or data-only push, pair this with a presentation library such as
[`expo-notifications`](https://docs.expo.dev/versions/latest/sdk/notifications/) — see the next
section for how they coexist on Android.

## Coexisting with other FCM libraries

Android delivers FCM messages to exactly **one** `FirebaseMessagingService`. The Azure SDK
registers its own (`FirebaseReceiver`), and so do `expo-notifications` and
`@react-native-firebase/messaging`. Whichever service the manifest merger puts first wins, and the
others receive nothing.

If you use this library **on its own**, there is nothing to do.

If another library owns the FCM service, disable Azure's receiver and feed the token in yourself:

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<manifest xmlns:tools="http://schemas.android.com/tools">
  <application>
    <service
      android:name="com.microsoft.windowsazure.messaging.notificationhubs.FirebaseReceiver"
      tools:node="remove" />
  </application>
</manifest>
```

```ts
import * as Notifications from 'expo-notifications';
import * as AzureNotificationHub from 'rn-azure-notification-hub';

await AzureNotificationHub.startAsync({ connectionString, hubName });

const { data: token } = await Notifications.getDevicePushTokenAsync();
await AzureNotificationHub.setPushChannelAsync(token);

Notifications.addPushTokenListener(({ data }) => {
  AzureNotificationHub.setPushChannelAsync(data);
});
```

`addNotificationReceivedListener` will no longer fire in this configuration — use the other
library's listener instead. Everything else (tags, templates, installations) keeps working.

On iOS there is no such conflict: the Azure SDK forwards through the app delegate rather than
replacing it.

## Permissions

```ts
const { status, granted, canAskAgain } = await AzureNotificationHub.requestPermissionsAsync();
if (!granted && !canAskAgain) {
  // Deep-link the user into system settings.
}
```

- **iOS** — `startAsync()` already prompts. Use `requestPermissionsAsync()` to prompt at a
  different moment, or to inspect the result. Control which options are requested with
  `authorizationOptions` on `startAsync`, or by passing them to `requestPermissionsAsync`.
- **Android 13+** — prompts for `POST_NOTIFICATIONS`. Below API 33 the result reflects whether
  notifications are enabled in system settings, and `canAskAgain` is `false` because there is
  nothing to prompt for.

Note the distinction: on Android, an FCM token — and therefore hub registration — works even
without the notification permission. The permission only governs whether notifications can be
*displayed*.

## Config plugin

```json
["rn-azure-notification-hub", {
  "apsEnvironment": "production",
  "enableBackgroundRemoteNotifications": true,
  "enableAndroidNotificationPermission": true
}]
```

| Option | Default | Effect |
| --- | --- | --- |
| `apsEnvironment` | `"development"` | Writes the `aps-environment` iOS entitlement. Use `"production"` for TestFlight and App Store builds. |
| `enableBackgroundRemoteNotifications` | `true` | Adds the `remote-notification` value to `UIBackgroundModes`, so iOS wakes the app for silent pushes. |
| `enableAndroidNotificationPermission` | `true` | Adds `POST_NOTIFICATIONS` to the merged Android manifest. |

Hub credentials are deliberately *not* plugin options — passing them to `startAsync()` at runtime
keeps them out of your native project files, and lets you swap hubs per environment.

## Advanced

**Turning off the iOS delegate forwarding.** The Azure SDK swizzles `UIApplicationDelegate` and
`UNUserNotificationCenterDelegate` so it sees tokens and notifications without any wiring. Two
`Info.plist` keys opt out, in which case you must forward the callbacks yourself from
`AppDelegate`:

```xml
<key>NHAppDelegateForwarderEnabled</key><integer>0</integer>
<key>NHUserNotificationCenterDelegateForwarderEnabled</key><integer>0</integer>
```

With the app-delegate forwarder disabled, call `setPushChannelAsync()` from
`didRegisterForRemoteNotificationsWithDeviceToken` to keep the installation up to date.

**Turning off the Android startup initializer.** An `androidx.startup` initializer registers the
notification listener during `Application` startup — see
[why](./android/src/main/java/com/rnazurenotificationhub/AzureNotificationHubInitializer.kt). To
opt out:

```xml
<provider
  android:name="androidx.startup.InitializationProvider"
  android:authorities="${applicationId}.androidx-startup"
  android:exported="false"
  tools:node="merge">
  <meta-data android:name="com.rnazurenotificationhub.AzureNotificationHubInitializer" tools:node="remove" />
</provider>
```

**Reaching the raw module.** The `NativeModule` instance is exported for `useEvent` and
`useEventListener`:

```ts
import { useEvent } from 'expo';
import { AzureNotificationHubModule } from 'rn-azure-notification-hub';

const notification = useEvent(AzureNotificationHubModule, 'onNotificationReceived');
```

## Troubleshooting

**`pushChannel` stays `null`.**
On iOS, check that the Push Notifications capability is enabled and that you are on a physical
device — the simulator issues no APNs token. On Android, confirm `google-services.json` matches
your package name and that the Google Services Gradle plugin is applied (set
`android.googleServicesFile` in your app config).

**`onInstallationSaveFailed` reports 401.**
The connection string is wrong, expired, or belongs to a different hub. Confirm you copied
`DefaultListenSharedAccessSignature` and that `hubName` matches the hub, not the namespace.

**Notifications arrive on the device but no event fires.**
The payload was a notification-type message received while backgrounded — the OS drew it and never
handed it to the app. Send a data-only payload, or add a `content-available: 1` / `data` block.
On Android, also check the [FCM service conflict](#coexisting-with-other-fcm-libraries).

**`ERR_NOT_STARTED`.**
A mutating call ran before `startAsync()` resolved. Reads work beforehand and return the persisted
values.

**Android build fails resolving `com.android.volley:volley`.**
The Azure SDK depends on Volley from `mavenCentral()`, which Expo's template already includes.
Custom `settings.gradle` repository blocks may need it added.

## What this wrapper does *not* cover

- **The legacy `SBNotificationHub` registration API** (iOS only). It is superseded by the
  installation model this library exposes, and the Android SDK removed it in v2, so there is no
  cross-platform equivalent to wrap.
- **Drawing notifications.** See [Receiving notifications](#receiving-notifications).
- **Server-side operations** (creating hubs, sending notifications, deleting registrations). Those
  need a `Manage`/`Send` policy and belong on your backend, not in the app.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). The
[`example/`](./example) app exercises every API and is the fastest way to try a change on a device.

## License

[MIT](./LICENSE) © Diego Michel

This project is not affiliated with or endorsed by Microsoft. "Azure" and "Azure Notification Hubs"
are trademarks of Microsoft Corporation. The bundled Azure SDKs are licensed under Apache-2.0 by
Microsoft.
