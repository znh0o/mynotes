package app.notelin.android;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.widget.Toast;
import androidx.activity.result.ActivityResult;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Only bounded file messages are exposed to the app's bundled WebView. */
@CapacitorPlugin(name = "NotelinDevice")
public class NotelinDevicePlugin extends Plugin {
    private static final int CHUNK = 512 * 1024;
    private static final long PDF_LIMIT = 150L * 1024 * 1024;
    private static final long EXPORT_LIMIT = 800L * 1024 * 1024;
    private final Map<String, Export> exports = new HashMap<>();
    private final Set<String> receiving = new HashSet<>();
    private File exportDirectory, incomingDirectory;
    private boolean pickerOpen;

    private static class Export {
        File file;
        String name, mimeType;
        int nextIndex;
        Export(File file, String name, String mimeType) { this.file = file; this.name = name; this.mimeType = mimeType; }
    }

    @Override public void load() {
        exportDirectory = new File(getContext().getCacheDir(), "document-exports");
        incomingDirectory = new File(getContext().getFilesDir(), "pending-pdfs");
        exportDirectory.mkdirs(); incomingDirectory.mkdirs();
        File[] stale = exportDirectory.listFiles();
        if (stale != null) for (File file : stale) file.delete();
        File[] partial = incomingDirectory.listFiles((dir, name) -> name.endsWith(".part"));
        if (partial != null) for (File file : partial) file.delete();
    }

    private String requireId(PluginCall call) {
        String id = call.getString("id");
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid document ID");
        return id;
    }

    private Export requireExport(PluginCall call) {
        Export item = exports.get(requireId(call));
        if (item == null) throw new IllegalArgumentException("Export is no longer available");
        return item;
    }

    private String filename(String value, String fallback) {
        String clean = (value == null ? fallback : value).replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        return clean.isEmpty() ? fallback : clean.substring(0, Math.min(180, clean.length()));
    }

