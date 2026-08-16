# Contributing

Thanks for taking the time. Bug reports, docs fixes, and pull requests are all welcome.

## Getting set up

```sh
git clone https://github.com/diegomichel/rn-azure-notification-hub.git
cd rn-azure-notification-hub
npm install
npm run build          # compiles src/ -> build/ and plugin/src -> plugin/build (watches in a TTY)
```

The `example/` app is a development build that exercises every API. It resolves the library from
the repository root, so native and JavaScript changes are picked up without publishing.

```sh
cd example
npm install
npx expo run:ios       # or: npx expo run:android
```

Point it at a hub of your own:

```sh
# example/.env
EXPO_PUBLIC_ANH_CONNECTION_STRING=Endpoint=sb://…;SharedAccessKeyName=DefaultListenSharedAccessSignature;SharedAccessKey=…
EXPO_PUBLIC_ANH_HUB_NAME=my-hub
```

Push notifications need a physical device — neither the iOS simulator nor a Play-Services-less
Android emulator image will issue a push token.

## Repository layout

```
src/                      TypeScript API surface
ios/                      Swift module, delegate proxy, serialization, podspec
android/src/main/java/
  com/rnazurenotificationhub/                       Kotlin module, registry, startup initializer
  com/microsoft/windowsazure/messaging/…/           Java shim for SDK internals (see below)
plugin/src/               Expo config plugin
example/                  Development build that exercises the API
docs/API.md               Full API reference
```

### About the Java shim

[`AzureNotificationHubInternals.java`](./android/src/main/java/com/microsoft/windowsazure/messaging/notificationhubs/AzureNotificationHubInternals.java)
deliberately lives in the Azure SDK's own package so it can reach `TagVisitor`, `TemplateVisitor`
and `IdAssignmentVisitor`, which are package-private. It exists because `NotificationHub` has no
way to enumerate or clear templates, and no way to read state before `start()` has run.

It is read-only apart from `clearTemplates`, and it is pinned against
`notification-hubs-android-sdk:2.0.0`. If that dependency is ever bumped, re-check it first — the
compiler will catch a removed class, but not a changed preference key.

## Checks

```sh
npm run lint           # ESLint + Prettier over src/
npm test               # Jest (watches in a TTY; CI runs it once)
npm run build          # type-checks as a side effect
```

Native code is verified by building the example app. CI builds the Android library and type-checks
JavaScript; iOS builds are expected to be run locally before a release.

## Making a change

1. Open an issue first for anything larger than a bug fix, so we can agree on the shape.
2. Keep the wrapper faithful. If the native SDKs disagree about a behaviour, document the
   difference rather than papering over it — and if a feature genuinely only exists on one
   platform, throw `ERR_UNSUPPORTED_ON_PLATFORM` on the other instead of silently no-oping.
3. Update `docs/API.md` and the `@platform` JSDoc tags alongside any API change.
4. Add an entry to `CHANGELOG.md` under `## Unreleased`.

## Releasing

Maintainers only:

```sh
npm version <patch|minor|major>   # updates package.json + tags
# move the Unreleased section in CHANGELOG.md under the new version
git push --follow-tags
npm publish                        # `prepare` rebuilds src/ and plugin/ first
```

`android/build.gradle` and `ios/*.podspec` carry their own version strings; `podspec` reads
`package.json`, `build.gradle` does not — bump it by hand.

## Code of conduct

Be decent to each other. Harassment or personal attacks get you removed from the project.
