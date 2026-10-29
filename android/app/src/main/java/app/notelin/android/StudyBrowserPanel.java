package app.notelin.android;

import android.content.Intent;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.text.InputType;
import android.view.Gravity;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.view.View;
import java.util.ArrayList;
import java.util.List;

/** A separate WebView for web research. It never receives Capacitor's bridge. */
final class StudyBrowserPanel extends LinearLayout {
    private final MainActivity activity;
    private final LinearLayout toolbar;
    private final EditText address;
    private final ProgressBar progress;
    private final WebView web;
    private final TextView placeholder;
    private final List<TextView> actions = new ArrayList<>();
    private final TextView back, forward;

    StudyBrowserPanel(MainActivity activity, Runnable close) {
        super(activity);
        this.activity = activity;
        web = new WebView(activity);
        setOrientation(VERTICAL);
        setElevation(dp(12));

        toolbar = new LinearLayout(activity);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(6), dp(5), dp(6), dp(5));
        addView(toolbar, new LayoutParams(LayoutParams.MATCH_PARENT, dp(54)));
        back = action("‹", "이전 웹페이지", () -> { if (web.canGoBack()) web.goBack(); });
        forward = action("›", "다음 웹페이지", () -> { if (web.canGoForward()) web.goForward(); });

        address = new EditText(activity);
        address.setSingleLine(true);
        address.setSelectAllOnFocus(true);
        address.setTextSize(13);
        address.setHint("검색어 또는 웹 주소");
        address.setPadding(dp(12), 0, dp(12), 0);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO | EditorInfo.IME_FLAG_NO_FULLSCREEN | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        address.setOnEditorActionListener((field, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_GO && actionId != EditorInfo.IME_ACTION_DONE) return false;
            navigate(address.getText().toString());
            address.clearFocus();
            hideKeyboard();
            web.requestFocus();
            return true;
        });
        LayoutParams addressParams = new LayoutParams(0, dp(39), 1);
        addressParams.setMargins(dp(4), 0, dp(4), 0);
        toolbar.addView(address, addressParams);
        action("↻", "새로고침", () -> { if (web.getUrl() != null) web.reload(); });
        action("↗", "기본 브라우저에서 열기", this::openExternal);
        action("×", "인터넷 패널 닫기", close);

        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        addView(progress, new LayoutParams(LayoutParams.MATCH_PARENT, dp(2)));

        View divider = new View(activity);
        addView(divider, new LayoutParams(LayoutParams.MATCH_PARENT, dp(1)));

        FrameLayout page = new FrameLayout(activity);
        addView(page, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
        web.setVisibility(View.GONE);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !isWebAddress(uri);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!address.hasFocus() && isWebAddress(Uri.parse(url))) address.setText(url);
                updateNavigation();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int amount) {
                progress.setProgress(amount);
                progress.setVisibility(amount >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        page.addView(web, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        placeholder = new TextView(activity);
        placeholder.setText("필기하면서 필요한 내용을 찾아보세요.\n위 검색창에 검색어나 주소를 입력하세요.");
        placeholder.setTextSize(13);
        placeholder.setGravity(Gravity.CENTER);
        placeholder.setLineSpacing(dp(5), 1);
        page.addView(placeholder, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        updateNavigation();
        setDark(false);
        divider.setBackgroundColor(Color.parseColor("#dde4ef"));
    }

    private TextView action(String glyph, String description, Runnable listener) {
        TextView button = new TextView(activity);
        button.setText(glyph);
        button.setTextSize(23);
        button.setGravity(Gravity.CENTER);
        button.setContentDescription(description);
        button.setOnClickListener(view -> listener.run());
        toolbar.addView(button, new LayoutParams(dp(38), dp(42)));
        actions.add(button);
        return button;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static boolean isWebAddress(Uri uri) {
        String scheme = uri.getScheme();
        return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) && uri.getHost() != null;
    }

    private void navigate(String input) {
        String value = input.trim();
        if (value.isEmpty()) return;
        String url;
        if (value.matches("(?i)^https?://.+")) url = value;
        else if (value.matches("(?i)^[^\\s/]+\\.[^\\s]+$")) url = "https://" + value;
        else url = "https://www.google.com/search?q=" + Uri.encode(value);
        Uri uri = Uri.parse(url);
        if (!isWebAddress(uri)) return;
        placeholder.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(uri.toString());
    }

    private void openExternal() {
        String url = web.getUrl();
        if (url == null || !isWebAddress(Uri.parse(url))) return;
        try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (Exception error) { Toast.makeText(activity, "브라우저를 열지 못했어요.", Toast.LENGTH_SHORT).show(); }
    }

    private void updateNavigation() {
        back.setAlpha(web.canGoBack() ? 1 : .35f);
        forward.setAlpha(web.canGoForward() ? 1 : .35f);
    }

    void setDark(boolean dark) {
        int surface = Color.parseColor(dark ? "#18263a" : "#ffffff");
        int ink = Color.parseColor(dark ? "#e4edfa" : "#28435f");
        int muted = Color.parseColor(dark ? "#9db0c8" : "#7188a2");
        setBackgroundColor(surface);
        toolbar.setBackgroundColor(surface);
        for (TextView action : actions) action.setTextColor(ink);
        address.setTextColor(ink);
        address.setHintTextColor(muted);
        GradientDrawable input = new GradientDrawable();
        input.setColor(Color.parseColor(dark ? "#263a53" : "#f1f5fb"));
        input.setCornerRadius(dp(9));
        address.setBackground(input);
        placeholder.setTextColor(muted);
    }

    void release() {
        hideKeyboard();
        web.stopLoading();
        web.destroy();
    }

    private void hideKeyboard() {
        InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(), 0);
    }
}
