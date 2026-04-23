#import "Beacon.h"
#import <CoreLocation/CoreLocation.h>

// ---------------------------------------------------------------------------
// Kalman filter state — one instance per beacon key ("uuid:major:minor")
// ---------------------------------------------------------------------------
@interface BeaconKalmanState : NSObject
@property (nonatomic, assign) double estimate;
@property (nonatomic, assign) double errorCovariance;
- (instancetype)initWithMeasurement:(double)measurement;
@end

@implementation BeaconKalmanState
- (instancetype)initWithMeasurement:(double)measurement {
    if (self = [super init]) {
        _estimate = measurement;
        _errorCovariance = 1.0;
    }
    return self;
}
@end

// ---------------------------------------------------------------------------
// Beacon module
// ---------------------------------------------------------------------------
@interface Beacon () <CLLocationManagerDelegate>
@property (nonatomic, strong) CLLocationManager *locationManager;
// Kalman filter config
@property (nonatomic, assign) BOOL   kalmanEnabled;
@property (nonatomic, assign) double kalmanQ;
@property (nonatomic, assign) double kalmanR;
@property (nonatomic, strong) NSMutableDictionary<NSString *, BeaconKalmanState *> *kalmanStates;
// identifier → CLBeaconIdentityConstraint (for stopRanging)
@property (nonatomic, strong) NSMutableDictionary<NSString *, CLBeaconIdentityConstraint *> *rangingConstraints;
// identifier → CLBeaconRegion (for stopMonitoring)
@property (nonatomic, strong) NSMutableDictionary<NSString *, CLBeaconRegion *> *monitoringRegions;
@end

@implementation Beacon

- (instancetype)init {
    if (self = [super init]) {
        _kalmanEnabled      = NO;
        _kalmanQ            = 0.008;
        _kalmanR            = 0.1;
        _kalmanStates       = [NSMutableDictionary new];
        _rangingConstraints = [NSMutableDictionary new];
        _monitoringRegions  = [NSMutableDictionary new];

        // CLLocationManager must be created on a thread with a run loop (main thread).
        // RN initializes TurboModules on the main thread in practice, but guard anyway.
        dispatch_block_t setup = ^{
            self->_locationManager          = [[CLLocationManager alloc] init];
            self->_locationManager.delegate = self;
        };
        if ([NSThread isMainThread]) {
            setup();
        } else {
            dispatch_sync(dispatch_get_main_queue(), setup);
        }
    }
    return self;
}

+ (NSString *)moduleName { return @"Beacon"; }

// Events emitted to JS
- (NSArray<NSString *> *)supportedEvents {
    return @[@"onBeaconsRanged", @"onRegionStateChanged", @"onRangingFailed", @"onMonitoringFailed"];
}

// TurboModule JSI bridge — required by New Architecture
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
    return std::make_shared<facebook::react::NativeBeaconSpecJSI>(params);
}

// ---------------------------------------------------------------------------
// checkPermissions
// ---------------------------------------------------------------------------
- (void)checkPermissions:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    CLAuthorizationStatus status;
    if (@available(iOS 14.0, *)) {
        status = self.locationManager.authorizationStatus;
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        status = [CLLocationManager authorizationStatus];
#pragma clang diagnostic pop
    }
    BOOL granted = (status == kCLAuthorizationStatusAuthorizedAlways ||
                    status == kCLAuthorizationStatusAuthorizedWhenInUse);
    resolve(@(granted));
}

// ---------------------------------------------------------------------------
// configure
// ---------------------------------------------------------------------------
- (void)configure:(NSDictionary *)config {
    NSDictionary *kalman = config[@"kalmanFilter"];
    if (kalman) {
        _kalmanEnabled = [kalman[@"enabled"] boolValue];
        if (kalman[@"q"]) _kalmanQ = [kalman[@"q"] doubleValue];
        if (kalman[@"r"]) _kalmanR = [kalman[@"r"] doubleValue];
        [_kalmanStates removeAllObjects];
    }
    // foregroundService, aggressiveBackground, scanPeriod, backgroundScanPeriod,
    // and betweenScanPeriod are Android-specific — silently ignored on iOS.
}

