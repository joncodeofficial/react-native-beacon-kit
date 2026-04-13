import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
  BeaconRegion,
  BeaconScanConfig,
  BeaconFailureEvent,
  BeaconsRangedEvent,
  RegionStateChangedEvent,
} from '../index';

type MockNativeModule = {
  checkPermissions: jest.Mock<() => Promise<boolean>>;
  configure: jest.Mock<(config: BeaconScanConfig) => void>;
  startRanging: jest.Mock<(region: BeaconRegion) => Promise<void>>;
  stopRanging: jest.Mock<(region: BeaconRegion) => Promise<void>>;
  startMonitoring: jest.Mock<(region: BeaconRegion) => Promise<void>>;
  stopMonitoring: jest.Mock<(region: BeaconRegion) => Promise<void>>;
  getRangedRegions: jest.Mock<() => Promise<BeaconRegion[]>>;
  getMonitoredRegions: jest.Mock<() => Promise<BeaconRegion[]>>;
  isIgnoringBatteryOptimizations: jest.Mock<() => Promise<boolean>>;
  requestIgnoreBatteryOptimizations: jest.Mock<() => void>;
  openAutostartSettings: jest.Mock<() => void>;
  addListener: jest.Mock<(eventName: string) => void>;
  removeListeners: jest.Mock<(count: number) => void>;
};

declare global {
  var __beaconNativeModuleMock: MockNativeModule | undefined;
}

const mockListeners = new Map<
  string,
  Set<(...args: readonly unknown[]) => unknown>
>();

const createMockNativeModule = (): MockNativeModule => ({
  checkPermissions: jest.fn<() => Promise<boolean>>(),
  configure: jest.fn<(config: BeaconScanConfig) => void>(),
  startRanging: jest.fn<(region: BeaconRegion) => Promise<void>>(),
  stopRanging: jest.fn<(region: BeaconRegion) => Promise<void>>(),
  startMonitoring: jest.fn<(region: BeaconRegion) => Promise<void>>(),
  stopMonitoring: jest.fn<(region: BeaconRegion) => Promise<void>>(),
  getRangedRegions: jest.fn<() => Promise<BeaconRegion[]>>(),
  getMonitoredRegions: jest.fn<() => Promise<BeaconRegion[]>>(),
  isIgnoringBatteryOptimizations: jest.fn<() => Promise<boolean>>(),
  requestIgnoreBatteryOptimizations: jest.fn<() => void>(),
  openAutostartSettings: jest.fn<() => void>(),
  addListener: jest.fn<(eventName: string) => void>(),
  removeListeners: jest.fn<(count: number) => void>(),
});

