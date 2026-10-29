package app.notelin.android;

import android.content.Intent;
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
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean dark;
    private boolean stylusButtonDown;
    private int keyboardInset = -1;
    private StudyBrowserPanel studyBrowser;
    private float studyBrowserRatio = 1f / 6f;

    @Override public void onCreate(Bundle state) {
        registerPlugin(NotelinDevicePlugin.class);
        registerPlugin(NotelinUpdaterPlugin.class);
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        content.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (studyBrowser != null && right - left != oldRight - oldLeft) layoutStudyBrowser();
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
        if (studyBrowser != null && studyBrowser.getVisibility() == View.VISIBLE) {
            int[] location = new int[2];
            studyBrowser.getLocationOnScreen(location);
            if (event.getRawX() >= location[0] && event.getRawX() < location[0] + studyBrowser.getWidth()) {
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

    public void openStudyBrowser() {
        if (studyBrowser != null) return;
        FrameLayout content = findViewById(android.R.id.content);
        studyBrowser = new StudyBrowserPanel(this, () -> closeStudyBrowser(true), this::resizeStudyBrowser);
        studyBrowser.setDark(dark);
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(studyBrowserWidth(),
            FrameLayout.LayoutParams.MATCH_PARENT, Gravity.RIGHT | Gravity.TOP);
        content.addView(studyBrowser, layout);
        studyBrowser.bringToFront();
        notifyStudyBrowserSize();
    }

    public void closeStudyBrowser() { closeStudyBrowser(false); }
    public void setStudyBrowserOccluded(boolean hidden) {
        if (studyBrowser != null) studyBrowser.setVisibility(hidden ? View.GONE : View.VISIBLE);
    }

    private void closeStudyBrowser(boolean notifyWeb) {
        if (studyBrowser == null) return;
        FrameLayout content = findViewById(android.R.id.content);
        content.removeView(studyBrowser);
        studyBrowser.release();
        studyBrowser = null;
        if (notifyWeb && bridge != null) bridge.getWebView().evaluateJavascript(
            "window.dispatchEvent(new Event('notelin-study-browser-closed'))", null);
    }

    private int studyBrowserWidth() {
        if (!isTablet()) return FrameLayout.LayoutParams.MATCH_PARENT;
        return Math.round(studyBrowserAvailableWidth() * studyBrowserRatio);
    }

    private int studyBrowserAvailableWidth() {
        View content = findViewById(android.R.id.content);
        return Math.max(1, content.getWidth() - content.getPaddingLeft() - content.getPaddingRight());
    }

    private void resizeStudyBrowser(int width) {
        if (studyBrowser == null || !isTablet()) return;
        int available = studyBrowserAvailableWidth();
        studyBrowserRatio = Math.max(.1f, Math.min(.8f, (float) width / available));
        layoutStudyBrowser();
    }

    private void layoutStudyBrowser() {
        if (studyBrowser == null) return;
        FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) studyBrowser.getLayoutParams();
        layout.width = studyBrowserWidth();
        studyBrowser.setLayoutParams(layout);
        notifyStudyBrowserSize();
    }

    private void notifyStudyBrowserSize() {
        if (bridge == null) return;
        float ratio = isTablet() ? studyBrowserRatio : 1;
        bridge.getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('notelin-study-browser-resized',{detail:{ratio:"
            + ratio + "}}))", null);
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
        if (studyBrowser != null) studyBrowser.setDark(dark);
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) applyChrome();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applyChrome();
        findViewById(android.R.id.content).post(this::layoutStudyBrowser);
    }

    @Override public void onDestroy() {
        closeStudyBrowser();
        super.onDestroy();
    }
}
