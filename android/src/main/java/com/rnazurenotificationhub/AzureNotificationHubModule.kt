package com.rnazurenotificationhub

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AzureNotificationHubModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AzureNotificationHub")

    Events("onChange")

    Function("hello") {
      "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { value: String ->
      sendEvent("onChange", mapOf(
        "value" to value
      ))
    }
  }
}
