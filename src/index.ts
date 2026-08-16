// Reexport the native module. On web, it will be resolved to AzureNotificationHubModule.web.ts
// and on native platforms to AzureNotificationHubModule.ts
export { default } from './AzureNotificationHubModule';
export * from './AzureNotificationHub.types';
