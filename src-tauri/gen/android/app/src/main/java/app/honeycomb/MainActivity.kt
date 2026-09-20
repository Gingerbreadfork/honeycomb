package app.honeycomb

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : TauriActivity() {
  // Wry's default Back handling finishes the activity; the page decides instead.
  override val handleBackNavigation: Boolean = false
  private var web: WebView? = null

  private external fun initAndroidContext(activity: android.app.Activity)

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(Bridge(), "HoneycombAndroid")
  }

  /** What the page can ask the phone to do: print the current page (Save as PDF lives there) and share a file. */
  inner class Bridge {
    @JavascriptInterface
    fun print(title: String) {
      runOnUiThread {
        val view = web ?: return@runOnUiThread
        val printing = getSystemService(Context.PRINT_SERVICE) as PrintManager
        printing.print(title, view.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
      }
    }

    @JavascriptInterface
    fun shareFile(name: String, mime: String, text: String) {
      runOnUiThread {
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        val file = File(dir, name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
        file.writeText(text)
        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
          type = mime
          putExtra(Intent.EXTRA_STREAM, uri)
          clipData = ClipData.newRawUri(name, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, null))
      }
    }
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
