package com.rnazurenotificationhub

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.microsoft.windowsazure.messaging.notificationhubs.Installation
import com.microsoft.windowsazure.messaging.notificationhubs.InstallationAdapter
import com.microsoft.windowsazure.messaging.notificationhubs.InstallationVisitor
import com.microsoft.windowsazure.messaging.notificationhubs.NotificationHub
import com.microsoft.windowsazure.messaging.notificationhubs.NotificationListener
import com.microsoft.windowsazure.messaging.notificationhubs.NotificationMessage
import java.lang.ref.WeakReference
import java.util.Date
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-wide state shared between the Expo module, the notification listener installed at
 * application startup, and the installation adapter used in custom-backend mode.
 *
 * The Expo module is torn down and recreated on every reload while `NotificationHub` is a
 * singleton for the life of the process, so the two cannot own each other. Notifications that
 * arrive before JavaScript has attached a listener — a data-only push that started the process,
 * typically — are buffered here and replayed once a listener appears.
 */
internal object ANHRegistry : NotificationListener {
  private const val TAG = "ANH"
  private const val MAX_BUFFERED_NOTIFICATIONS = 32
  private const val PREFERENCES = "rn-azure-notification-hub"
  private const val EXPIRATION_KEY = "expirationTime"

  private val lock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val upsertSequence = AtomicLong(0)

  private var applicationContext: Context? = null
  private var moduleRef: WeakReference<AzureNotificationHubModule>? = null
  private var isObservingNotifications = false
  private var hasRegisteredExpirationVisitor = false
  private val bufferedNotifications = ArrayDeque<MutableMap<String, Any?>>()
  private val pendingUpserts = mutableMapOf<String, PendingUpsert>()

  /** `true` once `startAsync` has run in this process. */
  @Volatile
  var isStarted = false
    private set

  /** Milliseconds to wait for JavaScript to acknowledge an installation upsert. */
  @Volatile
  var upsertTimeoutMillis = 30_000L

  private class PendingUpsert(
    val installation: Installation,
    val onSaved: InstallationAdapter.Listener,
    val onError: InstallationAdapter.ErrorListener,
    val timeout: Runnable
  )

  // region Startup

  /**
   * Registers this object as the SDK's notification listener. Called from
   * [AzureNotificationHubInitializer] during `Application` startup, and again when the module is
   * created in case the host app disabled androidx.startup.
   */
  fun install(context: Context) {
    synchronized(lock) {
      applicationContext = context.applicationContext
    }
    NotificationHub.setListener(this)
  }

  fun markStarted() {
    isStarted = true
  }

  // endregion

  // region Module attachment

  fun attach(module: AzureNotificationHubModule, context: Context) {
    synchronized(lock) {
      moduleRef = WeakReference(module)
    }
    install(context)
  }

  fun detach(module: AzureNotificationHubModule) {
    synchronized(lock) {
      if (moduleRef?.get() === module) {
        moduleRef = null
        isObservingNotifications = false
      }
    }
  }

  fun startObservingNotifications() {
    val module: AzureNotificationHubModule?
    val replay: List<MutableMap<String, Any?>>

    synchronized(lock) {
      isObservingNotifications = true
      replay = bufferedNotifications.toList()
      bufferedNotifications.clear()
      module = moduleRef?.get()
    }

    if (module == null) {
      return
    }
    replay.forEach { notification ->
      notification["buffered"] = true
      module.sendEvent("onNotificationReceived", notification)
    }
  }

  fun stopObservingNotifications() {
    synchronized(lock) {
      isObservingNotifications = false
    }
  }

  fun emit(event: String, payload: Map<String, Any?>) {
    val module = synchronized(lock) { moduleRef?.get() } ?: return
    module.sendEvent(event, payload)
  }

  // endregion

  // region NotificationListener

