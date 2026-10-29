package app.notelin.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import java.util.LinkedHashMap;

/** Page state belongs to a note; cookies and bookmarks keep their shared stores. */
final class NoteBrowserSessions {
    private final SharedPreferences pages;
    private final LinkedHashMap<String, Bundle> histories = new LinkedHashMap<>(24, .75f, true);

    NoteBrowserSessions(Context context) { pages = context.getSharedPreferences("note-browser-pages", Context.MODE_PRIVATE); }

    String lastUrl(String noteId) {
        String url = pages.getString(noteId, null);
        return BrowserBookmarks.validUrl(url) ? url : null;
    }

    void rememberUrl(String noteId, String url) {
        if (BrowserBookmarks.validUrl(url) && !url.equals(lastUrl(noteId))) pages.edit().putString(noteId, url).apply();
    }

    Bundle history(String noteId) {
        Bundle state = histories.get(noteId);
        return state == null ? null : new Bundle(state);
    }

    void rememberHistory(String noteId, Bundle state) {
        if (state == null) return;
        histories.put(noteId, new Bundle(state));
        while (histories.size() > 24) histories.remove(histories.keySet().iterator().next());
    }

    void clearHistories() { histories.clear(); }
}
