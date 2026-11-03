mod agents;
mod appicon;
mod browser;
mod dirs;
mod dock;
mod files;
mod git;
mod glow;
mod keystop;
mod notch;
mod onboarding;
mod pty;
mod servers;
mod shottr;
mod tickets;
mod usage;
mod worktrees;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Menu item ids sent to the frontend as "menu" events.
const LOADOUT_PREFIX: &str = "loadout:";
const SAVE_ALL_LOADOUT: &str = "loadout-save-all";
const EDIT_LOADOUTS: &str = "loadout-edit";
const RESTART_ONBOARDING: &str = "onboarding-restart";
const CHECK_UPDATES: &str = "check-updates";
/// ⌘Q and the main window's close button ask the frontend first, so it can
/// confirm before killing running commands.
const QUIT: &str = "quit";
const CLOSE_WINDOW: &str = "close-window";

/// Minimal menu: the default one binds ⌘W to "Close Window", which we want
/// for closing tabs instead. Cut/Copy/Paste stay so the webview receives native
/// clipboard events (without a menu item, macOS never sends the webview ⌘X). The Loadouts menu lists `loadouts` by name.
fn build_menu<R: Runtime>(h: &AppHandle<R>, loadouts: &[String]) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        h,
        "Workdesk",
        true,
        &[
            &PredefinedMenuItem::about(h, None, None)?,
            &MenuItem::with_id(h, CHECK_UPDATES, "Check for Updates…", true, None::<&str>)?,
            &MenuItem::with_id(h, RESTART_ONBOARDING, "Restart Onboarding", true, None::<&str>)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::hide(h, None)?,
            &PredefinedMenuItem::hide_others(h, None)?,
            &PredefinedMenuItem::separator(h)?,
            &MenuItem::with_id(h, QUIT, "Quit Workdesk", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        h,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::cut(h, None)?,
            &PredefinedMenuItem::copy(h, None)?,
            &PredefinedMenuItem::paste(h, None)?,
        ],
    )?;
    let loadout_menu = Submenu::new(h, "Loadouts", true)?;
    if loadouts.is_empty() {
        loadout_menu.append(&MenuItem::new(h, "No Loadouts Yet", false, None::<&str>)?)?;
    }
    for name in loadouts {
        let id = format!("{LOADOUT_PREFIX}{name}");
        loadout_menu.append(&MenuItem::with_id(h, id, format!("#{name}"), true, None::<&str>)?)?;
    }
    loadout_menu.append(&PredefinedMenuItem::separator(h)?)?;
    loadout_menu.append(&MenuItem::with_id(h, SAVE_ALL_LOADOUT, "Save All Tabs as Loadout…", true, None::<&str>)?)?;
    loadout_menu.append(&MenuItem::with_id(h, EDIT_LOADOUTS, "Edit Loadouts…", true, None::<&str>)?)?;
    let window_menu = Submenu::with_items(
        h,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(h, None)?, &PredefinedMenuItem::fullscreen(h, None)?],
    )?;
    Menu::with_items(h, &[&app_menu, &edit_menu, &loadout_menu, &window_menu])
}

/// Rebuilds the menu bar when the saved loadouts change.
#[tauri::command]
fn set_loadout_menu(app: AppHandle, names: Vec<String>) -> Result<(), String> {
    let menu = build_menu(&app, &names).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// Quits once the frontend has confirmed (or found nothing running).
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Closes the main window once the frontend has confirmed.
#[tauri::command]
fn close_main_window(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(pty::PtyState::default())
        .manage(agents::AgentState::default())
        .manage(servers::ServerState::default())
        .manage(notch::NotchState::default())
        .manage(browser::BrowserState::default())
        .setup(|app| {
            app.set_menu(build_menu(app.handle(), &[])?)?;
            if let Some(main) = app.get_webview("main") {
                keystop::contain_keys(&main);
            }
            if let Err(e) = notch::open(app.handle()) {
                eprintln!("notch: {e}");
            }
            if let Err(e) = dock::open(app.handle()) {
                eprintln!("dock: {e}");
            }
            shottr::start(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id.starts_with(LOADOUT_PREFIX) || id == SAVE_ALL_LOADOUT || id == EDIT_LOADOUTS || id == QUIT || id == CHECK_UPDATES {
                let _ = app.emit("menu", id);
            } else if id == RESTART_ONBOARDING {
                let _ = onboarding::open(app);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("menu", CLOSE_WINDOW);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_loadout_menu,
            quit_app,
            close_main_window,
            appicon::set_app_icon,
            browser::browser_open,
            browser::browser_place,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_reload,
            browser::browser_focus,
            browser::browser_focus_main,
            browser::browser_close,
            browser::browser_set_keys,
            glow::edge_glow,
            onboarding::open_onboarding,
            notch::notch_hit,
            notch::notch_jump,
            notch::notch_action,
            dock::dock_drop,
            shottr::shottr_installed,
            shottr::shottr_grab,
            shottr::shottr_ticket,
            shottr::shottr_preview,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_process_names,
            pty::pty_cwds,
            pty::pty_busy,
            agents::agent_status,
            usage::usage_status,
            usage::usage_ping_claude,
            dirs::home_dir,
            dirs::list_dirs,
            dirs::existing_dirs,
            dirs::list_entries,
            files::installed_editors,
            files::resolve_files,
            files::open_in_editor,
            files::save_drop,
            files::save_ticket_image,
            files::read_ticket_image,
            files::show_in_finder,
            git::git_status,
            git::git_branches,
            git::git_checkout,
            git::git_diff,
            servers::local_servers,
            tickets::tickets_accounts,
            tickets::tickets_whoami,
            tickets::tickets_connect,
            tickets::tickets_disconnect,
            tickets::tickets_list,
            tickets::tickets_pulls,
            tickets::tickets_targets,
            tickets::tickets_create,
            tickets::tickets_branch_pull,
            worktrees::worktree_start,
            worktrees::worktree_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
