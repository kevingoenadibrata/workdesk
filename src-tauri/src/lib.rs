mod agent_tickets;
mod agents;
mod appicon;
mod browser;
mod dirs;
mod dock;
mod files;
mod git;
mod glow;
mod keystop;
mod nativemenu;
mod notch;
mod onboarding;
mod phone;
mod pty;
mod servers;
mod shottr;
mod surfaces;
mod tailscale;
mod tickets;
mod usage;
mod webpush;
mod worktrees;

use std::collections::HashMap;

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

/// Prefix of menu items that run a keyboard-shortcut action in the frontend
/// ("action:splitRight" runs the same handler as ⌘D).
const ACTION_PREFIX: &str = "action:";


/// The menu bar. The default one binds ⌘W to "Close Window", which we want for
/// closing tabs instead. Cut/Copy/Paste stay so the webview receives native
/// clipboard events (without a menu item, macOS never sends the webview ⌘X).
/// Everything else mirrors the app's shortcuts, so each feature can be found
/// (and searched for from Help) in the menu bar. The Loadouts menu lists `loadouts` by name.
///
/// Also returns each action item's (title, action), so `nativemenu` can show its shortcut.
fn build_menu<R: Runtime>(h: &AppHandle<R>, loadouts: &[String]) -> tauri::Result<(Menu<R>, Vec<(String, String)>)> {
    let sep = || PredefinedMenuItem::separator(h);
    let actions = std::cell::RefCell::new(Vec::new());
    // A menu item that runs the frontend's `action` (an `Action` in src/shortcuts.ts).
    //
    // It gets no Tauri accelerator on purpose: a live key equivalent takes the
    // key before the webview sees it, so rebinding on the Shortcuts page,
    // text-field editing and browser panes keeping ⌘F/⌘A would all break. The
    // frontend's keydown handler stays the one place keys are bound;
    // `nativemenu` only shows the shortcut while the menu is open.
    let action = |action: &str, label: &str| {
        actions.borrow_mut().push((label.to_string(), action.to_string()));
        MenuItem::with_id(h, format!("{ACTION_PREFIX}{action}"), label, true, None::<&str>)
    };
    let app_menu = Submenu::with_items(
        h,
        "Workdesk",
        true,
        &[
            &PredefinedMenuItem::about(h, None, None)?,
            &MenuItem::with_id(h, CHECK_UPDATES, "Check for Updates…", true, None::<&str>)?,
            &sep()?,
            &action("openSettings", "Settings…")?,
            &action("openShortcuts", "Keyboard Shortcuts")?,
            &MenuItem::with_id(h, RESTART_ONBOARDING, "Restart Onboarding", true, None::<&str>)?,
            &sep()?,
            &PredefinedMenuItem::hide(h, None)?,
            &PredefinedMenuItem::hide_others(h, None)?,
            &PredefinedMenuItem::show_all(h, None)?,
            &sep()?,
            &MenuItem::with_id(h, QUIT, "Quit Workdesk", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let file_menu = Submenu::with_items(
        h,
        "File",
        true,
        &[
            &action("newTabIn", "Teleport: New Tab in Folder…")?,
            &action("newSession", "New Claude Session…")?,
            &action("newBrowser", "New Browser Tab")?,
            &action("newTicket", "New Ticket…")?,
            &sep()?,
            &action("renameTab", "Rename Tab…")?,
            &action("closeTab", "Close Pane or Tab")?,
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
            &sep()?,
            &action("selectAll", "Select All in Terminal")?,
            &action("findInTerminal", "Find in Terminal…")?,
            &action("clear", "Clear Terminal")?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        h,
        "View",
        true,
        &[
            &action("openHome", "Home")?,
            &action("openServers", "Local Servers")?,
            &sep()?,
            &action("toggleSidebar", "Show or Hide Sidebar")?,
            &action("collapseSidebar", "Collapse or Expand Sidebar")?,
            &action("toggleFileTree", "Show or Hide File Tree")?,
            &sep()?,
            &action("zoomIn", "Bigger Text")?,
            &action("zoomOut", "Smaller Text")?,
            &action("resetZoom", "Default Text Size")?,
        ],
    )?;
    let pane_menu = Submenu::with_items(
        h,
        "Pane",
        true,
        &[
            &action("splitRight", "Split Right")?,
            &action("splitDown", "Split Down")?,
            &action("splitBrowser", "Split Right with Browser")?,
            &action("unsplit", "Unsplit into Tabs")?,
            &sep()?,
            &action("maximizePane", "Maximize or Restore Pane")?,
            &action("arrangePanes", "Change Layout…")?,
            &sep()?,
            &action("nextPane", "Next Pane")?,
            &action("prevPane", "Previous Pane")?,
            &action("focusPaneLeft", "Focus Pane Left")?,
            &action("focusPaneRight", "Focus Pane Right")?,
            &action("focusPaneUp", "Focus Pane Above")?,
            &action("focusPaneDown", "Focus Pane Below")?,
        ],
    )?;
    let tabs_menu = Submenu::with_items(
        h,
        "Tabs",
        true,
        &[
            &action("searchTabs", "Search Tabs…")?,
            &action("nextTab", "Next Tab")?,
            &action("prevTab", "Previous Tab")?,
            &sep()?,
            &action("newGroup", "New Group")?,
            &action("groupSelected", "Group Selected Tabs")?,
            &action("ungroupSelected", "Ungroup Selected Tabs")?,
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
    loadout_menu.append(&sep()?)?;
    loadout_menu.append(&MenuItem::with_id(h, SAVE_ALL_LOADOUT, "Save All Tabs as Loadout…", true, None::<&str>)?)?;
    loadout_menu.append(&MenuItem::with_id(h, EDIT_LOADOUTS, "Edit Loadouts…", true, None::<&str>)?)?;
    let window_menu = Submenu::with_items(
        h,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(h, None)?,
            &PredefinedMenuItem::maximize(h, None)?,
            &PredefinedMenuItem::fullscreen(h, None)?,
        ],
    )?;
    let help_menu = Submenu::with_items(h, "Help", true, &[&action("openShortcuts", "Keyboard Shortcuts")?])?;
    #[cfg(target_os = "macos")]
    {
        // Lets macOS add its own items: the window list, and the Help menu's search field.
        window_menu.set_as_windows_menu_for_nsapp()?;
        help_menu.set_as_help_menu_for_nsapp()?;
    }
    let menu = Menu::with_items(
        h,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &pane_menu, &tabs_menu, &loadout_menu, &window_menu, &help_menu],
    )?;
    Ok((menu, actions.into_inner()))
}

/// Rebuilds the menu bar when the saved loadouts or the key bindings change.
/// `shortcuts` maps an action to the combo it's bound to ("mod+shift+d").
#[tauri::command]
fn update_menu(app: AppHandle, names: Vec<String>, shortcuts: HashMap<String, String>) -> Result<(), String> {
    let (menu, actions) = build_menu(&app, &names).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    let keys = actions.into_iter().filter_map(|(title, action)| Some((title, shortcuts.get(&action)?.clone()))).collect();
    nativemenu::apply(&app, keys);
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
            app.set_menu(build_menu(app.handle(), &[])?.0)?;
            nativemenu::apply(app.handle(), Vec::new());
            if let Some(main) = app.get_webview("main") {
                keystop::contain_keys(&main);
            }
            let shown = surfaces::load();
            if shown.notch {
                if let Err(e) = notch::open(app.handle()) {
                    eprintln!("notch: {e}");
                }
            }
            if shown.dock {
                if let Err(e) = dock::open(app.handle()) {
                    eprintln!("dock: {e}");
                }
            }
            shottr::start(app.handle());
            phone::init(app.handle());
            agent_tickets::start(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id.starts_with(LOADOUT_PREFIX) || id.starts_with(ACTION_PREFIX) || id == SAVE_ALL_LOADOUT || id == EDIT_LOADOUTS || id == QUIT || id == CHECK_UPDATES {
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
            update_menu,
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
            surfaces::surfaces_get,
            surfaces::surfaces_set,
            shottr::shottr_installed,
            shottr::shottr_grab,
            shottr::shottr_ticket,
            shottr::shottr_preview,
            phone::phone_status,
            phone::phone_state,
            phone::phone_snapshot,
            phone::phone_qr,
            phone::phone_forget_push,
            phone::open_tailscale,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_process_names,
            pty::pty_cwds,
            pty::pty_busy,
            agents::agent_status,
            agent_tickets::agent_tickets_take,
            agent_tickets::agent_tickets_done,
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
