package app.notelin.android;

import android.content.Intent;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Message;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
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
import java.util.function.IntConsumer;

/** A separate WebView for web research. It never receives Capacitor's bridge. */
final class StudyBrowserPanel extends LinearLayout {
    private final MainActivity activity;
    private final LinearLayout toolbar;
    private final LinearLayout addressRow;
    private final FrameLayout resizeHandle, page;
    private final View grip;
    private final EditText address;
    private final ProgressBar progress;
    private final WebView web;
    private final TextView placeholder;
    private final List<TextView> actions = new ArrayList<>();
    private final List<WebView> popups = new ArrayList<>();
    private final TextView back, forward;

    StudyBrowserPanel(MainActivity activity, Runnable close, IntConsumer resize) {
        super(activity);
        this.activity = activity;
        web = new WebView(activity);
        setOrientation(HORIZONTAL);
        setElevation(dp(12));

        resizeHandle = new FrameLayout(activity);
        resizeHandle.setContentDescription("인터넷 패널 너비 조절");
        resizeHandle.setFocusable(true);
        grip = new View(activity);
        FrameLayout.LayoutParams gripLayout = new FrameLayout.LayoutParams(dp(3), dp(46), Gravity.CENTER);
        resizeHandle.addView(grip, gripLayout);
        final float[] startX = new float[1];
        final int[] startWidth = new int[1];
        resizeHandle.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                startX[0] = event.getRawX();
                startWidth[0] = getWidth();
                view.getParent().requestDisallowInterceptTouchEvent(true);
                view.setAlpha(.65f);
            } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                resize.accept(startWidth[0] + Math.round(startX[0] - event.getRawX()));
            } else if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                view.setAlpha(1);
                view.getParent().requestDisallowInterceptTouchEvent(false);
                if (event.getActionMasked() == MotionEvent.ACTION_UP) view.performClick();
            }
            return true;
        });
        resizeHandle.setOnKeyListener((view, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (keyCode != KeyEvent.KEYCODE_DPAD_LEFT && keyCode != KeyEvent.KEYCODE_DPAD_RIGHT) return false;
            resize.accept(getWidth() + dp(keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? 32 : -32));
            return true;
        });
        if (getResources().getConfiguration().smallestScreenWidthDp < 600) resizeHandle.setVisibility(View.GONE);
        addView(resizeHandle, new LayoutParams(dp(14), LayoutParams.MATCH_PARENT));

        LinearLayout body = new LinearLayout(activity);
        body.setOrientation(VERTICAL);
        addView(body, new LayoutParams(0, LayoutParams.MATCH_PARENT, 1));
        addressRow = new LinearLayout(activity);
        addressRow.setPadding(dp(6), dp(6), dp(6), 0);
        body.addView(addressRow, new LayoutParams(LayoutParams.MATCH_PARENT, dp(46)));

        toolbar = new LinearLayout(activity);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(3), 0, dp(3), 0);
        body.addView(toolbar, new LayoutParams(LayoutParams.MATCH_PARENT, dp(38)));
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
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_UP;
            if (actionId != EditorInfo.IME_ACTION_GO && actionId != EditorInfo.IME_ACTION_DONE && !enter) return false;
            navigate(address.getText().toString());
            address.clearFocus();
            hideKeyboard();
            web.requestFocus();
            return true;
        });
        addressRow.addView(address, new LayoutParams(LayoutParams.MATCH_PARENT, dp(39)));
        action("↻", "새로고침", () -> { if (web.getUrl() != null) web.reload(); });
        action("↗", "기본 브라우저에서 열기", this::openExternal);
        action("×", "인터넷 패널 닫기", close);

        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        body.addView(progress, new LayoutParams(LayoutParams.MATCH_PARENT, dp(2)));

        View divider = new View(activity);
        body.addView(divider, new LayoutParams(LayoutParams.MATCH_PARENT, dp(1)));

        page = new FrameLayout(activity);
        body.addView(page, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
        web.setVisibility(View.GONE);
        configureWebView(web);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return handleSpecialLink(uri);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                placeholder.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (!request.isForMainFrame()) return;
                placeholder.setText("페이지를 열지 못했어요.\n주소와 인터넷 연결을 확인해 주세요.");
                placeholder.setVisibility(View.VISIBLE);
                web.setVisibility(View.GONE);
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
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture || popups.size() >= 2) return false;
                WebView popup = new WebView(activity);
                configureWebView(popup);
                popups.add(popup);
                page.addView(popup, new FrameLayout.LayoutParams(0, 0));
                popup.setWebViewClient(new WebViewClient() {
                    private boolean forwarded;
                    private void forward(String url) {
                        if (forwarded || "about:blank".equals(url)) return;
                        forwarded = true;
                        Uri uri = Uri.parse(url);
                        if (isWebAddress(uri)) navigate(url); else handleSpecialLink(uri);
                        popup.post(() -> { if (popups.remove(popup)) { page.removeView(popup); popup.destroy(); } });
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView target, WebResourceRequest request) {
                        forward(request.getUrl().toString()); return true;
                    }
                    @Override public void onPageStarted(WebView target, String url, android.graphics.Bitmap favicon) { forward(url); }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget();
                return true;
            }
        });
        page.addView(web, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        placeholder = new TextView(activity);
        placeholder.setText("필기하면서 필요한 내용을 찾아보세요.\n위 검색창에 검색어나 주소를 입력하세요.");
        placeholder.setTextSize(13);
        placeholder.setGravity(Gravity.CENTER);
        placeholder.setPadding(dp(14), 0, dp(14), 0);
        placeholder.setLineSpacing(dp(5), 1);
        page.addView(placeholder, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        updateNavigation();
        setDark(false);
        divider.setBackgroundColor(Color.parseColor("#dde4ef"));
    }

    private TextView action(String glyph, String description, Runnable listener) {
        TextView button = new TextView(activity);
        button.setText(glyph);
        button.setTextSize(21);
        button.setGravity(Gravity.CENTER);
        button.setContentDescription(description);
        button.setOnClickListener(view -> listener.run());
        toolbar.addView(button, new LayoutParams(0, dp(38), 1));
        actions.add(button);
        return button;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void configureWebView(WebView browser) {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        String agent = settings.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", "");
        if (!agent.contains("Mobile")) agent = agent.replace(" Safari/", " Mobile Safari/");
        settings.setUserAgentString(agent);
        browser.setInitialScale(0);
    }

    private boolean handleSpecialLink(Uri uri) {
        if (isWebAddress(uri)) return false;
        try {
            String fallback = "intent".equalsIgnoreCase(uri.getScheme())
                ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url")
                : uri.getQueryParameter("url");
            if (fallback != null && isWebAddress(Uri.parse(fallback))) navigate(fallback);
        } catch (Exception ignored) { /* Non-web app links stay outside the research panel. */ }
        return true;
    }

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
        addressRow.setBackgroundColor(surface);
        resizeHandle.setBackgroundColor(Color.parseColor(dark ? "#22344b" : "#eef2f8"));
        GradientDrawable handle = new GradientDrawable();
        handle.setColor(Color.parseColor(dark ? "#7892b3" : "#9fadc1"));
        handle.setCornerRadius(dp(2));
        grip.setBackground(handle);
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
        for (WebView popup : new ArrayList<>(popups)) { page.removeView(popup); popup.destroy(); }
        popups.clear();
        web.stopLoading();
        web.destroy();
    }

    private void hideKeyboard() {
        InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(), 0);
    }
}
