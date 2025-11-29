import { dialog } from "electron";
import { generateMockData, performAutomation } from "../rpa";



export async function fillTemplate(sender: Electron.WebContents,conversation?: string, sourceId?: string) {
    try {
        const textToProcess = conversation || generateMockData();
        await performAutomation(textToProcess, sourceId, (data) => {
          sender.send('automation-update', data);
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
}