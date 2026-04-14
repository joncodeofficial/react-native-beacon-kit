# react-native-beacon-kit

iBeacon and AltBeacon for React Native, built on New Architecture (TurboModules + JSI) with real Android background scanning support.

> **Platform support:** Android and iOS supported.

## Features

- Hooks-first API for React apps
- Low-level imperative API for advanced orchestration
- Real Android background scanning via foreground service
- iOS region monitoring with ranging handoff
- iBeacon and AltBeacon support
- Optional Kalman filter for more stable distance readings
- Configurable scan intervals
- Does not request permissions for you

## Installation

```sh
npm install react-native-beacon-kit
```

### Expo managed workflow

Recommended usage:

```json
{
  "expo": {
    "plugins": ["react-native-beacon-kit"]
  }
}
```

Optional iOS background location capability:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-beacon-kit",
        {
          "iosBackgroundLocation": true
        }
      ]
    ]
  }
}
```

The Expo plugin:

- adds the Android permissions used by the library
- removes `neverForLocation` from `BLUETOOTH_SCAN`
- adds the default iOS location usage strings
- optionally adds `UIBackgroundModes = ["location"]` when `iosBackgroundLocation` is enabled

The plugin does not request permissions at runtime.

## Quick Start

If you are building a React screen, start with the hooks API.

### Which hook should I use?

| Hook | Use it when | What it owns |
|---|---|---|
| `useBeaconRanging({ region })` | You want nearby beacon readings, RSSI, and distance | Listeners, `beacons`, error state, and ranging `start()` / `stop()` |
| `useBeaconMonitoring({ region })` | You only need `inside` / `outside` region state | Listeners, `regionState`, error state, and monitoring `start()` / `stop()` |
| `useMonitorThenRange({ region })` | You want monitoring to wake the workflow and ranging only while inside the region | Monitoring + ranging coordination, listeners, state, errors, and workflow `start()` / `stop()` |

### Required call order

This order matters on Android, especially on SDK 34+:

```text
1. Mount the hook (or register listeners manually if using the low-level API)
2. Request permissions
   - request ACCESS_BACKGROUND_LOCATION separately
3. Call Beacon.configure()
   - after permissions are granted on SDK 34+
4. Call hook.start()
   - or Beacon.startRanging(region) / Beacon.startMonitoring(region) if using the low-level API
```

On Android SDK 34+, calling `configure({ foregroundService: true })` before permissions are granted can throw a `SecurityException` on fresh installs.

### What hooks do and do not do

Hooks handle:

- listener setup and cleanup
- React state
- failure state
- start/stop orchestration

Hooks do not handle:

- requesting permissions
- calling `Beacon.configure()`
- highly custom multi-region orchestration

### Minimal hook example

```ts
import { useCallback } from 'react';
import { Button, Text } from 'react-native';
import Beacon, { useBeaconRanging } from 'react-native-beacon-kit';