  override fun onPushNotificationReceived(context: Context?, message: NotificationMessage?) {
    if (message == null) {
      return
    }
    val payload = ANHSerialization.message(message)

    val module = synchronized(lock) {
      if (context != null && applicationContext == null) {
        applicationContext = context.applicationContext
      }
      val target = moduleRef?.get()?.takeIf { isObservingNotifications }
      if (target == null) {
        if (bufferedNotifications.size >= MAX_BUFFERED_NOTIFICATIONS) {
          bufferedNotifications.removeFirst()
        }
        bufferedNotifications.addLast(payload)
      }
      target
    }

    module?.sendEvent("onNotificationReceived", payload)
  }

  // endregion

  // region Installation expiry

  /**
   * Registers [expirationVisitor] with the SDK exactly once per process. `useVisitor` appends to a
   * list that lives on the `NotificationHub` singleton, so a JavaScript reload followed by another
   * `startAsync` would otherwise keep growing it.
   */
  fun registerExpirationVisitor() {
    synchronized(lock) {
      if (hasRegisteredExpirationVisitor) {
        return
      }
      hasRegisteredExpirationVisitor = true
    }
    NotificationHub.useVisitor(expirationVisitor)
  }

  /**
   * The SDK has no setter for an installation's expiry, so it is applied through an
   * [InstallationVisitor] on every upsert.
   */
  private val expirationVisitor = InstallationVisitor { installation ->
    val context = synchronized(lock) { applicationContext }
    if (context != null) {
      getExpiration(context)?.let { installation.expiration = it }
    }
  }

  fun getExpiration(context: Context): Date? {
    val millis = preferences(context).getLong(EXPIRATION_KEY, 0L)
    return if (millis > 0L) Date(millis) else null
  }

  fun setExpiration(context: Context, expiration: Date?) {
    val editor = preferences(context).edit()
    if (expiration == null) {
      editor.remove(EXPIRATION_KEY)
    } else {
      editor.putLong(EXPIRATION_KEY, expiration.time)
    }
    editor.apply()
  }

  private fun preferences(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  // endregion

  // region Custom installation management

  fun requestUpsert(
    installation: Installation,
    onSaved: InstallationAdapter.Listener,
    onError: InstallationAdapter.ErrorListener
  ) {
    val requestId = "upsert-${upsertSequence.incrementAndGet()}"
    val timeoutMillis = upsertTimeoutMillis
    val timeout = Runnable {
      completeUpsert(
        requestId,
        "JavaScript did not acknowledge the installation upsert within ${timeoutMillis}ms. " +
          "Call completeInstallationUpsert(requestId) from your onInstallationUpsertRequested handler."
      )
    }

    synchronized(lock) {
      pendingUpserts[requestId] = PendingUpsert(installation, onSaved, onError, timeout)
    }
    mainHandler.postDelayed(timeout, timeoutMillis)

    emit(
      "onInstallationUpsertRequested",
      mapOf(
        "requestId" to requestId,
        "installation" to ANHSerialization.installation(installation)
      )
    )
  }

  fun hasPendingUpsert(requestId: String): Boolean =
    synchronized(lock) { pendingUpserts.containsKey(requestId) }

  /** Resolves a pending upsert. Extra calls for the same id are ignored. */
  fun completeUpsert(requestId: String, error: String?) {
    val pending = synchronized(lock) { pendingUpserts.remove(requestId) } ?: return
    mainHandler.removeCallbacks(pending.timeout)

    try {
      if (error == null) {
        pending.onSaved.onInstallationSaved(pending.installation)
      } else {
        pending.onError.onInstallationSaveError(Exception(error))
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to complete installation upsert $requestId", e)
    }
  }

  // endregion
}

/**
 * Hands every installation upsert to JavaScript instead of contacting Azure, so that apps can
 * register devices through their own backend and avoid shipping a connection string.
 */
internal class ANHInstallationAdapter : InstallationAdapter {
  override fun saveInstallation(
    installation: Installation,
    onInstallationSaved: InstallationAdapter.Listener,
    onInstallationSaveError: InstallationAdapter.ErrorListener
  ) {
    ANHRegistry.requestUpsert(installation, onInstallationSaved, onInstallationSaveError)
  }
}
