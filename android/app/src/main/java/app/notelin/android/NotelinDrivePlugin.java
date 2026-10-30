package app.notelin.android;

import android.app.Activity;
import android.accounts.Account;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.identity.RevokeAccessRequest;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;

/** Grants only appDataFolder access. Tokens are returned to the bundled app
 * WebView for a single sync and are never written to preferences or logs. */
@CapacitorPlugin(name = "NotelinDrive")
public class NotelinDrivePlugin extends Plugin {
    private PluginCall pending;
    private static final String APP_DATA = "https://www.googleapis.com/auth/drive.appdata";
    private static final String EMAIL = "https://www.googleapis.com/auth/userinfo.email";

    @PluginMethod public void authorize(PluginCall call) {
        if (pending != null) { call.reject("Google Drive 연결이 진행 중이에요."); return; }
        pending = call;
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Arrays.asList(new Scope(APP_DATA), new Scope(EMAIL)))
            .build();
        Identity.getAuthorizationClient(getActivity()).authorize(request)
            .addOnSuccessListener(result -> {
                if (pending != call) return;
                if (result.hasResolution()) {
                    if (call.getBoolean("silent", false)) { fail("Google Drive를 다시 연결해 주세요."); return; }
                    try { ((MainActivity) getActivity()).launchDriveAuthorization(result.getPendingIntent()); }
                    catch (Exception error) { fail("Google 계정 선택 창을 열지 못했어요."); }
                } else succeed(result);
            })
            .addOnFailureListener(error -> fail("Google Drive 연결에 실패했어요. 앱 등록과 계정 상태를 확인해 주세요."));
    }

    @PluginMethod public void revoke(PluginCall call) {
        String email = call.getString("email");
        if (email == null || email.isEmpty()) { call.reject("연결된 Google 계정을 찾지 못했어요."); return; }
        RevokeAccessRequest request = RevokeAccessRequest.builder()
            .setAccount(new Account(email, "com.google"))
            .setScopes(Arrays.asList(new Scope(APP_DATA), new Scope(EMAIL)))
            .build();
        Identity.getAuthorizationClient(getActivity()).revokeAccess(request)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> call.reject("Google 계정 권한을 철회하지 못했어요. 다시 시도해 주세요."));
    }

    void completeAuthorization(int resultCode, Intent data) {
        if (pending == null) return;
        if (resultCode != Activity.RESULT_OK || data == null) { fail("Google Drive 연결을 취소했어요."); return; }
        try { succeed(Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data)); }
        catch (Exception error) { fail("Google Drive 권한을 확인하지 못했어요."); }
    }

    private void succeed(AuthorizationResult result) {
        PluginCall call = pending; pending = null;
        if (call == null) return;
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) { call.reject("Google Drive 접근 권한이 없어요."); return; }
        JSObject response = new JSObject(); response.put("accessToken", token); call.resolve(response);
    }

    private void fail(String message) {
        PluginCall call = pending; pending = null;
        if (call != null) call.reject(message);
    }
}
