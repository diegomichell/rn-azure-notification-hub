import ExpoModulesCore

public class AzureNotificationHubModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AzureNotificationHub")

    Events("onChange")

    Function("hello") {
      return "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { (value: String) in
      self.sendEvent("onChange", [
        "value": value
      ])
    }
  }
}
