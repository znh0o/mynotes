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

    @Override public void onCreate(Bundle state) {
        registerPlugin(NotelinDevicePlugin.class);
        registerPlugin(NotelinUpdaterPlugin.class);
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int safeTypes = WindowInsetsCompat.Type.navigationBars() | WindowInsetsCompat.Type.captionBar()
                | WindowInsetsCompat.Type.displayCutout();
            if (!isTablet()) safeTypes |= WindowInsetsCompat.Type.statusBars();
            Insets safe = insets.getInsets(safeTypes);
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard.bottom));
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
            return insets;
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
        ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) applyChrome();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        applyChrome();
    }
}
