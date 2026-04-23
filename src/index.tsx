export {
  default,
  type Beacon,
  type BeaconFailureEvent,
  type BeaconsRangedEvent,
  type RegionStateChangedEvent,
} from './beaconApi';

export type {
  BeaconRegion,
  BeaconScanConfig,
  ForegroundServiceNotificationConfig,
  KalmanConfig,
} from './NativeBeacon';

export {
  type UseBeaconBaseResult,
  type UseBeaconOptions,
} from './useBeaconController';

export {
  useBeaconRanging,
  type UseBeaconRangingResult,
} from './useBeaconRanging';

export {
  useBeaconMonitoring,
  type UseBeaconMonitoringResult,
} from './useBeaconMonitoring';

export {
  useMonitorThenRange,
  type UseMonitorThenRangeResult,
} from './useMonitorThenRange';

export type { BeaconHookRegionState } from './hookUtils';