// ---------------------------------------------------------------------------
// startRanging / stopRanging
// ---------------------------------------------------------------------------
- (void)startRanging:(NSDictionary *)region
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
    NSString *identifier = region[@"identifier"];
    NSString *uuidString = region[@"uuid"];
    if (!identifier || !uuidString) {
        reject(@"RANGING_ERROR", @"identifier and uuid are required", nil);
        return;
    }

    // Guard: ranging and monitoring on the same region interfere with each other.
    if (_monitoringRegions[identifier]) {
        reject(@"RANGING_MONITORING_CONFLICT",
               [NSString stringWithFormat:
                @"Cannot call startRanging on region '%@' — startMonitoring is already active on the same region. "
                @"They interfere with each other. Call stopMonitoring first, or use a different region identifier.",
                identifier],
               nil);
        return;
    }
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:uuidString];
    if (!uuid) {
        reject(@"RANGING_ERROR", ([NSString stringWithFormat:@"Invalid UUID: %@", uuidString]), nil);
        return;
    }

    NSNumber *majorNum = region[@"major"];
    NSNumber *minorNum = region[@"minor"];
    CLBeaconIdentityConstraint *constraint;

    if (majorNum && minorNum) {
        constraint = [[CLBeaconIdentityConstraint alloc]
                      initWithUUID:uuid
                      major:(CLBeaconMajorValue)majorNum.unsignedShortValue
                      minor:(CLBeaconMinorValue)minorNum.unsignedShortValue];
    } else if (majorNum) {
        constraint = [[CLBeaconIdentityConstraint alloc]
                      initWithUUID:uuid
                      major:(CLBeaconMajorValue)majorNum.unsignedShortValue];
    } else {
        constraint = [[CLBeaconIdentityConstraint alloc] initWithUUID:uuid];
    }

    _rangingConstraints[identifier] = constraint;

    dispatch_async(dispatch_get_main_queue(), ^{
        [self.locationManager startRangingBeaconsSatisfyingConstraint:constraint];
        resolve(nil);
    });
}

- (void)stopRanging:(NSDictionary *)region
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
    NSString *identifier = region[@"identifier"];
    CLBeaconIdentityConstraint *constraint = _rangingConstraints[identifier];
    if (constraint) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.locationManager stopRangingBeaconsSatisfyingConstraint:constraint];
            [self->_rangingConstraints removeObjectForKey:identifier];
            resolve(nil);
        });
    } else {
        resolve(nil);
    }
}

// ---------------------------------------------------------------------------
// startMonitoring / stopMonitoring
// ---------------------------------------------------------------------------
- (void)startMonitoring:(NSDictionary *)region
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
    NSString *identifier = region[@"identifier"];
    NSString *uuidString = region[@"uuid"];
    if (!identifier || !uuidString) {
        reject(@"MONITORING_ERROR", @"identifier and uuid are required", nil);
        return;
    }

    // Guard: same conflict — stop ranging first before monitoring the same region.
    if (_rangingConstraints[identifier]) {
        reject(@"RANGING_MONITORING_CONFLICT",
               [NSString stringWithFormat:
                @"Cannot call startMonitoring on region '%@' — startRanging is already active on the same region. "
                @"They interfere with each other. Call stopRanging first, or use a different region identifier.",
                identifier],
               nil);
        return;
    }
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:uuidString];
    if (!uuid) {
        reject(@"MONITORING_ERROR", ([NSString stringWithFormat:@"Invalid UUID: %@", uuidString]), nil);
        return;
    }

    NSNumber *majorNum = region[@"major"];
    NSNumber *minorNum = region[@"minor"];
    CLBeaconRegion *beaconRegion;

    if (majorNum && minorNum) {
        beaconRegion = [[CLBeaconRegion alloc]
                        initWithUUID:uuid
                        major:(CLBeaconMajorValue)majorNum.unsignedShortValue
                        minor:(CLBeaconMinorValue)minorNum.unsignedShortValue
                        identifier:identifier];
    } else if (majorNum) {
        beaconRegion = [[CLBeaconRegion alloc]
                        initWithUUID:uuid
                        major:(CLBeaconMajorValue)majorNum.unsignedShortValue
                        identifier:identifier];
    } else {
        beaconRegion = [[CLBeaconRegion alloc] initWithUUID:uuid identifier:identifier];
    }

    // Notify on both entry and exit, and when the display turns on (useful for
    // proximity-aware UI that needs to update state when the user unlocks the phone).
    beaconRegion.notifyOnEntry = YES;
    beaconRegion.notifyOnExit  = YES;
    beaconRegion.notifyEntryStateOnDisplay = YES;

    _monitoringRegions[identifier] = beaconRegion;

    dispatch_async(dispatch_get_main_queue(), ^{
        [self.locationManager startMonitoringForRegion:beaconRegion];
        resolve(nil);
    });
}

