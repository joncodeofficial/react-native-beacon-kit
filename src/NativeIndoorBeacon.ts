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

export interface BeaconScanConfig {
  scanPeriod?: number;
  betweenScanPeriod?: number;
  foregroundService?: boolean;
  kalmanFilter?: KalmanConfig;
}

export interface Spec extends TurboModule {
  // Verifica si los permisos ya fueron concedidos (no los pide)
  checkPermissions(): Promise<boolean>;

  // Configura intervalos de escaneo y foreground service
  configure(config: BeaconScanConfig): void;

  // Ranging: detecta beacons cercanos con RSSI y distancia (~cada 1s)
  startRanging(region: BeaconRegion): Promise<void>;
  stopRanging(region: BeaconRegion): Promise<void>;

  // Monitoring: detecta entrada/salida de regiones (eficiente en batería)
  startMonitoring(region: BeaconRegion): Promise<void>;
  stopMonitoring(region: BeaconRegion): Promise<void>;

  // Requerido por NativeEventEmitter
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('IndoorBeacon');
