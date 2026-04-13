import { NativeEventEmitter } from 'react-native';
import NativeBeacon from './NativeBeacon';
import type {
  BeaconRegion,
  BeaconScanConfig,
  ForegroundServiceNotificationConfig,
  KalmanConfig,
} from './NativeBeacon';

export type {
  BeaconRegion,
  BeaconScanConfig,
  ForegroundServiceNotificationConfig,
  KalmanConfig,
};

export interface Beacon {
  uuid: string;
  major: number;
  minor: number;
  rssi: number;
  /** Kalman-filtered distance in meters (equals rawDistance when filter is disabled). */
  distance: number;
  /** Raw unfiltered distance from AltBeacon. Useful for calibration and debugging. */
  rawDistance: number;
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

export interface BeaconFailureEvent {
  region?: BeaconRegion;
  code: string;
  message: string;
  nativeCode?: number;
  domain?: string;
}

const emitter = new NativeEventEmitter(NativeBeacon);

const Beacon = {
  checkPermissions(): Promise<boolean> {
    return NativeBeacon.checkPermissions();
  },

  configure(config: BeaconScanConfig): void {
    NativeBeacon.configure(config);
  },

  startRanging(region: BeaconRegion): Promise<void> {
    return NativeBeacon.startRanging(region);
  },

  stopRanging(region: BeaconRegion): Promise<void> {
    return NativeBeacon.stopRanging(region);
  },

  startMonitoring(region: BeaconRegion): Promise<void> {
    return NativeBeacon.startMonitoring(region);
  },

  stopMonitoring(region: BeaconRegion): Promise<void> {
    return NativeBeacon.stopMonitoring(region);
  },

  getRangedRegions(): Promise<BeaconRegion[]> {
    return NativeBeacon.getRangedRegions();
  },

  getMonitoredRegions(): Promise<BeaconRegion[]> {
    return NativeBeacon.getMonitoredRegions();
  },

  /**
   * Returns true if the app is excluded from Android battery optimization.
   * When not excluded, Doze mode throttles BLE scanning with the screen off.
   */
  isIgnoringBatteryOptimizations(): Promise<boolean> {
    return NativeBeacon.isIgnoringBatteryOptimizations();
  },

  /**
   * Opens the system dialog asking the user to exclude this app from battery
   * optimization. Call after checking isIgnoringBatteryOptimizations() returns false.
   */
  requestIgnoreBatteryOptimizations(): void {
    NativeBeacon.requestIgnoreBatteryOptimizations();
  },

  /**
   * Opens the OEM-specific background permission settings page.
   * On Xiaomi/HyperOS opens the Autostart management screen directly.
   * On other OEMs falls back to the standard App Info screen.
   */
  openAutostartSettings(): void {
    NativeBeacon.openAutostartSettings();
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

  onRangingFailed(callback: (event: BeaconFailureEvent) => void) {
    return emitter.addListener(
      'onRangingFailed',
      callback as (...args: readonly unknown[]) => unknown
    );
  },

  onMonitoringFailed(callback: (event: BeaconFailureEvent) => void) {
    return emitter.addListener(
      'onMonitoringFailed',
      callback as (...args: readonly unknown[]) => unknown
    );
  },
};

export default Beacon;