- (void)stopMonitoring:(NSDictionary *)region
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
    NSString *identifier = region[@"identifier"];
    CLBeaconRegion *beaconRegion = _monitoringRegions[identifier];
    if (beaconRegion) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.locationManager stopMonitoringForRegion:beaconRegion];
            [self->_monitoringRegions removeObjectForKey:identifier];
            resolve(nil);
        });
    } else {
        resolve(nil);
    }
}

// ---------------------------------------------------------------------------
// getRangedRegions / getMonitoredRegions
// ---------------------------------------------------------------------------

- (void)getRangedRegions:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
    NSMutableArray *result = [NSMutableArray arrayWithCapacity:_rangingConstraints.count];
    [_rangingConstraints enumerateKeysAndObjectsUsingBlock:^(NSString *identifier,
                                                              CLBeaconIdentityConstraint *constraint,
                                                              BOOL *stop) {
        NSMutableDictionary *regionMap = [@{
            @"identifier": identifier,
            @"uuid": constraint.UUID.UUIDString.lowercaseString,
        } mutableCopy];
        if (constraint.major) regionMap[@"major"] = constraint.major;
        if (constraint.minor) regionMap[@"minor"] = constraint.minor;
        [result addObject:regionMap];
    }];
    resolve(result);
}

- (void)getMonitoredRegions:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
    NSMutableArray *result = [NSMutableArray arrayWithCapacity:_monitoringRegions.count];
    [_monitoringRegions enumerateKeysAndObjectsUsingBlock:^(NSString *identifier,
                                                             CLBeaconRegion *region,
                                                             BOOL *stop) {
        NSMutableDictionary *regionMap = [@{
            @"identifier": identifier,
            @"uuid": region.UUID.UUIDString.lowercaseString,
        } mutableCopy];
        if (region.major) regionMap[@"major"] = region.major;
        if (region.minor) regionMap[@"minor"] = region.minor;
        [result addObject:regionMap];
    }];
    resolve(result);
}

// ---------------------------------------------------------------------------
// Android-specific APIs — no-ops on iOS
// ---------------------------------------------------------------------------

// iOS has no equivalent of Android battery optimization. Return true so JS
// callers can skip the requestIgnoreBatteryOptimizations flow on iOS.
- (void)isIgnoringBatteryOptimizations:(RCTPromiseResolveBlock)resolve
                                reject:(RCTPromiseRejectBlock)reject {
    resolve(@YES);
}

// No-op on iOS — no battery optimization dialog exists.
- (void)requestIgnoreBatteryOptimizations {}

// No-op on iOS — no OEM autostart/power manager settings screen.
- (void)openAutostartSettings {}

// ---------------------------------------------------------------------------
// NativeEventEmitter — delegate to RCTEventEmitter superclass
// ---------------------------------------------------------------------------
- (void)addListener:(NSString *)eventName {
    [super addListener:eventName];
}

- (void)removeListeners:(double)count {
    [super removeListeners:count];
}

