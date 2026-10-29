package app.notelin.android;

import android.content.Intent;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Message;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebChromeClient;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.view.View;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntConsumer;
import java.util.function.Consumer;

/** A separate WebView for web research. It never receives Capacitor's bridge. */
final class StudyBrowserPanel extends LinearLayout {
    private final MainActivity activity;
    private final boolean aiMode;
    private final LinearLayout aiHeader;
    private final TextView aiTitle, aiBack;
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
    private final TextView bookmarkButton;
    private final BrowserBookmarks bookmarks;
    private LinearLayout bookmarksPanel;
    private int surfaceColor, inkColor, mutedColor;
    private boolean panelOnLeft;
    private Consumer<String> pageListener = url -> {};

    StudyBrowserPanel(MainActivity activity, boolean aiMode, Runnable close, IntConsumer resize) {
        super(activity);
        this.activity = activity;
        this.aiMode = aiMode;
        bookmarks = new BrowserBookmarks(activity);
        web = new WebView(activity);
        setOrientation(HORIZONTAL);
        setElevation(dp(12));

        resizeHandle = new FrameLayout(activity);
        resizeHandle.setContentDescription(aiMode ? "AI 패널 너비 조절" : "인터넷 패널 너비 조절");
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
                float delta = event.getRawX() - startX[0];
                resize.accept(startWidth[0] + Math.round(panelOnLeft ? delta : -delta));
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
            boolean grow = (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) != panelOnLeft;
            resize.accept(getWidth() + dp(grow ? 32 : -32));
            return true;
        });
        if (getResources().getConfiguration().smallestScreenWidthDp < 600) resizeHandle.setVisibility(View.GONE);
        addView(resizeHandle, new LayoutParams(dp(14), LayoutParams.MATCH_PARENT));

        LinearLayout body = new LinearLayout(activity);
        body.setOrientation(VERTICAL);
        addView(body, new LayoutParams(0, LayoutParams.MATCH_PARENT, 1));
        aiHeader = new LinearLayout(activity);
        aiHeader.setGravity(Gravity.CENTER_VERTICAL);
        aiHeader.setPadding(dp(3), 0, dp(3), 0);
        aiHeader.setVisibility(aiMode ? View.VISIBLE : View.GONE);
        body.addView(aiHeader, new LayoutParams(LayoutParams.MATCH_PARENT, dp(38)));
        aiBack = headerAction("‹", "AI 이전 화면", () -> {
            WebView current = activeBrowser();
            if (current.canGoBack()) current.goBack(); else if (current != web) closePopup(current);
        });
        aiTitle = new TextView(activity);
        aiTitle.setText("ChatGPT");
        aiTitle.setTextSize(12);
        aiTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        aiTitle.setSingleLine(true); aiTitle.setEllipsize(TextUtils.TruncateAt.END);
        aiHeader.addView(aiTitle, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        headerAction("↻", "AI 새로고침", () -> { if (activeBrowser().getUrl() != null) activeBrowser().reload(); });
        headerAction("×", "AI 패널 닫기", close);
        addressRow = new LinearLayout(activity);
        addressRow.setVisibility(aiMode ? View.GONE : View.VISIBLE);
        addressRow.setPadding(dp(6), dp(6), dp(6), 0);
        body.addView(addressRow, new LayoutParams(LayoutParams.MATCH_PARENT, dp(46)));

        toolbar = new LinearLayout(activity);
        toolbar.setVisibility(aiMode ? View.GONE : View.VISIBLE);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(3), 0, dp(3), 0);
        body.addView(toolbar, new LayoutParams(LayoutParams.MATCH_PARENT, dp(38)));
        back = action("‹", "이전 웹페이지", () -> {
            WebView current = activeBrowser();
            if (current.canGoBack()) current.goBack(); else if (current != web) closePopup(current);
        });
        forward = action("›", "다음 웹페이지", () -> { if (activeBrowser().canGoForward()) activeBrowser().goForward(); });

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
            activeBrowser().requestFocus();
            return true;
        });
        addressRow.addView(address, new LayoutParams(LayoutParams.MATCH_PARENT, dp(39)));
        action("↻", "새로고침", () -> { if (activeBrowser().getUrl() != null) activeBrowser().reload(); });
        bookmarkButton = action("☆", "즐겨찾기", this::showBookmarks);
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
        page.addView(web, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        placeholder = new TextView(activity);
        placeholder.setText(aiMode ? "ChatGPT를 불러오는 중…" : "필기하면서 필요한 내용을 찾아보세요.\n위 검색창에 검색어나 주소를 입력하세요.");
        placeholder.setTextSize(13);
        placeholder.setGravity(Gravity.CENTER);
        placeholder.setPadding(dp(14), 0, dp(14), 0);
        placeholder.setLineSpacing(dp(5), 1);
        page.addView(placeholder, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        installBrowserClients(web);
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

    private TextView headerAction(String glyph, String description, Runnable listener) {
        TextView button = new TextView(activity);
        button.setText(glyph); button.setTextSize(21); button.setGravity(Gravity.CENTER);
        button.setContentDescription(description); button.setOnClickListener(view -> listener.run());
        aiHeader.addView(button, new LayoutParams(dp(32), dp(38)));
        actions.add(button);
        return button;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void configureWebView(WebView browser) {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(browser, true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
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

    private WebView activeBrowser() { return popups.isEmpty() ? web : popups.get(popups.size() - 1); }

    private void installBrowserClients(WebView browser) {
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleSpecialLink(request.getUrl(), view);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (view != activeBrowser()) return;
                placeholder.setVisibility(View.GONE);
                view.setVisibility(View.VISIBLE);
                if (!address.hasFocus()) address.setText(isWebAddress(Uri.parse(url)) ? url : "");
                updateAiTitle(url);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (!request.isForMainFrame() || view != activeBrowser()) return;
                placeholder.setText("페이지를 열지 못했어요.\n주소와 인터넷 연결을 확인해 주세요.");
                placeholder.setVisibility(View.VISIBLE);
                view.setVisibility(View.GONE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view == activeBrowser()) {
                    if (!address.hasFocus() && isWebAddress(Uri.parse(url))) address.setText(url);
                    updateNavigation();
                }
                persistSession();
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int amount) {
                if (view != activeBrowser()) return;
                progress.setProgress(amount);
                progress.setVisibility(amount >= 100 ? View.GONE : View.VISIBLE);
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                if (!userGesture || popups.size() >= 4) return false;
                WebView popup = new WebView(activity);
                configureWebView(popup);
                installBrowserClients(popup);
                closeBookmarks();
                activeBrowser().setVisibility(View.GONE);
                popups.add(popup);
                page.addView(popup, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
                placeholder.setVisibility(View.GONE);
                address.setText("");
                updateNavigation();
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget();
                return true;
            }
            @Override public void onCloseWindow(WebView window) { window.post(() -> closePopup(window)); }
        });
    }

    private void closePopup(WebView target) {
        int index = popups.indexOf(target);
        if (index < 0) return;
        for (int position = popups.size() - 1; position >= index; position--) {
            WebView popup = popups.remove(position);
            page.removeView(popup);
            popup.stopLoading(); popup.destroy();
        }
        WebView current = activeBrowser();
        current.setVisibility(View.VISIBLE);
        placeholder.setVisibility(View.GONE);
        address.setText(current.getUrl() == null ? "" : current.getUrl());
        updateNavigation();
        persistSession();
    }

    private boolean handleSpecialLink(Uri uri, WebView browser) {
        if ("about:blank".equals(uri.toString())) return false;
        if (isWebAddress(uri)) return false;
        try {
            String fallback = "intent".equalsIgnoreCase(uri.getScheme())
                ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url")
                : uri.getQueryParameter("url");
            if (fallback != null && isWebAddress(Uri.parse(fallback))) browser.loadUrl(fallback);
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
        closeBookmarks();
        placeholder.setVisibility(View.GONE);
        activeBrowser().setVisibility(View.VISIBLE);
        activeBrowser().loadUrl(uri.toString());
    }

    void openUrl(String url) {
        if (!popups.isEmpty()) closePopup(popups.get(0));
        navigate(url);
    }

    private void closeBookmarks() {
        if (bookmarksPanel != null) page.removeView(bookmarksPanel);
        bookmarksPanel = null;
    }

    private void showBookmarks() {
        if (bookmarksPanel != null) { closeBookmarks(); return; }
        hideKeyboard();
        renderBookmarks();
    }

    private TextView bookmarkText(String text, int size) {
        TextView label = new TextView(activity);
        label.setText(text);
        label.setTextSize(size);
        label.setTextColor(inkColor);
        return label;
    }

    private TextView bookmarkAction(String text, Runnable click) {
        TextView button = bookmarkText(text, 12);
        button.setPadding(dp(12), dp(11), dp(12), dp(11));
        button.setMinHeight(dp(42));
        button.setTextColor(Color.parseColor("#4d83d2"));
        button.setFocusable(true);
        button.setOnClickListener(view -> click.run());
        return button;
    }

    private void renderBookmarks() {
        closeBookmarks();
        bookmarksPanel = new LinearLayout(activity);
        bookmarksPanel.setOrientation(VERTICAL);
        bookmarksPanel.setBackgroundColor(surfaceColor);
        LinearLayout heading = new LinearLayout(activity);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.setPadding(dp(12), dp(4), dp(4), dp(4));
        TextView title = bookmarkText("즐겨찾기", 14);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        heading.addView(title, new LayoutParams(0, dp(40), 1));
        title.setGravity(Gravity.CENTER_VERTICAL);
        TextView close = bookmarkAction("×", this::closeBookmarks);
        close.setContentDescription("즐겨찾기 닫기");
        heading.addView(close, new LayoutParams(dp(38), dp(42)));
        bookmarksPanel.addView(heading);

        String current = activeBrowser().getUrl();
        String currentTitle = activeBrowser().getTitle();
        boolean saved = bookmarks.contains(current), canSave = BrowserBookmarks.validUrl(current) && !saved;
        TextView add = bookmarkAction(saved ? "★ 현재 페이지 저장됨" : "＋ 현재 페이지 저장", () -> {
            bookmarks.add(currentTitle, current);
            updateNavigation();
            renderBookmarks();
            Toast.makeText(activity, "즐겨찾기에 저장했어요.", Toast.LENGTH_SHORT).show();
        });
        add.setEnabled(canSave); add.setAlpha(canSave ? 1 : .45f);
        bookmarksPanel.addView(add);

        ScrollView scroll = new ScrollView(activity);
        LinearLayout entries = new LinearLayout(activity);
        entries.setOrientation(VERTICAL);
        List<BrowserBookmarks.Entry> favorites = bookmarks.all();
        if (favorites.isEmpty()) {
            TextView empty = bookmarkText("저장한 즐겨찾기가 없어요.", 12);
            empty.setTextColor(mutedColor);
            empty.setPadding(dp(12), dp(22), dp(12), dp(22));
            entries.addView(empty);
        }
        for (BrowserBookmarks.Entry entry : favorites) {
            LinearLayout row = new LinearLayout(activity);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(12), dp(7), dp(3), dp(7));
            LinearLayout link = new LinearLayout(activity);
            link.setOrientation(VERTICAL);
            link.setPadding(0, dp(5), dp(5), dp(5));
            link.setFocusable(true);
            link.setContentDescription(entry.title + " 열기");
            link.setOnClickListener(view -> navigate(entry.url));
            TextView name = bookmarkText(entry.title, 12);
            name.setMaxLines(2); name.setEllipsize(TextUtils.TruncateAt.END);
            TextView url = bookmarkText(entry.url, 10);
            url.setTextColor(mutedColor); url.setSingleLine(true); url.setEllipsize(TextUtils.TruncateAt.END);
            link.addView(name); link.addView(url);
            row.addView(link, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            TextView remove = bookmarkAction("×", () -> { bookmarks.remove(entry.url); updateNavigation(); renderBookmarks(); });
            remove.setContentDescription(entry.title + " 즐겨찾기 삭제");
            row.addView(remove, new LayoutParams(dp(36), dp(44)));
            entries.addView(row);
        }
        scroll.addView(entries);
        bookmarksPanel.addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
        page.addView(bookmarksPanel, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    }

    private void updateNavigation() {
        WebView current = activeBrowser();
        back.setAlpha(current.canGoBack() || current != web ? 1 : .35f);
        aiBack.setAlpha(current.canGoBack() || current != web ? 1 : .35f);
        forward.setAlpha(current.canGoForward() ? 1 : .35f);
        bookmarkButton.setText(bookmarks.contains(current.getUrl()) ? "★" : "☆");
        updateAiTitle(current.getUrl());
    }

    private void updateAiTitle(String url) {
        if (!aiMode) return;
        String host = url == null ? null : Uri.parse(url).getHost();
        aiTitle.setText(host == null || host.equals("chatgpt.com") || host.endsWith(".chatgpt.com") ? "ChatGPT" : host);
    }

    void setDark(boolean dark) {
        int surface = Color.parseColor(dark ? "#18263a" : "#ffffff");
        int ink = Color.parseColor(dark ? "#e4edfa" : "#28435f");
        int muted = Color.parseColor(dark ? "#9db0c8" : "#7188a2");
        surfaceColor = surface; inkColor = ink; mutedColor = muted;
        setBackgroundColor(surface);
        toolbar.setBackgroundColor(surface);
        aiHeader.setBackgroundColor(surface);
        aiTitle.setTextColor(ink);
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
        if (bookmarksPanel != null) renderBookmarks();
    }

    void setPageListener(Consumer<String> listener) { pageListener = listener; }

    Bundle saveNoteState() {
        Bundle state = new Bundle();
        return activeBrowser().saveState(state) == null ? null : state;
    }

    boolean restoreNoteState(Bundle state) {
        if (state == null || web.restoreState(state) == null) return false;
        placeholder.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        address.setText(web.getUrl() == null ? "" : web.getUrl());
        updateNavigation();
        return true;
    }

    void setPanelSide(boolean left) {
        if (panelOnLeft == left) return;
        panelOnLeft = left;
        removeView(resizeHandle);
        addView(resizeHandle, left ? getChildCount() : 0, new LayoutParams(dp(14), LayoutParams.MATCH_PARENT));
    }

    void persistSession() {
        pageListener.accept(activeBrowser().getUrl());
        CookieManager.getInstance().flush();
    }

    void hidePanel() { hideKeyboard(); persistSession(); setVisibility(View.GONE); }

    void release() {
        hideKeyboard();
        persistSession();
        closeBookmarks();
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
