package app.notelin.android;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/** Uses the browser's own cookie store and security UI; no page data is read by Notelin. */
final class StudyCustomTabs {
    private static final int REQUEST_BROWSER = 10820;

    static void open(Activity activity, String url, boolean tablet, boolean left, boolean dark, int width) {
        if (!BrowserBookmarks.validUrl(url)) throw new IllegalArgumentException("올바른 웹 주소를 입력해 주세요.");
        CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setColorScheme(dark ? CustomTabsIntent.COLOR_SCHEME_DARK : CustomTabsIntent.COLOR_SCHEME_LIGHT)
            .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(Color.parseColor(dark ? "#18263a" : "#ffffff")).build())
            .setBackgroundInteractionEnabled(true)
            .setBookmarksButtonEnabled(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_ON);
        if (tablet) builder.setInitialActivityWidthPx(width)
            .setActivitySideSheetBreakpointDp(600)
            .setActivitySideSheetPosition(left ? CustomTabsIntent.ACTIVITY_SIDE_SHEET_POSITION_START : CustomTabsIntent.ACTIVITY_SIDE_SHEET_POSITION_END)
            .setActivitySideSheetMaximizationEnabled(true);
        CustomTabsIntent tab = builder.build();
        String provider = CustomTabsClient.getPackageName(activity, null);
        if (provider != null) tab.intent.setPackage(provider);
        tab.intent.setData(Uri.parse(url));
        // Starting for a result enables partial tabs without a bound service session.
        // Unsupported browsers ignore the sizing hints and open their normal window.
        activity.startActivityForResult(tab.intent, REQUEST_BROWSER);
    }
}
