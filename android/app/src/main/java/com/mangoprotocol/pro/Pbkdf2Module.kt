package com.mangoprotocol.pro

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Native PBKDF2-HmacSHA256, backed by the JVM/Android platform's own
 * javax.crypto (JCA) implementation instead of pure-JS.
 *
 * Ported byte-for-byte from mango-mobile's own Pbkdf2Module.kt, which
 * exists because src/wallet/walletCipher.ts derives the wallet's AES
 * key via 600,000 PBKDF2 iterations (OWASP's current minimum for
 * PBKDF2-SHA256) on every password entry — unlock, and every
 * password-gated action. Run in pure JS via @noble/hashes under Hermes
 * (no JIT, unlike V8/ART), that's several real seconds of computation
 * each time, felt directly as a hung "Encrypting your wallet..."
 * screen on a real device. The exact same standard algorithm run here
 * through the JVM's own crypto provider is JIT/AOT-compiled, not
 * interpreted, and produces byte-identical output to @noble's
 * implementation for the same inputs (already cross-checked during
 * mobile's own development) — a pure speed win with no change to what
 * gets encrypted/decrypted or how strong it is.
 *
 * If this module is ever unavailable for any reason, callers fall back
 * to the existing pure-JS path (see nativePbkdf2.ts / walletCipher.ts)
 * — this is a performance optimization, never a hard dependency.
 */
class Pbkdf2Module(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "Pbkdf2Module"

  @ReactMethod
  fun deriveSha256(password: String, saltBase64: String, iterations: Int, keyLengthBytes: Int, promise: Promise) {
    // Off the calling (native-modules) thread on general principle, even
    // though this bridge call is already invoked off the JS thread —
    // a real ~600k-iteration KDF has no business risking any UI-adjacent
    // thread, no matter how fast it usually is.
    Thread {
      try {
        val salt = Base64.decode(saltBase64, Base64.NO_WRAP)
        val spec = PBEKeySpec(password.toCharArray(), salt, iterations, keyLengthBytes * 8)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val keyBytes = factory.generateSecret(spec).encoded
        promise.resolve(Base64.encodeToString(keyBytes, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("PBKDF2_ERROR", e.message, e)
      }
    }.start()
  }
}
