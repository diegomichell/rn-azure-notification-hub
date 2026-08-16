package com.rnazurenotificationhub

import com.microsoft.windowsazure.messaging.notificationhubs.Installation
import com.microsoft.windowsazure.messaging.notificationhubs.InstallationTemplate
import com.microsoft.windowsazure.messaging.notificationhubs.NotificationMessage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Converts the Azure SDK's model objects into the maps handed to JavaScript. */
internal object ANHSerialization {

  private val iso8601: SimpleDateFormat
    get() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }

  fun formatDate(date: Date?): String? = date?.let { iso8601.format(it) }

  fun template(template: InstallationTemplate): Map<String, Any?> = mapOf(
    "body" to (template.body ?: ""),
    "tags" to template.tags.toList().sorted(),
    "headers" to (template.headers ?: emptyMap<String, String>())
  )

  fun templates(templates: Map<String, InstallationTemplate>): Map<String, Any?> =
    templates.mapValues { template(it.value) }

  fun installation(installation: Installation): Map<String, Any?> = mapOf(
    "installationId" to installation.installationId,
    "pushChannel" to installation.pushChannel,
    "platform" to installation.platform,
    "userId" to installation.userId,
    "tags" to installation.tags.toList().sorted(),
    "templates" to templates(installation.templates ?: emptyMap()),
    "expirationTime" to formatDate(installation.expiration)
  )

  fun message(message: NotificationMessage): MutableMap<String, Any?> = mutableMapOf(
    "title" to message.title,
    "body" to message.body,
    // `RemoteMessage.getData()` is always a String→String map.
    "data" to (message.data ?: emptyMap<String, String>()),
    "buffered" to false
  )
}
