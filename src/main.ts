import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  systemPreferences,
} from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import * as dotenv from "dotenv";
import { getWakeWordService, destroyWakeWordService } from "./wake";

// Load environment variables from multiple possible locations
const envPaths = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, "..", "..", ".env"),
  path.join(__dirname, "..", ".env"),
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log("[Main] Loaded .env from:", envPath);
    break;
  }
}

console.log("[Main] ========================================");
console.log("[Main] Application Starting");
console.log("[Main] ========================================");
console.log("[Main] CWD:", process.cwd());
console.log("[Main] __dirname:", __dirname);
console.log(
  "[Main] GOOGLE_API_KEY:",
  process.env.GOOGLE_API_KEY
    ? `SET (${process.env.GOOGLE_API_KEY.substring(0, 10)}...)`
    : "NOT SET ⚠️"
);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

ipcMain.on("resize-window", (event, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setSize(width, height, true);
  }
});

ipcMain.on("transcript-update", (event, text) => {
  // Find the main window (not the overlay)
  const windows = BrowserWindow.getAllWindows();
  const mainWindow = windows.find((w) => !w.isAlwaysOnTop()); // Heuristic: Overlay is always on top
  if (mainWindow) {
    mainWindow.webContents.send("transcript-update", text);
  }
});

ipcMain.handle("request-mic-permission", async () => {
  // skip non mac
  if (process.platform !== "darwin") {
    return true;
  }
  const status = systemPreferences.getMediaAccessStatus("microphone");
  console.log({ status });
  if (status === "granted") {
    return true;
  }
  return await systemPreferences.askForMediaAccess("microphone");
});

// =============================================================================
// Wake Word Service IPC Handlers
// =============================================================================

let wakeWordInitialized = false;

/**
 * Broadcast an event to all renderer windows
 */
function broadcastToRenderers(channel: string, data?: unknown) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

/**
 * Initialize wake word service and set up event forwarding
 */
async function initializeWakeWordService() {
  if (wakeWordInitialized) {
    console.log("[Main] Wake word service already initialized");
    return;
  }

  try {
    console.log("[Main] ========================================");
    console.log("[Main] Initializing Wake Word Service");
    console.log("[Main] ========================================");
    console.log(
      "[Main] GOOGLE_API_KEY:",
      process.env.GOOGLE_API_KEY ? "SET" : "NOT SET"
    );

    const service = getWakeWordService();

    // Forward events to renderer
    service.on("statusChange", (status) => {
      console.log("[Main] Status change:", status);
      broadcastToRenderers("wake-word-status-change", status);
    });

    service.on("wakeDetected", (data) => {
      console.log("[Main] 🎉 Wake word detected:", data);
      broadcastToRenderers("wake-word-detected", data);
    });

    service.on("commandCaptured", (data) => {
      console.log("[Main] 📝 Command captured:", data);
      broadcastToRenderers("wake-word-command", data);
    });

    service.on("transcript", (data) => {
      console.log("[Main] Transcript:", data.text);
      broadcastToRenderers("wake-word-transcript", data);
    });

    service.on("error", (error) => {
      console.error("[Main] ✗ Wake word error:", error.message);
      broadcastToRenderers("wake-word-error", error.message);
    });

    await service.initialize();
    wakeWordInitialized = true;
    console.log("[Main] ✓ Wake word service initialized successfully");
  } catch (error) {
    console.error("[Main] ✗ Failed to initialize wake word service:", error);
    throw error;
  }
}

// Wake word start
ipcMain.handle("wake-word-start", async () => {
  console.log("[Main] IPC: wake-word-start received");
  try {
    await initializeWakeWordService();
    const service = getWakeWordService();
    service.start();
    console.log("[Main] ✓ Wake word service started");
  } catch (error) {
    console.error("[Main] ✗ Failed to start wake word service:", error);
    throw error;
  }
});

// Wake word stop
ipcMain.handle("wake-word-stop", async () => {
  console.log("[Main] IPC: wake-word-stop received");
  const service = getWakeWordService();
  service.stop();
});

// Wake word status
ipcMain.handle("wake-word-status", async () => {
  const service = getWakeWordService();
  const status = service.getStatus();
  console.log("[Main] IPC: wake-word-status =", status);
  return status;
});

declare const OVERLAY_WINDOW_VITE_DEV_SERVER_URL: string;
declare const OVERLAY_WINDOW_VITE_NAME: string;

const createOverlayWindow = () => {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const padding = 20;
  const windowWidth = 550 - padding * 2;
  const windowHeight = 100;
  console.log({ screenWidth, windowWidth, windowHeight });

  const overlayWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: padding,
    y: padding,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false, // We use CSS shadow
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Make it float above full-screen apps if possible
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, "floating", 1);

  if (OVERLAY_WINDOW_VITE_DEV_SERVER_URL) {
    overlayWindow.loadURL(`${OVERLAY_WINDOW_VITE_DEV_SERVER_URL}/overlay.html`);
  } else {
    overlayWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${OVERLAY_WINDOW_VITE_NAME}/overlay.html`
      )
    );
  }

  // Open DevTools for overlay to see logs
  overlayWindow.webContents.openDevTools({ mode: "detach" });
};

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  createOverlayWindow();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Cleanup on quit
app.on("will-quit", () => {
  destroyWakeWordService();
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
