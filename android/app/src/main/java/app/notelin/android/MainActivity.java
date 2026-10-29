package app.notelin.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.LinkedHashMap;
import java.util.IdentityHashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    private boolean dark;
    private boolean stylusButtonDown;
    private int keyboardInset = -1;
    private final LinkedHashMap<String, StudyBrowserPanel> noteBrowsers = new LinkedHashMap<>(4, .75f, true);
    private NoteBrowserSessions noteBrowserSessions;
    private StudyBrowserPanel studyAi;
    private StudyBrowserPanel activeStudyPanel;
    private float studyBrowserRatio = 1f / 5f;
    private float studyAiRatio = 1f / 5f;
    private boolean studyPanelOccluded;
    private boolean studyPanelOnLeft;
    private ActivityResultLauncher<Intent> studyFilePicker;
    private ValueCallback<Uri[]> studyFileCallback;
    private StudyBrowserPanel studyFileOwner;
    private WebView studyFileView;
    private final Map<WebView, Runnable> studyContentTimeouts = new IdentityHashMap<>();

    @Override public void onCreate(Bundle state) {
        registerPlugin(NotelinDevicePlugin.class);
        registerPlugin(NotelinUpdaterPlugin.class);
        super.onCreate(state);
        studyFilePicker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            ValueCallback<Uri[]> callback = studyFileCallback;
            WebView selectedView = studyFileView;
            studyFileCallback = null;
            studyFileOwner = null;
            studyFileView = null;
            if (callback == null) return;
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData());
            // Some device pickers return the selection in ClipData even when
            // WebView's parser cannot extract it. Keep the normal parser first.
            if (result.getResultCode() == Activity.RESULT_OK && (selected == null || selected.length == 0)) {
                Intent data = result.getData();
                if (data != null) {
                    ClipData clip = data.getClipData();
                    if (clip != null && clip.getItemCount() > 0) {
                        selected = new Uri[clip.getItemCount()];
                        for (int i = 0; i < clip.getItemCount(); i++) selected[i] = clip.getItemAt(i).getUri();
                    } else if (data.getData() != null) selected = new Uri[] { data.getData() };
                }
            }
            if (result.getResultCode() != Activity.RESULT_OK || selected == null || selected.length == 0) {
                if (selectedView != null) revokeStudyContentAccess(selectedView);
                callback.onReceiveValue(null);
                return;
            }
            // A third-party picker can return arbitrary URIs. Never hand an app-
            // private provider or file:// URI to untrusted web content.
            for (Uri uri : selected) {
                if (uri == null || !"content".equalsIgnoreCase(uri.getScheme()) ||
                    uri.getAuthority() == null || uri.getAuthority().equals(getPackageName()) ||
                    uri.getAuthority().startsWith(getPackageName() + ".")) {
                    if (selectedView != null) revokeStudyContentAccess(selectedView);
                    android.widget.Toast.makeText(this, "선택한 파일을 읽을 수 없어요. 다른 사진을 선택해 주세요.", android.widget.Toast.LENGTH_SHORT).show();
                    callback.onReceiveValue(null);
                    return;
                }
            }
            // WebView must be able to read the chosen content:// stream while
            // turning it into the page's File object. The other WebViews stay
            // closed to content providers, and this grant expires shortly.
            if (selectedView != null) {
                Runnable timeout = () -> revokeStudyContentAccess(selectedView);
                studyContentTimeouts.put(selectedView, timeout);
                selectedView.postDelayed(timeout, 600_000);
            }
            callback.onReceiveValue(selected);
        });
        noteBrowserSessions = new NoteBrowserSessions(this);
        studyPanelOnLeft = "left".equals(getSharedPreferences("study-browser", MODE_PRIVATE).getString("panel-side", "right"));
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        content.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (activeStudyPanel != null && right - left != oldRight - oldLeft) layoutStudyPanel();
        });
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int safeTypes = WindowInsetsCompat.Type.navigationBars() | WindowInsetsCompat.Type.captionBar()
                | WindowInsetsCompat.Type.displayCutout();
            if (!isTablet()) safeTypes |= WindowInsetsCompat.Type.statusBars();
            Insets safe = insets.getInsets(safeTypes);
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            // WebView and adjustResize already account for the IME. Padding the
            // root by the IME height again leaves almost no room for web inputs.
            view.setPadding(safe.left, safe.top, safe.right,
                insets.isVisible(WindowInsetsCompat.Type.ime()) ? 0 : safe.bottom);
            if (keyboard.bottom != keyboardInset && bridge != null) {
                keyboardInset = keyboard.bottom;
                int windowHeight;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Rect bounds = getWindowManager().getCurrentWindowMetrics().getBounds();
                    windowHeight = bounds.height();
                } else {
                    Point size = new Point();
                    getWindowManager().getDefaultDisplay().getRealSize(size);
                    windowHeight = size.y;
                }
                int usableHeight = Math.max(0, windowHeight - keyboard.bottom - safe.top);
                bridge.getWebView().evaluateJavascript(
                    "window.__notelinKeyboardInset=" + keyboard.bottom +
                    ";window.__notelinKeyboardUsableHeight=" + usableHeight +
                    ";window.dispatchEvent(new Event('notelin-keyboard-inset'))", null);
            }
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(safeTypes, Insets.NONE)
                .build();
        });
        if (bridge != null) bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        applyChrome();
    }

    // BridgeActivity also dispatches the cold-start intent through onNewIntent.
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (bridge != null && intent != null) {
            NotelinDevicePlugin plugin = (NotelinDevicePlugin) bridge.getPlugin("NotelinDevice").getInstance();
            plugin.receiveDocument(intent);
        }
    }

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        observeStylusButton(event);
        return super.dispatchTouchEvent(event);
    }

    @Override public boolean dispatchGenericMotionEvent(MotionEvent event) {
        observeStylusButton(event);
        return super.dispatchGenericMotionEvent(event);
    }

    private void observeStylusButton(MotionEvent event) {
        if (activeStudyPanel != null && activeStudyPanel.getVisibility() == View.VISIBLE) {
            int[] location = new int[2];
            activeStudyPanel.getLocationOnScreen(location);
            if (event.getRawX() >= location[0] && event.getRawX() < location[0] + activeStudyPanel.getWidth()) {
                stylusButtonDown = false;
                return;
            }
        }
        boolean stylus = false;
        for (int i = 0; i < event.getPointerCount(); i++) {
            if (event.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) { stylus = true; break; }
        }
        if (!stylus) return;
        int buttons = event.getButtonState();
        boolean pressed = (buttons & (MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_STYLUS_SECONDARY)) != 0;
        // Some Samsung devices report the side button as a primary hover press.
        // A normal pen tip can report PRIMARY during contact, so never infer a
        // side-button press from PRIMARY on ACTION_DOWN or ACTION_MOVE.
        int action = event.getActionMasked();
        if ((action == MotionEvent.ACTION_BUTTON_PRESS || action == MotionEvent.ACTION_HOVER_ENTER
            || action == MotionEvent.ACTION_HOVER_MOVE) && (buttons & MotionEvent.BUTTON_PRIMARY) != 0)
            pressed = true;
        if (stylusButtonDown && (buttons & MotionEvent.BUTTON_PRIMARY) != 0 &&
            (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_MOVE)) pressed = true;
        if (pressed && !stylusButtonDown && bridge != null) {
            NotelinDevicePlugin plugin = (NotelinDevicePlugin) bridge.getPlugin("NotelinDevice").getInstance();
            plugin.stylusButtonPressed();
        }
        stylusButtonDown = pressed;
        if (action == MotionEvent.ACTION_HOVER_EXIT || action == MotionEvent.ACTION_CANCEL) stylusButtonDown = false;
    }

    private boolean isTablet() { return getResources().getConfiguration().smallestScreenWidthDp >= 600; }

    public void setDarkChrome(boolean value) { dark = value; applyChrome(); }

    public void chooseStudyFiles(StudyBrowserPanel owner, WebView source, WebChromeClient.FileChooserParams params, ValueCallback<Uri[]> callback) {
        cancelStudyFileChooser(studyFileOwner);
        if (!source.isShown() || owner.getVisibility() != View.VISIBLE) {
            callback.onReceiveValue(null);
            return;
        }
        if (params.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN &&
            params.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            callback.onReceiveValue(null);
            return;
        }
        studyFileCallback = callback;
        studyFileOwner = owner;
        studyFileView = source;
        revokeStudyContentAccess(source);
        source.getSettings().setAllowContentAccess(true);
        try {
            Intent picker = params.createIntent();
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            studyFilePicker.launch(picker);
        } catch (RuntimeException error) {
            cancelStudyFileChooser(owner);
            android.widget.Toast.makeText(this, "파일 선택기를 열지 못했어요.", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    public void cancelStudyFileChooser(StudyBrowserPanel owner) {
        if (owner == null || studyFileOwner != owner) return;
        ValueCallback<Uri[]> callback = studyFileCallback;
        WebView source = studyFileView;
        studyFileCallback = null;
        studyFileOwner = null;
        studyFileView = null;
        if (source != null) revokeStudyContentAccess(source);
        if (callback != null) callback.onReceiveValue(null);
    }

    public void revokeStudyContentAccess(WebView source) {
        Runnable timeout = studyContentTimeouts.remove(source);
        if (timeout != null) source.removeCallbacks(timeout);
        if (source.getParent() != null) source.getSettings().setAllowContentAccess(false);
    }

    public void cancelStudyFileChooser(StudyBrowserPanel owner, WebView source) {
        if (studyFileView == source) cancelStudyFileChooser(owner);
    }

    public void openStudyBrowser(String noteId, String url) {
        StudyBrowserPanel panel = noteBrowsers.get(noteId);
        boolean firstOpen = panel == null;
        if (firstOpen) {
            panel = new StudyBrowserPanel(this, false, () -> closeStudyPanel(true), this::resizeStudyPanel);
            panel.setPageListener(page -> noteBrowserSessions.rememberUrl(noteId, page));
            noteBrowsers.put(noteId, panel);
        }
        showStudyPanel(panel);
        if (url != null) panel.openUrl(url);
        else if (firstOpen && !panel.restoreNoteState(noteBrowserSessions.history(noteId))) {
            String lastUrl = noteBrowserSessions.lastUrl(noteId);
            if (lastUrl != null) panel.openUrl(lastUrl);
        }
        // Keep recent DOMs alive without retaining a heavyweight WebView for every note.
        while (noteBrowsers.size() > 3) {
            Map.Entry<String, StudyBrowserPanel> oldest = noteBrowsers.entrySet().iterator().next();
            StudyBrowserPanel previous = oldest.getValue();
            noteBrowserSessions.rememberHistory(oldest.getKey(), previous.saveNoteState());
            ((FrameLayout) findViewById(android.R.id.content)).removeView(previous);
            previous.release();
            noteBrowsers.remove(oldest.getKey());
        }
    }

    private String studyAiProvider;

    public void openStudyAI(String noteId, String provider) {
        boolean firstOpen = studyAi == null;
        if (firstOpen) studyAi = new StudyBrowserPanel(this, true, () -> closeStudyPanel(true), this::resizeStudyPanel);
        showStudyPanel(studyAi);
        if (firstOpen || !provider.equals(studyAiProvider)) {
            studyAiProvider = provider;
            String label = provider.equals("gemini") ? "Gemini" : provider.equals("claude") ? "Claude" : "ChatGPT";
            String url = provider.equals("gemini") ? "https://gemini.google.com/app" : provider.equals("claude") ? "https://claude.ai/" : "https://chatgpt.com/";
            studyAi.setAiProvider(label);
            studyAi.openUrl(url);
        }
    }

    private void showStudyPanel(StudyBrowserPanel panel) {
        if (activeStudyPanel != null && activeStudyPanel != panel) {
            activeStudyPanel.hidePanel();
        }
        activeStudyPanel = panel;
        panel.setPanelSide(studyPanelOnLeft);
        FrameLayout content = findViewById(android.R.id.content);
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(studyPanelWidth(),
            FrameLayout.LayoutParams.MATCH_PARENT, (studyPanelOnLeft ? Gravity.LEFT : Gravity.RIGHT) | Gravity.TOP);
        if (panel.getParent() == null) content.addView(panel, layout); else panel.setLayoutParams(layout);
        panel.setVisibility(studyPanelOccluded ? View.GONE : View.VISIBLE);
        panel.setDark(dark);
        panel.bringToFront();
        notifyStudyPanelSize();
    }

    public void closeStudyPanel() { closeStudyPanel(false); }
    public String studyPanelSide() { return studyPanelOnLeft ? "left" : "right"; }
    public void clearStudyLoginCookies(Runnable done) {
        closeStudyPanel(true);
        FrameLayout content = findViewById(android.R.id.content);
        for (StudyBrowserPanel panel : noteBrowsers.values()) { content.removeView(panel); panel.release(); }
        noteBrowsers.clear();
        if (studyAi != null) { content.removeView(studyAi); studyAi.release(); studyAi = null; }
        noteBrowserSessions.clearHistories();
        // Cookies belong to this app's WebViews, not Chrome/Samsung Internet.
        // Never clear WebStorage globally: Notelin notes live in IndexedDB.
        CookieManager.getInstance().removeAllCookies(removed -> { CookieManager.getInstance().flush(); done.run(); });
    }
    public void setStudyPanelSide(String side) {
        studyPanelOnLeft = "left".equals(side);
        getSharedPreferences("study-browser", MODE_PRIVATE).edit().putString("panel-side", studyPanelSide()).apply();
        if (activeStudyPanel != null) {
            activeStudyPanel.setPanelSide(studyPanelOnLeft);
            layoutStudyPanel();
        }
    }
    public void setStudyPanelOccluded(boolean hidden) {
        studyPanelOccluded = hidden;
        if (activeStudyPanel != null) activeStudyPanel.setVisibility(hidden ? View.GONE : View.VISIBLE);
    }

    private void closeStudyPanel(boolean notifyWeb) {
        if (activeStudyPanel == null) return;
        activeStudyPanel.hidePanel();
        activeStudyPanel = null;
        studyPanelOccluded = false;
        if (notifyWeb && bridge != null) bridge.getWebView().evaluateJavascript(
            "window.dispatchEvent(new Event('notelin-study-browser-closed'))", null);
    }

    private int studyPanelWidth() {
        if (!isTablet()) return FrameLayout.LayoutParams.MATCH_PARENT;
        return Math.round(studyBrowserAvailableWidth() * activeStudyRatio());
    }

    private float activeStudyRatio() { return activeStudyPanel == studyAi ? studyAiRatio : studyBrowserRatio; }

    private int studyBrowserAvailableWidth() {
        View content = findViewById(android.R.id.content);
        return Math.max(1, content.getWidth() - content.getPaddingLeft() - content.getPaddingRight());
    }

    private void resizeStudyPanel(int width) {
        if (activeStudyPanel == null || !isTablet()) return;
        int available = studyBrowserAvailableWidth();
        float ratio = Math.max(.1f, Math.min(.8f, (float) width / available));
        if (activeStudyPanel == studyAi) studyAiRatio = ratio; else studyBrowserRatio = ratio;
        layoutStudyPanel();
    }

    private void layoutStudyPanel() {
        if (activeStudyPanel == null) return;
        FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) activeStudyPanel.getLayoutParams();
        layout.width = studyPanelWidth();
        layout.gravity = (studyPanelOnLeft ? Gravity.LEFT : Gravity.RIGHT) | Gravity.TOP;
        activeStudyPanel.setLayoutParams(layout);
        notifyStudyPanelSize();
    }

    private void notifyStudyPanelSize() {
        if (bridge == null) return;
        float ratio = isTablet() ? activeStudyRatio() : 1;
        bridge.getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('notelin-study-browser-resized',{detail:{ratio:"
            + ratio + ",side:'" + studyPanelSide() + "'}}))", null);
    }

    private void applyChrome() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        // Hiding navigation bars makes Android consume the first edge gesture
        // to reveal system controls. Keep Back available on the first gesture.
        controller.show(WindowInsetsCompat.Type.navigationBars());
        if (isTablet()) controller.hide(WindowInsetsCompat.Type.statusBars());
        else controller.show(WindowInsetsCompat.Type.statusBars());
        getWindow().getDecorView().setBackgroundColor(Color.parseColor(dark ? "#0e1624" : "#f4f7ff"));
        for (StudyBrowserPanel panel : noteBrowsers.values()) panel.setDark(dark);
        if (studyAi != null) studyAi.setDark(dark);
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) applyChrome();
    }

    @Override public void onPause() {
        for (StudyBrowserPanel panel : noteBrowsers.values()) panel.persistSession();
        if (studyAi != null) studyAi.persistSession();
        super.onPause();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applyChrome();
        findViewById(android.R.id.content).post(this::layoutStudyPanel);
    }

    @Override public void onDestroy() {
        closeStudyPanel();
        FrameLayout content = findViewById(android.R.id.content);
        for (StudyBrowserPanel panel : noteBrowsers.values()) { content.removeView(panel); panel.release(); }
        if (studyAi != null) { content.removeView(studyAi); studyAi.release(); }
        noteBrowsers.clear(); studyAi = null;
        super.onDestroy();
    }
}
