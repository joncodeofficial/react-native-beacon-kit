# Roadmap

## Current status

The library is already strong on the core React Native iBeacon / AltBeacon flow:

- [x] Android ranging and monitoring
- [x] iOS ranging and monitoring
- [x] Real Android background scanning via foreground service
- [x] `aggressiveBackground` fallback for restrictive OEMs
- [x] Kalman filter
- [x] Configurable scan intervals
- [x] Permission check API
- [x] New Architecture (TurboModules + JSI)
- [x] Failure events: `onRangingFailed()` / `onMonitoringFailed()`
- [x] Hooks-first React API:
  - `useBeaconRanging()`
  - `useBeaconMonitoring()`
  - `useMonitorThenRange()`
- [x] Region query helpers:
  - `Beacon.getRangedRegions()`
  - `Beacon.getMonitoredRegions()`
- [x] JS API coverage
- [x] Hook tests with `@testing-library/react-native`
- [x] Tests running in CI and release workflows
- [x] npm package published as `react-native-beacon-kit`

---

## Next priority: Reliability and validation

This is the most important track before adding more surface area.

### Cross-platform confidence

- [ ] Add iOS build validation in CI
- [ ] Validate on real iPhone hardware
- [ ] Verify Android permissions and behavior on Android 12, 13, and 14
- [ ] Test with multiple beacon vendors:
  - Estimote
  - Kontakt.io
  - Minew

### Scanner and environment diagnostics

- [ ] Add `Beacon.getScannerState()` or `Beacon.getEnvironmentState()`
- [ ] Report actionable state such as:
  - Bluetooth enabled / disabled
  - Location services enabled / disabled
  - Required permissions granted / missing
  - Background permission granted / missing
- [ ] Consider `onScannerStateChanged()` for apps that need to react to runtime changes

### Test strategy

- [x] Contract tests for the public JS API
- [x] Hook behavior tests
- [ ] Add stronger cross-platform confidence beyond JS contract tests
- [ ] Add a documented real-device validation matrix for releases

---

## Next priority: Protocol expansion

### Eddystone-UID support

This is the biggest missing capability at the protocol level.

Target outcome:

```ts
{
  type: 'eddystone-uid',
  namespace: 'a1b23c45d67e9fab...',
  instance: '0034567890ab',
  rssi: -65,
  distance: 1.2,
  txPower: -59,
  macAddress: '...',
  timestamp: 123456789,
}
```

Work required:

- [ ] Add Eddystone parser support on Android
- [ ] Design the public reading model first:
  - discriminated union such as `IBeaconReading | EddystoneUidReading`
  - avoid forcing Eddystone into the current `uuid / major / minor` shape
- [ ] Update region/filter types to support Eddystone namespace and instance filtering
- [ ] Document the platform story clearly:
  - Android support expectations
  - iOS limitations or alternative approach if parity is not possible

---

## Mock Provider for testing

Allows injecting fake beacons via code so developers can test UI logic without physical hardware.

- [ ] Design a `MockBeaconProvider` or equivalent injection API
- [ ] Support simulating ranging events with configurable RSSI and distance
- [ ] Support simulating region enter/exit events
- [ ] Document how to use it with Jest and `@testing-library/react-native`

---

## Documentation: background wake-up and state hydration

The library supports background scanning, but there is no guide explaining what to do when the OS kills the app and a beacon event wakes it back up.

- [ ] Write a guide covering the full background wake-up lifecycle on Android and iOS
- [ ] Explain how to hydrate Redux or Zustand state when the app starts in background mode
- [ ] Cover the `aggressiveBackground` path specifically and its edge cases

---

## API and core improvements

These are useful, but below reliability and Eddystone.

- [ ] Region-scoped subscription helpers such as `Beacon.onBeaconsRanged('zone-a', callback)`
- [ ] Moving average filter as an alternative to Kalman
- [ ] `Beacon.getNearestBeacon(beacons)`
- [ ] `useNearestBeacon(region)`
- [ ] `useBeaconMap(beaconMap)`
- [x] Expo config plugin for automatic permission injection
- [x] Full TypeScript strict mode across the library

---

## Longer-term ideas

### Trilateration

Given 3+ beacons with known positions, estimate the user's `(x, y)` location.

```ts
const position = Beacon.estimatePosition(beacons, beaconMap);
// { x: 12.4, y: 8.1, confidence: 0.87 }
```

### Zone detection

Map beacon identifiers to named zones and emit transitions between them.

```ts
Beacon.configure({
  zones: [
    { name: 'entrance', beacons: [{ major: 1, minor: 1 }] },
    {
      name: 'hall-a',
      beacons: [
        { major: 1, minor: 2 },
        { major: 1, minor: 3 },
      ],
    },
  ],
});

Beacon.onZoneChanged((event) => {
  // event.zone
});
```

---

## Release checklist

- [x] Remove debug `Log.d` calls
- [x] Add `CHANGELOG.md`
- [x] Run unit and hook tests in CI
- [ ] Add iOS build validation in CI
- [ ] Validate Android permission behavior on Android 12, 13, and 14
- [ ] Validate on real iOS devices
- [ ] Test with multiple beacon manufacturers
- [ ] Maintain a documented hardware validation matrix for release confidence
