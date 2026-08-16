import { registerWebModule, NativeModule } from 'expo';

import { AzureNotificationHubModuleEvents } from './AzureNotificationHub.types';

// AzureNotificationHubModule is not available on the web platform.
class AzureNotificationHubModule extends NativeModule<AzureNotificationHubModuleEvents> {}

export default registerWebModule(AzureNotificationHubModule, 'AzureNotificationHubModule');
