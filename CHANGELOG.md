# Changelog

All notable changes to this project will be documented in this file.

## [0.7.2](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.7.1...v0.7.2) (2026-04-17)

### Bug Fixes

* stabilize hook callbacks to prevent spurious stop/start cycles on re-render ([37cb42a](https://github.com/joncodeofficial/react-native-beacon-kit/commit/37cb42a1993b66aad7556a19a658fad219694105))

## [0.7.1](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.7.0...v0.7.1) (2026-04-17)

### Bug Fixes

* update package.json for correct module exports and types paths ([f8bc2dd](https://github.com/joncodeofficial/react-native-beacon-kit/commit/f8bc2ddcf284702723fb95ee3b5812e61194493d))

## [0.7.0](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.6.3...v0.7.0) (2026-04-14)

### Features

* add Expo config plugin for Android and iOS beacon permissions ([ef71a2c](https://github.com/joncodeofficial/react-native-beacon-kit/commit/ef71a2c60bb7233f87078bb73b8ed4a1b22344ce))

## [0.6.3](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.6.2...v0.6.3) (2026-04-14)

## [0.6.2](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.6.1...v0.6.2) (2026-04-13)

## [0.6.1](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.6.0...v0.6.1) (2026-04-13)

## [0.6.0](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.5.0...v0.6.0) (2026-04-13)

### Features

* add React beacon hooks ([e130bd2](https://github.com/joncodeofficial/react-native-beacon-kit/commit/e130bd213752b71918641c8f45b6287a2a148ee5))

## [0.5.0](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.4.1...v0.5.0) (2026-04-13)

### Features

* add beacon failure events ([df8c240](https://github.com/joncodeofficial/react-native-beacon-kit/commit/df8c24099c2980b7756a6fb3fc0cd26fe94e9208))

## [0.4.1](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.4.0...v0.4.1) (2026-04-13)

### Bug Fixes

* **android:** register range/monitor notifiers once per module instance ([0ad47e3](https://github.com/joncodeofficial/react-native-beacon-kit/commit/0ad47e39a4f19d0dc50b6805f5d4a24ac7740338))

## [0.4.0](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.3.1...v0.4.0) (2026-04-13)

### Features

* guard startRanging/startMonitoring conflict, add getRangedRegions/getMonitoredRegions, restructure example ([2e83c28](https://github.com/joncodeofficial/react-native-beacon-kit/commit/2e83c28146b5c3ee6effedd056bfe394bccd6dcd))

## [0.3.1](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.3.0...v0.3.1) (2026-04-13)

### Bug Fixes

* add POST_NOTIFICATIONS permission for foreground service notifications on Android 13+ ([d1f2557](https://github.com/joncodeofficial/react-native-beacon-kit/commit/d1f25573c096ce23fdb9103eb41b11a6b0b20032))

## [0.3.0](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.2.0...v0.3.0) (2026-04-12)

### Features

* implement iOS support via CLLocationManager (ranging + monitoring + Kalman filter) ([b36ac41](https://github.com/joncodeofficial/react-native-beacon-kit/commit/b36ac4179902dd99de83ef5c455670360f6692ed))

## [0.2.0](https://github.com/joncodeofficial/react-native-beacon-kit/compare/v0.1.3...v0.2.0) (2026-04-12)

### Features

* **android:** aggressiveBackground mode with watchdog and screen-aware scan periods ([30c8c1f](https://github.com/joncodeofficial/react-native-beacon-kit/commit/30c8c1f332598815757358e7000876e079db1d81))
* **android:** reliable background scanning with LOW_LATENCY scan mode ([ce87918](https://github.com/joncodeofficial/react-native-beacon-kit/commit/ce87918d45e13142823a699275f8d906b4067868))
