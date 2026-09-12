package com.mangoprotocol.pro

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicInteger

/**
 * Posts a plain local (device-only) notification — used for deposit-
 * received alerts (see src/wallet/depositWatcher.ts). Not push: nothing
 * is sent to or received from any server, this only surfaces something
 * the app already detected on-device while it happened to be running.
 * No APNs/FCM plumbing needed for that.
 *
 * A NotificationChannel is required from Android O (API 26) onward —
 * without one, notify() silently does nothing on those versions. From
 * Android 13 (API 33) POST_NOTIFICATIONS is also a runtime permission
 * (declared in AndroidManifest.xml) that the JS side must request
 * first (localNotify.ts); notify() checks areNotificationsEnabled()
 * itself and simply no-ops rather than throwing if it's not granted —
 * a missed deposit alert is not worth surfacing an error over.
 */
class LocalNotifyModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "LocalNotifyModule"

  companion object {
    private const val CHANNEL_ID = "mango_pro_deposits"
    private val nextId = AtomicInteger(1)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Deposits", NotificationManager.IMPORTANCE_DEFAULT)
    channel.description = "Alerts when funds arrive in your Mango Pro wallet"
    manager.createNotificationChannel(channel)
  }

  @ReactMethod
  fun notify(title: String, body: String, promise: Promise) {
    try {
      val notifManagerCompat = NotificationManagerCompat.from(reactContext)
      if (!notifManagerCompat.areNotificationsEnabled()) {
        promise.resolve(false)
        return
      }
      ensureChannel()
      val notification = NotificationCompat.Builder(reactContext, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(reactContext.applicationInfo.icon)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
      notifManagerCompat.notify(nextId.getAndIncrement(), notification)
      promise.resolve(true)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS not granted — same as "not enabled" above,
      // never worth crashing a deposit-detection call over.
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("NOTIFY_ERROR", e.message, e)
    }
  }
}