// ---------------------------------------------------------------------------
// CLLocationManagerDelegate — ranging
// ---------------------------------------------------------------------------
- (void)locationManager:(CLLocationManager *)manager
      didRangeBeacons:(NSArray<CLBeacon *> *)beacons
  satisfyingConstraint:(CLBeaconIdentityConstraint *)constraint API_AVAILABLE(ios(13.0)) {
    // Reverse-lookup which identifier owns this constraint
    NSString *identifier = @"";
    for (NSString *key in _rangingConstraints) {
        if ([_rangingConstraints[key] isEqual:constraint]) {
            identifier = key;
            break;
        }
    }

    NSMutableArray *beaconArray = [NSMutableArray arrayWithCapacity:beacons.count];
    for (CLBeacon *beacon in beacons) {
        NSString *uuidStr = beacon.UUID.UUIDString.lowercaseString;
        NSInteger major   = beacon.major.integerValue;
        NSInteger minor   = beacon.minor.integerValue;
        // CLBeacon.accuracy is the estimated distance in meters.
        // Negative value (-1) means the distance could not be determined.
        double rawDistance = beacon.accuracy;
        NSString *key = [NSString stringWithFormat:@"%@:%ld:%ld",
                         uuidStr, (long)major, (long)minor];
        // Skip the Kalman filter when distance is unknown (-1) to avoid
        // corrupting the filter state with a nonsensical measurement.
        double distance = (_kalmanEnabled && rawDistance >= 0)
            ? [self applyKalman:key measurement:rawDistance]
            : rawDistance;

        [beaconArray addObject:@{
            @"uuid":        uuidStr,
            @"major":       @(major),
            @"minor":       @(minor),
            @"rssi":        @(beacon.rssi),
            @"distance":    @(distance),
            @"rawDistance": @(rawDistance),
            // CLBeacon does not expose txPower directly.
            // -59 dBm is the standard iBeacon reference RSSI at 1 metre.
            @"txPower":     @(-59),
            // iOS does not expose MAC addresses (privacy restriction since iOS 13).
            @"macAddress":  @"",
            @"timestamp":   @((double)[[NSDate date] timeIntervalSince1970] * 1000.0),
        }];
    }

    [self sendEventWithName:@"onBeaconsRanged" body:@{
        @"region": @{
            @"identifier": identifier,
            @"uuid":       constraint.UUID.UUIDString.lowercaseString,
        },
        @"beacons": beaconArray,
    }];
}

- (void)locationManager:(CLLocationManager *)manager
rangingBeaconsDidFailForConstraint:(CLBeaconIdentityConstraint *)constraint
              withError:(NSError *)error API_AVAILABLE(ios(13.0)) {
    NSString *identifier = [self identifierForConstraint:constraint];
    [self sendFailureEventWithName:@"onRangingFailed"
                            region:[self regionMapForConstraint:constraint identifier:identifier]
                             error:error
                              code:@"RANGING_ERROR"];
}

// ---------------------------------------------------------------------------
// CLLocationManagerDelegate — monitoring
// ---------------------------------------------------------------------------
- (void)locationManager:(CLLocationManager *)manager didEnterRegion:(CLRegion *)region {
    if (![region isKindOfClass:[CLBeaconRegion class]]) return;
    [self sendRegionStateEvent:(CLBeaconRegion *)region state:@"inside"];
}

- (void)locationManager:(CLLocationManager *)manager didExitRegion:(CLRegion *)region {
    if (![region isKindOfClass:[CLBeaconRegion class]]) return;
    [self sendRegionStateEvent:(CLBeaconRegion *)region state:@"outside"];
}

- (void)locationManager:(CLLocationManager *)manager
    monitoringDidFailForRegion:(CLRegion *)region
                     withError:(NSError *)error {
    NSDictionary *regionMap = nil;
    if ([region isKindOfClass:[CLBeaconRegion class]]) {
        regionMap = [self regionMapForBeaconRegion:(CLBeaconRegion *)region];
    }
    [self sendFailureEventWithName:@"onMonitoringFailed"
                            region:regionMap
                             error:error
                              code:@"MONITORING_ERROR"];
}

// Fires on app launch when a background region event woke the app, and whenever
// requestStateForRegion: is called. Gives the initial inside/outside state that
// didEnterRegion/didExitRegion would otherwise miss at cold start.
- (void)locationManager:(CLLocationManager *)manager
      didDetermineState:(CLRegionState)state
              forRegion:(CLRegion *)region {
    if (![region isKindOfClass:[CLBeaconRegion class]]) return;
    NSString *stateStr;
    switch (state) {
        case CLRegionStateInside:  stateStr = @"inside";  break;
        case CLRegionStateOutside: stateStr = @"outside"; break;
        default: return; // CLRegionStateUnknown — no actionable state to emit
    }
    [self sendRegionStateEvent:(CLBeaconRegion *)region state:stateStr];
}

