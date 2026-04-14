const plugin = require('../../app.plugin');

describe('Expo config plugin', () => {
  it('adds the required Android permissions and removes BLUETOOTH_SCAN neverForLocation', () => {
    const manifest = {
      manifest: {
        'uses-permission': [
          {
            $: {
              'android:name': 'android.permission.BLUETOOTH_SCAN',
              'android:usesPermissionFlags': 'neverForLocation',
            },
          },
        ],
      },
    };

    const result = plugin._internal.applyAndroidManifestChanges(manifest);
    const permissions = result.manifest['uses-permission'];

    expect(permissions).toEqual(
      expect.arrayContaining([
        { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } },
        {
          $: {
            'android:name': 'android.permission.ACCESS_BACKGROUND_LOCATION',
          },
        },
        { $: { 'android:name': 'android.permission.BLUETOOTH_SCAN' } },
        { $: { 'android:name': 'android.permission.BLUETOOTH_CONNECT' } },
        { $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } },
        {
          $: {
            'android:name': 'android.permission.FOREGROUND_SERVICE_LOCATION',
          },
        },
        { $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } },
      ])
    );

    const bluetoothScanPermission = permissions.find(
      (entry) => entry.$['android:name'] === 'android.permission.BLUETOOTH_SCAN'
    );

    expect(bluetoothScanPermission).toEqual({
      $: { 'android:name': 'android.permission.BLUETOOTH_SCAN' },
    });
  });

  it('adds default iOS location usage descriptions', () => {
    const infoPlist = {};

    const result = plugin._internal.applyIosInfoPlistChanges(infoPlist);

    expect(result).toMatchObject({
      NSLocationWhenInUseUsageDescription:
        'This app uses your location to detect nearby beacons.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'This app uses your location to detect nearby beacons.',
    });
    expect(result.UIBackgroundModes).toBeUndefined();
  });

  it('adds iOS location background mode only when explicitly enabled', () => {
    const infoPlist = {
      UIBackgroundModes: ['fetch'],
    };

    const result = plugin._internal.applyIosInfoPlistChanges(infoPlist, {
      iosBackgroundLocation: true,
    });

    expect(result.UIBackgroundModes).toEqual(['fetch', 'location']);
  });
});
