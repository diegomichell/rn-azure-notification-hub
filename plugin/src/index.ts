import {
  AndroidConfig,
  ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} from 'expo/config-plugins';

const pkg = require('../../package.json');

export type AzureNotificationHubPluginProps = {
  /**
   * The APNs environment written into the `aps-environment` entitlement.
   *
   * Use `production` for TestFlight and App Store builds, `development` for debug builds against
   * the APNs sandbox. Note that Notification Hubs must be configured with a matching certificate
   * or token environment.
   *
   * @default 'development'
   */
  apsEnvironment?: 'development' | 'production';

  /**
   * Adds the `remote-notification` background mode so iOS wakes the app for silent
   * (`content-available: 1`) pushes.
   *
   * @default true
   */
  enableBackgroundRemoteNotifications?: boolean;

  /**
   * Adds `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`.
   *
   * The library's own manifest already declares it; this exists only so the permission can be
   * removed from a build that deliberately never posts notifications.
   *
   * @default true
   */
  enableAndroidNotificationPermission?: boolean;
};

const withApsEntitlement: ConfigPlugin<AzureNotificationHubPluginProps> = (config, props) =>
  withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults['aps-environment'] = props.apsEnvironment ?? 'development';
    return modConfig;
  });

const withRemoteNotificationBackgroundMode: ConfigPlugin<AzureNotificationHubPluginProps> = (
  config,
  props
) =>
  withInfoPlist(config, (modConfig) => {
    if (props.enableBackgroundRemoteNotifications === false) {
      return modConfig;
    }

    const modes = new Set<string>(
      (modConfig.modResults.UIBackgroundModes as string[] | undefined) ?? []
    );
    modes.add('remote-notification');
    modConfig.modResults.UIBackgroundModes = [...modes];

    return modConfig;
  });

const withNotificationPermission: ConfigPlugin<AzureNotificationHubPluginProps> = (config, props) =>
  withAndroidManifest(config, (modConfig) => {
    if (props.enableAndroidNotificationPermission === false) {
      return modConfig;
    }

    AndroidConfig.Permissions.ensurePermissions(modConfig.modResults, [
      'android.permission.POST_NOTIFICATIONS',
    ]);

    return modConfig;
  });

/**
 * Config plugin for `rn-azure-notification-hub`.
 *
 * It only wires up the platform capabilities the native SDKs need — push entitlements and
 * background modes on iOS, the notification permission on Android. Hub credentials are *not*
 * handled here: pass them to `startAsync()` at runtime, or omit them entirely and register through
 * your own backend with `installationManagement: true`.
 *
 * Android additionally needs a `google-services.json` and the Google Services Gradle plugin, which
 * Expo wires up when `android.googleServicesFile` is set in your app config.
 */
const withAzureNotificationHub: ConfigPlugin<AzureNotificationHubPluginProps | void> = (
  config,
  props
) => {
  const options = props ?? {};

  config = withApsEntitlement(config, options);
  config = withRemoteNotificationBackgroundMode(config, options);
  config = withNotificationPermission(config, options);

  return config;
};

export default createRunOncePlugin(withAzureNotificationHub, pkg.name, pkg.version);
