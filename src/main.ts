import {
  app,
  BrowserWindow,
  screen,
  ipcMain, desktopCapturer, dialog,
  systemPreferences,
} from "electron";
import path from "node:path";
import { exec } from "child_process";
import 'dotenv/config'; // Load .env file
import started from "electron-squirrel-startup";
import * as dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { interpretAndExecuteCommand } from "./services/interpreter-service";
import { getWakeWordService, destroyWakeWordService } from "./wake";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

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
  "[Main] GEMINI_API_KEY:",
  process.env.GEMINI_API_KEY
    ? `SET (${process.env.GEMINI_API_KEY.substring(0, 10)}...)`
    : "NOT SET ⚠️"
);
import { generateMockData, performAutomation } from './rpa';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

ipcMain.on("resize-window", (event, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const padding = 20;
    const x = screenWidth - width - padding;
    const y = padding;
    win.setBounds({ x, y, width, height }, true);
  }
});

ipcMain.handle("check-and-open-app", async () => {
  return new Promise((resolve) => {
    const appName = "mock ehr desktop app";
    // Check if app is running
    exec(`ps -ax | grep "${appName}" | grep -v grep`, (err, stdout) => {
      if (stdout) {
        console.log(`${appName} is already running.`);
        resolve(true);
      } else {
        console.log(`${appName} is not running. Opening...`);
        exec(`open -a "${appName}"`, (err) => {
          if (err) {
            console.error(`Failed to open ${appName}:`, err);
            resolve(false);
          } else {
            console.log(`Opened ${appName}`);
            resolve(true);
          }
        });
      }
    });
  });
});

// Handle voice command execution
ipcMain.handle("execute-voice-command", async (_event, command: string) => {
  try {
    console.log("Received voice command:", command);

    // Interpret and execute the command using AI + computer.ts
    const result = await interpretAndExecuteCommand(command);

    return result;
  } catch (error) {
    console.error("Error executing voice command:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to execute command",
    };
  }
});

// Handle audio transcription
ipcMain.handle("transcribe-audio", async (_event, base64Audio: string) => {
  try {
    console.log("Received audio for transcription");

    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY not found in environment variables. Please add it to your .env file."
      );
    }

    // Call Gemini API for transcription
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    console.log("Sending to Gemini API...");
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: base64Audio,
        },
      },
      "Transcribe this audio to text. Only return the transcribed text, nothing else.",
    ]);

    const transcript = result.response.text();
    console.log("Transcription result:", transcript);

    return {
      success: true,
      transcript: transcript,
    };
  } catch (error) {
    console.error("Error transcribing audio:", error);
    console.error(
      "Error details:",
      error instanceof Error ? error.message : String(error)
    );
    return {
      success: false,
      transcript: "",
      error:
        error instanceof Error ? error.message : "Failed to transcribe audio",
    };
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
      "[Main] GEMINI_API_KEY:",
      process.env.GEMINI_API_KEY ? "SET" : "NOT SET"
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

    service.on("transcript", (data) => {
      console.log("[Main] Transcript:", data.text);
      broadcastToRenderers("wake-word-transcript", data);
    });

    service.on("geminiResponse", (data) => {
      console.log("[Main] 🤖 Gemini response:", data.text);
      broadcastToRenderers("gemini-response", data);
    });

    service.on("geminiAudio", (data) => {
      console.log("[Main] 🔊 Gemini audio received");
      // Convert Buffer to base64 for IPC
      broadcastToRenderers("gemini-audio", {
        audio: data.audio.toString("base64"),
      });
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
    x: screenWidth - windowWidth - padding,
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
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

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

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  });

  ipcMain.handle('rpa:fill-template', async (event, conversation: string, sourceId?: string) => {
    try {
      const textToProcess = conversation || generateMockData();
      await performAutomation(textToProcess, sourceId, (data) => {
        event.sender.send('automation-update', data);
      });
      return 'done';
    } catch (error: any) {
      console.error("RPA Error in main process:", error);
      
      let message = "An unexpected error occurred during automation.";
      if (error.name === 'RPAError' || error.name === 'ElementNotFoundError' || error.name === 'NoActionsGeneratedError' || error.name === 'ScreenCaptureError') {
        message = error.message;
      } else if (error.message) {
        message = error.message;
      }

      // Show error dialog to user
      dialog.showErrorBox("Automation Failed", message);
      
      throw error; // Propagate back to renderer if needed
    }
  });
};


app.on("ready", createWindow);


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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
