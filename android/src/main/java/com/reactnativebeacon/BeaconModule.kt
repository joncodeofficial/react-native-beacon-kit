package com.reactnativebeacon

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
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

  // aggressiveBackground mode: watchdog + wake lock + forced LOW_LATENCY.
  // Only active when configure({ aggressiveBackground: true }) is called.
  // Needed on Xiaomi/HyperOS and other OEMs with aggressive BLE power management.
  private var aggressiveMode: Boolean = false

  // User-configured scan periods. In aggressive mode, AltBeacon always uses
  // foregroundScanPeriod (because setBackgroundMode(false) is forced), so we
  // switch it manually between these two values based on screen state.
  private var userForegroundScanPeriod: Long = 10_000L
  private var userBackgroundScanPeriod: Long = 10_000L

  // Screen state receiver — registered only in aggressive mode.
  // ACTION_SCREEN_ON/OFF cannot be declared in the manifest; must be registered dynamically.
  private var screenReceiverRegistered: Boolean = false
  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> onScreenOff()
        Intent.ACTION_SCREEN_ON  -> onScreenOn()
      }
    }
  }

  // Watchdog: restarts BLE ranging every 20s to beat MIUI's ~20s scan-suspend timer.
  // MIUI/HyperOS force-suspends BLE scans after ~30s of screen-off even with
  // LOW_LATENCY mode and a foreground service. Restarting the scan resets the timer.
  private val watchdogHandler = Handler(Looper.getMainLooper())
  private var watchdogRunnable: Runnable? = null
  private val activeRangingRegions = java.util.concurrent.CopyOnWriteArrayList<Region>()

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
      // In aggressive mode: force LOW_LATENCY scan mode on every init including
      // Metro reloads. MIUI logs show "force suspend scan [scanModeApp 0]"
      // (LOW_POWER = 0) when screen turns off — LOW_LATENCY (mode 2) is treated
      // as high-priority and survives OEM power management restrictions.
      if (aggressiveMode) it.setBackgroundMode(false)
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
    // aggressiveBackground must be read before getOrCreateBeaconManager() because
    // the manager init conditionally calls setBackgroundMode(false) based on this flag.
    if (config.hasKey("aggressiveBackground")) {
      aggressiveMode = config.getBoolean("aggressiveBackground")
    }

    val manager = getOrCreateBeaconManager()

    if (config.hasKey("scanPeriod")) {
      userForegroundScanPeriod = config.getDouble("scanPeriod").toLong()
    }
    if (config.hasKey("backgroundScanPeriod")) {
      userBackgroundScanPeriod = config.getDouble("backgroundScanPeriod").toLong()
    }

    // In aggressive mode, setBackgroundMode(false) makes AltBeacon always use
    // foregroundScanPeriod. We switch it manually based on current screen state
    // so the developer's scanPeriod applies when screen is on and backgroundScanPeriod
    // when screen is off — without relying on AltBeacon's lifecycle detection.
    if (aggressiveMode) {
      val isScreenOn = reactApplicationContext.getSystemService(PowerManager::class.java).isInteractive
      manager.foregroundScanPeriod = if (isScreenOn) userForegroundScanPeriod else userBackgroundScanPeriod
    } else {
      manager.foregroundScanPeriod = userForegroundScanPeriod
      manager.backgroundScanPeriod = userBackgroundScanPeriod
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
        // IMPORTANCE_LOW: visible in the notification drawer, no sound or vibration.
        // Appropriate for a persistent "scanning active" indicator. IMPORTANCE_DEFAULT
        // would play a sound each time the service restarts, which is intrusive.
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Active while scanning for beacons in background"
      }
      val notificationManager = context.getSystemService(NotificationManager::class.java)
      notificationManager.createNotificationChannel(channel)
    }

    val title = notifConfig?.getString("title") ?: "Beacon"
    val text = notifConfig?.getString("text") ?: "Scanning for beacons..."

    val builder = Notification.Builder(context, channelId)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      // Keeps the notification in the drawer — user cannot dismiss a foreground service
      // notification, but setOngoing(true) makes this explicit and prevents some OEMs
      // (MIUI in particular) from treating it as a transient notification.
      .setOngoing(true)

    // Android 12+ delays foreground service notifications by 10s unless
    // FOREGROUND_SERVICE_IMMEDIATE is set. Show it right away so the user
    // can see the scanning indicator and the service isn't silently missing.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }

    val notification = builder.build()

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

    // Wake lock: only acquired in aggressive mode. Keeps the CPU awake so BLE
    // callbacks fire with the screen off on OEMs that would otherwise let the CPU
    // sleep between scan events. Skipped in normal mode to save battery.
    // Acquired outside the foregroundServiceEnabled guard because invalidate()
    // releases it on every JS reload — must re-acquire on each new BeaconModule instance.
    if (aggressiveMode && wakeLock?.isHeld != true) {
      val pm = context.getSystemService(PowerManager::class.java)
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "beacon-kit:scanning")
      wakeLock!!.acquire()
    }

    // Screen state receiver: switches scan period and watchdog based on screen on/off.
    // Registered here (outside the foregroundServiceEnabled guard) so it's always
    // re-registered on Metro reload even when the foreground service was already started.
    if (aggressiveMode) registerScreenReceiver()
  }

  private fun disableForegroundService() {
    unregisterScreenReceiver()
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    Companion.foregroundServiceEnabled = false
  }

  private fun registerScreenReceiver() {
    if (screenReceiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
    }
    reactApplicationContext.registerReceiver(screenReceiver, filter)
    screenReceiverRegistered = true
  }

  private fun unregisterScreenReceiver() {
    if (!screenReceiverRegistered) return
    try { reactApplicationContext.unregisterReceiver(screenReceiver) } catch (_: Exception) {}
    screenReceiverRegistered = false
  }

  // Called when screen turns off: switch to background scan period and start watchdog.
  private fun onScreenOff() {
    val manager = beaconManager ?: return
    manager.foregroundScanPeriod = userBackgroundScanPeriod
    try { manager.updateScanPeriods() } catch (_: Exception) {}
    if (activeRangingRegions.isNotEmpty()) startWatchdog()
  }

  // Called when screen turns on: switch to foreground scan period and stop watchdog.
  // Screen-on means the user is interacting — MIUI doesn't suspend BLE in this state,
  // so the watchdog is unnecessary and wastes battery.
  // Restarts active ranging immediately so the fast scan period (e.g. 1100ms) kicks in
  // right away instead of waiting up to 10s for the current background scan to finish.
  private fun onScreenOn() {
    stopWatchdog()
    val manager = beaconManager ?: return
    manager.foregroundScanPeriod = userForegroundScanPeriod
    for (region in activeRangingRegions) {
      try {
        manager.stopRangingBeacons(region)
        manager.startRangingBeacons(region)
      } catch (_: Exception) {}
    }
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

      // Track region for watchdog restarts (only used in aggressive mode)
      if (activeRangingRegions.none { it.uniqueId == beaconRegion.uniqueId }) {
        activeRangingRegions.add(beaconRegion)
      }
      // Start watchdog only if screen is already off — if screen is on, onScreenOff()
      // will start it when the screen turns off.
      if (aggressiveMode) {
        val isScreenOn = reactApplicationContext.getSystemService(PowerManager::class.java).isInteractive
        if (!isScreenOn) startWatchdog()
      }

      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RANGING_ERROR", e.message, e)
    }
  }

  override fun stopRanging(region: ReadableMap, promise: Promise) {
    try {
      val beaconRegion = readableMapToRegion(region)
      getOrCreateBeaconManager().stopRangingBeacons(beaconRegion)

      activeRangingRegions.removeAll { it.uniqueId == beaconRegion.uniqueId }
      if (activeRangingRegions.isEmpty()) stopWatchdog()

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

  // Starts the BLE watchdog if not already running.
  // Fires every WATCHDOG_INTERVAL_MS and restarts all active ranging regions to
  // reset MIUI's BLE scan suspend timer before it hits the ~30s threshold.
  private fun startWatchdog() {
    if (watchdogRunnable != null) return
    watchdogRunnable = object : Runnable {
      override fun run() {
        // try/finally guarantees postDelayed is always called so the watchdog
        // never stops silently due to a null beaconManager or an unexpected exception.
        try {
          val manager = beaconManager ?: return
          // Re-assert LOW_LATENCY and cycle each region to force a new startScan(),
          // which resets the MIUI ~30s suspend countdown.
          manager.setBackgroundMode(false)
          for (region in activeRangingRegions) {
            try {
              manager.stopRangingBeacons(region)
              manager.startRangingBeacons(region)
            } catch (_: Exception) {}
          }
        } finally {
          watchdogHandler.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
      }
    }
    watchdogHandler.postDelayed(watchdogRunnable!!, WATCHDOG_INTERVAL_MS)
  }

  private fun stopWatchdog() {
    watchdogRunnable?.let { watchdogHandler.removeCallbacks(it) }
    watchdogRunnable = null
  }

  // Release resources when the React Native bridge tears down (JS reload or app exit)
  override fun invalidate() {
    unregisterScreenReceiver()
    stopWatchdog()
    activeRangingRegions.clear()
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
    // Watchdog fires every 20s — 10s before MIUI's ~30s BLE scan suspend threshold.
    // This gives a 10s safety margin and ensures at least one full 10s scan cycle
    // completes between each restart before MIUI can suspend the radio.
    private const val WATCHDOG_INTERVAL_MS = 20_000L
    // BeaconManager is a singleton that outlives JS reloads. BeaconModule gets a
    // new instance on every reload, so these flags must be static to remember
    // one-time setup calls already made on the live singleton.
    @Volatile var foregroundServiceEnabled: Boolean = false
    @Volatile private var beaconManagerInitialized: Boolean = false
  }
}
