package com.reactnativebeacon

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.altbeacon.beacon.Beacon
import org.altbeacon.beacon.BeaconManager
import org.altbeacon.beacon.BeaconParser
import org.altbeacon.beacon.Identifier
import org.altbeacon.beacon.MonitorNotifier
import org.altbeacon.beacon.RangeNotifier
import org.altbeacon.beacon.Region

// Kalman filter state per beacon (keyed by uuid:major:minor)
data class KalmanState(
  var estimate: Double,
  var errorCovariance: Double,
)

class BeaconModule(reactContext: ReactApplicationContext) :
  NativeBeaconSpec(reactContext) {

  private var beaconManager: BeaconManager? = null
  private var rangeNotifier: RangeNotifier? = null
  private var monitorNotifier: MonitorNotifier? = null

  private var kalmanEnabled: Boolean = false
  private var kalmanQ: Double = 0.008  // process noise
  private var kalmanR: Double = 0.1    // measurement noise
  private val kalmanStates = mutableMapOf<String, KalmanState>()

  private var wakeLock: PowerManager.WakeLock? = null

  // Initializes BeaconManager once with parsers and scan periods.
  // BeaconManager is an app-level singleton that outlives JS reloads. BeaconModule
  // gets a new instance on every Metro reload (beaconManager resets to null), so
  // parser registration is guarded by a static flag to prevent duplicates.
  // setBackgroundMode(false) is called on every init (outside the guard) to ensure
  // LOW_LATENCY scan mode is always active — MIUI/HyperOS suspends LOW_POWER scans
  // when the screen turns off even with a foreground service running.
  private fun getOrCreateBeaconManager(): BeaconManager {
    return beaconManager ?: BeaconManager.getInstanceForApplication(reactApplicationContext).also {
      if (!Companion.beaconManagerInitialized) {
        // iBeacon (Apple)
        it.beaconParsers.add(
          BeaconParser().setBeaconLayout("m:2-3=0215,i:4-19,i:20-21,i:22-23,p:24-24,d:25-25")
        )
        // AltBeacon (open standard, same major/minor structure as iBeacon)
        it.beaconParsers.add(
          BeaconParser().setBeaconLayout("m:2-3=beac,i:4-19,i:20-21,i:22-23,p:24-24,d:25-25")
        )
        it.foregroundScanPeriod = 10_000L
        it.backgroundScanPeriod = 10_000L
        Companion.beaconManagerInitialized = true
      }
      // Force LOW_LATENCY scan mode on every init including Metro reloads.
      // Without this, AltBeacon defaults to LOW_POWER in background mode.
      // MIUI logs show "force suspend scan [scanModeApp 0]" (LOW_POWER = 0)
      // when screen turns off — LOW_LATENCY (mode 2) is treated as high-priority
      // and survives OEM power management restrictions.
      it.setBackgroundMode(false)
      beaconManager = it
    }
  }

  // Checks permissions without requesting them — the developer's responsibility
  override fun checkPermissions(promise: Promise) {
    val context = reactApplicationContext

    val hasLocation = ContextCompat.checkSelfPermission(
      context, Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED

    val hasBluetooth = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      ContextCompat.checkSelfPermission(
        context, Manifest.permission.BLUETOOTH_SCAN
      ) == PackageManager.PERMISSION_GRANTED
    } else {
      true // Android < 12 does not require BLUETOOTH_SCAN
    }

    promise.resolve(hasLocation && hasBluetooth)
  }

  // Sets scan intervals and optionally enables the foreground service
  override fun configure(config: ReadableMap) {
    val manager = getOrCreateBeaconManager()

    if (config.hasKey("scanPeriod")) {
      manager.foregroundScanPeriod = config.getDouble("scanPeriod").toLong()
    }

    if (config.hasKey("backgroundScanPeriod")) {
      manager.backgroundScanPeriod = config.getDouble("backgroundScanPeriod").toLong()
    }

    if (config.hasKey("betweenScanPeriod")) {
      val between = config.getDouble("betweenScanPeriod").toLong()
      manager.foregroundBetweenScanPeriod = between
      manager.backgroundBetweenScanPeriod = between
    }

    if (config.hasKey("foregroundService")) {
      if (config.getBoolean("foregroundService")) {
        val notifConfig = if (config.hasKey("foregroundServiceNotification")) {
          config.getMap("foregroundServiceNotification")
        } else null
        enableForegroundService(notifConfig)
      } else {
        disableForegroundService()
      }
    }

    if (config.hasKey("kalmanFilter")) {
      val kalman = config.getMap("kalmanFilter")!!
      kalmanEnabled = kalman.hasKey("enabled") && kalman.getBoolean("enabled")
      if (kalman.hasKey("q")) kalmanQ = kalman.getDouble("q")
      if (kalman.hasKey("r")) kalmanR = kalman.getDouble("r")
      kalmanStates.clear()
    }

    // Apply updated scan periods to an already-running scan
    try { manager.updateScanPeriods() } catch (_: Exception) {}
  }

  // Foreground service: enables real background scanning (process is not killed)
  private fun enableForegroundService(notifConfig: ReadableMap? = null) {
    val channelId = "beacon-channel"
    val context = reactApplicationContext

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        channelId,
        "Beacon Scanning",
        NotificationManager.IMPORTANCE_DEFAULT
      ).apply {
        description = "Active while scanning for beacons in background"
      }
      val notificationManager = context.getSystemService(NotificationManager::class.java)
      notificationManager.createNotificationChannel(channel)
    }

    val title = notifConfig?.getString("title") ?: "Beacon"
    val text = notifConfig?.getString("text") ?: "Scanning for beacons..."

    val notification = Notification.Builder(context, channelId)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      .build()

    val manager = getOrCreateBeaconManager()

    // enableForegroundServiceScanning() throws "May not be called after consumers
    // are already bound" if called while ranging/monitoring is active. The
    // BeaconManager singleton survives JS reloads, so skip this call if the
    // foreground service was already set up in a previous configure() invocation.
    if (!Companion.foregroundServiceEnabled) {
      // setEnableScheduledScanJobs(false) must be called before
      // enableForegroundServiceScanning() — disables Android's job scheduler so
      // the foreground service owns the scan lifecycle on Android 8+.
      manager.setEnableScheduledScanJobs(false)
      manager.enableForegroundServiceScanning(notification, FOREGROUND_SERVICE_ID)
      Companion.foregroundServiceEnabled = true
    }

    // Wake lock is acquired here — outside the foregroundServiceEnabled guard —
    // because invalidate() releases it on every JS reload. A new BeaconModule
    // instance must always re-acquire it even when the foreground service was
    // already started in a previous session.
    if (wakeLock?.isHeld != true) {
      val pm = context.getSystemService(PowerManager::class.java)
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "beacon-kit:scanning")
      wakeLock!!.acquire()
    }
  }

  private fun disableForegroundService() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    Companion.foregroundServiceEnabled = false
  }

  // Ranging: detects nearby beacons with RSSI and distance (~every 1s)
  override fun startRanging(region: ReadableMap, promise: Promise) {
    try {
      val beaconRegion = readableMapToRegion(region)
      val manager = getOrCreateBeaconManager()

      // Remove all previously registered notifiers before adding a new one.
      // BeaconManager is a singleton — on JS reload a new BeaconModule instance
      // is created and rangeNotifier resets to null, but stale notifiers from
      // the previous instance are still registered, causing duplicate events.
      manager.removeAllRangeNotifiers()
      rangeNotifier = RangeNotifier { beacons, rgn ->
        sendBeaconsRangedEvent(beacons, rgn)
      }
      manager.addRangeNotifier(rangeNotifier!!)

      manager.startRangingBeacons(beaconRegion)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RANGING_ERROR", e.message, e)
    }
  }

  override fun stopRanging(region: ReadableMap, promise: Promise) {
    try {
      getOrCreateBeaconManager().stopRangingBeacons(readableMapToRegion(region))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RANGING_ERROR", e.message, e)
    }
  }

  // Monitoring: detects region entry/exit (battery efficient)
  override fun startMonitoring(region: ReadableMap, promise: Promise) {
    try {
      val beaconRegion = readableMapToRegion(region)
      val manager = getOrCreateBeaconManager()

      manager.removeAllMonitorNotifiers()
      monitorNotifier = object : MonitorNotifier {
        override fun didEnterRegion(rgn: Region) {
          sendRegionStateChangedEvent(rgn, "inside")
        }
        override fun didExitRegion(rgn: Region) {
          sendRegionStateChangedEvent(rgn, "outside")
          }
          override fun didDetermineStateForRegion(state: Int, rgn: Region) {}
        }
      manager.addMonitorNotifier(monitorNotifier!!)

      manager.startMonitoring(beaconRegion)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MONITORING_ERROR", e.message, e)
    }
  }

  override fun stopMonitoring(region: ReadableMap, promise: Promise) {
    try {
      getOrCreateBeaconManager().stopMonitoring(readableMapToRegion(region))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MONITORING_ERROR", e.message, e)
    }
  }

  // Returns true if the app is excluded from Android battery optimization.
  // When not excluded, Doze mode can throttle BLE scanning with screen off.
  override fun isIgnoringBatteryOptimizations(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val pm = reactApplicationContext.getSystemService(PowerManager::class.java)
      promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    } else {
      promise.resolve(true) // Pre-M devices don't have battery optimization
    }
  }

  // Opens the system dialog asking the user to exclude this app from battery optimization.
  // Required for reliable background scanning on devices with aggressive Doze or OEM power managers.
  override fun requestIgnoreBatteryOptimizations() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(intent)
    }
  }

  // Opens the OEM-specific background permission settings page.
  // On Xiaomi/HyperOS this opens the Autostart management screen directly.
  // On other OEMs it falls back to the standard App Info screen.
  // Without Autostart enabled on Xiaomi, MIUI suspends the BLE radio ~30s after
  // screen-off regardless of foreground service, wake lock, or battery optimization.
  override fun openAutostartSettings() {
    val intent = getAutostartIntent() ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
      data = Uri.parse("package:${reactApplicationContext.packageName}")
    }
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    try {
      reactApplicationContext.startActivity(intent)
    } catch (_: Exception) {
      // Fallback to app info if OEM intent is not available
      val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(fallback)
    }
  }

  private fun getAutostartIntent(): Intent? {
    val manufacturer = Build.MANUFACTURER.lowercase()
    return when {
      manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") ->
        Intent().setClassName(
          "com.miui.securitycenter",
          "com.miui.permcenter.autostart.AutoStartManagementActivity"
        )
      manufacturer.contains("oppo") || manufacturer.contains("realme") ->
        Intent().setClassName(
          "com.coloros.safecenter",
          "com.coloros.privacypermissionsentry.PermissionTopActivity"
        )
      manufacturer.contains("vivo") ->
        Intent().setClassName(
          "com.vivo.permissionmanager",
          "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
        )
      manufacturer.contains("huawei") ->
        Intent().setClassName(
          "com.huawei.systemmanager",
          "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
        )
      manufacturer.contains("samsung") ->
        Intent().setClassName(
          "com.samsung.android.lool",
          "com.samsung.android.sm.battery.ui.BatteryActivity"
        )
      else -> null
    }
  }

  // Required by NativeEventEmitter — no logic needed
  override fun addListener(eventName: String) {}
  override fun removeListeners(count: Double) {}

  // Release the wake lock when the React Native bridge tears down
  override fun invalidate() {
    wakeLock?.let { if (it.isHeld) it.release() }
    super.invalidate()
  }

  // --- Helpers ---

  private fun readableMapToRegion(map: ReadableMap): Region {
    val identifier = map.getString("identifier")
      ?: throw IllegalArgumentException("identifier is required")
    val uuid = map.getString("uuid")
      ?: throw IllegalArgumentException("uuid is required")

    val major = if (map.hasKey("major")) Identifier.fromInt(map.getInt("major")) else null
    val minor = if (map.hasKey("minor")) Identifier.fromInt(map.getInt("minor")) else null

    return Region(identifier, Identifier.parse(uuid), major, minor)
  }

  // Kalman filter — smooths noisy distance readings
  private fun applyKalman(key: String, measurement: Double): Double {
    val state = kalmanStates.getOrPut(key) { KalmanState(measurement, 1.0) }

    // Prediction step
    val predictedError = state.errorCovariance + kalmanQ

    // Update step
    val gain = predictedError / (predictedError + kalmanR)
    state.estimate = state.estimate + gain * (measurement - state.estimate)
    state.errorCovariance = (1 - gain) * predictedError

    return state.estimate
  }

  private fun sendBeaconsRangedEvent(beacons: Collection<Beacon>, region: Region) {
    // Arguments.createMap/Array uses JSI in the New Architecture. Guard against
    // calls that arrive via StartupBroadcastReceiver during a Metro JS reload,
    // before the React instance is fully initialized.
    if (!reactApplicationContext.hasActiveReactInstance()) return

    val beaconArray = Arguments.createArray()

    for (beacon in beacons) {
      val key = "${beacon.id1}:${beacon.id2}:${beacon.id3}"
      val rawDistance = beacon.distance
      val distance = if (kalmanEnabled) applyKalman(key, rawDistance) else rawDistance

      beaconArray.pushMap(Arguments.createMap().apply {
        putString("uuid", beacon.id1?.toString() ?: "")
        putInt("major", beacon.id2?.toInt() ?: 0)
        putInt("minor", beacon.id3?.toInt() ?: 0)
        putInt("rssi", beacon.rssi)
        putDouble("distance", distance)
        putDouble("rawDistance", rawDistance)
        putInt("txPower", beacon.txPower)
        putString("macAddress", beacon.bluetoothAddress ?: "")
        putDouble("timestamp", System.currentTimeMillis().toDouble())
      })
    }

    sendEvent("onBeaconsRanged", Arguments.createMap().apply {
      putMap("region", regionToWritableMap(region))
      putArray("beacons", beaconArray)
    })
  }

  private fun sendRegionStateChangedEvent(region: Region, state: String) {
    if (!reactApplicationContext.hasActiveReactInstance()) return
    sendEvent("onRegionStateChanged", Arguments.createMap().apply {
      putMap("region", regionToWritableMap(region))
      putString("state", state)
    })
  }

  private fun regionToWritableMap(region: Region): WritableMap {
    return Arguments.createMap().apply {
      putString("identifier", region.uniqueId)
      putString("uuid", region.id1?.toString() ?: "")
      region.id2?.let { putInt("major", it.toInt()) }
      region.id3?.let { putInt("minor", it.toInt()) }
    }
  }

  private fun sendEvent(eventName: String, params: WritableMap) {
    // Guard against null reactInstance during JS reloads (Metro fast refresh) or
    // when the BroadcastReceiver fires before the bridge is fully initialized.
    try {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, params)
    } catch (_: Exception) {}
  }

  companion object {
    const val NAME = NativeBeaconSpec.NAME
    private const val FOREGROUND_SERVICE_ID = 456
    // BeaconManager is a singleton that outlives JS reloads. BeaconModule gets a
    // new instance on every reload, so these flags must be static to remember
    // one-time setup calls already made on the live singleton.
    @Volatile var foregroundServiceEnabled: Boolean = false
    @Volatile private var beaconManagerInitialized: Boolean = false
  }
}
