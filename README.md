# react-native-indoor-beacon

iBeacon library for React Native built on New Architecture (TurboModules + JSI).
Real background scanning on Android via foreground service — what other libraries promised but never delivered.

## Features

- New Architecture (TurboModules + JSI) — no legacy bridge
- Real background scanning on Android via foreground service
- Kalman filter for stable distance readings (optional)
- Configurable scan intervals
- Does not request permissions — respects your app's UX flow
- AltBeacon 2.21.2 (Android), CoreLocation (iOS)

## Installation

```sh
npm install react-native-indoor-beacon
```

### Android permissions

Add to your `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

Request them at runtime with [react-native-permissions](https://github.com/zoontek/react-native-permissions) before calling any scanning method.

## Usage

```ts
import IndoorBeacon from 'react-native-indoor-beacon';

// Configure once on app start
IndoorBeacon.configure({
  scanPeriod: 1100,
  betweenScanPeriod: 0,
  foregroundService: true,   // required for real background scanning
  kalmanFilter: { enabled: true },
});

// Check permissions (does not request them)
const granted = await IndoorBeacon.checkPermissions();

// Start ranging
await IndoorBeacon.startRanging({
  identifier: 'my-region',
  uuid: 'FDA50693-A4E2-4FB1-AFCF-C6EB07647825',
});

// Listen for beacons
const sub = IndoorBeacon.onBeaconsRanged((event) => {
  event.beacons.forEach((beacon) => {
    console.log(beacon.uuid, beacon.major, beacon.minor);
    console.log(beacon.distance);  // meters
    console.log(beacon.rssi);      // dBm
  });
});

// Cleanup
sub.remove();
await IndoorBeacon.stopRanging({ identifier: 'my-region', uuid: '...' });
```

## API

### `configure(config)`

Call once before starting any scan. All fields are optional.

```ts
IndoorBeacon.configure({
  scanPeriod?: number,          // active scan duration in ms (default: 1100)
  betweenScanPeriod?: number,   // rest between scans in ms (default: 0)
  foregroundService?: boolean,  // enable real background scanning (default: false)
  kalmanFilter?: {
    enabled: boolean,
    q?: number,   // process noise — how much you trust movement (default: 0.008)
    r?: number,   // measurement noise — how much you trust RSSI (default: 0.1)
  },
});
```

### `checkPermissions(): Promise<boolean>`

Returns `true` if all required permissions are granted. Does not request them.

### `startRanging(region) / stopRanging(region)`

Detects nearby beacons with RSSI and distance (~every 1s).

### `startMonitoring(region) / stopMonitoring(region)`

Detects region entry/exit. Battery efficient — use to wake up ranging when the user enters a zone.

### `onBeaconsRanged(callback)`

```ts
const sub = IndoorBeacon.onBeaconsRanged((event) => {
  // event.region  — the active region
  // event.beacons — array of detected beacons
});

sub.remove(); // unsubscribe
```

### `onRegionStateChanged(callback)`

```ts
const sub = IndoorBeacon.onRegionStateChanged((event) => {
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
  rssi: number;       // signal strength in dBm
  distance: number;   // estimated distance in meters
  txPower: number;    // calibrated tx power of the beacon
  /** @warning May be randomized on Android 10+ — use uuid + major + minor as unique identifier instead. */
  macAddress: string;
  timestamp: number;
}
```

## Background scanning

Background scanning on Android requires a foreground service — a persistent notification the user can see.
Enable it via `configure({ foregroundService: true })`.

Without this, Android will kill the scanning process when the app goes to background.
This is what most other beacon libraries for React Native never implemented.

## Platform notes

### Android
- Requires `ACCESS_BACKGROUND_LOCATION` for background scanning (Android 10+)
- Requires `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` (Android 12+)
- Foreground service keeps scanning alive even when the app is killed

### iOS
- Background ranging is limited by iOS — use monitoring to wake the app
- Add `NSLocationAlwaysAndWhenInUseUsageDescription` to `Info.plist`
- Enable "Location updates" background mode in Xcode capabilities

## License

MIT
