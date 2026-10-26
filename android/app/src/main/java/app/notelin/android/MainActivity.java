package app.notelin.android;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean dark;

    @Override public void onCreate(Bundle state) {
        registerPlugin(NotelinDevicePlugin.class);
        registerPlugin(NotelinUpdaterPlugin.class);
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets safe = insets.getInsets(isTablet()
                ? WindowInsetsCompat.Type.displayCutout()
                : WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard.bottom));
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

    private boolean isTablet() { return getResources().getConfiguration().smallestScreenWidthDp >= 600; }

    public void setDarkChrome(boolean value) { dark = value; applyChrome(); }

    private void applyChrome() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        if (isTablet()) controller.hide(WindowInsetsCompat.Type.systemBars());
        else controller.show(WindowInsetsCompat.Type.systemBars());
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