    @PluginMethod public synchronized void beginExport(PluginCall call) {
        try {
            if (!exports.isEmpty()) throw new IllegalStateException("다른 파일을 저장하고 있어요. 저장을 마친 뒤 다시 시도해 주세요.");
            String id = UUID.randomUUID().toString();
            File file = new File(exportDirectory, id);
            if (!file.createNewFile()) throw new IllegalStateException("Could not prepare document");
            exports.put(id, new Export(file, filename(call.getString("name"), "Notelin.pdf"), call.getString("mimeType", "application/octet-stream")));
            JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod public synchronized void appendExport(PluginCall call) {
        try {
            Export item = requireExport(call);
            Integer index = call.getInt("index");
            String data = call.getString("data");
            if (index == null || index != item.nextIndex || data == null || data.length() > 4 * ((CHUNK + 2) / 3)) throw new IllegalArgumentException("Invalid document chunk");
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            if (bytes.length > CHUNK || item.file.length() + bytes.length > EXPORT_LIMIT) throw new IllegalArgumentException("Document is too large");
            try (FileOutputStream stream = new FileOutputStream(item.file, true)) { stream.write(bytes); }
            item.nextIndex++; call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod public synchronized void finishExport(PluginCall call) {
        try {
            Export item = requireExport(call);
            if (pickerOpen) throw new IllegalStateException("A document picker is already open");
            pickerOpen = true;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(item.mimeType).putExtra(Intent.EXTRA_TITLE, item.name);
            getActivity().runOnUiThread(() -> {
                try { startActivityForResult(call, intent, "documentCreated"); }
                catch (Exception error) { synchronized (this) { pickerOpen = false; } call.reject(error.getMessage(), error); }
            });
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @ActivityCallback private void documentCreated(PluginCall call, ActivityResult result) {
        synchronized (this) { pickerOpen = false; }
        if (call == null) return;
        getBridge().execute(() -> {
            try {
                Export item;
                synchronized (this) { item = requireExport(call); }
                Uri uri = result.getData() == null ? null : result.getData().getData();
                JSObject response = new JSObject();
                boolean saved = result.getResultCode() == Activity.RESULT_OK && uri != null;
                if (saved) {
                    try (InputStream input = new FileInputStream(item.file);
                         OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IllegalStateException("선택한 위치에 저장할 수 없어요.");
                        byte[] buffer = new byte[64 * 1024]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    response.put("uri", uri.toString());
                }
                response.put("saved", saved); call.resolve(response);
            } catch (Exception error) { call.reject(error.getMessage(), error); }
            finally { synchronized (this) { removeExport(call.getString("id")); } }
        });
    }

    private void removeExport(String id) { Export item = exports.remove(id); if (item != null) item.file.delete(); }
    @PluginMethod public synchronized void cancelExport(PluginCall call) { removeExport(call.getString("id")); call.resolve(); }

    @PluginMethod public void setAppearance(PluginCall call) {
        getActivity().runOnUiThread(() -> { ((MainActivity) getActivity()).setDarkChrome(call.getBoolean("dark", false)); call.resolve(); });
    }

    @PluginMethod public void openStudyBrowser(PluginCall call) {
        String noteId = call.getString("noteId");
        if (noteId == null || noteId.trim().isEmpty() || noteId.length() > 200) { call.reject("인터넷을 열 노트를 확인하지 못했어요."); return; }
        getActivity().runOnUiThread(() -> {
            try {
                JSObject result = new JSObject();
                result.put("external", ((MainActivity) getActivity()).openStudyBrowser(noteId, call.getString("url")));
                call.resolve(result);
            }
            catch (Exception error) { call.reject("인터넷 패널을 열지 못했어요.", error); }
        });
    }

    @PluginMethod public void openStudyAI(PluginCall call) {
        String noteId = call.getString("noteId");
        if (noteId == null || noteId.trim().isEmpty() || noteId.length() > 200) { call.reject("AI를 열 노트를 확인하지 못했어요."); return; }
        getActivity().runOnUiThread(() -> {
            try {
                JSObject result = new JSObject();
                result.put("external", ((MainActivity) getActivity()).openStudyAI(noteId));
                call.resolve(result);
            }
            catch (Exception error) { call.reject("AI 패널을 열지 못했어요.", error); }
        });
    }

    @PluginMethod public void closeStudyPanel(PluginCall call) {
        getActivity().runOnUiThread(() -> { ((MainActivity) getActivity()).closeStudyPanel(); call.resolve(); });
    }

    @PluginMethod public void setStudyPanelOccluded(PluginCall call) {
        getActivity().runOnUiThread(() -> { ((MainActivity) getActivity()).setStudyPanelOccluded(call.getBoolean("hidden", false)); call.resolve(); });
    }

    @PluginMethod public void getStudyPanelSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject settings = new JSObject();
            settings.put("side", ((MainActivity) getActivity()).studyPanelSide());
            settings.put("mode", ((MainActivity) getActivity()).studyBrowserMode());
            call.resolve(settings);
        });
    }

    @PluginMethod public void setStudyPanelSide(PluginCall call) {
        String side = call.getString("side");
        if (!"left".equals(side) && !"right".equals(side)) { call.reject("패널 위치를 확인해 주세요."); return; }
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).setStudyPanelSide(side);
            call.resolve();
        });
    }

    @PluginMethod public void setStudyBrowserMode(PluginCall call) {
        String mode = call.getString("mode");
        if (!"panel".equals(mode) && !"browser".equals(mode)) { call.reject("인터넷 실행 방식을 확인해 주세요."); return; }
        getActivity().runOnUiThread(() -> { ((MainActivity) getActivity()).setStudyBrowserMode(mode); call.resolve(); });
    }

    @PluginMethod public void clearStudyLoginCookies(PluginCall call) {
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).clearStudyLoginCookies(call::resolve));
    }

    @PluginMethod public void openUpdates(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/znh0o/mynotes/releases/latest")));
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    public void stylusButtonPressed() {
        notifyListeners("stylusButtonPressed", new JSObject());
    }

    public void receiveDocument(Intent intent) {
        Uri uri;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        else return;
        if (uri == null || !("content".equals(uri.getScheme()) || "file".equals(uri.getScheme()))) return;
        String source = uri.toString();
        synchronized (this) { if (!receiving.add(source)) return; }
        // Retain our copy across process death; importing never edits the source PDF.
        getBridge().execute(() -> {
            String id = UUID.randomUUID().toString();
            File partial = new File(incomingDirectory, id + ".part");
            File pdf = new File(incomingDirectory, id + ".pdf");
            try {
                String name = "가져온 PDF.pdf";
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{ OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = filename(cursor.getString(0), name);
                } catch (Exception ignored) { /* Providers need not expose a display name. */ }
                long total = 0;
                try (InputStream input = getContext().getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(partial)) {
                    if (input == null) throw new IllegalStateException("PDF를 읽을 수 없어요.");
                    byte[] buffer = new byte[64 * 1024]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > PDF_LIMIT) throw new IllegalArgumentException("PDF는 150MB 이하로 가져올 수 있어요.");
                        output.write(buffer, 0, count);
                    }
                }
                byte[] header = new byte[(int) Math.min(1024, partial.length())];
                try (FileInputStream stream = new FileInputStream(partial)) { if (stream.read(header) < 5) throw new IllegalArgumentException("PDF 파일이 아니에요."); }
                if (!new String(header, StandardCharsets.ISO_8859_1).contains("%PDF-")) throw new IllegalArgumentException("PDF 파일이 아니에요.");
                if (!partial.renameTo(pdf)) throw new IllegalStateException("PDF를 보관하지 못했어요.");
                JSObject metadata = new JSObject(); metadata.put("id", id); metadata.put("name", name); metadata.put("size", total);
                Files.write(new File(incomingDirectory, id + ".json").toPath(), metadata.toString().getBytes(StandardCharsets.UTF_8));
                getActivity().runOnUiThread(() -> notifyListeners("documentReceived", new JSObject(), true));
            } catch (Exception error) {
                partial.delete(); pdf.delete();
                getActivity().runOnUiThread(() -> Toast.makeText(getContext(), error.getMessage(), Toast.LENGTH_LONG).show());
            } finally { synchronized (this) { receiving.remove(source); } }
        });
    }

    @PluginMethod public void pendingDocuments(PluginCall call) {
        try {
            File[] files = incomingDirectory.listFiles((dir, name) -> name.endsWith(".json"));
            JSArray documents = new JSArray();
            if (files != null) {
                Arrays.sort(files, Comparator.comparingLong(File::lastModified));
                for (File file : files) documents.put(new JSObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)));
            }
            JSObject response = new JSObject(); response.put("documents", documents); call.resolve(response);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod public void readDocument(PluginCall call) {
        try {
            String id = requireId(call);
            int offset = call.getInt("offset", -1), length = call.getInt("length", -1);
            File file = new File(incomingDirectory, id + ".pdf");
            if (offset < 0 || length < 0 || length > CHUNK || (long) offset + length > file.length()) throw new IllegalArgumentException("Invalid PDF chunk");
            byte[] bytes = new byte[length];
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) { input.seek(offset); input.readFully(bytes); }
            JSObject response = new JSObject(); response.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)); call.resolve(response);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod public void completeDocument(PluginCall call) {
        try {
            String id = requireId(call);
            new File(incomingDirectory, id + ".json").delete(); new File(incomingDirectory, id + ".pdf").delete(); call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }
}
