package com.rnazurenotificationhub

import android.content.Context
import androidx.startup.Initializer

/**
 * Installs the notification listener while the `Application` is starting, before any
 * `FirebaseMessagingService` can run.
 *
 * The Azure SDK's `FirebaseReceiver` calls `getInstanceListener().onPushNotificationReceived(…)`
 * without a null check, so a data-only push that cold-starts the process would otherwise crash the
 * service. Registering here also means those notifications get buffered and replayed to JavaScript
 * once the app finishes launching, instead of being dropped.
 *
 * Registered automatically through this library's manifest. To opt out, add the following to your
 * app's `AndroidManifest.xml`:
 *
 * ```xml
 * <provider
 *   android:name="androidx.startup.InitializationProvider"
 *   android:authorities="${applicationId}.androidx-startup"
 *   android:exported="false"
 *   tools:node="merge">
 *   <meta-data
 *     android:name="com.rnazurenotificationhub.AzureNotificationHubInitializer"
 *     tools:node="remove" />
 * </provider>
 * ```
 */
class AzureNotificationHubInitializer : Initializer<Unit> {
  override fun create(context: Context) {
    ANHRegistry.install(context)
  }

  override fun dependencies(): MutableList<Class<out Initializer<*>>> = mutableListOf()
}
