package app.notelin.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** Explicitly saved browser URLs are separate from cached in-app WebView pages. */
final class ConnectedBrowserPages {
    private final SharedPreferences preferences;

    ConnectedBrowserPages(Context context) { preferences = context.getSharedPreferences("connected-browser-pages", Context.MODE_PRIVATE); }

    String lastUrl(String noteId, boolean ai) {
        String url = preferences.getString(key(noteId, ai), null);
        return validUrl(url, ai) ? url : null;
    }

    boolean save(String noteId, boolean ai, String url) {
        if (noteId == null || noteId.trim().isEmpty() || noteId.length() > 200 || !validUrl(url, ai)) return false;
        preferences.edit().putString(key(noteId, ai), url).apply();
        return true;
    }

    private String key(String noteId, boolean ai) { return (ai ? "ai:" : "web:") + noteId; }

    private boolean validUrl(String url, boolean ai) {
        if (!BrowserBookmarks.validUrl(url)) return false;
        if (!ai) return true;
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme()) && "chatgpt.com".equalsIgnoreCase(uri.getHost());
    }
}
