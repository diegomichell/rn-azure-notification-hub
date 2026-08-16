import Foundation
import WindowsAzureMessaging

/**
 A process-wide `NSObject` that receives every Azure Notification Hubs callback and forwards it to
 the currently mounted `AzureNotificationHubModule`.

 It exists as a singleton rather than living on the module itself for three reasons:

 1. `ExpoModulesCore.Module` is not an `NSObject` subclass, so it cannot conform to the SDK's
    Objective-C delegate protocols.
 2. The SDK holds `enrichmentDelegate`, `lifecycleDelegate` and `managementDelegate` **weakly**,
    so something has to keep the delegate alive.
 3. Modules are torn down and recreated on every fast refresh, while `MSNotificationHub` is a
    singleton that lives for the whole process.

 Every delegate method carries an explicit `@objc(selector)` annotation. All of these protocol
 requirements are `@optional`, so a signature that Swift imports differently than expected would
 otherwise fail silently — pinning the selector keeps `respondsToSelector:` accurate no matter how
 the importer renames things.

 Notifications that arrive before JavaScript has attached a listener — a cold launch from a
 notification tap, most commonly — are buffered here and replayed once a listener appears.
 */
final class ANHDelegateProxy: NSObject {
  static let shared = ANHDelegateProxy()

  /// Upper bound on replayed notifications, so a device that never opens the app cannot grow the
  /// buffer without limit.
  private static let maxBufferedNotifications = 32

  private static let installationIdKey = "rn-azure-notification-hub.installationId"
  private static let expirationKey = "rn-azure-notification-hub.expirationTime"
  private static let clearUserIdKey = "rn-azure-notification-hub.clearUserId"

  private let lock = NSRecursiveLock()
  private weak var module: AzureNotificationHubModule?
  private var bufferedNotifications: [[String: Any?]] = []
  private var isObservingNotifications = false
  private var pendingUpserts: [String: (Error?) -> Void] = [:]
  private var pendingTimeouts: [String: DispatchWorkItem] = [:]
  private var upsertSequence: UInt64 = 0

  /// Seconds to wait for JavaScript to acknowledge an installation upsert.
  var upsertTimeout: TimeInterval = 30

  /// `MSNotificationHub.setUserId` cannot take `nil`, so clearing the user id is deferred to
  /// enrichment.
  var shouldClearUserId: Bool {
    get { UserDefaults.standard.bool(forKey: Self.clearUserIdKey) }
    set { UserDefaults.standard.set(newValue, forKey: Self.clearUserIdKey) }
  }

  /// `true` once `startAsync` has run in this process.
  private(set) var isStarted = false

  private override init() {
    super.init()
  }

  // MARK: - Overrides applied during enrichment

  /// A caller-supplied installation id. The SDK has no setter for this, so it is applied on every
  /// upsert through `MSInstallationEnrichmentDelegate`.
  var installationIdOverride: String? {
    get { UserDefaults.standard.string(forKey: Self.installationIdKey) }
    set {
      if let newValue {
        UserDefaults.standard.set(newValue, forKey: Self.installationIdKey)
      } else {
        UserDefaults.standard.removeObject(forKey: Self.installationIdKey)
      }
    }
  }

  /// A caller-supplied installation expiry, applied the same way as `installationIdOverride`.
  var expirationOverride: Date? {
    get {
      let seconds = UserDefaults.standard.double(forKey: Self.expirationKey)
      return seconds > 0 ? Date(timeIntervalSince1970: seconds) : nil
    }
    set {
      if let newValue {
        UserDefaults.standard.set(newValue.timeIntervalSince1970, forKey: Self.expirationKey)
      } else {
        UserDefaults.standard.removeObject(forKey: Self.expirationKey)
      }
    }
  }

  // MARK: - Module attachment

  func attach(module: AzureNotificationHubModule) {
    lock.lock()
    self.module = module
    lock.unlock()

    // Registering the delegates also instantiates `MSNotificationHub.sharedInstance`, which the
    // SDK's static template/user-id helpers dereference directly. Doing it here means those work
    // even if the app calls them before `startAsync`.
    MSNotificationHub.setDelegate(self)
    MSNotificationHub.setEnrichmentDelegate(self)
    MSNotificationHub.setLifecycleDelegate(self)
  }

  func detach(module: AzureNotificationHubModule) {
    lock.lock()
    defer { lock.unlock() }

    if self.module === module {
      self.module = nil
      isObservingNotifications = false
    }
  }

  func markStarted() {
    lock.lock()
    isStarted = true
    lock.unlock()
  }

  // MARK: - Notification buffering

