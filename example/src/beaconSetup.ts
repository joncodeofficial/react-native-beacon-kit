import { PermissionsAndroid, Platform } from 'react-native';
import Beacon, { type BeaconScanConfig } from 'react-native-beacon-kit';

const DEFAULT_BEACON_CONFIG: BeaconScanConfig = {
  scanPeriod: 1100,
  backgroundScanPeriod: 10000,
  betweenScanPeriod: 0,
  foregroundService: true,
  foregroundServiceNotification: {
    title: 'Beacon Example',
    text: 'Scanning for beacons...',
  },
  kalmanFilter: { enabled: true },
  aggressiveBackground: false,
};

// Example app setup lives in one place so every screen can assume Beacon is
// already configured and focus on demonstrating the hooks.
export const requestBeaconPermissions = async () => {
  if (Platform.OS !== 'android') return;

  const permissions: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][] =
    [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  if (Platform.Version >= 31) {
    permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
    permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  }
  if (Platform.Version >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  const results = await PermissionsAndroid.requestMultiple(permissions);

  if (
    Platform.Version >= 29 &&
    results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === 'granted'
  ) {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
    );
  }
};

// configure() is global library state, not component state. Run it once at the
// app level so switching demo screens does not reconfigure the native scanner.
export const updateBeaconExampleConfig = (config: BeaconScanConfig = {}) => {
  Beacon.configure({
    ...DEFAULT_BEACON_CONFIG,
    ...config,
    foregroundServiceNotification: {
      ...DEFAULT_BEACON_CONFIG.foregroundServiceNotification,
      ...config.foregroundServiceNotification,
    },
    kalmanFilter: config.kalmanFilter
      ? {
          ...DEFAULT_BEACON_CONFIG.kalmanFilter,
          ...config.kalmanFilter,
        }
      : DEFAULT_BEACON_CONFIG.kalmanFilter,
  });
};

export const initializeBeaconExample = async () => {
  // Step 1: permissions first — configure() must come after on SDK 34+
  await requestBeaconPermissions();

  // Step 2: apply the shared baseline config once during app startup.
  updateBeaconExampleConfig();

  // Step 3: battery optimization check
  const exempt = await Beacon.isIgnoringBatteryOptimizations();
  console.log(`[beacon] battery optimization exempt: ${exempt}`);
  if (!exempt) {
    Beacon.requestIgnoreBatteryOptimizations();
  }
};
