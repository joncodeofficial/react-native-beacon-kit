import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface BeaconRegion {
  identifier: string;
  uuid: string;
  major?: number;
  minor?: number;
}

export interface KalmanConfig {
  enabled: boolean;
  q?: number; // process noise — how much you trust movement (default 0.008)
  r?: number; // measurement noise — how much you trust RSSI (default 0.1)
}

export interface ForegroundServiceNotificationConfig {
  title?: string;
  text?: string;
}

export interface BeaconScanConfig {
  scanPeriod?: number;
  backgroundScanPeriod?: number;
  betweenScanPeriod?: number;
  foregroundService?: boolean;
  foregroundServiceNotification?: ForegroundServiceNotificationConfig;
  kalmanFilter?: KalmanConfig;
}

export interface Spec extends TurboModule {
  // Checks permissions without requesting them — the developer's responsibility
  checkPermissions(): Promise<boolean>;

  // Sets scan intervals and optionally enables the foreground service
  configure(config: BeaconScanConfig): void;

  // Ranging: detects nearby beacons with RSSI and distance (~every 1s)
  startRanging(region: BeaconRegion): Promise<void>;
  stopRanging(region: BeaconRegion): Promise<void>;

  // Monitoring: detects region entry/exit (battery efficient)
  startMonitoring(region: BeaconRegion): Promise<void>;
  stopMonitoring(region: BeaconRegion): Promise<void>;

  // Battery optimization — required for reliable scanning with screen off
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): void;

  // Opens OEM-specific autostart/background permission settings.
  // On Xiaomi opens Autostart management directly; falls back to App Info on other devices.
  openAutostartSettings(): void;

  // Required by NativeEventEmitter
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Beacon');
