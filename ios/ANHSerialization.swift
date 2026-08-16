import Foundation
import WindowsAzureMessaging

/**
 Converts the Azure Notification Hubs model objects into the plain dictionaries handed to
 JavaScript.

 A note on nullability: apart from `MSNotificationHub.h`, the SDK's headers carry no nullability
 annotations, so Swift imports those properties as implicitly unwrapped optionals. They are bound
 to real optionals here before use. The annotated `MSNotificationHub` getters are declared
 `nonnull` but do return `nil` in practice (for example `getPushChannel` before APNs has issued a
 token); Swift bridges those to empty `String`/`Array`/`Dictionary` values rather than trapping,
 which is why `emptyToNil(_:)` exists.
 */
enum ANHSerialization {
  private static let iso8601: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  /// Treats the empty string that the SDK's `nonnull` getters produce for a missing value as `nil`.
  static func emptyToNil(_ value: String?) -> String? {
    guard let value, !value.isEmpty else {
      return nil
    }
    return value
  }

  static func string(from date: Date?) -> String? {
    guard let date else {
      return nil
    }
    return iso8601.string(from: date)
  }

  static func template(_ template: MSInstallationTemplate) -> [String: Any?] {
    let tags: Set<String>? = template.tags
    let headers: [String: String]? = template.headers
    let body: String? = template.body

    return [
      "body": body ?? "",
      "tags": Array(tags ?? []).sorted(),
      "headers": headers ?? [:]
    ]
  }

  static func templates(_ templates: [String: MSInstallationTemplate]?) -> [String: Any?] {
    var result: [String: Any?] = [:]
    for (key, value) in templates ?? [:] {
      result[key] = template(value)
    }
    return result
  }

  static func installation(_ installation: MSInstallation) -> [String: Any?] {
    let tags: Set<String>? = installation.tags
    let expiration: Date? = installation.expirationTime

    return [
      "installationId": emptyToNil(installation.installationId),
      "pushChannel": emptyToNil(installation.pushChannel),
      "platform": "apns",
      "userId": emptyToNil(installation.userId),
      "tags": Array(tags ?? []).sorted(),
      "templates": templates(installation.templates),
      "expirationTime": string(from: expiration)
    ]
  }

  static func message(_ message: MSNotificationHubMessage) -> [String: Any?] {
    let title: String? = message.title
    let body: String? = message.body
    let userInfo: [AnyHashable: Any]? = message.userInfo

    return [
      "title": title,
      "body": body,
      "data": jsonSafe(userInfo ?? [:]),
      "buffered": false
    ]
  }

  /// Drops any value that cannot survive the trip across the JavaScript bridge.
  private static func jsonSafe(_ dictionary: [AnyHashable: Any]) -> [String: Any] {
    var result: [String: Any] = [:]
    for (key, value) in dictionary {
      guard let key = key as? String else {
        continue
      }
      if let value = jsonSafeValue(value) {
        result[key] = value
      }
    }
    return result
  }

  private static func jsonSafeValue(_ value: Any) -> Any? {
    switch value {
    case let value as String:
      return value
    case let value as NSNumber:
      return value
    case is NSNull:
      return nil
    case let value as [AnyHashable: Any]:
      return jsonSafe(value)
    case let value as [Any]:
      return value.compactMap { jsonSafeValue($0) }
    case let value as Date:
      return string(from: value)
    default:
      return String(describing: value)
    }
  }
}
