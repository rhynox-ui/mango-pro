package com.mangoprotocol.pro

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Ported verbatim from mango-mobile's own ScreenSecurityModule.kt.
 * Toggles FLAG_SECURE (blocks screenshots, screen recording, and the
 * recent-apps thumbnail) on the current activity's window, on demand
 * rather than app-wide. The recovery-phrase reveal screen
 * (RevealPhraseModal.tsx) needs this: a screenshot of it is a direct,
 * permanent path to draining the wallet (malware like SparkKitty scans
 * photo galleries with OCR specifically for seed phrases), unlike a
 * screenshot of a balance or a trade quote, which reveals nothing
 * exploitable.
 */
class ScreenSecurityModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "ScreenSecurityModule"

  @ReactMethod
  fun setSecure(secure: Boolean, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    activity.runOnUiThread {
      if (secure) {
        activity.window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
    promise.resolve(true)
  }
}