// Fires when the user grants or revokes location permission while the app is running.
// Propagates a PERMISSION_DENIED failure to all active regions so the JS layer can react.
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
    CLAuthorizationStatus status = manager.authorizationStatus;
    if (status != kCLAuthorizationStatusDenied && status != kCLAuthorizationStatusRestricted) return;

    NSError *error = [NSError errorWithDomain:@"BeaconKit"
                                         code:1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Location permission denied or restricted"}];
    for (NSString *identifier in _rangingConstraints) {
        CLBeaconIdentityConstraint *constraint = _rangingConstraints[identifier];
        [self sendFailureEventWithName:@"onRangingFailed"
                                region:[self regionMapForConstraint:constraint identifier:identifier]
                                 error:error
                                  code:@"PERMISSION_DENIED"];
    }
    for (NSString *identifier in _monitoringRegions) {
        CLBeaconRegion *region = _monitoringRegions[identifier];
        [self sendFailureEventWithName:@"onMonitoringFailed"
                                region:[self regionMapForBeaconRegion:region]
                                 error:error
                                  code:@"PERMISSION_DENIED"];
    }
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    for (NSString *identifier in _rangingConstraints) {
        CLBeaconIdentityConstraint *constraint = _rangingConstraints[identifier];
        [self sendFailureEventWithName:@"onRangingFailed"
                                region:[self regionMapForConstraint:constraint identifier:identifier]
                                 error:error
                                  code:@"RANGING_ERROR"];
    }

    for (NSString *identifier in _monitoringRegions) {
        CLBeaconRegion *region = _monitoringRegions[identifier];
        [self sendFailureEventWithName:@"onMonitoringFailed"
                                region:[self regionMapForBeaconRegion:region]
                                 error:error
                                  code:@"MONITORING_ERROR"];
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
- (void)sendRegionStateEvent:(CLBeaconRegion *)region state:(NSString *)state {
    [self sendEventWithName:@"onRegionStateChanged" body:@{
        @"region": [self regionMapForBeaconRegion:region],
        @"state":  state,
    }];
}

- (NSString *)identifierForConstraint:(CLBeaconIdentityConstraint *)constraint API_AVAILABLE(ios(13.0)) {
    for (NSString *key in _rangingConstraints) {
        if ([_rangingConstraints[key] isEqual:constraint]) {
            return key;
        }
    }
    return @"";
}

- (NSDictionary *)regionMapForConstraint:(CLBeaconIdentityConstraint *)constraint
                              identifier:(NSString *)identifier API_AVAILABLE(ios(13.0)) {
    NSMutableDictionary *regionMap = [@{
        @"identifier": identifier ?: @"",
        @"uuid": constraint.UUID.UUIDString.lowercaseString,
    } mutableCopy];
    if (constraint.major) regionMap[@"major"] = constraint.major;
    if (constraint.minor) regionMap[@"minor"] = constraint.minor;
    return regionMap;
}

- (NSDictionary *)regionMapForBeaconRegion:(CLBeaconRegion *)region {
    NSMutableDictionary *regionMap = [@{
        @"identifier": region.identifier,
        @"uuid": region.UUID.UUIDString.lowercaseString,
    } mutableCopy];
    if (region.major) regionMap[@"major"] = region.major;
    if (region.minor) regionMap[@"minor"] = region.minor;
    return regionMap;
}

- (void)sendFailureEventWithName:(NSString *)eventName
                          region:(NSDictionary *)region
                           error:(NSError *)error
                            code:(NSString *)code {
    NSMutableDictionary *payload = [@{
        @"code": code,
        @"message": error.localizedDescription ?: @"Unknown error",
        @"nativeCode": @(error.code),
    } mutableCopy];
    if (region) payload[@"region"] = region;
    if (error.domain) payload[@"domain"] = error.domain;
    [self sendEventWithName:eventName body:payload];
}

// Kalman filter — identical algorithm to the Android implementation.
// Smooths noisy distance readings by weighting the predicted state against
// the new measurement using the Kalman gain.
- (double)applyKalman:(NSString *)key measurement:(double)measurement {
    BeaconKalmanState *state = _kalmanStates[key];
    if (!state) {
        state = [[BeaconKalmanState alloc] initWithMeasurement:measurement];
        _kalmanStates[key] = state;
    }
    // Prediction step: propagate error covariance forward
    double predictedError = state.errorCovariance + _kalmanQ;
    // Update step: compute Kalman gain and correct the estimate
    double gain = predictedError / (predictedError + _kalmanR);
    state.estimate = state.estimate + gain * (measurement - state.estimate);
    state.errorCovariance = (1.0 - gain) * predictedError;
    return state.estimate;
}

@end
