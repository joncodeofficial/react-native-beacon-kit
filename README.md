# react-native-beacon-kit

iBeacon / AltBeacon library for React Native built on New Architecture (TurboModules + JSI).
Real background scanning on Android via foreground service — what other libraries promised but never delivered.

> **Platform support:** Android and iOS fully supported.

## Features

- New Architecture (TurboModules + JSI) — no legacy bridge
- Real background scanning on Android via foreground service
- Background region monitoring on iOS (entry/exit events with ~10s ranging bursts)
- iBeacon + AltBeacon support (~85% of the beacon market)
- Kalman filter for stable distance readings (optional)
- Configurable scan intervals
- Does not request permissions — respects your app's UX flow

## Installation

```sh
npm install react-native-beacon-kit
```

### Android permissions

All required permissions are automatically merged into your app's `AndroidManifest.xml` via autolinking — no manual changes needed for React Native CLI or Expo bare workflow.

**Expo managed workflow** — declare permissions explicitly in `app.json`:

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.POST_NOTIFICATIONS"
      ]
    }
  }
}
```

Permissions are declared but not requested by the library — use [react-native-permissions](https://github.com/zoontek/react-native-permissions) to request them at runtime before calling any scanning method.

#### Android permissions checklist

| Permission | Why | When required |
|---|---|---|
| `ACCESS_FINE_LOCATION` | BLE scanning requires location | Always |
| `ACCESS_BACKGROUND_LOCATION` | BLE scanning with screen off | Android 10+ |
| `BLUETOOTH_SCAN` | BLE radio access | Android 12+ |
| `BLUETOOTH_CONNECT` | Connect to BLE devices | Android 12+ |
| `FOREGROUND_SERVICE` | Persistent notification | Android 8+ |
| `FOREGROUND_SERVICE_LOCATION` | Location-type foreground service | Android 14+ |
| `POST_NOTIFICATIONS` | Show foreground service notification | Android 13+ |

**`POST_NOTIFICATIONS` (Android 13+/SDK 33):** Without this permission, the foreground service notification is silently suppressed. On some OEMs this causes the foreground service itself to be killed. Request it at runtime alongside your other permissions:

```ts
const permissions = [
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
];

if (Platform.Version >= 31) {
  permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
  permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
}
if (Platform.Version >= 33) {
  permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}
```

**`ACCESS_BACKGROUND_LOCATION` must be requested separately at runtime.** Android rejects it when bundled with other permissions in the same `requestMultiple()` call — it must be a separate `request()` after `ACCESS_FINE_LOCATION` is granted. This is the most common reason background scanning silently stops working.

**Expo + `BLUETOOTH_SCAN` flag:** The Expo managed workflow adds `BLUETOOTH_SCAN` with `android:usesPermissionFlags="neverForLocation"` by default, which **blocks beacon scanning** (beacon scanning requires location). Remove this flag with a config plugin:

```js
// app.config.js
const { withAndroidManifest } = require('@expo/config-plugins');

const withBleScanPermissionFix = (config) =>
  withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest['uses-permission'] || [];
    permissions.forEach((perm) => {
      if (perm?.$?.['android:name'] === 'android.permission.BLUETOOTH_SCAN') {
        delete perm.$['android:usesPermissionFlags'];
      }
    });
    return config;
  });

module.exports = withBleScanPermissionFix({ /* your config */ });
```

## Usage

> **Recommended for React apps:** use the hooks API. It abstracts listener setup, React state, error state, and the correct start/stop flow. The imperative `Beacon.*` methods remain available as a low-level API for advanced cases, custom orchestration, or non-hook code.

Available hooks:

- `useBeaconRanging({ region })`
- `useBeaconMonitoring({ region })`
- `useMonitorThenRange({ region })`

### Required call order

The following order is mandatory on Android, especially on SDK 34+:

```
1. Mount the hook (or register listeners manually if using the low-level API)
2. Request permissions (await all; ACCESS_BACKGROUND_LOCATION separately)
3. Beacon.configure()  — after permissions on SDK 34+
4. Call `start()` from the hook result  OR  call `Beacon.startRanging(region)` / `Beacon.startMonitoring(region)`
   ↑ ranging and monitoring must not run on the same region simultaneously — see Ranging vs Monitoring below
