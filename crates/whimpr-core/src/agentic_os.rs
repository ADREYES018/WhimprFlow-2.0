//! Agentic OS Bridge
//! This module handles the execution layer for voice-command workflows on macOS.
//! It uses AppleScript and standard process commands to read context and execute actions.

use std::process::Command;

/// Executes an AppleScript and returns the String output.
pub fn run_applescript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to run AppleScript process: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Grabs the name of the currently active macOS application.
/// Useful for "Context-Aware" AI decisions.
pub fn get_frontmost_app() -> Result<String, String> {
    let script = r#"tell application "System Events" to get name of first application process whose frontmost is true"#;
    run_applescript(script)
}

/// Grabs the active window title of the frontmost app.
pub fn get_active_window_title() -> Result<String, String> {
    let script = r#"
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set frontAppName to name of frontApp
        tell process frontAppName
            if exists (1st window whose value of attribute "AXMain" is true) then
                return name of (1st window whose value of attribute "AXMain" is true)
            else if exists (1st window) then
                return name of 1st window
            else
                return ""
            end if
        end tell
    end tell
    "#;
    run_applescript(script)
}

/// Grabs the selected text across the system using Cmd+C.
/// Safely restores the previous clipboard contents.
pub fn get_selected_text() -> Result<Option<String>, String> {
    let script = r#"
    try
        set oldClipboard to the clipboard
    on error
        set oldClipboard to ""
    end try
    
    set the clipboard to ""
    
    tell application "System Events"
        keystroke "c" using command down
        delay 0.15
    end tell
    
    set selectedText to the clipboard
    
    try
        set the clipboard to oldClipboard
    end try
    
    return selectedText
    "#;
    
    match run_applescript(script) {
        Ok(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        },
        _ => Ok(None),
    }
}

/// A basic command executer for opening apps or URLs
pub fn execute_system_command(intent: &str, target: &str) -> Result<String, String> {
    match intent {
        "open_app" => handle_open_app(target),
        "search_web" => handle_search_web(target),
        "ui_click" => handle_ui_click(target),
        "open_url" => {
            Command::new("open")
                .arg(target)
                .output()
                .map_err(|e| format!("Failed to open URL: {}", e))?;
            Ok(format!("Opened URL: {}", target))
        },
        "start_recording" => handle_start_recording(),
        _ => Err(format!("Unknown intent: {}", intent)),
    }
}

/// Phase 3: Opens a macOS application
pub fn handle_open_app(target: &str) -> Result<String, String> {
    let script = format!(r#"try
        tell application "{}" to activate
        return "success"
    on error
        return "error"
    end try"#, target);
    
    if let Ok(res) = run_applescript(&script) {
        if res == "success" {
            return Ok(format!("Opened application: {}", target));
        }
    }
    
    // Fallback if AppleScript fails
    Command::new("open")
        .arg("-a")
        .arg(target)
        .output()
        .map_err(|e| format!("Failed to open app: {}", e))?;
    Ok(format!("Opened application via shell: {}", target))
}

/// Phase 3: Searches the web
pub fn handle_search_web(query: &str) -> Result<String, String> {
    let encoded = query.replace(' ', "%20").replace('\"', "%22");
    let target = format!("https://google.com/search?q={}", encoded);
    
    Command::new("open")
        .arg(&target)
        .output()
        .map_err(|e| format!("Failed to launch search: {}", e))?;
    Ok(format!("Searched web for: {}", query))
}

/// Phase 3: Triggers a UI element or menu item by name via Mac Accessibility API
pub fn handle_ui_click(button_name: &str) -> Result<String, String> {
    let safe_button = button_name.replace('\"', "\\\"");
    
    let script = format!(r#"
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set frontAppName to name of frontApp
        tell process frontAppName
            try
                -- Attempt to click a button by name on the active window
                click button "{0}" of front window
                return "Clicked button"
            on error
                try
                    -- Attempt to click a menu item (often what users mean by UI action)
                    click menu item "{0}" of menu 1 of menu bar item 1 of menu bar 1
                    return "Clicked menu item"
                on error
                    error "Could not find a button or menu item named '{0}'"
                end try
            end try
        end tell
    end tell
    "#, safe_button);
    
    run_applescript(&script)?;
    Ok(format!("Clicked UI element: {}", button_name))
}

/// Phase 3: Starts the Oatmeal recording server if offline, and opens it
pub fn handle_start_recording() -> Result<String, String> {
    // Attempt pinging Oatmeal server
    let ping = Command::new("curl")
        .arg("--silent")
        .arg("--max-time")
        .arg("1")
        .arg("http://localhost:4123/api/health")
        .output();
    
    let is_up = ping.map(|o| o.status.success()).unwrap_or(false);
    
    if !is_up {
        // Try starting it in detached mode based on standard local paths or home dir
        if let Ok(home) = std::env::var("HOME") {
            let possible_paths = [
                format!("{}/Adriel_2.0/oatmeal-repo/capture/server.mjs", home),
                format!("{}/oatmeal-repo/capture/server.mjs", home)
            ];
            
            for path in possible_paths.iter() {
                if std::path::Path::new(path).exists() {
                    let node_path = format!("{}/.local/bin/node", home);
                    let cmd_node = if std::path::Path::new(&node_path).exists() { node_path } else { "node".to_string() };
                    let _ = Command::new(cmd_node)
                        .arg(path)
                        .spawn(); // detaches
                    std::thread::sleep(std::time::Duration::from_millis(500)); // give it a moment to bind
                    break;
                }
            }
        }
    }
    
    Command::new("open")
        .arg("http://localhost:4123")
        .output()
        .map_err(|e| format!("Failed to open recording server: {}", e))?;
    
    Ok("Opened Oatmeal recorder".to_string())
}
