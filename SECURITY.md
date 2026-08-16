# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through
[GitHub Security Advisories](https://github.com/diegomichell/rn-azure-notification-hub/security/advisories/new),
or by email to <diego.ivan.perez.michel@gmail.com>. Include:

- what you found and how it can be reproduced,
- which version of this library and which platform,
- the impact you believe it has.

You can expect an acknowledgement within a few days and an assessment within two weeks. Fixes are
released as a patch version and credited in the changelog unless you prefer otherwise.

## Supported versions

Only the latest published minor version receives security fixes.

## Vulnerabilities in the Azure SDKs

This library wraps Microsoft's client SDKs. Issues in the SDKs themselves belong upstream:

- [Azure/azure-notificationhubs-ios](https://github.com/Azure/azure-notificationhubs-ios/issues)
- [Azure/azure-notificationhubs-android](https://github.com/Azure/azure-notificationhubs-android/issues)

Report anything affecting the Azure service to
[Microsoft MSRC](https://msrc.microsoft.com/report/vulnerability/new).

## Handling hub credentials

A few notes worth repeating, since most reports in this area turn out to be misconfiguration:

- **Ship only the listen-only connection string** (`DefaultListenSharedAccessSignature`). `Manage`
  and `Send` policies can enumerate, modify, and delete every registration in the hub, and anything
  in an app bundle can be extracted — obfuscation does not change that.
- **Better: ship none at all.** `startAsync({ installationManagement: true })` hands installation
  upserts to your JavaScript, so the credential lives on your backend. See
  [Registering through your own backend](./README.md#registering-through-your-own-backend).
- **Treat installation ids and push channels as sensitive.** They identify a device and can be used
  to target it. Do not log them in production builds.
- **Rotate the access policy key** if a connection string is ever exposed. Regenerating the key in
  the Azure portal invalidates every client using the old one, so ship the new value first.
