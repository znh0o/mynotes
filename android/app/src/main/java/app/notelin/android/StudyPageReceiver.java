package app.notelin.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/** The browser supplies the current URL only after the user selects our menu item. */
public final class StudyPageReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        boolean ai = intent.getBooleanExtra("ai", false);
        boolean saved = new ConnectedBrowserPages(context).save(intent.getStringExtra("noteId"), ai, intent.getDataString());
        Toast.makeText(context, saved ? (ai ? "이 노트의 AI 대화 주소를 저장했어요." : "이 노트의 인터넷 주소를 저장했어요.")
            : (ai ? "ChatGPT 화면에서 주소를 저장해 주세요." : "이 페이지의 주소를 저장하지 못했어요."), Toast.LENGTH_SHORT).show();
    }
}
