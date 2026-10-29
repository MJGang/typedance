use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone)]
struct WorkspacePlacement {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    maximized: bool,
}

#[derive(Default)]
struct Presentation {
    workspace: bool,
    placement: Option<WorkspacePlacement>,
}

/// 原生窗口外观由可信账号状态驱动，不允许前端决定是否进入工作台。
#[derive(Default)]
pub(crate) struct AccountWindow(Mutex<Presentation>);

fn fitted_size(window: &WebviewWindow, width: f64, height: f64) -> LogicalSize<f64> {
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Ok(Some(monitor)) = window.current_monitor() {
        let available = monitor.work_area().size.to_logical::<f64>(scale);
        return LogicalSize::new(
            width.min((available.width - 24.0).max(1.0)),
            height.min((available.height - 24.0).max(1.0)),
        );
    }
    LogicalSize::new(width, height)
}

impl AccountWindow {
    pub(crate) fn apply(app: &AppHandle, workspace: bool) {
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let controller = handle.state::<Self>();
            let Ok(mut presentation) = controller.0.lock() else {
                return;
            };
            if presentation.workspace == workspace {
                return;
            }
            let Some(window) = handle.get_webview_window("main") else {
                return;
            };
            let result = if workspace {
                Self::restore_workspace(&window, &presentation)
            } else {
                Self::show_login(&window, &mut presentation)
            };
            match result {
                Ok(()) => presentation.workspace = workspace,
                Err(error) => eprintln!("Failed to adjust account window: {error}"),
            }
        }) {
            eprintln!("Failed to schedule account window: {error}");
        }
    }

    fn show_login(window: &WebviewWindow, presentation: &mut Presentation) -> tauri::Result<()> {
        let maximized = window.is_maximized()?;
        let mut placement = WorkspacePlacement {
            size: window.inner_size()?,
            position: window.outer_position()?,
            maximized,
        };
        // 保留最大化之前的正常尺寸，重新登录后再恢复最大化。
        if maximized {
            if let Some(previous) = &presentation.placement {
                placement.size = previous.size;
                placement.position = previous.position;
            }
        }
        presentation.placement = Some(placement);
        window.unmaximize()?;
        window.set_min_size(None::<LogicalSize<f64>>)?;
        window.set_size(fitted_size(window, 480.0, 640.0))?;
        window.set_maximizable(false)?;
        window.set_resizable(false)?;
        window.center()
    }

    fn restore_workspace(window: &WebviewWindow, presentation: &Presentation) -> tauri::Result<()> {
        window.set_resizable(true)?;
        window.set_maximizable(true)?;
        window.set_min_size(None::<LogicalSize<f64>>)?;
        if let Some(placement) = &presentation.placement {
            window.set_size(placement.size)?;
            window.set_position(placement.position)?;
            if placement.maximized {
                window.maximize()?;
            }
        } else {
            window.set_size(fitted_size(window, 1366.0, 900.0))?;
            window.center()?;
        }
        Ok(())
    }

    pub(crate) fn remember_workspace(window: &tauri::Window) {
        let Some(controller) = window.app_handle().try_state::<Self>() else {
            return;
        };
        // 窗口变更可能在设置尺寸期间触发，不能重入外观切换。
        let Ok(mut presentation) = controller.0.try_lock() else {
            return;
        };
        if !presentation.workspace || window.is_maximized().unwrap_or(true) {
            return;
        }
        if let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) {
            presentation.placement = Some(WorkspacePlacement {
                size,
                position,
                maximized: false,
            });
        }
    }

    pub(crate) fn fit_initial(app: &AppHandle) -> tauri::Result<()> {
        if let Some(window) = app.get_webview_window("main") {
            window.set_size(fitted_size(&window, 480.0, 640.0))?;
            window.center()?;
        }
        Ok(())
    }
}
