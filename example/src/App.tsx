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
import IndoorBeacon, { type Beacon } from 'react-native-indoor-beacon';

async function requestPermissions() {
  if (Platform.OS !== 'android') return;

  const permissions: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][] =
    [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  if (Platform.Version >= 31) {
    permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
    permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  }

  await PermissionsAndroid.requestMultiple(permissions);
}

const TEST_REGION = {
  identifier: 'test-region',
  uuid: 'a1b23c45-d67e-9fab-de12-0034567890ab',
};

export default function App() {
  const [hasPermissions, setHasPermissions] = useState<boolean | null>(null);
  const [beacons, setBeacons] = useState<Beacon[]>([]);
  const [regionState, setRegionState] = useState<string>('unknown');
  const [isRanging, setIsRanging] = useState(false);

  useEffect(() => {
    IndoorBeacon.configure({
      scanPeriod: 5000,
      betweenScanPeriod: 0,
      foregroundService: true,
      kalmanFilter: { enabled: true },
    });

    requestPermissions().then(() => {
      IndoorBeacon.checkPermissions().then(setHasPermissions);
    });

    const rangingSub = IndoorBeacon.onBeaconsRanged((event) => {
      setBeacons(event.beacons);
    });

    const monitorSub = IndoorBeacon.onRegionStateChanged((event) => {
      setRegionState(event.state);
    });

    return () => {
      rangingSub.remove();
      monitorSub.remove();
    };
  }, []);

  const handleStartRanging = async () => {
    await IndoorBeacon.startRanging(TEST_REGION);
    setIsRanging(true);
  };

  const handleStopRanging = async () => {
    await IndoorBeacon.stopRanging(TEST_REGION);
    setIsRanging(false);
    setBeacons([]);
  };

  const handleStartMonitoring = () => {
    IndoorBeacon.startMonitoring(TEST_REGION);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>IndoorBeacon Test</Text>

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
