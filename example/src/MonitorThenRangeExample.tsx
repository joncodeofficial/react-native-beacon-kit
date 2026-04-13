/**
 * MonitorThenRangeExample
 *
 * Demonstrates the recommended background pattern:
 *   1. startMonitoring keeps the app alive with minimal battery use
 *   2. When the user enters the region → startRanging for precise distance
 *   3. When the user exits the region → stopRanging to save battery
 *
 * This is the correct way to combine monitoring and ranging.
 * Do NOT call startMonitoring and startRanging on the same region simultaneously —
 * use this sequential pattern instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';
import Beacon, {
  type Beacon as BeaconType,
  type BeaconFailureEvent,
} from 'react-native-beacon-kit';
import { handleMonitorThenRangeStateChange } from './monitorThenRange';

const REGION = {
  identifier: 'my-region',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

export default function MonitorThenRangeExample() {
  const startingRef = useRef(false);
  const [regionState, setRegionState] = useState<
    'unknown' | 'inside' | 'outside'
  >('unknown');
  const [beacons, setBeacons] = useState<BeaconType[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const handleFailure = useCallback((event: BeaconFailureEvent) => {
    const prefix = event.region?.identifier
      ? `${event.region.identifier}: `
      : '';
    const message = `[${event.code}] ${prefix}${event.message}`;
    console.warn(`[beacon] ${message}`);
    setLastError(message);
  }, []);

  // Step 1: Register listeners at mount — independent of permissions and scanning state.
  useEffect(() => {
    const rangingSub = Beacon.onBeaconsRanged((event) => {
      setLastError(null);
      setBeacons(event.beacons);
    });

    // Step 2 (automatic): when the region state changes, start or stop ranging.
    // This is the core of the pattern — ranging is driven by monitoring events,
    // not by the user manually pressing a button.
    const monitorSub = Beacon.onRegionStateChanged(({ state }) => {
      setLastError(null);
      handleMonitorThenRangeStateChange(state as 'inside' | 'outside', REGION, {
        setRegionState,
        clearBeacons: () => setBeacons([]),
        startRanging: Beacon.startRanging,
        stopRanging: Beacon.stopRanging,
      }).catch((error: unknown) => {
        setLastError(
          error instanceof Error ? error.message : 'Unknown ranging error'
        );
      });
    });

    const rangingFailedSub = Beacon.onRangingFailed(handleFailure);
    const monitoringFailedSub = Beacon.onMonitoringFailed(handleFailure);

    return () => {
      rangingSub.remove();
      monitorSub.remove();
      rangingFailedSub.remove();
      monitoringFailedSub.remove();
    };
  }, [handleFailure]);

  const handleStart = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      setLastError(null);
      // configure() already ran in App.tsx — just start monitoring here.
      // Ranging starts automatically from the onRegionStateChanged callback
      // above when the user enters the region.
      await Beacon.startMonitoring(REGION);
      setIsMonitoring(true);
    } catch (error: unknown) {
      setLastError(
        error instanceof Error ? error.message : 'Unknown monitoring error'
      );
    } finally {
      startingRef.current = false;
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      setLastError(null);
      await Beacon.stopMonitoring(REGION);
      await Beacon.stopRanging(REGION);
      setIsMonitoring(false);
      setRegionState('unknown');
      setBeacons([]);
    } catch (error: unknown) {
      setLastError(
        error instanceof Error ? error.message : 'Unknown stop error'
      );
    }
  }, []);

  const stateColor =
    regionState === 'inside'
      ? '#2a2'
      : regionState === 'outside'
        ? '#a22'
        : '#888';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Monitor → Range Example</Text>

      <View style={styles.stateBox}>
        <Text style={styles.stateLabel}>Region state</Text>
        <Text style={[styles.stateValue, { color: stateColor }]}>
          {regionState}
        </Text>
      </View>

      <Text style={styles.hint}>
        {regionState === 'inside'
          ? 'Inside region — ranging active'
          : regionState === 'outside'
            ? 'Outside region — ranging paused'
            : 'Waiting for first region event...'}
      </Text>

      {lastError ? <Text style={styles.error}>{lastError}</Text> : null}

      <View style={styles.buttons}>
        {!isMonitoring ? (
          <Button title="Start" onPress={handleStart} />
        ) : (
          <Button title="Stop" onPress={handleStop} />
        )}
      </View>

      <Text style={styles.sectionTitle}>Beacons ({beacons.length})</Text>
      <FlatList
        data={beacons}
        keyExtractor={(item) => `${item.uuid}-${item.major}-${item.minor}`}
        renderItem={({ item }) => (
          <View style={styles.beacon}>
            <Text style={styles.beaconUuid}>{item.uuid}</Text>
            <Text>
              {item.major}/{item.minor} · {item.rssi} dBm
            </Text>
            <Text style={styles.beaconDistance}>
              {item.distance.toFixed(2)} m
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {regionState === 'inside'
              ? 'No beacons detected'
              : 'Ranging not active'}
          </Text>
        }
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
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  stateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  stateLabel: {
    fontSize: 14,
    color: '#555',
  },
  stateValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    marginBottom: 20,
  },
  error: {
    color: '#a22',
    fontSize: 12,
    marginBottom: 16,
  },
  buttons: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  beacon: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  beaconUuid: {
    fontSize: 11,
    color: '#aaa',
    marginBottom: 4,
  },
  beaconDistance: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  empty: {
    color: '#aaa',
    fontSize: 13,
    fontStyle: 'italic',
  },
});
