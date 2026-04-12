# Roadmap

## V1 — Android (complete)

- [x] iBeacon + AltBeacon ranging and monitoring
- [x] Real background scanning via foreground service (+ `aggressiveBackground` mode for OEM devices that suspend BLE scanning)
- [x] Kalman filter for stable distance readings
- [x] Configurable scan intervals
- [x] Permission check (no request — developer's responsibility)
- [x] New Architecture (TurboModules + JSI)

---

## V2 — iOS + API improvements (planned)

### iOS

- [x] `CLLocationManager` + `CLBeaconRegion` ranging and monitoring
- [x] Background monitoring with ~10s ranging bursts on region entry
- [x] Permissions: `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationWhenInUseUsageDescription`
- [x] "Location updates" background mode in Xcode capabilities
- [x] API mirrors Android exactly — JS code is platform-agnostic

### Eddystone-UID support

Google's beacon format. Present in airports, enterprise, and modern retail deployments.
No major/minor — uses `namespace` (10 bytes) + `instance` (6 bytes).

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

- Add `BeaconParser.EDDYSTONE_UID_LAYOUT` to `getOrCreateBeaconManager()`
- Extend `Beacon` type — discriminated union `IBeacon | EddystoneBeacon` or optional fields
- Update `BeaconRegion` to support Eddystone namespace filtering

### API additions

- [ ] Region-scoped ranging callback: `Beacon.onBeaconsRanged('zone-a', callback)`
- [ ] `Beacon.getRangedRegions()` / `Beacon.getMonitoredRegions()` — useful for cleanup on restart
- [ ] Moving average filter as alternative to Kalman: `configure({ smoothing: { type: 'moving-average', window: 5 } })`
- [ ] `Beacon.getNearestBeacon(beacons)` — returns closest beacon from a list

---

## V3 — Positioning (planned)

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
  // event.zone — 'entrance' | 'hall-a' | ...
});
```

---

## V4 — C++ engine via Nitro Modules (future)

Move positioning math (trilateration, Kalman, smoothing) to a shared C++ layer
via Nitro Modules / JSI. Single implementation for both platforms, no JS thread
involvement for math-heavy operations.

Only worth doing once the TypeScript positioning engine in V3 is validated.

---

## Release checklist

- [x] Remove debug `Log.d` calls
- [x] Add `CHANGELOG.md`
- [ ] Verify permissions on Android 12, 13, 14 (`BLUETOOTH_SCAN`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE_LOCATION`)
- [ ] Test with multiple beacon manufacturers (Estimote, Kontakt.io, Minew)
- [ ] Implement iOS (V2)
- [x] Publish to npm as `react-native-beacon-kit`
