package com.bleindoorbeacon

import com.facebook.react.bridge.ReactApplicationContext

class BleIndoorBeaconModule(reactContext: ReactApplicationContext) :
  NativeBleIndoorBeaconSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeBleIndoorBeaconSpec.NAME
  }
}
