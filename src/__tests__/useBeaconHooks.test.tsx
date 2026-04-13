import type {
  BeaconFailureEvent,
  BeaconRegion,
  BeaconScanConfig,
} from '../index';
import type { Mock } from 'jest-mock';

const { beforeEach, describe, expect, it } =
  require('@jest/globals') as typeof import('@jest/globals');

const getMockJest = () =>
  (require('@jest/globals') as typeof import('@jest/globals')).jest;

type MockNativeModule = {
  checkPermissions: Mock<() => Promise<boolean>>;
  configure: Mock<(config: BeaconScanConfig) => void>;
  startRanging: Mock<(region: BeaconRegion) => Promise<void>>;
  stopRanging: Mock<(region: BeaconRegion) => Promise<void>>;
  startMonitoring: Mock<(region: BeaconRegion) => Promise<void>>;
  stopMonitoring: Mock<(region: BeaconRegion) => Promise<void>>;
  getRangedRegions: Mock<() => Promise<BeaconRegion[]>>;
  getMonitoredRegions: Mock<() => Promise<BeaconRegion[]>>;
  isIgnoringBatteryOptimizations: Mock<() => Promise<boolean>>;
  requestIgnoreBatteryOptimizations: Mock<() => void>;
  openAutostartSettings: Mock<() => void>;
  addListener: Mock<(eventName: string) => void>;
  removeListeners: Mock<(count: number) => void>;
};

declare global {
  var __beaconHookNativeModuleMock: MockNativeModule | undefined;
}

const mockListeners = new Map<
  string,
  Set<(...args: readonly unknown[]) => unknown>
>();

const createMockNativeModule = (): MockNativeModule => {
  const mockJest = getMockJest();

  return {
    checkPermissions: mockJest.fn<() => Promise<boolean>>(),
    configure: mockJest.fn<(config: BeaconScanConfig) => void>(),
    startRanging: mockJest.fn<(region: BeaconRegion) => Promise<void>>(),
    stopRanging: mockJest.fn<(region: BeaconRegion) => Promise<void>>(),
    startMonitoring: mockJest.fn<(region: BeaconRegion) => Promise<void>>(),
    stopMonitoring: mockJest.fn<(region: BeaconRegion) => Promise<void>>(),
    getRangedRegions: mockJest.fn<() => Promise<BeaconRegion[]>>(),
    getMonitoredRegions: mockJest.fn<() => Promise<BeaconRegion[]>>(),
    isIgnoringBatteryOptimizations: mockJest.fn<() => Promise<boolean>>(),
    requestIgnoreBatteryOptimizations: mockJest.fn<() => void>(),
    openAutostartSettings: mockJest.fn<() => void>(),
    addListener: mockJest.fn<(eventName: string) => void>(),
    removeListeners: mockJest.fn<(count: number) => void>(),
  };
};

getMockJest().mock('react-native', () => {
  const mockJest = getMockJest();
  const nativeModule =
    globalThis.__beaconHookNativeModuleMock ?? createMockNativeModule();
  globalThis.__beaconHookNativeModuleMock = nativeModule;

  return {
    NativeEventEmitter: mockJest.fn((module: MockNativeModule) => ({
      addListener: (
        eventName: string,
        callback: (...args: readonly unknown[]) => unknown
      ) => {
        module.addListener(eventName);

        let callbacks = mockListeners.get(eventName);
        if (!callbacks) {
          callbacks = new Set();
          mockListeners.set(eventName, callbacks);
        }
        callbacks.add(callback);

        return {
          remove: () => {
            callbacks!.delete(callback);
            module.removeListeners(1);
          },
        };
      },
    })),
    TurboModuleRegistry: {
      getEnforcing: mockJest.fn(() => nativeModule),
    },
  };
});

const { act, renderHook, waitFor } = require('@testing-library/react-native');

const { useBeaconMonitoring, useBeaconRanging, useMonitorThenRange } =
  require('../index') as typeof import('../index');

const getMockNativeModule = (): MockNativeModule => {
  if (!globalThis.__beaconHookNativeModuleMock) {
    globalThis.__beaconHookNativeModuleMock = createMockNativeModule();
  }
  return globalThis.__beaconHookNativeModuleMock;
};

const emitMockEvent = async (eventName: string, payload: unknown) => {
  await act(async () => {
    const callbacks = mockListeners.get(eventName);
    callbacks?.forEach((callback) => callback(payload));
    await Promise.resolve();
  });
};

