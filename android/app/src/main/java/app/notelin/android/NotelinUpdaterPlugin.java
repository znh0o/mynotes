package app.notelin.android;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/** Download a same-package, same-signer APK, then use Android's install UI. */
@CapacitorPlugin(name = "NotelinUpdater")
public class NotelinUpdaterPlugin extends Plugin {
    private static final String RELEASES = "https://api.github.com/repos/znh0o/mynotes/releases/latest";
    private static final String ASSET_PREFIX = "https://github.com/znh0o/mynotes/releases/download/";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile Release available;
    private volatile File pendingApk;
    private volatile boolean awaitingPermission;

    private static class Release {
        String version, apk, checksum;
        long code, size;
    }

    private long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private PackageInfo installed() throws Exception { return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0); }

    private HttpURLConnection connection(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "Notelin-Android");
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        return connection;
    }

    private String smallText(String address, int limit) throws Exception {
        HttpURLConnection connection = connection(address);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > limit) throw new IllegalStateException("업데이트 정보가 올바르지 않아요.");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally { connection.disconnect(); }
    }

    private long releaseCode(String version) {
        if (!version.matches("\\d+\\.\\d+\\.\\d+")) throw new IllegalArgumentException("지원하지 않는 업데이트 버전이에요.");
        String[] parts = version.split("\\.");
        long major = Long.parseLong(parts[0]), minor = Long.parseLong(parts[1]), patch = Long.parseLong(parts[2]);
        if (major > 200000 || minor > 99 || patch > 99) throw new IllegalArgumentException("Invalid update version");
        return major * 10000 + minor * 100 + patch;
    }

    @PluginMethod public void check(PluginCall call) {
        worker.execute(() -> {
            try {
                JSONObject data = new JSONObject(smallText(RELEASES, 256 * 1024));
                String version = data.getString("tag_name").replaceFirst("^v", "");
                Release release = new Release(); release.version = version; release.code = releaseCode(version);
                JSONArray assets = data.getJSONArray("assets");
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    String name = asset.getString("name"), address = asset.getString("browser_download_url");
                    if (!address.startsWith(ASSET_PREFIX)) continue;
                    if (name.equals("Notelin-" + version + ".apk")) { release.apk = address; release.size = asset.getLong("size"); }
                    if (name.equals("Notelin-" + version + ".apk.sha256")) release.checksum = address;
                }
                PackageInfo current = installed();
                boolean newer = release.code > versionCode(current);
                if (newer && (release.apk == null || release.checksum == null || release.size <= 0 || release.size > 300L * 1024 * 1024)) throw new IllegalStateException("새 버전의 설치 파일을 아직 준비하고 있어요. 잠시 후 다시 확인해 주세요.");
                available = newer ? release : null;
                JSObject result = new JSObject(); result.put("available", newer); result.put("version", version); result.put("installedVersion", current.versionName); call.resolve(result);
            } catch (Exception error) { call.reject("업데이트를 확인하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.", error); }
        });
    }

    private String digest(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream stream = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int count;
            while ((count = stream.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte part : digest.digest()) value.append(String.format(Locale.ROOT, "%02x", part & 0xff));
        return value.toString();
    }

    private Signature[] signers(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners() : info.signatures;
    }

    private void verify(File apk, Release release, String expected) throws Exception {
        if (apk.length() != release.size || !digest(apk).equals(expected)) throw new IllegalStateException("설치 파일 검증에 실패했어요. 다시 다운로드해 주세요.");
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo current = manager.getPackageInfo(getContext().getPackageName(), flags);
        if (candidate == null || !getContext().getPackageName().equals(candidate.packageName) || versionCode(candidate) != release.code || versionCode(candidate) <= versionCode(current)) throw new IllegalStateException("이 앱의 올바른 업데이트 파일이 아니에요.");
        Signature[] installedSigners = signers(current), candidateSigners = signers(candidate);
        if (installedSigners == null || candidateSigners == null || installedSigners.length != 1 || candidateSigners.length != 1 || !MessageDigest.isEqual(installedSigners[0].toByteArray(), candidateSigners[0].toByteArray())) throw new IllegalStateException("앱 서명이 다른 설치 파일이에요.");
    }

    @PluginMethod public void install(PluginCall call) {
        Release release = available;
        if (release == null) { call.reject("먼저 업데이트를 확인해 주세요."); return; }
        if (!busy.compareAndSet(false, true)) { call.reject("업데이트를 다운로드하고 있어요."); return; }
        worker.execute(() -> {
            File partial = null;
            try {
                String checksum = smallText(release.checksum, 4096).trim().split("\\s+")[0].toLowerCase(Locale.ROOT);
                if (!checksum.matches("[0-9a-f]{64}")) throw new IllegalStateException("올바른 파일 검증 정보가 없어요.");
                File directory = new File(getContext().getCacheDir(), "apk-updates"); directory.mkdirs();
                File apk = new File(directory, "Notelin-" + release.version + ".apk");
                partial = new File(directory, "update.part");
                if (!apk.exists() || !digest(apk).equals(checksum)) {
                    HttpURLConnection connection = connection(release.apk);
                    connection.setRequestProperty("Accept", "application/octet-stream");
                    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                        byte[] buffer = new byte[64 * 1024]; int count, percent = -1; long total = 0;
                        while ((count = input.read(buffer)) != -1) {
                            total += count;
                            if (total > release.size) throw new IllegalStateException("설치 파일 크기가 올바르지 않아요.");
                            output.write(buffer, 0, count);
                            int next = (int) (total * 100 / release.size);
                            if (next != percent) { percent = next; JSObject progress = new JSObject(); progress.put("percent", percent); notifyListeners("downloadProgress", progress); }
                        }
                    } finally { connection.disconnect(); }
                    verify(partial, release, checksum);
                    if (apk.exists()) apk.delete();
                    if (!partial.renameTo(apk)) throw new IllegalStateException("설치 파일을 준비하지 못했어요.");
                }
                verify(apk, release, checksum); pendingApk = apk;
                getActivity().runOnUiThread(() -> {
                    try {
                        boolean needsPermission = !getContext().getPackageManager().canRequestPackageInstalls();
                        if (needsPermission) {
                            awaitingPermission = true;
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                        } else launchInstaller();
                        JSObject response = new JSObject(); response.put("needsPermission", needsPermission); call.resolve(response);
                    } catch (Exception error) { call.reject("설치 화면을 열지 못했어요. 다시 시도해 주세요.", error); }
                    finally { busy.set(false); }
                });
            } catch (Exception error) { if (partial != null) partial.delete(); busy.set(false); call.reject(error.getMessage(), error); }
        });
    }

    private void launchInstaller() {
        if (pendingApk == null || !pendingApk.isFile()) return;
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", pendingApk);
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(intent);
    }

    @Override protected void handleOnResume() {
        if (awaitingPermission) {
            awaitingPermission = false;
            if (getContext().getPackageManager().canRequestPackageInstalls()) getActivity().runOnUiThread(this::launchInstaller);
        }
    }
}
