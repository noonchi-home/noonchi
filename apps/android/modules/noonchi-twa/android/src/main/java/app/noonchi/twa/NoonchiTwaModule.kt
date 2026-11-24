package app.noonchi.twa

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsService
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import androidx.browser.trusted.ScreenOrientation
import androidx.browser.trusted.TrustedWebActivityDisplayMode
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHROME = "com.android.chrome"
private const val RELATION = CustomTabsService.RELATION_HANDLE_ALL_URLS
private const val CANCELED = "클로이드 열기를 취소했어요."
private const val LINK_FAILED = "Chrome에서 AR 서버와 앱의 서명을 확인하지 못했어요."

class NoonchiTwaModule : Module() {
    private val handler = Handler(Looper.getMainLooper())
    private var pending: Attempt? = null

    override fun definition() = ModuleDefinition {
        Name("NoonchiTwa")

        AsyncFunction("open") { url: String, origin: String, token: String, promise: Promise ->
            open(Uri.parse(url), Uri.parse(origin), token, promise)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("cancel") { token: String ->
            val attempt = pending
            if (attempt?.token == token) finish(attempt, CANCELED)
        }.runOnQueue(Queues.MAIN)

        OnDestroy {
            handler.post { pending?.let { finish(it, CANCELED) } }
        }
    }

    private fun open(url: Uri, origin: Uri, token: String, promise: Promise) {
        if (!sameOrigin(url, origin) || url.path != "/phone/" || url.query != null || url.fragment != null) {
            promise.reject("ERR_NOONCHI_TWA", "허브의 AR 연결 주소를 확인해 주세요.", null)
            return
        }
        val activity = appContext.currentActivity
        if (activity == null || !activity.hasWindowFocus() || pending != null) {
            promise.reject("ERR_NOONCHI_TWA", CANCELED, null)
            return
        }
        val provider = Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION)
            .setPackage(CHROME)
            .addCategory(CustomTabsService.TRUSTED_WEB_ACTIVITY_CATEGORY)
        if (activity.packageManager.queryIntentServices(provider, 0).isEmpty()) {
            promise.reject("ERR_NOONCHI_TWA", "이 화면을 열 수 있는 Android Chrome을 설치하거나 업데이트해 주세요.", null)
            return
        }
        val attempt = Attempt(activity, url, origin, token, promise)
        pending = attempt
        attempt.bound = runCatching {
            CustomTabsClient.bindCustomTabsService(activity.applicationContext, CHROME, attempt.connection)
        }.getOrDefault(false)
        if (attempt.bound) handler.postDelayed(attempt.timeout, 12000)
        else finish(attempt, "Android Chrome에 연결하지 못했어요.")
    }

    private inner class Attempt(
        val activity: Activity,
        val url: Uri,
        val origin: Uri,
        val token: String,
        val promise: Promise,
    ) {
        var bound = false
        val timeout = Runnable { finish(this, "Chrome에서 연결을 확인하는 시간이 지났어요.") }
        val connection = object : CustomTabsServiceConnection() {
            override fun onCustomTabsServiceConnected(name: ComponentName, client: CustomTabsClient) {
                if (pending !== this@Attempt) return
                if (name.packageName != CHROME || !client.warmup(0L)) {
                    finish(this@Attempt, LINK_FAILED)
                    return
                }
                val callback = object : CustomTabsCallback() {
                    override fun onRelationshipValidationResult(relation: Int, requestedOrigin: Uri, result: Boolean, extras: Bundle?) {
                        if (pending !== this@Attempt || relation != RELATION || !sameOrigin(requestedOrigin, origin)) return
                        val verified = session
                        if (!result || verified == null) {
                            finish(this@Attempt, LINK_FAILED)
                            return
                        }
                        if (activity !== appContext.currentActivity || activity.isDestroyed || !activity.hasWindowFocus()) {
                            finish(this@Attempt, CANCELED)
                            return
                        }
                        val opened = runCatching {
                            val cameraUrl = url.buildUpon().appendQueryParameter("launch", "android").build()
                            TrustedWebActivityIntentBuilder(cameraUrl)
                                .setDisplayMode(TrustedWebActivityDisplayMode.DefaultMode())
                                .setScreenOrientation(ScreenOrientation.LANDSCAPE)
                                .build(verified)
                                .launchTrustedWebActivity(activity)
                        }.isSuccess
                        finish(this@Attempt, if (opened) null else "Chrome에서 클로이드를 열지 못했어요.")
                    }
                }
                session = client.newSession(callback)
                if (session?.validateRelationship(RELATION, origin, null) != true) finish(this@Attempt, LINK_FAILED)
            }

            override fun onServiceDisconnected(name: ComponentName) {
                finish(this@Attempt, "Android Chrome 연결이 끊겼어요.")
            }

            private var session: CustomTabsSession? = null
        }
    }

    private fun finish(attempt: Attempt, message: String?) {
        if (pending !== attempt) return
        pending = null
        handler.removeCallbacks(attempt.timeout)
        if (attempt.bound) runCatching { attempt.activity.applicationContext.unbindService(attempt.connection) }
        if (message == null) attempt.promise.resolve()
        else attempt.promise.reject("ERR_NOONCHI_TWA", message, null)
    }
}

private fun sameOrigin(left: Uri, right: Uri): Boolean =
    left.scheme == "https" && right.scheme == "https" && left.userInfo == null && right.userInfo == null &&
        left.host != null && left.host.equals(right.host, ignoreCase = true) &&
        (if (left.port < 0) 443 else left.port) == (if (right.port < 0) 443 else right.port)
