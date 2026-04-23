const {
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
} = require('@expo/config-plugins');

const pkg = require('./package.json');

const PLUGIN_NAME = 'react-native-beacon-kit';
const DEFAULT_LOCATION_PERMISSION_MESSAGE =
  'This app uses your location to detect nearby beacons.';

const ANDROID_PERMISSIONS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];

const hasPermission = (permissions, permission) =>
  permissions.some((entry) => entry?.$?.['android:name'] === permission);

const ensureAndroidPermission = (permissions, permission) => {
  if (hasPermission(permissions, permission)) {
    return permissions;
  }

  return [
    ...permissions,
    {
      $: {
        'android:name': permission,
      },
    },
  ];
};

const applyAndroidManifestChanges = (manifest) => {
  let permissions = manifest.manifest['uses-permission'] ?? [];

  permissions = permissions.map((entry) => {
    if (entry?.$?.['android:name'] !== 'android.permission.BLUETOOTH_SCAN') {
      return entry;
    }

    const nextEntry = {
      ...entry,
      $: {
        ...entry.$,
      },
    };

    delete nextEntry.$['android:usesPermissionFlags'];

    return nextEntry;
  });

  for (const permission of ANDROID_PERMISSIONS) {
    permissions = ensureAndroidPermission(permissions, permission);
  }

  manifest.manifest['uses-permission'] = permissions;

  return manifest;
};

const ensureBackgroundMode = (infoPlist, mode) => {
  const modes = Array.isArray(infoPlist.UIBackgroundModes)
    ? infoPlist.UIBackgroundModes
    : [];

  if (modes.includes(mode)) {
    infoPlist.UIBackgroundModes = modes;
    return infoPlist;
  }

  infoPlist.UIBackgroundModes = [...modes, mode];
  return infoPlist;
};

const applyIosInfoPlistChanges = (
  infoPlist,
  { iosBackgroundLocation = false } = {}
) => {
  infoPlist.NSLocationWhenInUseUsageDescription ??=
    DEFAULT_LOCATION_PERMISSION_MESSAGE;
  infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription ??=
    DEFAULT_LOCATION_PERMISSION_MESSAGE;

  if (iosBackgroundLocation) {
    ensureBackgroundMode(infoPlist, 'location');
  }

  return infoPlist;
};

const withAndroidBeaconPermissions = (config) =>
  withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyAndroidManifestChanges(modConfig.modResults);
    return modConfig;
  });

const withIosBeaconConfig = (config, props) =>
  withInfoPlist(config, (modConfig) => {
    modConfig.modResults = applyIosInfoPlistChanges(
      modConfig.modResults,
      props
    );
    return modConfig;
  });

const withBeaconKit = (config, props = {}) => {
  config = withAndroidBeaconPermissions(config);
  config = withIosBeaconConfig(config, props);
  return config;
};

const plugin = createRunOncePlugin(withBeaconKit, PLUGIN_NAME, pkg.version);

module.exports = plugin;
module.exports.withBeaconKit = withBeaconKit;
module.exports.withAndroidBeaconPermissions = withAndroidBeaconPermissions;
module.exports.withIosBeaconConfig = withIosBeaconConfig;
module.exports._internal = {
  ANDROID_PERMISSIONS,
  DEFAULT_LOCATION_PERMISSION_MESSAGE,
  applyAndroidManifestChanges,
  applyIosInfoPlistChanges,
};
