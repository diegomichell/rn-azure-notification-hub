import { NativeModule, requireNativeModule } from 'expo';

import {
  AzureNotificationHubModuleEvents,
  Installation,
  InstallationPlatform,
  InstallationTemplate,
  NotificationHubConfig,
  NotificationPermissions,
} from './AzureNotificationHub.types';

/**
 * The raw native module. Prefer the wrapper functions exported from the package root — they add
 * argument validation and friendlier types. This is exported for advanced use and for
 * `useEvent()`/`useEventListener()` from `expo`.
 */
declare class AzureNotificationHubModule extends NativeModule<AzureNotificationHubModuleEvents> {
  // Lifecycle
  startAsync(config: NotificationHubConfig): Promise<void>;
  isStarted(): boolean;
  setEnabledAsync(enabled: boolean): Promise<void>;
  isEnabledAsync(): Promise<boolean>;

  // Installation
  getInstallationAsync(): Promise<Installation>;
  saveInstallationAsync(): Promise<void>;
  getInstallationIdAsync(): Promise<string | null>;
  setInstallationIdAsync(installationId: string): Promise<void>;
  getPushChannelAsync(): Promise<string | null>;
  setPushChannelAsync(pushChannel: string): Promise<void>;
  getUserIdAsync(): Promise<string | null>;
  setUserIdAsync(userId: string | null): Promise<void>;
  getPlatformAsync(): Promise<InstallationPlatform | null>;
  setPlatformAsync(platform: string): Promise<void>;
  setExpirationAsync(expiration: number | null): Promise<void>;

  // Tags
  addTagAsync(tag: string): Promise<boolean>;
  addTagsAsync(tags: string[]): Promise<boolean>;
  removeTagAsync(tag: string): Promise<boolean>;
  removeTagsAsync(tags: string[]): Promise<boolean>;
  getTagsAsync(): Promise<string[]>;
  clearTagsAsync(): Promise<void>;

  // Templates
  setTemplateAsync(name: string, template: InstallationTemplate): Promise<boolean>;
  removeTemplateAsync(name: string): Promise<boolean>;
  getTemplateAsync(name: string): Promise<InstallationTemplate | null>;
  getTemplatesAsync(): Promise<Record<string, InstallationTemplate>>;
  clearTemplatesAsync(): Promise<void>;

  // Custom installation management
  completeInstallationUpsert(requestId: string, error: string | null): void;

  // Permissions
  getPermissionsAsync(): Promise<NotificationPermissions>;
  requestPermissionsAsync(options: string[] | null): Promise<NotificationPermissions>;
}

export default requireNativeModule<AzureNotificationHubModule>('AzureNotificationHub');
