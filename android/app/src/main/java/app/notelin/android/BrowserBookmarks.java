package app.notelin.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

final class BrowserBookmarks {
    static final class Entry {
        final String title, url;
        Entry(String title, String url) { this.title = title; this.url = url; }
    }

    private final SharedPreferences preferences;
    BrowserBookmarks(Context context) { preferences = context.getSharedPreferences("study-browser", Context.MODE_PRIVATE); }

    List<Entry> all() {
        List<Entry> entries = new ArrayList<>();
        try {
            JSONArray saved = new JSONArray(preferences.getString("bookmarks", "[]"));
            for (int index = 0; index < saved.length(); index++) {
                JSONObject item = saved.optJSONObject(index);
                if (item == null) continue;
                String url = secureUrl(item.optString("url", ""));
                if (url != null) entries.add(new Entry(title(item.optString("title", ""), url), url));
            }
        } catch (Exception ignored) { /* A malformed bookmark never prevents the browser from opening. */ }
        return entries;
    }

    boolean contains(String url) {
        for (Entry entry : all()) if (entry.url.equals(url)) return true;
        return false;
    }

    void add(String name, String url) {
        if (!validUrl(url) || contains(url)) return;
        List<Entry> entries = all();
        entries.add(new Entry(title(name, url), url));
        save(entries);
    }

    void remove(String url) {
        List<Entry> entries = all();
        entries.removeIf(entry -> entry.url.equals(url));
        save(entries);
    }

    private void save(List<Entry> entries) {
        JSONArray saved = new JSONArray();
        for (Entry entry : entries) {
            JSONObject item = new JSONObject();
            try { item.put("title", entry.title); item.put("url", entry.url); saved.put(item); }
            catch (Exception ignored) { /* Entries contain only bounded text. */ }
        }
        preferences.edit().putString("bookmarks", saved.toString()).apply();
    }

    static boolean validUrl(String value) {
        if (value == null || value.length() > 4096) return false;
        Uri uri = Uri.parse(value);
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
    }

    // Keep previously saved HTTP bookmarks visible after cleartext is disabled.
    // Only an HTTPS equivalent may be opened; the stored record is untouched.
    static String secureUrl(String value) {
        if (validUrl(value)) return value;
        if (value == null || value.length() > 4096) return null;
        Uri old = Uri.parse(value);
        if (!"http".equalsIgnoreCase(old.getScheme()) || old.getHost() == null) return null;
        String upgraded = old.buildUpon().scheme("https").encodedAuthority(old.getHost()).build().toString();
        return validUrl(upgraded) ? upgraded : null;
    }

    private static String title(String value, String url) {
        String name = value == null ? "" : value.trim();
        if (name.isEmpty()) name = Uri.parse(url).getHost();
        return name.substring(0, Math.min(120, name.length()));
    }
}
