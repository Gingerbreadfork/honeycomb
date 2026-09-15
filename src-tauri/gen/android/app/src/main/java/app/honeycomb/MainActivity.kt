package app.honeycomb

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  // Wry's default Back handling finishes the activity; the page decides instead.
  override val handleBackNavigation: Boolean = false
  private var web: WebView? = null

  private external fun initAndroidContext(activity: android.app.Activity)

  override fun onWebViewCreate(webView: WebView) {
    web = webView
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    try {
      initAndroidContext(this)
    } catch (e: Throwable) {
      android.util.Log.w("honeycomb", "Android context init failed", e)
    }
    // Back closes whatever the page has open; when nothing is open the app goes to the background.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val w = web
        if (w == null) {
          moveTaskToBack(true)
          return
        }
        w.evaluateJavascript("(function(){try{return window.__honeycombBack?window.__honeycombBack():false}catch(e){return false}})()") { result ->
          if (result != "true") moveTaskToBack(true)
        }
      }
    })
  }
}
