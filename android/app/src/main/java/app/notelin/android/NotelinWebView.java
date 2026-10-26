package app.notelin.android;

import android.content.Context;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import com.getcapacitor.CapacitorWebView;

public class NotelinWebView extends CapacitorWebView {
    public NotelinWebView(Context context, AttributeSet attrs) { super(context, attrs); }

    @Override public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection connection = super.onCreateInputConnection(outAttrs);
        // Samsung Keyboard otherwise replaces the landscape note editor with
        // its full-screen extracted text field.
        outAttrs.imeOptions |= EditorInfo.IME_FLAG_NO_FULLSCREEN | EditorInfo.IME_FLAG_NO_EXTRACT_UI;
        return connection;
    }
}
