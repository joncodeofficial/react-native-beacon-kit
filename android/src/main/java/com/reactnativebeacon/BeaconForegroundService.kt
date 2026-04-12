package com.reactnativebeacon

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Minimal foreground service that holds the persistent notification while
 * beacon scanning is active. AltBeacon's intent scanning strategy (PendingIntent)
 * does not use BeaconService, so we provide our own service for:
 *  - showing the "scanning" notification required by Android 8+
 *  - keeping the process alive so PendingIntent results can be processed
 */
class BeaconForegroundService : Service() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = intent?.getParcelableExtra<Notification>(EXTRA_NOTIFICATION)
    if (notification != null) {
      // Store the notification so we can re-use it if Android restarts the service
      // via START_STICKY (which delivers a null intent on restart).
      lastNotification = notification
    }
    val notifToShow = lastNotification
    if (notifToShow != null) {
      startForeground(NOTIFICATION_ID, notifToShow)
    } else {
      // No notification available yet — stop so Android doesn't keep a
      // foreground service without a visible notification.
      stopSelf()
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val EXTRA_NOTIFICATION = "notification"
    const val NOTIFICATION_ID = 457
    // Retained across START_STICKY restarts so the service can re-show the
    // notification even when Android delivers a null intent on restart.
    private var lastNotification: Notification? = null
  }
}
