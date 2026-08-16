import ExpoModulesCore
import UserNotifications
import WindowsAzureMessaging

/// Options accepted by `startAsync`.
struct ANHConfigRecord: Record {
  @Field var connectionString: String?
  @Field var hubName: String?
  @Field var installationManagement: Bool = false
  @Field var installationUpsertTimeout: Double = 30_000
  @Field var authorizationOptions: [String]?
}

/// A template as it crosses the bridge.
struct ANHTemplateRecord: Record {
  @Field var body: String = ""
  @Field var tags: [String] = []
  @Field var headers: [String: String] = [:]
}

public class AzureNotificationHubModule: Module {
  private let proxy = ANHDelegateProxy.shared

  public func definition() -> ModuleDefinition {
    Name("AzureNotificationHub")

    Events(
      "onNotificationReceived",
      "onInstallationSaved",
      "onInstallationSaveFailed",
      "onInstallationUpsertRequested",
      "onAuthorizationRequested"
    )

    OnCreate {
      self.proxy.attach(module: self)
    }

    OnDestroy {
      self.proxy.detach(module: self)
    }

    OnStartObserving("onNotificationReceived") {
      self.proxy.startObservingNotifications()
    }

    OnStopObserving("onNotificationReceived") {
      self.proxy.stopObservingNotifications()
    }

    // MARK: - Lifecycle

    AsyncFunction("startAsync") { (config: ANHConfigRecord) in
      let options = MSNotificationHubOptions()
      options.authorizationOptions = Self.authorizationOptions(from: config.authorizationOptions)

      if config.installationManagement {
        self.proxy.upsertTimeout = max(config.installationUpsertTimeout, 1_000) / 1_000
        MSNotificationHub.start(withInstallationManagement: self.proxy, options: options)
      } else {
        guard let connectionString = config.connectionString, !connectionString.isEmpty,
              let hubName = config.hubName, !hubName.isEmpty else {
          throw InvalidConfigurationException()
        }
        MSNotificationHub.start(connectionString: connectionString, hubName: hubName, options: options)
      }

      self.proxy.markStarted()
    }
    // `MSNotificationHub.start` calls `UIApplication.registerForRemoteNotifications()`.
    .runOnQueue(.main)

    Function("isStarted") {
      self.proxy.isStarted
    }

    AsyncFunction("setEnabledAsync") { (enabled: Bool) in
      MSNotificationHub.setEnabled(enabled)
    }
    .runOnQueue(.main)

    AsyncFunction("isEnabledAsync") {
      MSNotificationHub.isEnabled()
    }

    // MARK: - Installation

    AsyncFunction("getInstallationAsync") { () -> [String: Any?] in
      [
        "installationId": self.currentInstallationId(),
        "pushChannel": ANHSerialization.emptyToNil(MSNotificationHub.getPushChannel()),
        "platform": "apns",
        "userId": self.currentUserId(),
        "tags": MSNotificationHub.getTags().sorted(),
        "templates": ANHSerialization.templates(MSNotificationHub.getTemplates()),
        "expirationTime": ANHSerialization.string(from: self.proxy.expirationOverride)
      ]
    }

    AsyncFunction("saveInstallationAsync") {
      try self.requireStarted()
      MSNotificationHub.willSaveInstallation()
    }
    .runOnQueue(.main)

    AsyncFunction("getInstallationIdAsync") { () -> String? in
      self.currentInstallationId()
    }

    AsyncFunction("setInstallationIdAsync") { (installationId: String) in
      try self.requireStarted()
      self.proxy.installationIdOverride = installationId
      // The id is applied by the enrichment delegate, so force an upsert to make it take effect.
      MSNotificationHub.willSaveInstallation()
    }
    .runOnQueue(.main)

    AsyncFunction("getPushChannelAsync") { () -> String? in
      ANHSerialization.emptyToNil(MSNotificationHub.getPushChannel())
    }

    AsyncFunction("setPushChannelAsync") { (pushChannel: String) in
      guard let token = Self.dataFromHexString(pushChannel) else {
        throw InvalidPushChannelException(pushChannel)
      }
      MSNotificationHub.didRegisterForRemoteNotifications(withDeviceToken: token)
    }
    .runOnQueue(.main)

    AsyncFunction("getUserIdAsync") { () -> String? in
      self.currentUserId()
    }

    AsyncFunction("setUserIdAsync") { (userId: String?) in
      try self.requireStarted()
      // `MSNotificationHub.setUserId` takes a non-null string, so clearing is handled by the
      // enrichment delegate instead.
      self.proxy.shouldClearUserId = userId == nil
      MSNotificationHub.setUserId(userId ?? "")
    }
    .runOnQueue(.main)

    AsyncFunction("getPlatformAsync") { () -> String? in
      "apns"
    }

    AsyncFunction("setPlatformAsync") { (_: String) in
      throw UnsupportedOnPlatformException("setPlatformAsync")
    }

    AsyncFunction("setExpirationAsync") { (expiration: Double?) in
      try self.requireStarted()
      self.proxy.expirationOverride = expiration.map { Date(timeIntervalSince1970: $0 / 1_000) }
      MSNotificationHub.willSaveInstallation()
    }
    .runOnQueue(.main)

    // MARK: - Tags

    AsyncFunction("addTagAsync") { (tag: String) -> Bool in
      try self.requireStarted()
      return MSNotificationHub.addTag(tag)
    }
    .runOnQueue(.main)

    AsyncFunction("addTagsAsync") { (tags: [String]) -> Bool in
      try self.requireStarted()
      return MSNotificationHub.addTags(tags)
    }
    .runOnQueue(.main)

    AsyncFunction("removeTagAsync") { (tag: String) -> Bool in
      try self.requireStarted()
      return MSNotificationHub.removeTag(tag)
    }
    .runOnQueue(.main)

    AsyncFunction("removeTagsAsync") { (tags: [String]) -> Bool in
      try self.requireStarted()
      return MSNotificationHub.removeTags(tags)
    }
    .runOnQueue(.main)

    AsyncFunction("getTagsAsync") { () -> [String] in
      MSNotificationHub.getTags().sorted()
    }

    AsyncFunction("clearTagsAsync") {
      try self.requireStarted()
      MSNotificationHub.clearTags()
    }
    .runOnQueue(.main)

    // MARK: - Templates

    AsyncFunction("setTemplateAsync") { (name: String, template: ANHTemplateRecord) -> Bool in
      try self.requireStarted()

      let installationTemplate = MSInstallationTemplate()
      installationTemplate.body = template.body
      if !template.tags.isEmpty {
        _ = installationTemplate.addTags(template.tags)
      }
      for (key, value) in template.headers {
        installationTemplate.setHeaderValue(value, forKey: key)
      }

      return MSNotificationHub.setTemplate(installationTemplate, forKey: name)
    }
    .runOnQueue(.main)

    AsyncFunction("removeTemplateAsync") { (name: String) -> Bool in
      try self.requireStarted()
      return MSNotificationHub.removeTemplate(forKey: name)
    }
    .runOnQueue(.main)

    AsyncFunction("getTemplateAsync") { (name: String) -> [String: Any?]? in
      // `getTemplateForKey:` is declared non-null but returns nil for unknown keys, which is not
      // safe to bridge into Swift. Reading through the dictionary avoids that.
      guard let template = MSNotificationHub.getTemplates()[name] else {
        return nil
      }
      return ANHSerialization.template(template)
    }

    AsyncFunction("getTemplatesAsync") { () -> [String: Any?] in
      ANHSerialization.templates(MSNotificationHub.getTemplates())
    }

    AsyncFunction("clearTemplatesAsync") {
      try self.requireStarted()
      // The iOS SDK has no bulk template removal.
      for key in MSNotificationHub.getTemplates().keys {
        MSNotificationHub.removeTemplate(forKey: key)
      }
    }
    .runOnQueue(.main)

    // MARK: - Custom installation management

    Function("completeInstallationUpsert") { (requestId: String, error: String?) in
      guard self.proxy.hasPendingUpsert(requestId: requestId) else {
        throw UnknownUpsertRequestException(requestId)
      }
      self.proxy.completeUpsert(
        requestId: requestId,
        error: error.map {
          NSError(
            domain: "RNAzureNotificationHub",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: $0]
          )
        }
      )
    }

