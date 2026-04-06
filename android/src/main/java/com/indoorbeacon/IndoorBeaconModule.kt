package com.indoorbeacon

import com.facebook.react.bridge.ReactApplicationContext

class IndoorBeaconModule(reactContext: ReactApplicationContext) :
  NativeIndoorBeaconSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeIndoorBeaconSpec.NAME
  }
}
