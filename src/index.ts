import {
  AuthorizationEvent,
  AuthorizationOption,
  Installation,
  InstallationPlatform,
  InstallationSaveFailedEvent,
  InstallationSavedEvent,
  InstallationTemplate,
  InstallationUpsertRequest,
  NotificationHubConfig,
  NotificationPayload,
  NotificationPermissions,
} from './AzureNotificationHub.types';
import AzureNotificationHubModule from './AzureNotificationHubModule';

export * from './AzureNotificationHub.types';

/**
 * The raw native module.
 *
 * Exported so it can be passed to `useEvent()` / `useEventListener()` from `expo`, and so that
 * anything this wrapper does not surface stays reachable.
 */
export { AzureNotificationHubModule };

/** A handle returned by the `add*Listener` functions. Call `remove()` to unsubscribe. */
export type EventSubscription = {
  remove(): void;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts the Azure Notification Hubs SDK and registers this device for push notifications.
 *
 * Call this once, as early as it makes sense in your UX — on iOS it triggers the system
 * notification permission prompt. Everything else in this module requires the SDK to be started;
 * calling it twice with the same configuration is harmless.
 *
 * @example Connecting straight to a hub
 * ```ts
 * await startAsync({
 *   connectionString: 'Endpoint=sb://…;SharedAccessKeyName=DefaultListenSharedAccessSignature;SharedAccessKey=…',
 *   hubName: 'my-hub',
 * });
 * ```
 *
 * @example Routing registrations through your own backend
 * ```ts
 * addInstallationUpsertRequestListener(async ({ requestId, installation }) => {
 *   try {
 *     await fetch('https://api.example.com/installations', {
 *       method: 'PUT',
 *       body: JSON.stringify(installation),
 *     });
 *     completeInstallationUpsert(requestId);
 *   } catch (e) {
 *     completeInstallationUpsert(requestId, String(e));
 *   }
 * });
 *
 * await startAsync({ installationManagement: true });
 * ```
 *
 * @throws If neither a `connectionString` + `hubName` pair nor `installationManagement` is given.
 */
export async function startAsync(config: NotificationHubConfig): Promise<void> {
  const useCustomBackend = config.installationManagement === true;

  if (!useCustomBackend && (!config.connectionString || !config.hubName)) {
    throw new Error(
      'startAsync: pass both `connectionString` and `hubName`, or set `installationManagement: true` ' +
        'to persist installations through your own backend.'
    );
  }

  return AzureNotificationHubModule.startAsync(config);
}

/** Whether {@link startAsync} has completed in this process. */
export function isStarted(): boolean {
  return AzureNotificationHubModule.isStarted();
}

/**
 * Enables or disables the SDK.
 *
 * While disabled the SDK stops upserting installations and drops incoming notifications instead of
 * delivering them. The flag is persisted across launches by the native SDKs.
 */
export async function setEnabledAsync(enabled: boolean): Promise<void> {
  return AzureNotificationHubModule.setEnabledAsync(enabled);
}

/** Whether the SDK is currently enabled. Defaults to `true`. */
export async function isEnabledAsync(): Promise<boolean> {
  return AzureNotificationHubModule.isEnabledAsync();
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/** Returns a snapshot of the installation record for this device. */
export async function getInstallationAsync(): Promise<Installation> {
  return AzureNotificationHubModule.getInstallationAsync();
}

/**
 * Forces an installation upsert now, rather than waiting for the SDK's debounce window.
 *
 * Every mutating call in this module already schedules a save, so you rarely need this — it is
 * useful after a batch of changes, or to retry after {@link addInstallationSaveFailedListener}
 * reported a failure.
 */
export async function saveInstallationAsync(): Promise<void> {
  return AzureNotificationHubModule.saveInstallationAsync();
}

/** The installation id for this device, or `null` if the SDK has not generated one yet. */
export async function getInstallationIdAsync(): Promise<string | null> {
  return AzureNotificationHubModule.getInstallationIdAsync();
}

/**
 * Overrides the installation id with your own identifier.
 *
 * Useful when your backend already has a stable device id and you want hub records keyed by it.
 * The value is persisted and reapplied on every subsequent upsert.
 */
export async function setInstallationIdAsync(installationId: string): Promise<void> {
  return AzureNotificationHubModule.setInstallationIdAsync(installationId);
}

/**
 * The platform push handle: the APNs device token (lowercase hex) on iOS, the FCM registration
 * token on Android. `null` until the OS has issued one.
 */
export async function getPushChannelAsync(): Promise<string | null> {
  return AzureNotificationHubModule.getPushChannelAsync();
}

/**
 * Hands the SDK a push token yourself instead of letting it discover one.
 *
 * You need this on Android when another library owns the `FirebaseMessagingService` — see the
 * "Coexisting with other FCM libraries" section of the README. On iOS, pass the APNs device token
 * as a lowercase hex string.
 */
export async function setPushChannelAsync(pushChannel: string): Promise<void> {
  return AzureNotificationHubModule.setPushChannelAsync(pushChannel);
}

/** The user id associated with this installation, or `null`. */
export async function getUserIdAsync(): Promise<string | null> {
  return AzureNotificationHubModule.getUserIdAsync();
}

/**
 * Associates a user id with this installation so the backend can target a person across devices.
 *
 * Pass `null` to clear it — typically on sign-out, alongside {@link clearTagsAsync}.
 */
export async function setUserIdAsync(userId: string | null): Promise<void> {
  return AzureNotificationHubModule.setUserIdAsync(userId);
}

/** The push platform this installation is registered against. */
export async function getPlatformAsync(): Promise<InstallationPlatform | null> {
  return AzureNotificationHubModule.getPlatformAsync();
}

/**
 * Overrides the push platform reported to the hub.
 *
 * Only meaningful on Android, where a hub may still be configured for the legacy `gcm` credential
 * rather than `fcmv1`. On iOS the platform is always `apns` and this throws.
 *
 * @platform android
 */
export async function setPlatformAsync(platform: InstallationPlatform): Promise<void> {
  return AzureNotificationHubModule.setPlatformAsync(platform);
}

/**
 * Sets the time at which the hub should expire this installation, or `null` to never expire.
 *
 * The value is applied to every subsequent upsert.
 */
export async function setExpirationAsync(expiration: Date | null): Promise<void> {
  return AzureNotificationHubModule.setExpirationAsync(expiration ? expiration.getTime() : null);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Subscribes this installation to a tag.
 *
 * Tags may contain up to 120 characters and must not contain a comma. A hub allows at most
 * 60 tags per installation.
 *
 * @returns `true` if the tag set changed.
 */
export async function addTagAsync(tag: string): Promise<boolean> {
  return AzureNotificationHubModule.addTagAsync(tag);
}

/**
 * Subscribes this installation to several tags at once.
 *
 * @returns `true` if the tag set changed.
 */
export async function addTagsAsync(tags: string[]): Promise<boolean> {
  return AzureNotificationHubModule.addTagsAsync(tags);
}

/**
 * Unsubscribes this installation from a tag.
 *
 * @returns `true` if the tag set changed.
 */
export async function removeTagAsync(tag: string): Promise<boolean> {
  return AzureNotificationHubModule.removeTagAsync(tag);
}

/**
 * Unsubscribes this installation from several tags at once.
 *
 * @returns `true` if the tag set changed.
 */
export async function removeTagsAsync(tags: string[]): Promise<boolean> {
  return AzureNotificationHubModule.removeTagsAsync(tags);
}

/** All tags this installation is subscribed to. */
export async function getTagsAsync(): Promise<string[]> {
  return AzureNotificationHubModule.getTagsAsync();
}

/** Unsubscribes this installation from every tag. */
export async function clearTagsAsync(): Promise<void> {
  return AzureNotificationHubModule.clearTagsAsync();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Registers (or replaces) a named template on this installation.
 *
 * @example
 * ```ts
 * await setTemplateAsync('simple', {
 *   body: Platform.select({
 *     ios: '{"aps":{"alert":"$(message)"}}',
 *     android: '{"message":{"notification":{"body":"$(message)"}}}',
 *   })!,
 *   tags: ['news'],
 * });
 * ```
 *
 * @returns `true` if the stored templates changed.
 */
export async function setTemplateAsync(
  name: string,
  template: InstallationTemplate
): Promise<boolean> {
  return AzureNotificationHubModule.setTemplateAsync(name, template);
}

/**
 * Removes a named template from this installation.
 *
 * @returns `true` if a template was removed.
 */
export async function removeTemplateAsync(name: string): Promise<boolean> {
  return AzureNotificationHubModule.removeTemplateAsync(name);
}

/** Returns a named template, or `null` if none is registered under that name. */
export async function getTemplateAsync(name: string): Promise<InstallationTemplate | null> {
  return AzureNotificationHubModule.getTemplateAsync(name);
}

/** Every template registered on this installation, keyed by name. */
export async function getTemplatesAsync(): Promise<Record<string, InstallationTemplate>> {
  return AzureNotificationHubModule.getTemplatesAsync();
}

/** Removes every template from this installation. */
export async function clearTemplatesAsync(): Promise<void> {
  return AzureNotificationHubModule.clearTemplatesAsync();
}

// ---------------------------------------------------------------------------
// Custom installation management
// ---------------------------------------------------------------------------

/**
 * Acknowledges an {@link InstallationUpsertRequest} delivered while running in
 * `installationManagement` mode.
 *
 * Call it exactly once per `requestId`. Pass an `error` message to report the upsert as failed,
 * which surfaces through {@link addInstallationSaveFailedListener} and lets the SDK retry later.
 */
export function completeInstallationUpsert(requestId: string, error?: string | null): void {
  AzureNotificationHubModule.completeInstallationUpsert(requestId, error ?? null);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Reads the current OS notification permission without prompting.
 */
export async function getPermissionsAsync(): Promise<NotificationPermissions> {
  return AzureNotificationHubModule.getPermissionsAsync();
}

/**
 * Prompts for the OS notification permission.
 *
 * {@link startAsync} already prompts on iOS, so this is mainly useful for Android 13+
 * (`POST_NOTIFICATIONS`) or to re-check the result later. Prompting a second time is a no-op once
 * the user has answered — inspect `canAskAgain` to decide whether to deep-link into Settings.
 *
 * @param options iOS authorization options to request. Defaults to `['alert', 'sound', 'badge']`.
 */
export async function requestPermissionsAsync(
  options?: AuthorizationOption[]
): Promise<NotificationPermissions> {
  return AzureNotificationHubModule.requestPermissionsAsync(options ?? null);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Fires when a notification is delivered to the app.
 *
 * - **iOS** — while the app is in the foreground, and when the user taps a notification.
 * - **Android** — for every message routed to the SDK's `FirebaseMessagingService`. Messages that
 *   arrive while the JavaScript runtime is not yet running are buffered and replayed here with
 *   `buffered: true`.
 */
export function addNotificationReceivedListener(
  listener: (event: NotificationPayload) => void
): EventSubscription {
  return AzureNotificationHubModule.addListener('onNotificationReceived', listener);
}

/** Fires after the hub (or your backend) accepted an installation upsert. */
export function addInstallationSavedListener(
  listener: (event: InstallationSavedEvent) => void
): EventSubscription {
  return AzureNotificationHubModule.addListener('onInstallationSaved', listener);
}

/** Fires when an installation upsert failed. */
export function addInstallationSaveFailedListener(
  listener: (event: InstallationSaveFailedEvent) => void
): EventSubscription {
  return AzureNotificationHubModule.addListener('onInstallationSaveFailed', listener);
}

/**
 * Fires in `installationManagement` mode when the SDK wants an installation persisted.
 *
 * Register this **before** calling {@link startAsync}, and answer every request with
 * {@link completeInstallationUpsert}.
 */
export function addInstallationUpsertRequestListener(
  listener: (event: InstallationUpsertRequest) => void
): EventSubscription {
  return AzureNotificationHubModule.addListener('onInstallationUpsertRequested', listener);
}

/**
 * Fires on iOS once the user answers the authorization prompt that {@link startAsync} triggers.
 *
 * @platform ios
 */
export function addAuthorizationListener(
  listener: (event: AuthorizationEvent) => void
): EventSubscription {
  return AzureNotificationHubModule.addListener('onAuthorizationRequested', listener);
}

export default AzureNotificationHubModule;
