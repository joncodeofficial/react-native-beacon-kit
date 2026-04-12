import { useEffect, useState } from 'react';
import {
  Button,
  FlatList,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Beacon, { type Beacon as BeaconType } from 'react-native-beacon-kit';

async function requestPermissions() {
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

  // ACCESS_BACKGROUND_LOCATION must be requested separately — Android rejects it
  // when bundled with other permissions in the same requestMultiple() call.
  // Required on Android 10+ for BLE scanning to continue with the screen off.
  if (
    Platform.Version >= 29 &&
    results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === 'granted'
  ) {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
    );
  }
}

const TEST_REGION = {
  identifier: 'test-region',
  uuid: 'a1b23c45-d67e-9fab-de12-0034567890ab',
};

export default function App() {
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);
  const [beacons, setBeacons] = useState<BeaconType[]>([]);
  const [regionState, setRegionState] = useState<string>('unknown');
  const [isRanging, setIsRanging] = useState(false);

  useEffect(() => {
    Beacon.configure({
      // foregroundScanPeriod defaults to 1100ms (fast detection in foreground)
      // backgroundScanPeriod defaults to 10000ms (safe from Android BLE throttle)
      betweenScanPeriod: 0,
      foregroundService: true,
      kalmanFilter: { enabled: true },
    });

    requestPermissions().then(async () => {
      Beacon.checkPermissions().then(setHasPermissions);
      const exempt = await Beacon.isIgnoringBatteryOptimizations();
      console.log(`[DOZE] battery optimization exempt: ${exempt}`);
      if (!exempt) {
        Beacon.requestIgnoreBatteryOptimizations();
      }
      // NOTE: openAutostartSettings() intentionally NOT called here.
      // Calling it automatically sends the app to background right after startup,
      // triggering IMPORTANCE_CHANGE events in the BLE stack that cause scan data
      // loss on Xiaomi/MIUI. Call it only from a user-initiated onboarding action.
    });

    const rangingSub = Beacon.onBeaconsRanged((event) => {
      const ts = new Date().toISOString();
      if (event.beacons.length === 0) {
        console.log(`[DOZE] ${ts} — scan fired, 0 beacons`);
      } else {
        event.beacons.forEach((b) => {
          console.log(
            `[DOZE] ${ts} — ${b.uuid} (${b.major}/${b.minor}) ` +
              `rssi=${b.rssi} dBm | filtered=${b.distance.toFixed(2)}m | raw=${b.rawDistance.toFixed(2)}m`
          );
        });
      }
      setBeacons(event.beacons);
    });

    const monitorSub = Beacon.onRegionStateChanged((event) => {
      const ts = new Date().toISOString();
      console.log(
        `[DOZE] ${ts} — region ${event.state}: ${event.region.identifier}`
      );
      setRegionState(event.state);
    });

    return () => {
      rangingSub.remove();
      monitorSub.remove();
    };
  }, []);

  const handleStartRanging = async () => {
    await Beacon.startRanging(TEST_REGION);
    setIsRanging(true);
  };

  const handleStopRanging = async () => {
    await Beacon.stopRanging(TEST_REGION);
    setIsRanging(false);
    setBeacons([]);
  };

  const handleStartMonitoring = () => {
    Beacon.startMonitoring(TEST_REGION);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Beacon Test</Text>

      <Text style={styles.status}>
        Permissions:{' '}
        {hasPermissions === null
          ? '...'
          : hasPermissions
            ? 'granted'
            : 'denied'}
      </Text>

      <Text style={styles.status}>Region: {regionState}</Text>

      <View style={styles.buttons}>
        <Button
          title={isRanging ? 'Stop Ranging' : 'Start Ranging'}
          onPress={isRanging ? handleStopRanging : handleStartRanging}
        />
        <Button title="Start Monitoring" onPress={handleStartMonitoring} />
      </View>

      <Text style={styles.sectionTitle}>
        Beacons detected: {beacons.length}
      </Text>

      <FlatList
        data={beacons}
        keyExtractor={(item) => `${item.uuid}-${item.major}-${item.minor}`}
        renderItem={({ item }) => (
          <View style={styles.beacon}>
            <Text style={styles.beaconUuid}>{item.uuid}</Text>
            <Text style={styles.beaconMac}>{item.macAddress}</Text>
            <Text>
              Major: {item.major} Minor: {item.minor}
            </Text>
            <Text>RSSI: {item.rssi} dBm</Text>
            <Text style={styles.beaconDistance}>
              {item.distance.toFixed(2)} m
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  status: {
    fontSize: 14,
    marginBottom: 8,
    color: '#555',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  beacon: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  beaconUuid: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  beaconMac: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 6,
  },
  beaconDistance: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
});
