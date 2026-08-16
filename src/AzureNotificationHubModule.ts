import { NativeModule, requireNativeModule } from 'expo';

import { AzureNotificationHubModuleEvents } from './AzureNotificationHub.types';

declare class AzureNotificationHubModule extends NativeModule<AzureNotificationHubModuleEvents> {
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<AzureNotificationHubModule>('AzureNotificationHub');