const region = {
  identifier: 'my-region',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

const MyComponent = () => {
  const {
    beacons,
    error,
    isActive,
    isStarting,
    start: startRanging,
    stop: stopRanging,
  } = useBeaconRanging({ region });

  const start = useCallback(async () => {
    try {
      await requestPermissions();

      Beacon.configure({
        scanPeriod: 1100,
        backgroundScanPeriod: 10000,
        betweenScanPeriod: 0,
        foregroundService: true,
        foregroundServiceNotification: {
          title: 'My App',
          text: 'Scanning for nearby assets...',
        },
        kalmanFilter: { enabled: true },
      });

      await startRanging();
    } catch (error) {
      console.warn('[beacon] start failed', error);
    }
  }, [startRanging]);

  const stop = useCallback(async () => {
    await stopRanging();
  }, [stopRanging]);

  return (
    <>
      <Text>Detected beacons: {beacons.length}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={isActive ? 'Stop' : isStarting ? 'Starting...' : 'Start'}
        onPress={isActive ? stop : start}
      />
    </>
  );
};
```

### Error handling semantics

The library reports failures through two channels:

- Promise rejection from `start()` / `stop()` or `startRanging()` / `startMonitoring()` for immediate call-time failures
- `onRangingFailed()` / `onMonitoringFailed()` for runtime or asynchronous native failures

When you use hooks, runtime failures are already surfaced through the hook's `error` field.

For hook users, the normal pattern is:

```ts
const { error, start } = useBeaconMonitoring({ region });

try {
  await start();
} catch (error) {
  // Immediate failure while starting
  console.warn('[beacon] start failed', error);
}

if (error) {
  // Runtime or asynchronous failure already exposed by the hook
  console.warn('[beacon] monitoring error', error.code, error.message);
}
```

Use `Beacon.onRangingFailed()` / `Beacon.onMonitoringFailed()` directly when you are working with the low-level API or building custom orchestration outside the hooks.

## API

### Hooks API

The hooks API is the recommended React interface.

All three hooks accept:

- `region`: beacon region to target
- `autoStart?`: automatically call `start()` when the hook mounts
- `stopOnUnmount?`: automatically stop the active operation when the component unmounts

Default behavior:

- `autoStart = false`
- `stopOnUnmount = true`

### `useBeaconRanging({ region, autoStart?, stopOnUnmount? })`

Returns:

- `beacons`
- `error`
- `isActive`
- `isStarting`
- `isStopping`
- `clearError()`
- `start()`
- `stop()`

Example:

```ts
import { useCallback } from 'react';
import { Button, Text, View } from 'react-native';
import Beacon, { useBeaconRanging } from 'react-native-beacon-kit';

const region = {
  identifier: 'warehouse',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

const RangingScreen = () => {
  const { beacons, error, isActive, start, stop } = useBeaconRanging({
    region,
  });

  const handleStart = useCallback(async () => {
    await requestPermissions();

    Beacon.configure({
      scanPeriod: 1100,
      backgroundScanPeriod: 10000,
      foregroundService: true,
    });

    await start();
  }, [start]);

  return (
    <View>
      <Text>Beacons: {beacons.length}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={isActive ? 'Stop ranging' : 'Start ranging'}
        onPress={isActive ? stop : handleStart}
      />
    </View>
  );
};
```

### `useBeaconMonitoring({ region, autoStart?, stopOnUnmount? })`

Returns:

- `regionState` (`'unknown' | 'inside' | 'outside'`)
- `error`
- `isActive`
- `isStarting`
- `isStopping`
- `clearError()`
- `start()`
- `stop()`

Example:

```ts
import { useCallback, useEffect } from 'react';
import { Button, Text, View } from 'react-native';
import Beacon, { useBeaconMonitoring } from 'react-native-beacon-kit';

const region = {
  identifier: 'entrance-zone',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

const MonitoringScreen = () => {
  const { regionState, error, isActive, start, stop } = useBeaconMonitoring({
    region,
  });

  const handleStart = useCallback(async () => {
    await requestPermissions();
    Beacon.configure({});
    await start();
  }, [start]);

  useEffect(() => {
    if (regionState === 'inside') {
      console.log('User entered the region');
    }
  }, [regionState]);

  return (
    <View>
      <Text>State: {regionState}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={isActive ? 'Stop monitoring' : 'Start monitoring'}
        onPress={isActive ? stop : handleStart}
      />
    </View>
  );
};
```

### `useMonitorThenRange({ region, autoStart?, stopOnUnmount? })`

Use this when you want battery-friendly monitoring that turns on ranging only while the device is inside the region.

Returns:

- `beacons`
- `regionState`
- `isRanging`
- `error`
- `isActive`
- `isStarting`
- `isStopping`
- `clearError()`
- `start()`
- `stop()`

Example:

```ts
import { useCallback } from 'react';
import { Button, FlatList, Text, View } from 'react-native';
import Beacon, { useMonitorThenRange } from 'react-native-beacon-kit';

const region = {
  identifier: 'store-zone',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

const StoreExperience = () => {
  const {
    beacons,
    regionState,
    isActive,
    isRanging,
    error,
    start,
    stop,
  } = useMonitorThenRange({ region });

  const handleStart = useCallback(async () => {
    await requestPermissions();
    Beacon.configure({
      foregroundService: true,
      backgroundScanPeriod: 10000,
    });
    await start();
  }, [start]);

  return (
    <View>
      <Text>Region: {regionState}</Text>
      <Text>Ranging active: {isRanging ? 'yes' : 'no'}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={isActive ? 'Stop workflow' : 'Start workflow'}
        onPress={isActive ? stop : handleStart}
      />
      <FlatList
        data={beacons}
        keyExtractor={(item) => `${item.uuid}-${item.major}-${item.minor}`}
        renderItem={({ item }) => (
          <Text>
            {item.major}/{item.minor} - {item.distance.toFixed(2)} m
          </Text>
        )}
      />
    </View>
  );
};
```

### Low-level API

The imperative `Beacon.*` API remains available for advanced use cases, non-React flows, or custom orchestration that does not map cleanly to a hook.

### `configure(config)`

Call after permissions are granted and before starting a scan. All fields are optional.

> **SDK 34+ requirement:** `configure({ foregroundService: true })` must be called after permissions are granted.

```ts
Beacon.configure({
  scanPeriod?: number,
  backgroundScanPeriod?: number,
  betweenScanPeriod?: number,
  foregroundService?: boolean,
  foregroundServiceNotification?: {
    title?: string,
    text?: string,
  },
  kalmanFilter?: {
    enabled: boolean,
    q?: number,
    r?: number,
  },
  aggressiveBackground?: boolean,
});
```

Key fields:

- `scanPeriod`: active foreground scan window in ms
- `backgroundScanPeriod`: active background scan window in ms
- `betweenScanPeriod`: rest period between scans in ms
- `foregroundService`: enables real Android background scanning
- `aggressiveBackground`: Android-only fallback for problematic OEMs; keep off unless you have verified that you need it

Recommended defaults:

```ts
Beacon.configure({
  scanPeriod: 1100,
  backgroundScanPeriod: 10000,
  betweenScanPeriod: 0,
});
```

`configure()` can also be called while scanning is already running; updated intervals take effect immediately.

#### Scan interval notes

`scanPeriod` is how long the BLE radio is actively scanning. `betweenScanPeriod` is how long it rests before the next scan cycle.

- `betweenScanPeriod: 0` means continuous scanning
- longer rest periods save battery
- if your beacons advertise slowly, your scan window must still be long enough to catch them reliably

If your beacons advertise every ~1000ms, use a scan window closer to `3000ms` rather than `1100ms`.

### `checkPermissions(): Promise<boolean>`

Returns `true` if all required permissions are already granted. Does not request them.

### `startRanging(region) / stopRanging(region)`

Detects nearby beacons with RSSI and distance.

### `startMonitoring(region) / stopMonitoring(region)`

Detects region entry and exit.

### Ranging vs Monitoring

Do not call `startRanging()` and `startMonitoring()` on the same region at the same time.

The library enforces this at runtime and rejects with `RANGING_MONITORING_CONFLICT`.

| Use case | API |
|---|---|
| Foreground RSSI / distance measurement | `startRanging` only |
| Background zone entry/exit detection | `startMonitoring` only |
| Background ranging after zone entry | `startMonitoring` then start ranging after `inside` |

```ts
// ❌ Do not combine on the same region simultaneously
await Beacon.startRanging(region);
await Beacon.startMonitoring(region);

// ✅ Foreground positioning
await Beacon.startRanging(region);

// ✅ Background monitoring that triggers ranging
Beacon.startMonitoring(region);
Beacon.onRegionStateChanged(({ state }) => {
  if (state === 'inside') Beacon.startRanging(region);
  if (state === 'outside') Beacon.stopRanging(region);
});
```

### Region filtering

`BeaconRegion` fields behave as hierarchical filters:

| Fields provided | What it matches |
|---|---|
| `uuid` only | All beacons with that UUID |
| `uuid` + `major` | All beacons with that UUID and major |
| `uuid` + `major` + `minor` | One exact beacon |

Typical iBeacon convention:

- `uuid`: project or fleet
- `major`: group, zone, or floor
- `minor`: specific beacon

Example:

```ts
await Beacon.startRanging({
  identifier: 'my-fleet',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
});

await Beacon.startRanging({
  identifier: 'beacon-101',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
  major: 1,
  minor: 42,
});
```

### Events

#### `onBeaconsRanged(callback)`

```ts
const sub = Beacon.onBeaconsRanged((event) => {
  // event.region
  // event.beacons
});

sub.remove();
```

#### `onRegionStateChanged(callback)`

```ts
const sub = Beacon.onRegionStateChanged((event) => {
  // event.region
  // event.state
});
```

#### `onRangingFailed(callback)`

Emits a failure event when the native layer reports a runtime or asynchronous ranging error.

```ts
const sub = Beacon.onRangingFailed((event) => {
  // event.code
  // event.message
  // event.region
  // event.nativeCode
  // event.domain
});
```

#### `onMonitoringFailed(callback)`

Emits a failure event when the native layer reports a runtime or asynchronous monitoring error.

```ts
const sub = Beacon.onMonitoringFailed((event) => {
  // Same payload shape as onRangingFailed()
});
```

### Beacon object

```ts
interface Beacon {
  uuid: string;
  major: number;
  minor: number;
  rssi: number;
  distance: number;
  rawDistance: number;
  txPower: number;
  macAddress: string;
  timestamp: number;
}
```

Notes:

- `distance` is Kalman-filtered if the filter is enabled
- `rawDistance` is the unfiltered value
- `macAddress` may be randomized on Android 10+
- on iOS, `macAddress` is always empty and `txPower` is always `-59`

### Android utility methods

#### `isIgnoringBatteryOptimizations(): Promise<boolean>`

Returns `true` if the app is excluded from Android battery optimization.

#### `requestIgnoreBatteryOptimizations(): void`

Opens the Android system dialog asking the user to exclude the app from battery optimization.

```ts
const exempt = await Beacon.isIgnoringBatteryOptimizations();
if (!exempt) {
  Beacon.requestIgnoreBatteryOptimizations();
}
```

#### `openAutostartSettings(): void`

Opens the OEM-specific background permission settings page.

- Xiaomi / HyperOS: Autostart management
- OPPO / Realme: privacy permissions
- Vivo: background startup manager
- Huawei: startup manager
- Samsung: battery settings
- Other OEMs: standard App Info

```ts
Beacon.openAutostartSettings();
```

Do not call `openAutostartSettings()` during app initialization. Call it only from a user-initiated action.

## Platform Setup

Use this section for platform-specific setup details after installation and quick start.

### Android permissions

Required permissions are merged into `AndroidManifest.xml` automatically through autolinking for React Native CLI and Expo bare workflow.

If you are using Expo managed workflow, the recommended setup is the built-in Expo plugin:

```json
{
  "expo": {
    "plugins": ["react-native-beacon-kit"]
  }
}
```

The library declares permissions but does not request them. Use [react-native-permissions](https://github.com/zoontek/react-native-permissions) or your own runtime permission flow.

#### Android permission checklist

| Permission | Why | When required |
|---|---|---|
| `ACCESS_FINE_LOCATION` | BLE scanning requires location | Always |
| `ACCESS_BACKGROUND_LOCATION` | Background scanning | Android 10+ |
| `BLUETOOTH_SCAN` | BLE radio access | Android 12+ |
| `BLUETOOTH_CONNECT` | BLE device access | Android 12+ |
| `FOREGROUND_SERVICE` | Persistent notification | Android 8+ |
| `FOREGROUND_SERVICE_LOCATION` | Location foreground service | Android 14+ |
| `POST_NOTIFICATIONS` | Foreground service notification | Android 13+ |

Important Android notes:

- `ACCESS_BACKGROUND_LOCATION` must be requested separately at runtime
- on Android 13+, `POST_NOTIFICATIONS` should be requested at runtime too
- on Expo managed workflow, the built-in plugin already removes `android:usesPermissionFlags="neverForLocation"` from `BLUETOOTH_SCAN`

### iOS setup

If you are using Expo managed workflow, see [Installation](#installation) for the built-in plugin setup.

If you are configuring iOS manually, add to `Info.plist`:

```xml
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>This app uses your location to detect nearby beacons.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>This app uses your location to detect nearby beacons.</string>
```

Enable **Location updates** background mode in Xcode under your target's Background Modes capability.

iOS background behavior is different from Android:

- continuous background ranging is not supported
- use `startMonitoring()` to wake the app
- start ranging after the region event if you need the short execution window

```ts
Beacon.startMonitoring({ identifier: 'my-region', uuid: '...' });

const sub = Beacon.onRegionStateChanged(({ state }) => {
  if (state === 'inside') {
    Beacon.startRanging({ identifier: 'my-region', uuid: '...' });
  }
});
```

iOS-specific behavior:

- `foregroundService`, `aggressiveBackground`, `scanPeriod`, `backgroundScanPeriod`, and `betweenScanPeriod` are ignored
- `isIgnoringBatteryOptimizations()` always returns `true`
- `requestIgnoreBatteryOptimizations()` and `openAutostartSettings()` are no-ops
- `macAddress` is always empty
- `txPower` is always `-59`

## Advanced Android Background Scanning

### Foreground service

Android background scanning requires `configure({ foregroundService: true })`.

Without a foreground service, Android can kill scanning when the app goes to the background.

### Doze and screen-off behavior

Even with a foreground service, Android Doze and OEM power management can still reduce BLE reliability with the screen off.

This library mitigates that through:

1. high-priority scanning
2. partial wake lock support when foreground service is enabled
3. optional battery optimization exemption flow

```ts
const exempt = await Beacon.isIgnoringBatteryOptimizations();
if (!exempt) {
  Beacon.requestIgnoreBatteryOptimizations();
}
```

### `aggressiveBackground`

`aggressiveBackground` is an advanced Android-only option for problematic OEMs.

It is:

- off by default
- not needed for most apps
- worth enabling only if you have verified that screen-off scanning is still being suspended on your target hardware

```ts
Beacon.configure({
  foregroundService: true,
  aggressiveBackground: true,
});
```

Tradeoff:

- improves survivability on some OEMs
- increases battery usage

### Xiaomi / HyperOS

Xiaomi and HyperOS devices often need extra manual setup beyond standard Android behavior.

For reliable screen-off scanning on those devices, you may need all of:

| Required | How |
|---|---|
| `foregroundService: true` | In `Beacon.configure()` |
| `aggressiveBackground: true` | Only if testing shows it is needed |
| Battery optimization exemption | `requestIgnoreBatteryOptimizations()` |
| Autostart permission | `openAutostartSettings()` from a user action |

After opening the OEM settings, the user may still need to:

- enable **Autostart**
- set battery mode to **No restrictions**

This is an edge-case OEM section, not the normal setup path for every app.

## Troubleshooting

### `SecurityException` on fresh install (SDK 34+)

`configure()` is being called before permissions resolve. Await your permission flow first.

### Ranging always returns 0 beacons

Check whether ranging and monitoring were started simultaneously on the same region. That flow is unsupported and rejects with `RANGING_MONITORING_CONFLICT`.

### No foreground service notification on Android 13+

Add `POST_NOTIFICATIONS` to your runtime permission flow and manifest/app config.

### Scanning stops after screen off on Xiaomi / HyperOS

Review the [Xiaomi / HyperOS](#xiaomi--hyperos) section. `aggressiveBackground` alone is not always enough.

### `configure()` appears to run twice at startup

Guard your startup function with a ref, not state:

```ts
const startingRef = useRef(false);

const start = useCallback(async () => {
  if (startingRef.current) return;
  startingRef.current = true;
  try {
    // request permissions
    // Beacon.configure(...)
    // await start()
  } finally {
    startingRef.current = false;
  }
}, []);
```

### 0 beacons or intermittent detection after reinstall

If both the example app and your production app are installed on the same device, two services may compete for the scanner.

Diagnose:

```sh
adb logcat -v time BeaconService:V *:S
```

Fix:

```sh
adb shell am force-stop com.beacon.example
adb uninstall com.beacon.example
```

## License

MIT
