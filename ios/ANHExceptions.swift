import ExpoModulesCore
import Foundation

/// Errors reported back through the Azure SDK's own completion handlers.
enum ANHError: LocalizedError {
  case upsertTimedOut(seconds: TimeInterval)

  var errorDescription: String? {
    switch self {
    case .upsertTimedOut(let seconds):
      return "JavaScript did not acknowledge the installation upsert within \(Int(seconds))s. " +
        "Call completeInstallationUpsert(requestId) from your onInstallationUpsertRequested handler."
    }
  }
}

internal final class InvalidConfigurationException: Exception, @unchecked Sendable {
  override var reason: String {
    "startAsync requires either `connectionString` and `hubName`, or `installationManagement: true`"
  }
}

internal final class NotStartedException: Exception, @unchecked Sendable {
  override var reason: String {
    "The Azure Notification Hubs SDK has not been started. Call startAsync() first."
  }
}

internal final class InvalidPushChannelException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "\"\(param)\" is not a valid APNs device token. Pass the token as a lowercase hex string."
  }
}

internal final class UnsupportedOnPlatformException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "`\(param)` is not supported on this platform"
  }
}

internal final class UnknownUpsertRequestException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "No pending installation upsert with id \"\(param)\". It may have already been completed or timed out."
  }
}
