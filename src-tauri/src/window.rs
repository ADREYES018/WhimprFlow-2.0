// The screen-share hide feature.
//
// A native NSWindow has a `sharingType`. Setting it to NSWindowSharingNone (0)
// tells the window server this window must be EXCLUDED from screen capture.
// Every modern screen-sharer on macOS (Zoom, Discord, Loom, QuickTime, OBS,
// Teams, Google Meet in Chrome) captures via ScreenCaptureKit / CGDisplayStream,
// both of which honor this flag. The window still renders on the local display —
// so *you* see it, but it never lands in anyone else's shared feed.

#[cfg(target_os = "macos")]
mod imp {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::{Manager, Runtime, WebviewWindow};

    const NS_WINDOW_SHARING_NONE: u64 = 0;
    const NS_WINDOW_SHARING_READ_ONLY: u64 = 1;

    const NS_CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
    const NS_FULL_SCREEN_AUXILIARY: u64 = 1 << 8;

    pub fn set_hidden_from_capture<R: Runtime>(
        window: &WebviewWindow<R>,
        hidden: bool,
    ) -> Result<(), String> {
        let ns_window = window
            .ns_window()
            .map_err(|e| format!("no ns_window: {e}"))? as *mut AnyObject;
        if ns_window.is_null() {
            return Err("ns_window is null".into());
        }
        let sharing_type = if hidden {
            NS_WINDOW_SHARING_NONE
        } else {
            NS_WINDOW_SHARING_READ_ONLY
        };
        unsafe {
            let _: () = msg_send![ns_window, setSharingType: sharing_type];
        }
        Ok(())
    }

    pub fn set_pinned<R: Runtime>(window: &WebviewWindow<R>, pinned: bool) -> Result<(), String> {
        let ns_window = window
            .ns_window()
            .map_err(|e| format!("no ns_window: {e}"))? as *mut AnyObject;
        if ns_window.is_null() {
            return Err("ns_window is null".into());
        }
        let bits = NS_CAN_JOIN_ALL_SPACES | NS_FULL_SCREEN_AUXILIARY;
        unsafe {
            let current: u64 = msg_send![ns_window, collectionBehavior];
            let next = if pinned { current | bits } else { current & !bits };
            let _: () = msg_send![ns_window, setCollectionBehavior: next];
        }
        Ok(())
    }

    pub fn apply_on_main<R: Runtime>(
        app: &tauri::AppHandle<R>,
        label: &str,
        hidden: bool,
    ) -> Result<(), String> {
        let app = app.clone();
        let label = label.to_string();
        app.clone()
            .run_on_main_thread(move || {
                if let Some(win) = app.get_webview_window(&label) {
                    if let Err(e) = set_hidden_from_capture(&win, hidden) {
                        eprintln!("[whimpr] set_hidden_from_capture failed: {e}");
                    }
                }
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::{Runtime, WebviewWindow};

    pub fn set_hidden_from_capture<R: Runtime>(
        _window: &WebviewWindow<R>,
        _hidden: bool,
    ) -> Result<(), String> {
        Err("screen-share hiding is only supported on macOS".into())
    }

    pub fn apply_on_main<R: Runtime>(
        _app: &tauri::AppHandle<R>,
        _label: &str,
        _hidden: bool,
    ) -> Result<(), String> {
        Err("screen-share hiding is only supported on macOS".into())
    }

    pub fn set_pinned<R: Runtime>(
        _window: &WebviewWindow<R>,
        _pinned: bool,
    ) -> Result<(), String> {
        Err("pinning is only supported on macOS".into())
    }
}

pub use imp::{apply_on_main, set_hidden_from_capture, set_pinned};
