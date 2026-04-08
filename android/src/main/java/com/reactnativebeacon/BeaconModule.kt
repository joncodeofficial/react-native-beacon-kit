package com.reactnativebeacon

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
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

  // Initializes BeaconManager once with the iBeacon parser
  private fun getOrCreateBeaconManager(): BeaconManager {
    return beaconManager ?: BeaconManager.getInstanceForApplication(reactApplicationContext).also {
      // iBeacon (Apple)
      it.beaconParsers.add(
        BeaconParser().setBeaconLayout("m:2-3=0215,i:4-19,i:20-21,i:22-23,p:24-24,d:25-25")
      )
      // AltBeacon (open standard, same major/minor structure as iBeacon)
      it.beaconParsers.add(
        BeaconParser().setBeaconLayout("m:2-3=beac,i:4-19,i:20-21,i:22-23,p:24-24,d:25-25")
      )
      // Default scan interval: 5 seconds
      it.foregroundScanPeriod = 5000L
      it.backgroundScanPeriod = 5000L
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
      val period = config.getDouble("scanPeriod").toLong()
      manager.foregroundScanPeriod = period
      manager.backgroundScanPeriod = period
    }

    if (config.hasKey("betweenScanPeriod")) {
      val between = config.getDouble("betweenScanPeriod").toLong()
      manager.foregroundBetweenScanPeriod = between
      manager.backgroundBetweenScanPeriod = between
    }

    if (config.hasKey("foregroundService") && config.getBoolean("foregroundService")) {
      enableForegroundService()
    }

    if (config.hasKey("kalmanFilter")) {
      val kalman = config.getMap("kalmanFilter")!!
      kalmanEnabled = kalman.hasKey("enabled") && kalman.getBoolean("enabled")
      if (kalman.hasKey("q")) kalmanQ = kalman.getDouble("q")
      if (kalman.hasKey("r")) kalmanR = kalman.getDouble("r")
      kalmanStates.clear()
    }
  }

  // Foreground service: enables real background scanning (process is not killed)
  private fun enableForegroundService() {
    val channelId = "beacon-channel"
    val context = reactApplicationContext

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        channelId,
        "Beacon Scanning",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Active while scanning for beacons in background"
      }
      val notificationManager = context.getSystemService(NotificationManager::class.java)
      notificationManager.createNotificationChannel(channel)
    }

    val notification = Notification.Builder(context, channelId)
      .setContentTitle("Beacon")
      .setContentText("Scanning for beacons...")
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      .build()

    val manager = getOrCreateBeaconManager()
    manager.enableForegroundServiceScanning(notification, FOREGROUND_SERVICE_ID)
    // Required on Android 8+ for the foreground service to work correctly
    manager.setEnableScheduledScanJobs(false)
    manager.backgroundBetweenScanPeriod = 0
  }

  // Ranging: detects nearby beacons with RSSI and distance (~every 1s)
  override fun startRanging(region: ReadableMap, promise: Promise) {
    try {
      val beaconRegion = readableMapToRegion(region)
      val manager = getOrCreateBeaconManager()

      if (rangeNotifier == null) {
        rangeNotifier = RangeNotifier { beacons, rgn ->
          sendBeaconsRangedEvent(beacons, rgn)
        }
        manager.addRangeNotifier(rangeNotifier!!)
      }

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

      if (monitorNotifier == null) {
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
      }

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

  // Required by NativeEventEmitter — no logic needed
  override fun addListener(eventName: String) {}
  override fun removeListeners(count: Double) {}

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
    val beaconArray = Arguments.createArray()

    for (beacon in beacons) {
      val key = "${beacon.id1}:${beacon.id2}:${beacon.id3}"
      val distance = if (kalmanEnabled) {
        applyKalman(key, beacon.distance)
      } else {
        beacon.distance
      }

      beaconArray.pushMap(Arguments.createMap().apply {
        putString("uuid", beacon.id1?.toString() ?: "")
        putInt("major", beacon.id2?.toInt() ?: 0)
        putInt("minor", beacon.id3?.toInt() ?: 0)
        putInt("rssi", beacon.rssi)
        putDouble("distance", distance)
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
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }

  companion object {
    const val NAME = NativeBeaconSpec.NAME
    private const val FOREGROUND_SERVICE_ID = 456
  }
}
