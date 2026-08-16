# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.1.0

Initial release.

### Added

- Expo Module wrapping `AzureNotificationHubs-iOS` 3.1.5 and
  `com.microsoft.azure:notification-hubs-android-sdk` 2.0.0.
- `startAsync` against a hub connection string, or with `installationManagement: true` to route
  installation upserts through your own backend via `onInstallationUpsertRequested` /
  `completeInstallationUpsert`.
- Installation API: `getInstallationAsync`, `saveInstallationAsync`, installation id, push channel,
  user id, platform and expiry getters and setters.
- Tags: `addTagAsync`, `addTagsAsync`, `removeTagAsync`, `removeTagsAsync`, `getTagsAsync`,
  `clearTagsAsync`.
- Templates: `setTemplateAsync`, `removeTemplateAsync`, `getTemplateAsync`, `getTemplatesAsync`,
  `clearTemplatesAsync`. The last two are backed by the Android SDK's own template store, which has
  no public accessor.
- `setEnabledAsync` / `isEnabledAsync`.
- Permissions: `getPermissionsAsync` / `requestPermissionsAsync`, including Android 13+
  `POST_NOTIFICATIONS`.
- Events for received notifications, installation save success and failure, custom-backend upsert
  requests, and the iOS authorization result.
- Notification buffering: pushes that arrive before JavaScript attaches a listener are replayed
  with `buffered: true` instead of being dropped. On Android this also prevents the SDK's
  `FirebaseMessagingService` from crashing on a data-only push that cold-starts the process.
- Expo config plugin for the iOS `aps-environment` entitlement, the `remote-notification`
  background mode, and the Android `POST_NOTIFICATIONS` permission.
- Full TypeScript declarations, a web fallback that throws a descriptive `UnavailabilityError`, and
  an example app that exercises every API.
