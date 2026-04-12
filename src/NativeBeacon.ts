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
  /** Scan period while the screen is on, in ms. Minimum: 1100ms. Default: 10000ms. */
  scanPeriod?: number;
  /**
   * Scan period while the screen is off, in ms. Minimum: 10000ms (enforced by the
   * Android BLE throttle — more than 5 startScan() calls in 30s degrades to
   * opportunistic scanning). Default: 10000ms.
   */
  backgroundScanPeriod?: number;
  betweenScanPeriod?: number;
  foregroundService?: boolean;
  foregroundServiceNotification?: ForegroundServiceNotificationConfig;
  kalmanFilter?: KalmanConfig;
  /**
   * Enables aggressive background scanning mode for OEM devices with restrictive
   * power managers (Xiaomi/HyperOS, some Samsung and Huawei models).
   *
   * When true, adds:
   * - BLE scan watchdog: restarts ranging every 20s to beat MIUI's ~20s scan-suspend timer
   * - PARTIAL_WAKE_LOCK: keeps CPU awake so BLE callbacks fire with the screen off
   * - Forced LOW_LATENCY scan mode: prevents MIUI from downgrading to LOW_POWER on screen-off
   *
   * Default: false. Only enable if you've confirmed background scanning stops on
   * the target device without it — these measures increase battery consumption.
   */
  aggressiveBackground?: boolean;
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
