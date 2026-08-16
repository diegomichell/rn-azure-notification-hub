package com.microsoft.windowsazure.messaging.notificationhubs;

import android.content.Context;
import android.content.SharedPreferences;

import com.microsoft.windowsazure.messaging.R;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Reaches the parts of the Azure Notification Hubs Android SDK that have no public entry point.
 *
 * <p>{@code NotificationHub} exposes {@code getTemplate(name)} but no way to enumerate or clear
 * templates, and it cannot read tags before {@code start()} has run. Both capabilities do exist on
 * the SDK's {@code TagVisitor}/{@code TemplateVisitor}, which are package-private — hence this
 * class living in the SDK's package. It is a read/clear shim only; nothing here changes SDK
 * behaviour.
 *
 * <p>The visitors are constructed from an explicit {@link SharedPreferences} instance rather than
 * from a {@link Context}. {@code TemplateVisitor(Context)} resolves its preference file with
 * {@code String.valueOf(R.string.installation_enrichment_file_key)} — the numeric resource id
 * rather than its value — so it reads a different file than the rest of the SDK. Passing the
 * preferences directly sidesteps that bug and keeps this in sync with what
 * {@code NotificationHub} actually persists.
 *
 * <p>Pinned against {@code com.microsoft.azure:notification-hubs-android-sdk:2.0.0}.
 */
public final class AzureNotificationHubInternals {

  private AzureNotificationHubInternals() {
  }

  private static SharedPreferences installationPreferences(Context context) {
    Context applicationContext = context.getApplicationContext();
    return applicationContext.getSharedPreferences(
        applicationContext.getString(R.string.installation_enrichment_file_key),
        Context.MODE_PRIVATE);
  }

  /** Reads the tags the SDK has persisted, whether or not {@code NotificationHub.start} has run. */
  public static Set<String> getTags(Context context) {
    TagVisitor visitor = new TagVisitor(installationPreferences(context));
    Set<String> tags = new HashSet<>();
    for (String tag : visitor.getTags()) {
      tags.add(tag);
    }
    return tags;
  }

  /**
   * Reads the persisted installation id.
   *
   * <p>{@code NotificationHub.getInstallationId()} throws before {@code start()} has run, because
   * the visitor it delegates to has not been constructed yet.
   */
  public static String getInstallationId(Context context) {
    return new IdAssignmentVisitor(context.getApplicationContext()).getInstallationId();
  }

  /** Reads the persisted user id, whether or not {@code NotificationHub.start} has run. */
  public static String getUserId(Context context) {
    return new UserIdVisitor(context.getApplicationContext()).getUserId();
  }

  /** Reads every template the SDK has persisted, keyed by template name. */
  public static Map<String, InstallationTemplate> getTemplates(Context context) {
    TemplateVisitor visitor = new TemplateVisitor(installationPreferences(context));
    Map<String, InstallationTemplate> templates = new HashMap<>();
    for (Map.Entry<String, InstallationTemplate> entry : visitor.getTemplates()) {
      templates.put(entry.getKey(), entry.getValue());
    }
    return templates;
  }

  /**
   * Removes every persisted template.
   *
   * <p>Callers should follow this with {@code NotificationHub.beginInstallationUpdate()} so the
   * change reaches the hub; the visitor only touches local storage.
   */
  public static void clearTemplates(Context context) {
    new TemplateVisitor(installationPreferences(context)).clearTemplates();
  }
}