```

On SDK 34+, Android enforces permission checks when a foreground service is involved. Calling `configure({ foregroundService: true })` before permissions are granted will throw a `SecurityException` on fresh installs. On SDK ≤ 33 this appeared to work because permissions were pre-granted from previous installs.

### Hook example

```ts
import { useCallback } from 'react';
import { Button, Text } from 'react-native';
import Beacon, { useBeaconRanging } from 'react-native-beacon-kit';

const region = {
  identifier: 'my-region',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

function MyComponent() {
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
}
```

### Error handling semantics

The library reports failures through two different channels:

- **Promise rejection** from `startRanging()` / `startMonitoring()` or hook `start()` / `stop()` for **immediate call-time failures** such as invalid arguments, `RANGING_MONITORING_CONFLICT`, or platform/setup errors detected while starting.
- **`onRangingFailed()` / `onMonitoringFailed()` events** for **runtime or asynchronous native failures** that occur after the operation has already started.

When using hooks, the latest failure is also exposed via the hook's `error` field.

Use both:

```ts
const { error, start } = useBeaconMonitoring({ region });

try {
  await start();
} catch (error) {
  // Immediate failure while starting
  console.warn('[beacon] hook start failed', error);
}

const sub = Beacon.onMonitoringFailed((event) => {
  // Failure reported later by the native layer while monitoring is active
  console.warn('[beacon] runtime monitoring failure', event.code, event.message);
});
```

## API

### Hooks API

The hooks API is the recommended React interface. It handles event subscriptions, React state, error state, and start/stop orchestration for you.

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

function RangingScreen() {
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
}
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
import { useEffect } from 'react';
import { Button, Text, View } from 'react-native';
import { useBeaconMonitoring } from 'react-native-beacon-kit';

const region = {
  identifier: 'entrance-zone',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

function MonitoringScreen() {
  const { regionState, error, isActive, start, stop } = useBeaconMonitoring({
    region,
  });

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
        onPress={isActive ? stop : start}
      />
    </View>
  );
}
```

### `useMonitorThenRange({ region, autoStart?, stopOnUnmount? })`

Recommended when you want monitoring to wake the workflow and ranging to activate only while the user is inside the region.

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
import { Button, FlatList, Text, View } from 'react-native';
import { useMonitorThenRange } from 'react-native-beacon-kit';

const region = {
  identifier: 'store-zone',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
};

function StoreExperience() {
  const {
    beacons,
    regionState,
    isActive,
    isRanging,
    error,
    start,
    stop,
  } = useMonitorThenRange({ region });

  return (
    <View>
      <Text>Region: {regionState}</Text>
      <Text>Ranging active: {isRanging ? 'yes' : 'no'}</Text>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title={isActive ? 'Stop workflow' : 'Start workflow'}
        onPress={isActive ? stop : start}
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
}
```

### Low-level API

The imperative `Beacon.*` API is still supported and powers the hooks internally. Use it when you need custom orchestration, integration with existing imperative code, or behavior that doesn't map cleanly to a hook.

### `configure(config)`

Call after permissions are granted, before starting any scan. All fields are optional.

> **SDK 34+ requirement:** `configure({ foregroundService: true })` must be called _after_ all required permissions are granted. On SDK 34+, Android enforces permission checks when enabling a foreground service — calling `configure()` before permissions are granted causes a `SecurityException` on fresh installs.

```ts
Beacon.configure({
  scanPeriod?: number,           // foreground scan period in ms (default: 10000)
  backgroundScanPeriod?: number, // background scan period in ms (default: 10000)
  betweenScanPeriod?: number,    // rest between scans in ms (default: 0)
  foregroundService?: boolean,   // enable real background scanning (default: false)
  foregroundServiceNotification?: {
    title?: string,   // notification title (default: 'Beacon')
    text?: string,    // notification body  (default: 'Scanning for beacons...')
  },
  kalmanFilter?: {
    enabled: boolean,
    q?: number,   // process noise — how much you trust movement (default: 0.008)
    r?: number,   // measurement noise — how much you trust RSSI (default: 0.1)
  },
  aggressiveBackground?: boolean, // enable aggressive OEM mode (default: false) — see below
});
```

`configure()` can be called while a scan is already running — updated scan periods take effect immediately.

**Foreground vs background scan periods:** `scanPeriod` controls how long the BLE radio is on when the app is in the foreground (screen on, app active). `backgroundScanPeriod` controls the same when the app is in the background (screen off). The library **automatically switches** between these two periods based on Android's Activity lifecycle — no code required on the caller side. You can confirm this in logcat: `set scan intervals received` fires at the exact moment the screen turns off.

Recommended defaults:

```ts
Beacon.configure({
  scanPeriod: 1100,            // foreground: fast updates, no throttle risk
  backgroundScanPeriod: 10000, // background: safe from Android's 5-in-30s throttle
  betweenScanPeriod: 0,
});
```

**`scanPeriod` vs `betweenScanPeriod`**

`scanPeriod` is how long the BLE radio is on and detecting. `betweenScanPeriod` is how long it rests before the next scan. Beacons are reported once at the end of each active period.

```
|←── scanPeriod ──→|←── betweenScanPeriod ──→|←── scanPeriod ──→|
      radio ON              radio OFF                radio ON
```

`betweenScanPeriod: 0` means continuous scanning. Adding a rest period saves battery — `scanPeriod: 5000, betweenScanPeriod: 3000` and `scanPeriod: 8000, betweenScanPeriod: 0` both update every ~8s, but the first uses less power because the radio is off for 3s each cycle.

> **Choosing `scanPeriod`:** The scan window must cover at least 2–3 advertising intervals to reliably detect a beacon. Most beacons advertise every 100ms–1000ms. If your beacons advertise at 1000ms (e.g. Moko M2 in battery-saving mode), use `scanPeriod: 3000` minimum — a 1.1s window will miss ~30–40% of scan cycles.

| Use case | scanPeriod | backgroundScanPeriod | betweenScanPeriod |
|---|---|---|---|
| Real-time foreground positioning | 1100 | 10000 | 0 |
| Standard indoor navigation | 1100 | 10000 | 0 |
| Background zone detection | 1100 | 10000 | 10000 |
| Battery-sensitive background | 1100 | 10000 | 30000 |

> **Android BLE scan throttle:** Android throttles BLE scanning if an app accumulates more than 5 scan starts in any 30-second window. **This applies to background/Doze scanning only.** In the foreground, `longScanForcingEnabled` (enabled automatically) makes the scanner run continuously without restarting — so `scanPeriod: 1100` in the foreground carries no throttle risk. For background scanning, use `backgroundScanPeriod >= 10 000ms` to avoid the throttle.

### `checkPermissions(): Promise<boolean>`

Returns `true` if all required permissions are granted. Does not request them.

### `startRanging(region) / stopRanging(region)`

Detects nearby beacons with RSSI and distance. Results are delivered once per `scanPeriod` (default: every 10s).

### `startMonitoring(region) / stopMonitoring(region)`

Detects region entry/exit. Battery efficient — use to wake up ranging when the user enters a zone.

### Ranging vs Monitoring — use one or the other per region

> **⚠️ Do not call `startRanging` and `startMonitoring` on the same region simultaneously.** When both are active on the same region, the monitoring state machine interferes with the ranging scan cycle: `onRegionStateChanged` oscillates rapidly between `inside` and `outside`, and every transition to `outside` silences ranging until the next `inside` event. The symptom — intermittent zero results while standing next to beacons — is identical to a hardware or permission failure, making it extremely difficult to diagnose.
>
> The library enforces this at runtime — calling either method while the other is already active on the same region identifier rejects the promise with a `RANGING_MONITORING_CONFLICT` error.

These are distinct use cases with different APIs:

| Use case | API | Notes |
|---|---|---|
| Foreground RSSI / distance measurement | `startRanging` only | Fast updates, real-time positioning |
| Background zone entry/exit detection | `startMonitoring` only | Battery efficient, wakes the app |
| Background ranging after zone entry | `startMonitoring` → on `inside` → `startRanging` | Sequential, not simultaneous |

```ts
// ❌ Do not combine on the same region — monitoring disrupts ranging
await Beacon.startRanging(region);
await Beacon.startMonitoring(region);

// ✅ Foreground positioning — ranging only
await Beacon.startRanging(region);

// ✅ Background ranging — monitoring triggers ranging on entry
Beacon.startMonitoring(region);
Beacon.onRegionStateChanged(({ state }) => {
  if (state === 'inside') Beacon.startRanging(region);
  if (state === 'outside') Beacon.stopRanging(region);
});
```

### Region filtering

`BeaconRegion` fields act as **hierarchical filters** in the underlying AltBeacon `Region` constructor. Omitting `major` or `minor` acts as a wildcard for that level:

| Fields provided | What it matches |
|---|---|
| `uuid` only | All beacons with that UUID (any major/minor) |
| `uuid` + `major` | All beacons with that UUID and major (any minor) |
| `uuid` + `major` + `minor` | Only the exact beacon |

The standard iBeacon deployment convention is:
- **UUID** — identifies the project or fleet (same for all beacons)
- **major** — identifies a group (e.g. a building floor)
- **minor** — identifies a specific physical beacon

For most use cases, range with **UUID only** to detect your entire fleet:

```ts
// Detects ALL beacons in your fleet
await Beacon.startRanging({
  identifier: 'my-fleet',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
});

// Detects only one specific beacon
await Beacon.startRanging({
  identifier: 'beacon-101',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
  major: 1,
  minor: 42,
});
```

### `onBeaconsRanged(callback)`

```ts
const sub = Beacon.onBeaconsRanged((event) => {
  // event.region  — the active region
  // event.beacons — array of detected beacons
});

sub.remove(); // unsubscribe
```

### `onRegionStateChanged(callback)`

```ts
const sub = Beacon.onRegionStateChanged((event) => {
  // event.region — the region
  // event.state  — 'inside' | 'outside'
});
```

### `onRangingFailed(callback)`

Emits a failure event when the native layer reports a runtime or asynchronous ranging error.

```ts
const sub = Beacon.onRangingFailed((event) => {
  // event.code       — stable error code, e.g. 'RANGING_ERROR'
  // event.message    — human-readable message
  // event.region     — region when available
  // event.nativeCode — native platform error code when available
  // event.domain     — iOS NSError domain when available
});
```

### `onMonitoringFailed(callback)`

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
  rssi: number;          // signal strength in dBm
  distance: number;      // estimated distance in meters (Kalman-filtered, or raw if filter disabled)
  rawDistance: number;   // raw unfiltered distance from AltBeacon — useful for calibration/debugging
  txPower: number;       // calibrated tx power of the beacon
  /** @warning May be randomized on Android 10+ — use uuid + major + minor as unique identifier instead. */
  macAddress: string;
  timestamp: number;
}
```

### `isIgnoringBatteryOptimizations(): Promise<boolean>`

Returns `true` if the app is excluded from Android battery optimization. When not excluded, Doze mode throttles BLE scanning with the screen off — even with `foregroundService: true`.

### `requestIgnoreBatteryOptimizations(): void`

Opens the Android system dialog asking the user to exclude this app from battery optimization. Call after `isIgnoringBatteryOptimizations()` returns `false`.

```ts
const exempt = await Beacon.isIgnoringBatteryOptimizations();
if (!exempt) {
  Beacon.requestIgnoreBatteryOptimizations();
}
```

### `openAutostartSettings(): void`

Opens the OEM-specific background permission settings page.

- **Xiaomi / HyperOS** — opens the Autostart management screen directly (`AutoStartManagementActivity`)
- **OPPO / Realme** — opens the privacy permissions screen
- **Vivo** — opens the background startup manager
- **Huawei** — opens the startup manager
- **Samsung** — opens the battery settings screen
- **Other OEMs** — falls back to the standard App Info screen

```ts
// Guide the user through OEM-specific background permissions
Beacon.openAutostartSettings();
```

> **⚠️ Do NOT call `openAutostartSettings()` during app initialization.** It navigates the user away from your app immediately, which triggers `IMPORTANCE_CHANGE` events that disrupt BLE scanning on Xiaomi/MIUI. Only call it from a deliberate user action — for example, an onboarding button or an in-app prompt. Show the user a dialog explaining what they are about to do before calling it.

## Background scanning

Background scanning on Android requires a foreground service — a persistent notification the user can see. Enable it via `configure({ foregroundService: true })`.

Without this, Android will kill the scanning process when the app goes to background. This is what most other beacon libraries for React Native never implemented.

## Doze mode and screen-off scanning

The foreground service keeps the process alive, but **Android Doze mode** (triggered when the screen turns off) can still throttle BLE radio access. The library addresses this in three ways:

1. **`SCAN_MODE_LOW_LATENCY`** — the library forces high-priority scan mode via `setBackgroundMode(false)`. OEM power managers (Xiaomi MIUI/HyperOS in particular) log `force suspend scan` for `LOW_POWER` scans on screen-off but treat `LOW_LATENCY` as an active high-priority scan that survives power restrictions.

2. **Partial wake lock** — automatically acquired when `foregroundService: true` is set. This prevents the CPU from entering deep sleep so BLE callbacks keep firing with the screen off.

3. **Battery optimization exemption** — Doze is further suppressed when the app is excluded from battery optimization. Check and request this at runtime:

```ts
const exempt = await Beacon.isIgnoringBatteryOptimizations();
if (!exempt) {
  Beacon.requestIgnoreBatteryOptimizations();
}
```

> **OEM battery managers:** Samsung, Xiaomi, Huawei, OPPO, and others add their own battery optimization layers on top of standard Doze. The wake lock and battery optimization exemption address standard Android Doze; use `openAutostartSettings()` to deep-link users into the OEM-specific screen where they can grant the remaining permissions.

## Xiaomi / HyperOS

Xiaomi devices running MIUI or HyperOS add extra restrictions on top of standard Doze that will stop BLE scanning with the screen off. All of the following are required simultaneously for reliable background scanning — missing any one will cause BLE to suspend ~20–30s after screen-off:

| Required | How |
|---|---|
| `foregroundService: true` | In `Beacon.configure()` |
| `aggressiveBackground: true` | In `Beacon.configure()` |
| Battery optimization exempt | `requestIgnoreBatteryOptimizations()` after permissions resolve |
| Autostart permission | `openAutostartSettings()` from a user-initiated action only |

```ts
// After permissions are granted:
const exempt = await Beacon.isIgnoringBatteryOptimizations();
if (!exempt) {
  Beacon.requestIgnoreBatteryOptimizations(); // system dialog
}

// From a user-initiated action only (NOT during app init — see openAutostartSettings warning):
Beacon.openAutostartSettings();
```

Specific restrictions on Xiaomi/HyperOS:

1. **Autostart** — MIUI suspends the BLE radio ~30s after screen-off if Autostart is not granted, regardless of foreground service or wake lock. This is the most common reason background scanning stops on Xiaomi.
2. **Battery restriction** — MIUI's per-app battery mode must be set to **No restrictions** (not *Optimized* or *Restricted*).

After `openAutostartSettings()` the user needs to:
- Enable the **Autostart** toggle for the app
- Go to **Settings > Apps > [App] > Battery** and select **No restrictions**

There is no way to grant these permissions programmatically — the user must do it manually. Guide them with a dialog before calling `openAutostartSettings()` so they know what to look for.

## Aggressive background mode

Some OEM devices (Xiaomi/HyperOS, some Samsung and Huawei models) suspend BLE scanning ~20s after the screen turns off even when a foreground service is running. Enable `aggressiveBackground` to fight this:

```ts
Beacon.configure({
  foregroundService: true,
  aggressiveBackground: true,
});
```

This enables three additional mechanisms:

| Mechanism | What it does |
|---|---|
| **Scan watchdog** | Restarts all active ranging regions every 20s, resetting the OEM scan-suspend timer before it fires |
| **PARTIAL_WAKE_LOCK** | Keeps the CPU awake so BLE scan callbacks fire reliably with the screen off |
| **Forced LOW_LATENCY** | Sets `SCAN_MODE_LOW_LATENCY` permanently — prevents MIUI from downgrading to LOW_POWER, which it suspends more aggressively |

**Default is `false`.** Only enable if you've confirmed that background scanning stops without it on your target device. These measures increase battery consumption.

> **Note:** `aggressiveBackground` does not replace `requestIgnoreBatteryOptimizations()` or `openAutostartSettings()` — those are still needed on Xiaomi. Aggressive mode fights the BLE driver throttle; battery optimization and autostart are separate permission layers.

## Platform notes

### Android
- Requires `ACCESS_BACKGROUND_LOCATION` for background scanning (Android 10+)
- Requires `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` (Android 12+)
- Foreground service keeps scanning alive even when the app is killed

### iOS

Add to `Info.plist`:

```xml
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>This app uses your location to detect nearby beacons.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>This app uses your location to detect nearby beacons.</string>
```

Enable **Location updates** background mode in Xcode → your target → Signing & Capabilities → Background Modes.

**Background ranging on iOS** works differently from Android. iOS does not support continuous background ranging — instead, use `startMonitoring()` to wake the app when the user enters a region, then start ranging from that callback. iOS gives ~10 seconds of execution time per region event.

```ts
// Recommended iOS background pattern
Beacon.startMonitoring({ identifier: 'my-region', uuid: '...' });

const sub = Beacon.onRegionStateChanged(({ state }) => {
  if (state === 'inside') {
    // iOS woke the app — start ranging for the ~10s window
    Beacon.startRanging({ identifier: 'my-region', uuid: '...' });
  }
});
```

**iOS-specific behaviour:**
- `foregroundService`, `aggressiveBackground`, `scanPeriod`, `backgroundScanPeriod`, `betweenScanPeriod` are Android-only — silently ignored on iOS
- `isIgnoringBatteryOptimizations()` always returns `true` on iOS
- `requestIgnoreBatteryOptimizations()` and `openAutostartSettings()` are no-ops on iOS
- `macAddress` is always an empty string — iOS does not expose MAC addresses (privacy restriction since iOS 13)
- `txPower` is always `-59` — `CLBeacon` does not expose the raw tx power value

## Troubleshooting

### 0 beacons or intermittent detection after reinstall

Two `BeaconService` instances may be competing for the BLE scanner. This happens when both the example app and your production app are installed on the same device. Results alternate between services or one silently starves the other — the symptom looks identical to a hardware or permission failure.

Diagnose:
```sh
adb logcat -v time BeaconService:V *:S
# If you see two different PIDs, you have competing instances
```

Fix:
```sh
adb shell am force-stop com.beacon.example
adb uninstall com.beacon.example
```

### `SecurityException` on fresh install (SDK 34+)

`configure()` is being called before permissions resolve. Await `requestPermissions()` before calling `Beacon.configure()`. See [Required call order](#required-call-order).

### Ranging always returns 0 beacons despite beacons being nearby

Check if `startMonitoring()` was previously called on the same region as `startRanging()`. If the conflict was introduced after this guard was added, the call will now reject with `RANGING_MONITORING_CONFLICT`. See [Ranging vs Monitoring](#ranging-vs-monitoring--use-one-or-the-other-per-region).

### Scanning stops ~20–30s after screen off (Xiaomi/HyperOS)

`aggressiveBackground: true` alone is not sufficient. See the [Xiaomi / HyperOS](#xiaomi--hyperos) section — all four items in the checklist are required simultaneously.

### No foreground service notification on Android 13+

Add `POST_NOTIFICATIONS` to your runtime permission request (requires `Platform.Version >= 33`) and to `app.json` / `AndroidManifest.xml`. Without this, the notification is silently suppressed and some OEMs will kill the foreground service.

### `configure()` called twice at startup

Visible in logcat as two `set scan intervals received` lines. Guard your async start function with a `ref`, not a state variable — state updates are batched and async, so they cannot prevent re-entrant calls within the same render cycle. A `ref` is synchronous:

```ts
const startingRef = useRef(false);

const start = useCallback(async () => {
  if (startingRef.current) return;
  startingRef.current = true;
  try {
    // ... configure and startRanging
  } finally {
    startingRef.current = false; // always reset, even on error
  }
}, []);
```

## License

MIT
