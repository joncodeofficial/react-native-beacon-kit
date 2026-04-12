# react-native-beacon-kit

iBeacon / AltBeacon library for React Native built on New Architecture (TurboModules + JSI).
Real background scanning on Android via foreground service — what other libraries promised but never delivered.

> **Platform support:** Android fully supported. iOS in development.

## Features

- New Architecture (TurboModules + JSI) — no legacy bridge
- Real background scanning on Android via foreground service
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
        "android.permission.FOREGROUND_SERVICE_LOCATION"
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

```ts
import Beacon from 'react-native-beacon-kit';

// Configure once on app start
Beacon.configure({
  betweenScanPeriod: 0,
  foregroundService: true,   // required for real background scanning
  foregroundServiceNotification: {
    title: 'My App',
    text: 'Scanning for nearby assets...',
  },
  kalmanFilter: { enabled: true },
});

// Check permissions (does not request them)
const granted = await Beacon.checkPermissions();

// Start ranging
await Beacon.startRanging({
  identifier: 'my-region',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
});

// Listen for beacons
const sub = Beacon.onBeaconsRanged((event) => {
  event.beacons.forEach((beacon) => {
    console.log(beacon.uuid, beacon.major, beacon.minor);
    console.log(beacon.distance);      // meters (Kalman-filtered)
    console.log(beacon.rawDistance);   // meters (raw from AltBeacon)
    console.log(beacon.rssi);          // dBm
    /** @warning May be randomized on Android 10+ */
    console.log(beacon.macAddress);
  });
});

// Cleanup
sub.remove();
await Beacon.stopRanging({ identifier: 'my-region', uuid: '...' });
```

## API

### `configure(config)`

Call once before starting any scan. All fields are optional.

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
});
```

`configure()` can be called while a scan is already running — updated scan periods take effect immediately.

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
| Real-time positioning | 10000 | 10000 | 0 |
| Standard indoor navigation | 10000 | 10000 | 0 |
| Background zone detection | 10000 | 10000 | 10000 |
| Battery-sensitive background | 10000 | 10000 | 30000 |

> **Android BLE scan throttle:** Android throttles BLE scanning if an app accumulates more than 5 scan starts in any 30-second window. This applies in background/Doze mode even with a foreground service running. A `scanPeriod` below ~6 000ms will trigger the throttle, causing scans to go silent. **Use `scanPeriod >= 10 000ms` for reliable background scanning.**

### `checkPermissions(): Promise<boolean>`

Returns `true` if all required permissions are granted. Does not request them.

### `startRanging(region) / stopRanging(region)`

Detects nearby beacons with RSSI and distance. Results are delivered once per `scanPeriod` (default: every 10s).

### `startMonitoring(region) / stopMonitoring(region)`

Detects region entry/exit. Battery efficient — use to wake up ranging when the user enters a zone.

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

Xiaomi devices running MIUI or HyperOS add two extra restrictions on top of standard Doze that will stop BLE scanning with the screen off even when the foreground service and wake lock are active:

1. **Autostart** — MIUI suspends the BLE radio ~30s after screen-off if Autostart is not granted, regardless of foreground service or wake lock. This is the most common reason background scanning stops on Xiaomi.
2. **Battery restriction** — MIUI's per-app battery mode must be set to **No restrictions** (not *Optimized* or *Restricted*).

Call both in your onboarding flow:

```ts
// 1. Standard Android battery optimization
const exempt = await Beacon.isIgnoringBatteryOptimizations();
if (!exempt) {
  Beacon.requestIgnoreBatteryOptimizations();
}

// 2. Xiaomi Autostart (and equivalent on other OEMs)
// Opens the Autostart management screen directly on Xiaomi/HyperOS
Beacon.openAutostartSettings();
```

After `openAutostartSettings()` the user needs to:
- Enable the **Autostart** toggle for the app
- Go to **Settings > Apps > [App] > Battery** and select **No restrictions**

There is no way to grant these permissions programmatically — the user must do it manually. Guide them with a dialog before calling `openAutostartSettings()` so they know what to look for.

## Platform notes

### Android
- Requires `ACCESS_BACKGROUND_LOCATION` for background scanning (Android 10+)
- Requires `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` (Android 12+)
- Foreground service keeps scanning alive even when the app is killed

### iOS
> iOS support is in development. Android is fully supported.

When iOS is released, it will require:
- `NSLocationAlwaysAndWhenInUseUsageDescription` in `Info.plist`
- `NSLocationWhenInUseUsageDescription` in `Info.plist`
- "Location updates" background mode enabled in Xcode capabilities

**Background ranging on iOS** works differently from Android. iOS does not support
continuous background ranging — instead, use `startMonitoring()` to wake the app
when the user enters a region, then start ranging from that callback.
iOS gives ~10 seconds of execution time per region event.

## License

MIT