  func startObservingNotifications() {
    lock.lock()
    isObservingNotifications = true
    let buffered = bufferedNotifications
    bufferedNotifications = []
    let module = self.module
    lock.unlock()

    guard let module else {
      return
    }
    for var notification in buffered {
      notification["buffered"] = true
      module.sendEvent("onNotificationReceived", notification)
    }
  }

  func stopObservingNotifications() {
    lock.lock()
    isObservingNotifications = false
    lock.unlock()
  }

  private func emit(_ event: String, _ payload: [String: Any?]) {
    lock.lock()
    let module = self.module
    lock.unlock()

    module?.sendEvent(event, payload)
  }

  // MARK: - Custom installation management

  /// Registers a pending upsert and returns the id JavaScript must acknowledge.
  private func registerUpsert(completion: @escaping (Error?) -> Void) -> String {
    lock.lock()
    upsertSequence += 1
    let requestId = "upsert-\(upsertSequence)"
    pendingUpserts[requestId] = completion
    let seconds = upsertTimeout

    let timeout = DispatchWorkItem { [weak self] in
      self?.completeUpsert(requestId: requestId, error: ANHError.upsertTimedOut(seconds: seconds))
    }
    pendingTimeouts[requestId] = timeout
    lock.unlock()

    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds, execute: timeout)
    return requestId
  }

  /// Resolves a pending upsert. Extra calls for the same id are ignored.
  func completeUpsert(requestId: String, error: Error?) {
    lock.lock()
    let completion = pendingUpserts.removeValue(forKey: requestId)
    pendingTimeouts.removeValue(forKey: requestId)?.cancel()
    lock.unlock()

    completion?(error)
  }

  func hasPendingUpsert(requestId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return pendingUpserts[requestId] != nil
  }
}

// MARK: - MSNotificationHubDelegate

extension ANHDelegateProxy: MSNotificationHubDelegate {
  @objc(notificationHub:didReceivePushNotification:)
  func notificationHub(
    _ notificationHub: MSNotificationHub,
    didReceivePushNotification message: MSNotificationHubMessage
  ) {
    let payload = ANHSerialization.message(message)

    lock.lock()
    let canDeliver = isObservingNotifications && module != nil
    if !canDeliver {
      if bufferedNotifications.count >= Self.maxBufferedNotifications {
        bufferedNotifications.removeFirst()
      }
      bufferedNotifications.append(payload)
    }
    lock.unlock()

    if canDeliver {
      emit("onNotificationReceived", payload)
    }
  }

  @objc(notificationHub:didRequestAuthorization:error:)
  func notificationHub(
    _ notificationHub: MSNotificationHub,
    didRequestAuthorization granted: Bool,
    error: Error?
  ) {
    emit("onAuthorizationRequested", [
      "granted": granted,
      "message": error?.localizedDescription
    ])
  }
}

// MARK: - MSInstallationEnrichmentDelegate

extension ANHDelegateProxy: MSInstallationEnrichmentDelegate {
  @objc(notificationHub:willEnrichInstallation:)
  func notificationHub(
    _ notificationHub: MSNotificationHub,
    willEnrichInstallation installation: MSInstallation
  ) {
    if let installationIdOverride, !installationIdOverride.isEmpty {
      installation.installationId = installationIdOverride
    }
    if let expirationOverride {
      installation.expirationTime = expirationOverride
    }
    if shouldClearUserId {
      installation.userId = nil
    }
  }
}

// MARK: - MSInstallationLifecycleDelegate

extension ANHDelegateProxy: MSInstallationLifecycleDelegate {
  @objc(notificationHub:didSaveInstallation:)
  func notificationHub(
    _ notificationHub: MSNotificationHub,
    didSave installation: MSInstallation
  ) {
    emit("onInstallationSaved", [
      "installation": ANHSerialization.installation(installation)
    ])
  }

  @objc(notificationHub:didFailToSaveInstallation:withError:)
  func notificationHub(
    _ notificationHub: MSNotificationHub,
    didFailToSave installation: MSInstallation,
    withError error: Error
  ) {
    let nsError = error as NSError
    emit("onInstallationSaveFailed", [
      "installation": ANHSerialization.installation(installation),
      "message": nsError.localizedDescription,
      "code": "\(nsError.domain).\(nsError.code)"
    ])
  }
}

// MARK: - MSInstallationManagementDelegate

extension ANHDelegateProxy: MSInstallationManagementDelegate {
  @objc(notificationHub:willUpsertInstallation:completionHandler:)
  func notificationHub(
    _ notificationHub: MSNotificationHub,
    willUpsertInstallation installation: MSInstallation,
    completionHandler: @escaping (Error?) -> Void
  ) {
    let payload = ANHSerialization.installation(installation)
    let requestId = registerUpsert(completion: completionHandler)

    emit("onInstallationUpsertRequested", [
      "requestId": requestId,
      "installation": payload
    ])
  }
}
