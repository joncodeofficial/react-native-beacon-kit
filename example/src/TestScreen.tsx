import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Beacon, {
  type BeaconRegion,
  useBeaconEnvironment,
  useBeaconMonitoring,
  useBeaconRanging,
} from 'react-native-beacon-kit';

const TEST_REGION: BeaconRegion = {
  identifier: 'test-region',
  uuid: 'a1b23c45-d67e-9fab-de12-0034567890ab',
};

export default function TestScreen() {
  const [rangedRegions, setRangedRegions] = useState<BeaconRegion[]>([]);
  const [monitoredRegions, setMonitoredRegions] = useState<BeaconRegion[]>([]);
  const ranging = useBeaconRanging({ region: TEST_REGION });
  const monitoring = useBeaconMonitoring({ region: TEST_REGION });
  const {
    state: environmentState,
    isLoading: environmentLoading,
    refresh: refreshEnvironment,
  } = useBeaconEnvironment();

  useEffect(() => {
    const ts = new Date().toISOString();
    if (ranging.beacons.length === 0) {
      console.log(`[beacon] ${ts} — scan fired, 0 beacons`);
      return;
    }

    ranging.beacons.forEach((b) => {
      console.log(
        `[beacon] ${ts} — ${b.uuid} (${b.major}/${b.minor}) ` +
          `rssi=${b.rssi} dBm | filtered=${b.distance.toFixed(2)}m | raw=${b.rawDistance.toFixed(2)}m`
      );
    });
  }, [ranging.beacons]);

  useEffect(() => {
    if (monitoring.regionState === 'unknown') return;
    const ts = new Date().toISOString();
    console.log(
      `[beacon] ${ts} — region ${monitoring.regionState}: ${TEST_REGION.identifier}`
    );
  }, [monitoring.regionState]);

  const lastError = ranging.error?.message ?? monitoring.error?.message ?? null;

  const handleStartRanging = useCallback(async () => {
    ranging.clearError();
    monitoring.clearError();
    try {
      await ranging.start();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[beacon] startRanging error: ${msg}`);
    }
  }, [monitoring, ranging]);

  const handleStopRanging = useCallback(async () => {
    ranging.clearError();
    monitoring.clearError();
    await ranging.stop();
  }, [monitoring, ranging]);

  const handleStartMonitoring = useCallback(async () => {
    ranging.clearError();
    monitoring.clearError();
    try {
      await monitoring.start();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[beacon] startMonitoring error: ${msg}`);
    }
  }, [monitoring, ranging]);

  const handleStopMonitoring = useCallback(async () => {
    ranging.clearError();
    monitoring.clearError();
    await monitoring.stop();
  }, [monitoring, ranging]);

  const handleGetRegions = useCallback(async () => {
    const [ranged, monitored] = await Promise.all([
      Beacon.getRangedRegions(),
      Beacon.getMonitoredRegions(),
    ]);
    console.log('[beacon] ranged regions:', JSON.stringify(ranged));
    console.log('[beacon] monitored regions:', JSON.stringify(monitored));
    setRangedRegions(ranged);
    setMonitoredRegions(monitored);
  }, []);

  const handleRefreshDiagnostics = useCallback(async () => {
    await refreshEnvironment();
    console.log('[beacon] environment refresh requested');
  }, [refreshEnvironment]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Test</Text>

      <Text style={styles.status}>
        Permissions:{' '}
        {environmentState == null
          ? '...'
          : environmentState.permissionsGranted
            ? 'granted ✓'
            : 'denied ✗'}
      </Text>
      <Text style={styles.status}>Region state: {monitoring.regionState}</Text>

      <Text style={styles.sectionTitle}>Diagnostics</Text>
      <Text style={styles.hint}>
        This screen uses hooks end-to-end. Toggle Bluetooth, location services,
        or permissions and the diagnostics state should update automatically.
      </Text>
      <View style={styles.row}>
        <Button
          title="Refresh Diagnostics"
          onPress={handleRefreshDiagnostics}
        />
      </View>
      {environmentState ? (
        <View style={styles.diagnosticsCard}>
          <Text style={styles.diagnosticsTitle}>
            Ready now:{' '}
            <Text
              style={[
                styles.diagnosticsValue,
                environmentState.canScanInForeground
                  ? styles.goodText
                  : styles.badText,
              ]}
            >
              {environmentState.canScanInForeground ? 'yes' : 'no'}
            </Text>
          </Text>
          <Text style={styles.diagnosticsLine}>
            Background ready:{' '}
            {environmentState.canScanInBackground ? 'yes' : 'no'}
          </Text>
          <Text style={styles.diagnosticsLine}>
            Bluetooth enabled:{' '}
            {environmentState.bluetoothEnabled ? 'yes' : 'no'}
          </Text>
          <Text style={styles.diagnosticsLine}>
            Location services enabled:{' '}
            {environmentState.locationServicesEnabled ? 'yes' : 'no'}
          </Text>
          <Text style={styles.diagnosticsLine}>
            Location permission:{' '}
            {environmentState.locationPermissionGranted ? 'granted' : 'missing'}
          </Text>
          <Text style={styles.diagnosticsLine}>
            Bluetooth permission:{' '}
            {environmentState.bluetoothPermissionGranted
              ? 'granted'
              : 'missing'}
          </Text>
          <Text style={styles.diagnosticsLine}>
            Background permission:{' '}
            {environmentState.backgroundPermissionGranted
              ? 'granted'
              : 'missing'}
          </Text>
        </View>
      ) : environmentLoading ? (
        <Text style={styles.status}>Loading diagnostics...</Text>
      ) : (
        <Text style={styles.status}>Diagnostics unavailable</Text>
      )}

      {/* --- Ranging --- */}
      <Text style={styles.sectionTitle}>Ranging</Text>
      <View style={styles.row}>
        <Button
          title={ranging.isActive ? 'Stop Ranging' : 'Start Ranging'}
          onPress={ranging.isActive ? handleStopRanging : handleStartRanging}
          disabled={ranging.isStarting || ranging.isStopping}
        />
      </View>

      {/* --- Monitoring --- */}
      <Text style={styles.sectionTitle}>Monitoring</Text>
      <Text style={styles.hint}>
        Start Monitoring while Ranging is active → should show
        RANGING_MONITORING_CONFLICT error below.
      </Text>
      <View style={styles.row}>
        <Button
          title={monitoring.isActive ? 'Stop Monitoring' : 'Start Monitoring'}
          onPress={
            monitoring.isActive ? handleStopMonitoring : handleStartMonitoring
          }
          disabled={monitoring.isStarting || monitoring.isStopping}
        />
      </View>

      {/* --- Error display --- */}
      {lastError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{lastError}</Text>
        </View>
      ) : null}

      {/* --- getRangedRegions / getMonitoredRegions --- */}
      <Text style={styles.sectionTitle}>Active Regions</Text>
      <View style={styles.row}>
        <Button title="Get Active Regions" onPress={handleGetRegions} />
      </View>
      <Text style={styles.label}>Ranged ({rangedRegions.length}):</Text>
      {rangedRegions.map((r) => (
        <Text key={r.identifier} style={styles.regionText}>
          {r.identifier} — {r.uuid}
        </Text>
      ))}
      <Text style={styles.label}>Monitored ({monitoredRegions.length}):</Text>
      {monitoredRegions.map((r) => (
        <Text key={r.identifier} style={styles.regionText}>
          {r.identifier} — {r.uuid}
        </Text>
      ))}

      {/* --- Beacon list --- */}
      <Text style={styles.sectionTitle}>
        Beacons detected: {ranging.beacons.length}
      </Text>
      <FlatList
        data={ranging.beacons}
        scrollEnabled={false}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  status: { fontSize: 14, marginBottom: 6, color: '#555' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  hint: { fontSize: 12, color: '#888', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  label: { fontSize: 13, color: '#555', marginTop: 6 },
  regionText: { fontSize: 12, color: '#333', marginLeft: 8, marginBottom: 2 },
  errorBox: {
    backgroundColor: '#fff0f0',
    borderColor: '#f66',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
  },
  errorText: { fontSize: 12, color: '#c00' },
  diagnosticsCard: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  diagnosticsTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  diagnosticsValue: { fontWeight: '700' },
  diagnosticsLine: {
    fontSize: 13,
    color: '#444',
    marginBottom: 4,
  },
  goodText: { color: '#1a7f37' },
  badText: { color: '#c00' },
  beacon: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  beaconUuid: { fontSize: 12, color: '#888', marginBottom: 2 },
  beaconMac: { fontSize: 12, color: '#aaa', marginBottom: 6 },
  beaconDistance: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
});
