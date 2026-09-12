package com.mangoprotocol.pro

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Native PBKDF2 acceleration (see Pbkdf2Module.kt) — not
          // autolinkable since it's a plain module in this app's own
          // source tree, not an installed RN package.
          add(Pbkdf2Package())
          // Deposit-received local notifications (see LocalNotifyModule.kt).
          add(LocalNotifyPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
