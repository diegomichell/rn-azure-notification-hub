/* eslint-disable import/first -- `jest.mock` is hoisted, so the imports must follow it. */
// The factory has to build the mock inline: `jest.mock` is hoisted above every other statement in
// the file, so it cannot close over a `const` declared here.
jest.mock('../AzureNotificationHubModule', () => ({
  __esModule: true,
  default: {
    startAsync: jest.fn(),
    setExpirationAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    completeInstallationUpsert: jest.fn(),
    addListener: jest.fn(),
  },
}));

import AzureNotificationHubModule from '../AzureNotificationHubModule';
import * as AzureNotificationHub from '../index';

const native = AzureNotificationHubModule as unknown as {
  startAsync: jest.Mock;
  setExpirationAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  completeInstallationUpsert: jest.Mock;
  addListener: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  native.startAsync.mockResolvedValue(undefined);
  native.setExpirationAsync.mockResolvedValue(undefined);
  native.requestPermissionsAsync.mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: false,
  });
  native.addListener.mockReturnValue({ remove: jest.fn() });
});

describe('startAsync', () => {
  it('forwards a connection string configuration', async () => {
    await AzureNotificationHub.startAsync({ connectionString: 'Endpoint=sb://…', hubName: 'hub' });

    expect(native.startAsync).toHaveBeenCalledWith({
      connectionString: 'Endpoint=sb://…',
      hubName: 'hub',
    });
  });

  it('accepts custom installation management without hub credentials', async () => {
    await AzureNotificationHub.startAsync({ installationManagement: true });

    expect(native.startAsync).toHaveBeenCalledWith({ installationManagement: true });
  });

  it.each([
    ['neither credential', {}],
    ['only a connection string', { connectionString: 'Endpoint=sb://…' }],
    ['only a hub name', { hubName: 'hub' }],
  ])('rejects a configuration with %s', async (_label, config) => {
    await expect(AzureNotificationHub.startAsync(config)).rejects.toThrow(/connectionString/);
    expect(native.startAsync).not.toHaveBeenCalled();
  });
});

describe('setExpirationAsync', () => {
  it('sends epoch milliseconds', async () => {
    const date = new Date('2030-01-02T03:04:05.000Z');
    await AzureNotificationHub.setExpirationAsync(date);

    expect(native.setExpirationAsync).toHaveBeenCalledWith(date.getTime());
  });

  it('sends null to clear the expiry', async () => {
    await AzureNotificationHub.setExpirationAsync(null);

    expect(native.setExpirationAsync).toHaveBeenCalledWith(null);
  });
});

describe('completeInstallationUpsert', () => {
  it('normalises a missing error to null', () => {
    AzureNotificationHub.completeInstallationUpsert('upsert-1');

    expect(native.completeInstallationUpsert).toHaveBeenCalledWith('upsert-1', null);
  });

  it('passes an error message through', () => {
    AzureNotificationHub.completeInstallationUpsert('upsert-1', 'HTTP 500');

    expect(native.completeInstallationUpsert).toHaveBeenCalledWith('upsert-1', 'HTTP 500');
  });
});

describe('requestPermissionsAsync', () => {
  it('defaults the options argument to null', async () => {
    await AzureNotificationHub.requestPermissionsAsync();

    expect(native.requestPermissionsAsync).toHaveBeenCalledWith(null);
  });

  it('forwards explicit authorization options', async () => {
    await AzureNotificationHub.requestPermissionsAsync(['alert', 'provisional']);

    expect(native.requestPermissionsAsync).toHaveBeenCalledWith(['alert', 'provisional']);
  });
});

describe('event listeners', () => {
  it('subscribes to the documented native event names', () => {
    AzureNotificationHub.addNotificationReceivedListener(() => {});
    AzureNotificationHub.addInstallationSavedListener(() => {});
    AzureNotificationHub.addInstallationSaveFailedListener(() => {});
    AzureNotificationHub.addInstallationUpsertRequestListener(() => {});
    AzureNotificationHub.addAuthorizationListener(() => {});

    expect(native.addListener.mock.calls.map(([name]) => name)).toEqual([
      'onNotificationReceived',
      'onInstallationSaved',
      'onInstallationSaveFailed',
      'onInstallationUpsertRequested',
      'onAuthorizationRequested',
    ]);
  });
});
