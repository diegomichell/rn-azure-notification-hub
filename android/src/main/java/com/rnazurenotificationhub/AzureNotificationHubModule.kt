package com.rnazurenotificationhub

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.microsoft.windowsazure.messaging.notificationhubs.AzureNotificationHubInternals
import com.microsoft.windowsazure.messaging.notificationhubs.DebounceInstallationAdapter
import com.microsoft.windowsazure.messaging.notificationhubs.InstallationTemplate
import com.microsoft.windowsazure.messaging.notificationhubs.NotificationHub
import com.microsoft.windowsazure.messaging.notificationhubs.PlatformVisitor
import com.microsoft.windowsazure.messaging.notificationhubs.PushChannelValidationAdapter
import com.microsoft.windowsazure.messaging.notificationhubs.PushChannelVisitor
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import java.util.Date

internal class NotStartedException :
  CodedException("The Azure Notification Hubs SDK has not been started. Call startAsync() first.")

internal class InvalidConfigurationException :
  CodedException(
    "startAsync requires either `connectionString` and `hubName`, or `installationManagement: true`"
  )

internal class MissingApplicationContextException :
  CodedException("Unable to resolve the Android Application instance from the React context.")

internal class FirebaseNotConfiguredException(cause: Throwable) :
  CodedException(
    "Firebase is not initialised, so the SDK cannot obtain an FCM token. Add google-services.json " +
      "to your project and set `android.googleServicesFile` in your app config, then rebuild.",
    cause
  )

internal class UnknownUpsertRequestException(requestId: String) :
  CodedException(
    "No pending installation upsert with id \"$requestId\". " +
      "It may have already been completed or timed out."
  )

/** Options accepted by `startAsync`. */
internal class ANHConfigRecord : Record {
  @Field val connectionString: String? = null

  @Field val hubName: String? = null

  @Field val installationManagement: Boolean = false

  @Field val installationUpsertTimeout: Double = 30_000.0

  /** iOS only; accepted and ignored here so shared config objects work unchanged. */
  @Field val authorizationOptions: List<String>? = null
}

/** A template as it crosses the bridge. */
internal class ANHTemplateRecord : Record {
  @Field val body: String = ""

  @Field val tags: List<String> = emptyList()

  @Field val headers: Map<String, String> = emptyMap()
}

class AzureNotificationHubModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw MissingApplicationContextException()

  private val application: Application
    get() = context.applicationContext as? Application ?: throw MissingApplicationContextException()

  override fun definition() = ModuleDefinition {
    Name("AzureNotificationHub")

    Events(
      "onNotificationReceived",
      "onInstallationSaved",
      "onInstallationSaveFailed",
      "onInstallationUpsertRequested",
      "onAuthorizationRequested"
    )

    OnCreate {
      appContext.reactContext?.let {
        ANHRegistry.attach(this@AzureNotificationHubModule, it)
      }
    }

    OnDestroy {
      ANHRegistry.detach(this@AzureNotificationHubModule)
    }

    OnStartObserving("onNotificationReceived") {
      ANHRegistry.startObservingNotifications()
    }

    OnStopObserving("onNotificationReceived") {
      ANHRegistry.stopObservingNotifications()
    }

    // region Lifecycle

    AsyncFunction("startAsync") { config: ANHConfigRecord ->
      val application = application

      try {
        if (config.installationManagement) {
          ANHRegistry.upsertTimeoutMillis =
            config.installationUpsertTimeout.toLong().coerceAtLeast(1_000L)
          // Wrap the JavaScript-backed adapter the same way the connection-string overload wraps
          // its own: debounce bursts of changes, and hold registrations back until FCM has issued
          // a token.
          val adapter = PushChannelValidationAdapter(
            DebounceInstallationAdapter(application, ANHInstallationAdapter())
          )
          NotificationHub.start(application, adapter)
        } else {
          val connectionString = config.connectionString
          val hubName = config.hubName
          if (connectionString.isNullOrEmpty() || hubName.isNullOrEmpty()) {
            throw InvalidConfigurationException()
          }
          NotificationHub.start(application, hubName, connectionString)
        }
      } catch (e: IllegalStateException) {
        // The SDK asks Firebase for a token as soon as it starts, which throws when the default
        // FirebaseApp was never initialised. That is nearly always a missing google-services.json.
        throw FirebaseNotConfiguredException(e)
      }

      ANHRegistry.registerExpirationVisitor()

      NotificationHub.setInstallationSavedListener { installation ->
        ANHRegistry.emit(
          "onInstallationSaved",
          mapOf("installation" to ANHSerialization.installation(installation))
        )
      }
      NotificationHub.setInstallationSaveFailureListener { exception ->
        ANHRegistry.emit(
          "onInstallationSaveFailed",
          mapOf(
            "installation" to null,
            "message" to (exception?.message ?: exception?.toString() ?: "Unknown error"),
            "code" to exception?.javaClass?.simpleName
          )
        )
      }

      ANHRegistry.markStarted()
    }.runOnQueue(Queues.MAIN)

    Function("isStarted") {
      ANHRegistry.isStarted
    }

    AsyncFunction("setEnabledAsync") { enabled: Boolean ->
      requireStarted()
      NotificationHub.setEnabled(enabled)
    }

    AsyncFunction("isEnabledAsync") {
      if (!ANHRegistry.isStarted) true else NotificationHub.isEnabled()
    }

    // endregion

    // region Installation

    AsyncFunction("getInstallationAsync") {
      mapOf(
        "installationId" to AzureNotificationHubInternals.getInstallationId(context),
        "pushChannel" to PushChannelVisitor(context).pushChannel,
        "platform" to (PlatformVisitor(context).platform ?: "fcmv1"),
        "userId" to AzureNotificationHubInternals.getUserId(context),
        "tags" to AzureNotificationHubInternals.getTags(context).sorted(),
        "templates" to ANHSerialization.templates(readTemplates()),
        "expirationTime" to ANHSerialization.formatDate(ANHRegistry.getExpiration(context))
      )
    }

    AsyncFunction("saveInstallationAsync") {
      requireStarted()
      NotificationHub.beginInstallationUpdate()
    }

    AsyncFunction("getInstallationIdAsync") {
      AzureNotificationHubInternals.getInstallationId(context)
    }

    AsyncFunction("setInstallationIdAsync") { installationId: String ->
      requireStarted()
      NotificationHub.setInstallationId(installationId)
    }

    AsyncFunction("getPushChannelAsync") {
      PushChannelVisitor(context).pushChannel
    }

    AsyncFunction("setPushChannelAsync") { pushChannel: String ->
      // `NotificationHub` has no public push-channel setter, but the visitor it reads from does,
      // and it is backed by the same preference file.
      PushChannelVisitor(context).pushChannel = pushChannel
      if (ANHRegistry.isStarted) {
        NotificationHub.beginInstallationUpdate()
      }
    }

    AsyncFunction("getUserIdAsync") {
      AzureNotificationHubInternals.getUserId(context)
    }

    AsyncFunction("setUserIdAsync") { userId: String? ->
      requireStarted()
      NotificationHub.setUserId(userId)
    }

    AsyncFunction("getPlatformAsync") {
      PlatformVisitor(context).platform ?: "fcmv1"
    }

    AsyncFunction("setPlatformAsync") { platform: String ->
      PlatformVisitor(context).platform = platform
      if (ANHRegistry.isStarted) {
        NotificationHub.beginInstallationUpdate()
      }
    }

    AsyncFunction("setExpirationAsync") { expiration: Double? ->
      ANHRegistry.setExpiration(context, expiration?.let { Date(it.toLong()) })
      if (ANHRegistry.isStarted) {
        NotificationHub.beginInstallationUpdate()
      }
    }

    // endregion

    // region Tags

    AsyncFunction("addTagAsync") { tag: String ->
      requireStarted()
      NotificationHub.addTag(tag)
    }

    AsyncFunction("addTagsAsync") { tags: List<String> ->
      requireStarted()
      NotificationHub.addTags(tags)
    }

    AsyncFunction("removeTagAsync") { tag: String ->
      requireStarted()
      NotificationHub.removeTag(tag)
    }

    AsyncFunction("removeTagsAsync") { tags: List<String> ->
      requireStarted()
      NotificationHub.removeTags(tags)
    }

    AsyncFunction("getTagsAsync") {
      AzureNotificationHubInternals.getTags(context).sorted()
    }

    AsyncFunction("clearTagsAsync") {
      requireStarted()
      NotificationHub.clearTags()
    }

    // endregion

    // region Templates

    AsyncFunction("setTemplateAsync") { name: String, template: ANHTemplateRecord ->
      requireStarted()

      val installationTemplate = InstallationTemplate()
      installationTemplate.body = template.body
      template.tags.forEach { installationTemplate.addTag(it) }
      template.headers.forEach { (key, value) -> installationTemplate.setHeader(key, value) }

      val existing = readTemplates()[name]
      NotificationHub.setTemplate(name, installationTemplate)
      existing != installationTemplate
    }

    AsyncFunction("removeTemplateAsync") { name: String ->
      requireStarted()
      NotificationHub.removeTemplate(name)
    }

    AsyncFunction("getTemplateAsync") { name: String ->
      readTemplates()[name]?.let { ANHSerialization.template(it) }
    }

    AsyncFunction("getTemplatesAsync") {
      ANHSerialization.templates(readTemplates())
    }

    AsyncFunction("clearTemplatesAsync") {
      requireStarted()
      // The Android SDK has no bulk template removal on `NotificationHub`.
      AzureNotificationHubInternals.clearTemplates(context)
      NotificationHub.beginInstallationUpdate()
    }

    // endregion

    // region Custom installation management

    Function("completeInstallationUpsert") { requestId: String, error: String? ->
      if (!ANHRegistry.hasPendingUpsert(requestId)) {
        throw UnknownUpsertRequestException(requestId)
      }
      ANHRegistry.completeUpsert(requestId, error)
    }

    // endregion

    // region Permissions

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      resolvePermissions(promise, ask = false)
    }

    AsyncFunction("requestPermissionsAsync") { _: List<String>?, promise: Promise ->
      resolvePermissions(promise, ask = true)
    }

    // endregion
  }

  // region Helpers

  private fun requireStarted() {
    if (!ANHRegistry.isStarted) {
      throw NotStartedException()
    }
  }

  private fun readTemplates(): Map<String, InstallationTemplate> = try {
    AzureNotificationHubInternals.getTemplates(context)
  } catch (e: RuntimeException) {
    // The SDK throws when it cannot deserialize its own stored templates.
    emptyMap()
  }

  private fun notificationsEnabled(): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    return manager?.areNotificationsEnabled() ?: false
  }

  private fun resolvePermissions(promise: Promise, ask: Boolean) {
    // POST_NOTIFICATIONS only exists on Android 13+. Below that, notifications are allowed unless
    // the user turned them off in system settings, which is not something an app can prompt for.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      val enabled = notificationsEnabled()
      promise.resolve(
        mapOf(
          "status" to if (enabled) "granted" else "denied",
          "granted" to enabled,
          "canAskAgain" to false
        )
      )
      return
    }

    val permissions = appContext.permissions
    if (permissions == null) {
      // No permissions service (a bare React Native host, for instance). Report what can be
      // determined without prompting.
      val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
      promise.resolve(
        mapOf(
          "status" to if (granted) "granted" else "denied",
          "granted" to granted,
          "canAskAgain" to !granted
        )
      )
      return
    }

    val callback = PermissionsResponseListener { result ->
      val response = result[Manifest.permission.POST_NOTIFICATIONS]
      val granted = response?.status == PermissionsStatus.GRANTED
      promise.resolve(
        mapOf(
          "status" to when (response?.status) {
            PermissionsStatus.GRANTED -> "granted"
            PermissionsStatus.DENIED -> "denied"
            else -> "undetermined"
          },
          "granted" to granted,
          "canAskAgain" to (response?.canAskAgain ?: true)
        )
      )
    }

    if (ask) {
      permissions.askForPermissions(callback, Manifest.permission.POST_NOTIFICATIONS)
    } else {
      permissions.getPermissions(callback, Manifest.permission.POST_NOTIFICATIONS)
    }
  }

  // endregion
}