    // MARK: - Permissions

    AsyncFunction("getPermissionsAsync") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        promise.resolve(Self.serialize(settings: settings))
      }
    }

    AsyncFunction("requestPermissionsAsync") { (options: [String]?, promise: Promise) in
      let center = UNUserNotificationCenter.current()
      center.requestAuthorization(options: Self.authorizationOptions(from: options)) { _, error in
        if let error {
          promise.reject(error)
          return
        }
        center.getNotificationSettings { settings in
          promise.resolve(Self.serialize(settings: settings))
        }
      }
    }
  }

  // MARK: - Helpers

  private func requireStarted() throws {
    guard proxy.isStarted else {
      throw NotStartedException()
    }
  }

  private func currentInstallationId() -> String? {
    if let override = proxy.installationIdOverride, !override.isEmpty {
      return override
    }
    return ANHSerialization.emptyToNil(MSNotificationHub.getInstallationId())
  }

  private func currentUserId() -> String? {
    if proxy.shouldClearUserId {
      return nil
    }
    return ANHSerialization.emptyToNil(MSNotificationHub.getUserId())
  }

  private static func authorizationOptions(from names: [String]?) -> UNAuthorizationOptions {
    guard let names, !names.isEmpty else {
      return [.alert, .sound, .badge]
    }

    var options: UNAuthorizationOptions = []
    for name in names {
      switch name {
      case "badge": options.insert(.badge)
      case "sound": options.insert(.sound)
      case "alert": options.insert(.alert)
      case "carPlay": options.insert(.carPlay)
      case "criticalAlert": options.insert(.criticalAlert)
      case "providesAppNotificationSettings": options.insert(.providesAppNotificationSettings)
      case "provisional": options.insert(.provisional)
      default: break
      }
    }
    return options
  }

  private static func serialize(settings: UNNotificationSettings) -> [String: Any?] {
    let status: String
    var canAskAgain = false

    switch settings.authorizationStatus {
    case .notDetermined:
      status = "undetermined"
      canAskAgain = true
    case .denied:
      status = "denied"
    case .authorized, .provisional, .ephemeral:
      status = "granted"
    @unknown default:
      status = "undetermined"
      canAskAgain = true
    }

    return [
      "status": status,
      "granted": status == "granted",
      "canAskAgain": canAskAgain,
      "ios": [
        "allowsAlert": settings.alertSetting == .enabled,
        "allowsBadge": settings.badgeSetting == .enabled,
        "allowsSound": settings.soundSetting == .enabled,
        "allowsCriticalAlerts": settings.criticalAlertSetting == .enabled,
        "allowsAnnouncements": settings.announcementSetting == .enabled,
        "providesAppNotificationSettings": settings.providesAppNotificationSettings,
        "provisional": settings.authorizationStatus == .provisional
      ]
    ]
  }

  /// Parses a lowercase/uppercase hex APNs token into the `Data` the SDK expects.
  private static func dataFromHexString(_ hex: String) -> Data? {
    let trimmed = hex
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: " ", with: "")
      .replacingOccurrences(of: "<", with: "")
      .replacingOccurrences(of: ">", with: "")

    guard !trimmed.isEmpty, trimmed.count % 2 == 0 else {
      return nil
    }

    var data = Data(capacity: trimmed.count / 2)
    var index = trimmed.startIndex
    while index < trimmed.endIndex {
      let next = trimmed.index(index, offsetBy: 2)
      guard let byte = UInt8(trimmed[index..<next], radix: 16) else {
        return nil
      }
      data.append(byte)
      index = next
    }
    return data
  }
}
