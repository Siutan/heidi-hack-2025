import { app, BrowserWindow, screen, ipcMain, desktopCapturer, dialog } from 'electron';
import path from 'node:path';
import 'dotenv/config'; // Load .env file
import started from 'electron-squirrel-startup';
import { generateMockData, performAutomation } from './rpa';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

ipcMain.on('resize-window', (event, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const padding = 20;
    const x = screenWidth - width - padding;
    const y = padding;
    win.setBounds({ x, y, width, height }, true);
  }
});

declare const OVERLAY_WINDOW_VITE_DEV_SERVER_URL: string;
declare const OVERLAY_WINDOW_VITE_NAME: string;

const createOverlayWindow = () => {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const padding = 20;
  const windowWidth = 550 - (padding * 2);
  const windowHeight = 100;
  console.log({ screenWidth, windowWidth, windowHeight })

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
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'floating', 1);

  if (OVERLAY_WINDOW_VITE_DEV_SERVER_URL) {
    overlayWindow.loadURL(`${OVERLAY_WINDOW_VITE_DEV_SERVER_URL}/overlay.html`);
  } else {
    overlayWindow.loadFile(
      path.join(__dirname, `../renderer/${OVERLAY_WINDOW_VITE_NAME}/overlay.html`),
    );
  }
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
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


app.on('ready', createWindow);


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
