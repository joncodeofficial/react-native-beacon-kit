import { NativeEventEmitter } from 'react-native';
import NativeIndoorBeacon from './NativeIndoorBeacon';
import type {
  BeaconRegion,
  BeaconScanConfig,
  KalmanConfig,
} from './NativeIndoorBeacon';

export type { BeaconRegion, BeaconScanConfig, KalmanConfig };

export interface Beacon {
  uuid: string;
  major: number;
  minor: number;
  rssi: number;
  distance: number;
  txPower: number;
  /** @warning May be randomized on Android 10+ — use uuid + major + minor as unique identifier instead. */
  macAddress: string;
  timestamp: number;
}

export interface BeaconsRangedEvent {
  region: BeaconRegion;
  beacons: Beacon[];
}

export interface RegionStateChangedEvent {
  region: BeaconRegion;
  state: 'inside' | 'outside';
}

const emitter = new NativeEventEmitter(NativeIndoorBeacon);

const IndoorBeacon = {
  checkPermissions(): Promise<boolean> {
    return NativeIndoorBeacon.checkPermissions();
  },

  configure(config: BeaconScanConfig): void {
    NativeIndoorBeacon.configure(config);
  },

  startRanging(region: BeaconRegion): Promise<void> {
    return NativeIndoorBeacon.startRanging(region);
  },

  stopRanging(region: BeaconRegion): Promise<void> {
    return NativeIndoorBeacon.stopRanging(region);
  },

  startMonitoring(region: BeaconRegion): Promise<void> {
    return NativeIndoorBeacon.startMonitoring(region);
  },

  stopMonitoring(region: BeaconRegion): Promise<void> {
    return NativeIndoorBeacon.stopMonitoring(region);
  },

  onBeaconsRanged(callback: (event: BeaconsRangedEvent) => void) {
    return emitter.addListener(
      'onBeaconsRanged',
      callback as (...args: readonly unknown[]) => unknown
    );
  },

  onRegionStateChanged(callback: (event: RegionStateChangedEvent) => void) {
    return emitter.addListener(
      'onRegionStateChanged',
      callback as (...args: readonly unknown[]) => unknown
    );
  },
};

export default IndoorBeacon;