describe('Beacon hooks', () => {
  const region: BeaconRegion = {
    identifier: 'test-region',
    uuid: 'a1b23c45-d67e-9fab-de12-0034567890ab',
    major: 1,
    minor: 2,
  };

  beforeEach(() => {
    const mockNativeModule = getMockNativeModule();

    getMockJest().clearAllMocks();
    mockListeners.clear();

    mockNativeModule.checkPermissions.mockResolvedValue(true);
    mockNativeModule.startRanging.mockResolvedValue();
    mockNativeModule.stopRanging.mockResolvedValue();
    mockNativeModule.startMonitoring.mockResolvedValue();
    mockNativeModule.stopMonitoring.mockResolvedValue();
    mockNativeModule.getRangedRegions.mockResolvedValue([]);
    mockNativeModule.getMonitoredRegions.mockResolvedValue([]);
    mockNativeModule.isIgnoringBatteryOptimizations.mockResolvedValue(true);
  });

  it('useBeaconRanging starts, receives beacon events, and clears state on stop', async () => {
    const mockNativeModule = getMockNativeModule();
    const hook = renderHook(() =>
      useBeaconRanging({ region, stopOnUnmount: false })
    );

    act(() => {
      hook.result.current.start();
    });

    await waitFor(() => {
      expect(mockNativeModule.startRanging).toHaveBeenCalledWith(region);
      expect(hook.result.current.isActive).toBe(true);
    });

    await emitMockEvent('onBeaconsRanged', {
      region,
      beacons: [
        {
          uuid: region.uuid,
          major: 1,
          minor: 2,
          rssi: -65,
          distance: 1.25,
          rawDistance: 1.5,
          txPower: -59,
          macAddress: 'AA:BB:CC:DD:EE:FF',
          timestamp: 1_713_000_000_000,
        },
      ],
    });

    expect(hook.result.current.beacons).toHaveLength(1);

    act(() => {
      hook.result.current.stop();
    });

    await waitFor(() => {
      expect(mockNativeModule.stopRanging).toHaveBeenCalledWith(region);
      expect(hook.result.current.isActive).toBe(false);
      expect(hook.result.current.beacons).toEqual([]);
    });

    act(() => {
      hook.unmount();
    });
  });

  it('useBeaconMonitoring auto-starts and stops on unmount by default', async () => {
    const mockNativeModule = getMockNativeModule();
    const hook = renderHook(() =>
      useBeaconMonitoring({ region, autoStart: true })
    );

    await waitFor(() => {
      expect(mockNativeModule.startMonitoring).toHaveBeenCalledWith(region);
      expect(hook.result.current.isActive).toBe(true);
    });

    act(() => {
      hook.unmount();
    });

    await waitFor(() => {
      expect(mockNativeModule.stopMonitoring).toHaveBeenCalledWith(region);
    });
  });

  it('useBeaconMonitoring updates region state from monitoring events', async () => {
    const hook = renderHook(() =>
      useBeaconMonitoring({ region, stopOnUnmount: false })
    );

    await emitMockEvent('onRegionStateChanged', {
      region,
      state: 'inside',
    });

    await waitFor(() => {
      expect(hook.result.current.regionState).toBe('inside');
    });

    act(() => {
      hook.unmount();
    });
  });

  it('useMonitorThenRange switches ranging on enter and off on exit', async () => {
    const mockNativeModule = getMockNativeModule();
    const hook = renderHook(() =>
      useMonitorThenRange({ region, stopOnUnmount: false })
    );

    act(() => {
      hook.result.current.start();
    });

    await waitFor(() => {
      expect(mockNativeModule.startMonitoring).toHaveBeenCalledWith(region);
      expect(hook.result.current.isActive).toBe(true);
    });

    await emitMockEvent('onRegionStateChanged', {
      region,
      state: 'inside',
    });

    await waitFor(() => {
      expect(mockNativeModule.startRanging).toHaveBeenCalledWith(region);
      expect(hook.result.current.regionState).toBe('inside');
      expect(hook.result.current.isRanging).toBe(true);
    });

    await emitMockEvent('onBeaconsRanged', {
      region,
      beacons: [
        {
          uuid: region.uuid,
          major: 1,
          minor: 2,
          rssi: -67,
          distance: 2.1,
          rawDistance: 2.3,
          txPower: -59,
          macAddress: 'AA:BB:CC:DD:EE:FF',
          timestamp: 1_713_000_000_000,
        },
      ],
    });

    expect(hook.result.current.beacons).toHaveLength(1);

    await emitMockEvent('onRegionStateChanged', {
      region,
      state: 'outside',
    });

    await waitFor(() => {
      expect(mockNativeModule.stopRanging).toHaveBeenCalledWith(region);
      expect(hook.result.current.regionState).toBe('outside');
      expect(hook.result.current.isRanging).toBe(false);
      expect(hook.result.current.beacons).toEqual([]);
    });

    act(() => {
      hook.unmount();
    });
  });

  it('updates hook error state from failure events and allows clearing it', async () => {
    const hook = renderHook(() =>
      useBeaconMonitoring({ region, stopOnUnmount: false })
    );
    const error: BeaconFailureEvent = {
      region,
      code: 'MONITORING_ERROR',
      message: 'Permission revoked',
    };

    await emitMockEvent('onMonitoringFailed', error);

    await waitFor(() => {
      expect(hook.result.current.error).toEqual(error);
    });

    act(() => {
      hook.result.current.clearError();
    });

    expect(hook.result.current.error).toBeNull();

    act(() => {
      hook.unmount();
    });
  });
});
