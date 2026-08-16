import { NativeModule, registerWebModule } from 'expo';

import { AzureNotificationHubModuleEvents } from './AzureNotificationHub.types';

function unavailable(method: string): never {
  const error = new Error(
    `rn-azure-notification-hub: \`${method}\` is not available on web. ` +
      'The Azure Notification Hubs client SDKs only ship for Apple and Android platforms; ' +
      'guard your calls with `Platform.OS !== "web"`, or use the Notification Hubs REST API ' +
      'together with the Web Push (browser) registration flow.'
  );
  error.name = 'UnavailabilityError';
  throw error;
}

/**
 * Web fallback. Every method throws a descriptive `UnavailabilityError` so that shared code fails
 * loudly instead of silently no-oping, with the exception of `isStarted()`, which reports `false`.
 */
class AzureNotificationHubModule extends NativeModule<AzureNotificationHubModuleEvents> {
  startAsync = () => unavailable('startAsync');
  isStarted = () => false;
  setEnabledAsync = () => unavailable('setEnabledAsync');
  isEnabledAsync = () => unavailable('isEnabledAsync');

  getInstallationAsync = () => unavailable('getInstallationAsync');
  saveInstallationAsync = () => unavailable('saveInstallationAsync');
  getInstallationIdAsync = () => unavailable('getInstallationIdAsync');
  setInstallationIdAsync = () => unavailable('setInstallationIdAsync');
  getPushChannelAsync = () => unavailable('getPushChannelAsync');
  setPushChannelAsync = () => unavailable('setPushChannelAsync');
  getUserIdAsync = () => unavailable('getUserIdAsync');
  setUserIdAsync = () => unavailable('setUserIdAsync');
  getPlatformAsync = () => unavailable('getPlatformAsync');
  setPlatformAsync = () => unavailable('setPlatformAsync');
  setExpirationAsync = () => unavailable('setExpirationAsync');

  addTagAsync = () => unavailable('addTagAsync');
  addTagsAsync = () => unavailable('addTagsAsync');
  removeTagAsync = () => unavailable('removeTagAsync');
  removeTagsAsync = () => unavailable('removeTagsAsync');
  getTagsAsync = () => unavailable('getTagsAsync');
  clearTagsAsync = () => unavailable('clearTagsAsync');

  setTemplateAsync = () => unavailable('setTemplateAsync');
  removeTemplateAsync = () => unavailable('removeTemplateAsync');
  getTemplateAsync = () => unavailable('getTemplateAsync');
  getTemplatesAsync = () => unavailable('getTemplatesAsync');
  clearTemplatesAsync = () => unavailable('clearTemplatesAsync');

  completeInstallationUpsert = () => unavailable('completeInstallationUpsert');

  getPermissionsAsync = () => unavailable('getPermissionsAsync');
  requestPermissionsAsync = () => unavailable('requestPermissionsAsync');
}

export default registerWebModule(AzureNotificationHubModule, 'AzureNotificationHub');
