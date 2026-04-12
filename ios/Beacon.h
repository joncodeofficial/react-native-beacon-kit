#import <BeaconSpec/BeaconSpec.h>
#import <React/RCTEventEmitter.h>

// RCTEventEmitter provides sendEventWithName:body:, addListener:, and removeListeners:
// which are required by NativeBeaconSpec and the NativeEventEmitter on the JS side.
@interface Beacon : RCTEventEmitter <NativeBeaconSpec>

@end
