import { GoogleGenerativeAI } from "@google/generative-ai";
import { exec } from "child_process";
import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { interpretAndExecuteCommand } from "./services/interpreter-service";

// Load environment variables from .env file
dotenv.config();

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

  // overlayWindow.webContents.openDevTools({ mode: 'detach' });
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

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