jest.mock('react-native', () => {
  const nativeModule =
    globalThis.__beaconNativeModuleMock ?? createMockNativeModule();
  globalThis.__beaconNativeModuleMock = nativeModule;

  return {
    NativeEventEmitter: jest.fn((module: MockNativeModule) => ({
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
      getEnforcing: jest.fn(() => nativeModule),
    },
  };
});

import Beacon from '../index';

const getMockNativeModule = (): MockNativeModule => {
  if (!globalThis.__beaconNativeModuleMock) {
    globalThis.__beaconNativeModuleMock = createMockNativeModule();
  }
  return globalThis.__beaconNativeModuleMock;
};

const emitMockEvent = (eventName: string, payload: unknown) => {
  const callbacks = mockListeners.get(eventName);
  callbacks?.forEach((callback) => callback(payload));
};

describe('Beacon', () => {
  const region: BeaconRegion = {
    identifier: 'test-region',
    uuid: 'a1b23c45-d67e-9fab-de12-0034567890ab',
    major: 1,
    minor: 2,
  };

  beforeEach(() => {
    const mockNativeModule = getMockNativeModule();

    jest.clearAllMocks();
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

  describe('unit', () => {
    it('delegates the scanning lifecycle methods to the native module', async () => {
      const mockNativeModule = getMockNativeModule();
      const config: BeaconScanConfig = {
        scanPeriod: 1100,
        backgroundScanPeriod: 10_000,
        betweenScanPeriod: 0,
        foregroundService: true,
      };

      await expect(Beacon.checkPermissions()).resolves.toBe(true);
      Beacon.configure(config);
      await expect(Beacon.startRanging(region)).resolves.toBeUndefined();
      await expect(Beacon.stopRanging(region)).resolves.toBeUndefined();
      await expect(Beacon.startMonitoring(region)).resolves.toBeUndefined();
      await expect(Beacon.stopMonitoring(region)).resolves.toBeUndefined();

      expect(mockNativeModule.checkPermissions).toHaveBeenCalledTimes(1);
      expect(mockNativeModule.configure).toHaveBeenCalledWith(config);
      expect(mockNativeModule.startRanging).toHaveBeenCalledWith(region);
      expect(mockNativeModule.stopRanging).toHaveBeenCalledWith(region);
      expect(mockNativeModule.startMonitoring).toHaveBeenCalledWith(region);
      expect(mockNativeModule.stopMonitoring).toHaveBeenCalledWith(region);
    });

    it('delegates region queries and battery helpers to the native module', async () => {
      const mockNativeModule = getMockNativeModule();
      mockNativeModule.getRangedRegions.mockResolvedValue([region]);
      mockNativeModule.getMonitoredRegions.mockResolvedValue([region]);
      mockNativeModule.isIgnoringBatteryOptimizations.mockResolvedValue(false);

      await expect(Beacon.getRangedRegions()).resolves.toEqual([region]);
      await expect(Beacon.getMonitoredRegions()).resolves.toEqual([region]);
      await expect(Beacon.isIgnoringBatteryOptimizations()).resolves.toBe(
        false
      );

      Beacon.requestIgnoreBatteryOptimizations();
      Beacon.openAutostartSettings();

      expect(mockNativeModule.getRangedRegions).toHaveBeenCalledTimes(1);
      expect(mockNativeModule.getMonitoredRegions).toHaveBeenCalledTimes(1);
      expect(
        mockNativeModule.isIgnoringBatteryOptimizations
      ).toHaveBeenCalledTimes(1);
      expect(
        mockNativeModule.requestIgnoreBatteryOptimizations
      ).toHaveBeenCalledTimes(1);
      expect(mockNativeModule.openAutostartSettings).toHaveBeenCalledTimes(1);
    });

    it('propagates native ranging failures without swallowing the error', async () => {
      const mockNativeModule = getMockNativeModule();
      const nativeError = new Error('Bluetooth is off');

      mockNativeModule.startRanging.mockRejectedValue(nativeError);

      await expect(Beacon.startRanging(region)).rejects.toBe(nativeError);
      expect(mockNativeModule.startRanging).toHaveBeenCalledWith(region);
    });

    it('propagates monitoring conflicts from the native layer as-is', async () => {
      const mockNativeModule = getMockNativeModule();
      const conflictError = {
        code: 'RANGING_MONITORING_CONFLICT',
        message:
          "Cannot call startMonitoring on region 'test-region' while ranging is active.",
      };

      mockNativeModule.startMonitoring.mockRejectedValue(conflictError);

      await expect(Beacon.startMonitoring(region)).rejects.toMatchObject({
        code: 'RANGING_MONITORING_CONFLICT',
        message:
          "Cannot call startMonitoring on region 'test-region' while ranging is active.",
      });
      expect(mockNativeModule.startMonitoring).toHaveBeenCalledWith(region);
    });

    it('propagates region query failures to callers', async () => {
      const mockNativeModule = getMockNativeModule();
      const nativeError = new Error('Native module unavailable');

      mockNativeModule.getMonitoredRegions.mockRejectedValue(nativeError);

      await expect(Beacon.getMonitoredRegions()).rejects.toBe(nativeError);
      expect(mockNativeModule.getMonitoredRegions).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration', () => {
    it('delivers ranging events through the public subscription API and removes listeners cleanly', () => {
      const mockNativeModule = getMockNativeModule();
      const callback = jest.fn<(event: BeaconsRangedEvent) => void>();
      const event: BeaconsRangedEvent = {
        region,
        beacons: [
          {
            uuid: region.uuid,
            major: 1,
            minor: 2,
            rssi: -64,
            distance: 1.42,
            rawDistance: 1.7,
            txPower: -59,
            macAddress: 'AA:BB:CC:DD:EE:FF',
            timestamp: 1_713_000_000_000,
          },
        ],
      };

      const subscription = Beacon.onBeaconsRanged(callback);

      emitMockEvent('onBeaconsRanged', event);
      expect(callback).toHaveBeenCalledWith(event);
      expect(mockNativeModule.addListener).toHaveBeenCalledWith(
        'onBeaconsRanged'
      );

      subscription.remove();
      emitMockEvent('onBeaconsRanged', event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNativeModule.removeListeners).toHaveBeenCalledWith(1);
    });

    it('delivers monitoring state changes to each active subscriber independently', () => {
      const mockNativeModule = getMockNativeModule();
      const firstCallback = jest.fn<(event: RegionStateChangedEvent) => void>();
      const secondCallback =
        jest.fn<(event: RegionStateChangedEvent) => void>();
      const event: RegionStateChangedEvent = {
        region,
        state: 'inside',
      };

      const firstSubscription = Beacon.onRegionStateChanged(firstCallback);
      Beacon.onRegionStateChanged(secondCallback);

      emitMockEvent('onRegionStateChanged', event);

      expect(firstCallback).toHaveBeenCalledWith(event);
      expect(secondCallback).toHaveBeenCalledWith(event);
      expect(mockNativeModule.addListener).toHaveBeenCalledWith(
        'onRegionStateChanged'
      );

      firstSubscription.remove();
      emitMockEvent('onRegionStateChanged', {
        ...event,
        state: 'outside',
      });

      expect(firstCallback).toHaveBeenCalledTimes(1);
      expect(secondCallback).toHaveBeenCalledTimes(2);
    });

    it('delivers ranging failure events through the public subscription API', () => {
      const mockNativeModule = getMockNativeModule();
      const callback = jest.fn<(event: BeaconFailureEvent) => void>();
      const event: BeaconFailureEvent = {
        region,
        code: 'RANGING_ERROR',
        message: 'Bluetooth is off',
        nativeCode: 42,
        domain: 'CoreLocation',
      };

      const subscription = Beacon.onRangingFailed(callback);

      emitMockEvent('onRangingFailed', event);

      expect(callback).toHaveBeenCalledWith(event);
      expect(mockNativeModule.addListener).toHaveBeenCalledWith(
        'onRangingFailed'
      );

      subscription.remove();
      emitMockEvent('onRangingFailed', event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNativeModule.removeListeners).toHaveBeenCalledWith(1);
    });

    it('delivers monitoring failure events through the public subscription API', () => {
      const mockNativeModule = getMockNativeModule();
      const callback = jest.fn<(event: BeaconFailureEvent) => void>();
      const event: BeaconFailureEvent = {
        region,
        code: 'MONITORING_ERROR',
        message: 'Location permission was revoked',
      };

      Beacon.onMonitoringFailed(callback);
      emitMockEvent('onMonitoringFailed', event);

      expect(callback).toHaveBeenCalledWith(event);
      expect(mockNativeModule.addListener).toHaveBeenCalledWith(
        'onMonitoringFailed'
      );
    });
  });
});
