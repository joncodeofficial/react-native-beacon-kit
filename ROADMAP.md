# Roadmap & Ideas

Current state: Android V1 working — ranging, monitoring, background scanning, Kalman filter.

---

## API — things to revisit

### Proximity thresholds should be user-defined
Removed `proximity` field (immediate/near/far) because the thresholds are arbitrary and
depend on the use case and beacon calibration. If re-added, it should be configurable:

```ts
Beacon.configure({
  proximityThresholds: {
    immediate: 0.5,
    near: 3.0,
  }
})
```

### configure() should return a Promise
Currently `void`. If the BeaconManager fails to initialize (e.g. Bluetooth off),
there is no way to know. A Promise would let the developer handle it.

```ts
await Beacon.configure(config); // can reject with reason
```

### Region-level callbacks
Currently `onBeaconsRanged` fires for all regions. For apps monitoring multiple zones,
filtering by region identifier would be useful:

```ts
Beacon.onBeaconsRanged('zone-a', (event) => { ... });
```

### getActiveRegions()
No way to query which regions are currently being ranged or monitored.
Useful for cleanup on app restart.

```ts
const regions = await Beacon.getRangedRegions();
const monitored = await Beacon.getMonitoredRegions();
```

---

## V2 — Eddystone-UID support

Google's beacon format. Not as dominant as iBeacon/AltBeacon but present in airports,
modern retail, and enterprise deployments.

Key difference from iBeacon: no major/minor — uses `namespace` (10 bytes) + `instance` (6 bytes).

```ts
// Eddystone-UID beacon would look like:
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
- Add Eddystone-UID parser to `getOrCreateBeaconManager()`
- Extend `Beacon` type to accommodate both formats (union type or discriminated union)
- Decide if `major/minor` fields become optional when type is eddystone-uid
- Update `BeaconRegion` to support Eddystone namespace filtering

Parser layout for AltBeacon library:
```kotlin
BeaconParser().setBeaconLayout(BeaconParser.EDDYSTONE_UID_LAYOUT)
```

Decision needed: whether to keep a single `Beacon` type or split into `IBeacon | EddystoneBeacon`.
A discriminated union is cleaner but breaks backwards compatibility for existing users.

---

## V2 — Signal smoothing

### Moving average filter
Simpler alternative to Kalman for cases where low latency is not critical.
Average of last N readings per beacon.

```ts
Beacon.configure({
  smoothing: { type: 'moving-average', window: 5 }
})
```

### Nearest beacon
Given a list of detected beacons, return the closest one.
Simple but useful for wayfinding and zone detection.

```ts
const nearest = Beacon.getNearestBeacon(beacons);
```

### Signal stability score
Expose how stable the RSSI readings are for a given beacon.
Useful for the developer to decide when to trust the distance value.

---

## V3 — Positioning

### Trilateration
Given 3+ beacons with known positions, estimate the user's (x, y) position.
Requires the developer to provide a floor map with beacon coordinates.

```ts
const position = Beacon.estimatePosition(beacons, beaconMap);
// { x: 12.4, y: 8.1, confidence: 0.87 }
```

### Zone detection
Map beacon minor IDs to named zones. Fire an event when the user moves between zones.

```ts
Beacon.configure({
  zones: [
    { name: 'entrance', beacons: [{ major: 1, minor: 1 }] },
    { name: 'hall-a',   beacons: [{ major: 1, minor: 2 }, { major: 1, minor: 3 }] },
  ]
});

Beacon.onZoneChanged((event) => {
  // event.zone — 'entrance' | 'hall-a' | ...
});
```

---

## V4 — C++ engine (Nitro Modules)

Move the positioning math (trilateration, Kalman, smoothing) to a C++ layer
shared between Android and iOS via Nitro Modules / JSI.

Benefits:
- Single implementation for both platforms
- No JS thread involvement for math-heavy operations
- Consistent results across platforms

This is only worth doing once the TypeScript positioning engine is validated.
Do not do this prematurely.

---

## iOS — pending

iOS implementation not started. Notes for when it begins:

- Use CoreLocation — `CLLocationManager` + `CLBeaconRegion`
- Background ranging is limited (~10s bursts) — monitoring is the reliable primitive
- Request `NSLocationAlwaysAndWhenInUseUsageDescription`
- Enable "Location updates" background mode in Xcode
- The ranging API should mirror Android exactly so JS code is platform-agnostic
- Permissions: same approach — verify only, do not request

---

## Distribution

- [ ] Remove debug `Log.d` calls before publishing
- [ ] Add `CHANGELOG.md`
- [ ] Test on Android 12, 13, 14
- [ ] Test with multiple beacon manufacturers
- [ ] Publish to npm as `react-native-beacon`
