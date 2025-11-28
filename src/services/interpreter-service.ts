/**
 * CommandInterpreter - Converts natural language commands to computer actions
 *
 * This service uses Claude AI to interpret voice commands and convert them
 * into specific desktop automation actions that computer.ts can execute.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { Computer } from "./computer-service";

interface CommandResult {
  success: boolean;
  message: string;
  actions?: string[];
}

/**
 * Analyze the current screen to detect Heidi Health and EMR applications
 */
async function analyzeCurrentScreen(): Promise<{
  hasHeidiHealth: boolean;
  hasEMR: boolean;
  heidiTabIndex?: number;
  emrTabIndex?: number;
  description: string;
}> {
  try {
    console.log("Analyzing current screen...");

    const screenshot = await Computer.takeScreenshot();
    const displayDimensions = await Computer.getDisplayDimensions();

    const result = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: screenshot,
            },
            {
              type: "text",
              text: `Analyze this screen and identify:

1. Is there a browser tab/window open with "scribe.heidihealth.com"?
2. Is there an EMR (Electronic Medical Record) software or medical records application visible?
   - Look for: patient charts, medical forms, clinical documentation systems
   - Common EMR names: Epic, Cerner, Meditech, Allscripts, or any medical record interface
3. If browser tabs are visible, which tab number (1-based index from left) is Heidi Health?
4. Which tab/window appears to be the EMR or notes application?

Return ONLY a JSON object:
{
  "hasHeidiHealth": true/false,
  "hasEMR": true/false,
  "heidiTabIndex": <number or null>,
  "emrTabIndex": <number or null>,
  "description": "brief description of what you see"
}

Screen dimensions: ${displayDimensions.width}x${displayDimensions.height}`,
            },
          ],
        },
      ],
      temperature: 0,
    });

    console.log("Screen Analysis:", result.text);

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in analysis");
    }

    const analysis = JSON.parse(jsonMatch[0]);
    console.log("Parsed analysis:", analysis);

    return analysis;
  } catch (error) {
    console.error("Error analyzing screen:", error);
    return {
      hasHeidiHealth: false,
      hasEMR: false,
      description: "Failed to analyze screen",
    };
  }
}

/**
 * Execute Heidi Health to EMR workflow with smart detection
 */
async function executeHeidiToEMRWorkflow(): Promise<CommandResult> {
  try {
    console.log("Starting Heidi to EMR workflow...");

    // Step 1: Analyze the screen
    const analysis = await analyzeCurrentScreen();
    console.log("Screen analysis:", analysis);

    const executedActions: string[] = [];
    executedActions.push(`Screen analysis: ${analysis.description}`);

    // Step 2: Ensure browser with Heidi Health is focused
    if (!analysis.hasHeidiHealth) {
      executedActions.push(
        "Heidi Health not found - searching for browser window"
      );
      // Try to find browser with Heidi
      await Computer.pressKey("cmd+tab");
      await Computer.wait(0.5);
      executedActions.push("Switched windows");

      // Re-analyze
      const reanalysis = await analyzeCurrentScreen();
      if (!reanalysis.hasHeidiHealth) {
        return {
          success: false,
          message:
            "Could not find Heidi Health scribe. Please open scribe.heidihealth.com first.",
          actions: executedActions,
        };
      }
      executedActions.push("Found Heidi Health");
    } else {
      // Heidi is visible but might not be focused - click on browser to ensure focus
      executedActions.push("Ensuring browser is focused...");
      const displayDimensions = await Computer.getDisplayDimensions();
      // Click on browser title bar/URL area to focus it
      const focusX = Math.round(displayDimensions.width * 0.5);
      const focusY = 50; // Top area where URL bar typically is

      console.log(`🎯 Clicking browser to focus at (${focusX}, ${focusY})`);
      await Computer.clickAt(focusX, focusY);
      await Computer.wait(0.3);
      executedActions.push(`Focused browser window`);
    }

    // Step 3: Select and copy the text content
    executedActions.push("Selecting text content on Heidi Health...");
    try {
      // Click in the main content area (slightly left of center and upper-middle)
      const displayDimensions = await Computer.getDisplayDimensions();
      // Click at 40% from left, 40% from top (avoid sidebars and headers)
      const centerX = Math.round(displayDimensions.width * 0.4);
      const centerY = Math.round(displayDimensions.height * 0.4);

      console.log(`📍 Clicking in content area at (${centerX}, ${centerY})`);
      await Computer.clickAt(centerX, centerY);
      await Computer.wait(0.3);
      executedActions.push(
        `Clicked in content area at (${centerX}, ${centerY})`
      );

      // Select all text
      console.log(`📋 Selecting all content (Cmd+A)`);
      await Computer.pressKey("cmd+a");
      await Computer.wait(0.3);
      executedActions.push("Selected all content");

      // Copy
      console.log(`📋 Copying content (Cmd+C)`);
      await Computer.pressKey("cmd+c");
      await Computer.wait(0.5);
      executedActions.push("Copied content to clipboard");
    } catch (copyError) {
      return {
        success: false,
        message: `Failed to copy content: ${copyError instanceof Error ? copyError.message : String(copyError)}`,
        actions: executedActions,
      };
    }

    // Step 4: Find and switch to EMR/Notes app
    if (analysis.hasEMR && analysis.emrTabIndex !== analysis.heidiTabIndex) {
      // EMR is in a different tab - switch tabs
      executedActions.push("EMR detected in different tab - switching to it");

      const tabDiff = analysis.emrTabIndex! - analysis.heidiTabIndex!;
      if (tabDiff > 0) {
        // Switch forward
        for (let i = 0; i < tabDiff; i++) {
          await Computer.pressKey("cmd+shift+]");
          await Computer.wait(0.3);
        }
      } else if (tabDiff < 0) {
        // Switch backward
        for (let i = 0; i < Math.abs(tabDiff); i++) {
          await Computer.pressKey("cmd+shift+[");
          await Computer.wait(0.3);
        }
      }
      executedActions.push("Switched to EMR tab");
    } else {
      // EMR is same tab OR not detected - switch to different app (Notes, etc)
      executedActions.push("Switching to different app (Cmd+Tab)");
      await Computer.pressKey("cmd+tab");
      await Computer.wait(1.5); // Wait longer for app to fully switch
      executedActions.push("Switched to next application");
    }

    // Step 5: Focus the target app and click in text area
    executedActions.push("Focusing target application...");
    const displayDimensions2 = await Computer.getDisplayDimensions();

    // First, click on the top of the window to ensure it's focused (title bar area)
    const focusAppX = Math.round(displayDimensions2.width * 0.5);
    const focusAppY = 50; // Top area

    console.log(
      `🎯 Clicking to focus target app at (${focusAppX}, ${focusAppY})`
    );
    await Computer.clickAt(focusAppX, focusAppY);
    await Computer.wait(0.3);
    executedActions.push(`Focused target application`);

    // Now click in the text area
    executedActions.push("Looking for text input area...");
    // Click in a better position - left-center area where text editors usually are
    const pasteX = Math.round(displayDimensions2.width * 0.3);
    const pasteY = Math.round(displayDimensions2.height * 0.3);

    console.log(`📍 Clicking in paste area at (${pasteX}, ${pasteY})`);
    await Computer.clickAt(pasteX, pasteY);
    await Computer.wait(0.3);
    executedActions.push(`Clicked in text area at (${pasteX}, ${pasteY})`);

    // Paste
    await Computer.pressKey("cmd+v");
    executedActions.push("Pasted content");

    return {
      success: true,
      message: "Successfully copied from Heidi Health to EMR",
      actions: executedActions,
    };
  } catch (error) {
    console.error("Error in Heidi to EMR workflow:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Workflow failed",
    };
  }
}

/**
 * Interpret a natural language command and execute it using computer.ts
 */
export async function interpretAndExecuteCommand(
  command: string
): Promise<CommandResult> {
  try {
    console.log("Interpreting command:", command);

    // Check if this is a Heidi Health workflow command
    const lowerCommand = command.toLowerCase();
    const isHeidiWorkflow =
      (lowerCommand.includes("heidi") || lowerCommand.includes("scribe")) &&
      (lowerCommand.includes("copy") ||
        lowerCommand.includes("paste") ||
        lowerCommand.includes("emr") ||
        lowerCommand.includes("transfer"));

    if (isHeidiWorkflow) {
      console.log("Detected Heidi Health workflow - using smart detection");
      return await executeHeidiToEMRWorkflow();
    }

    // Use Claude to interpret the command and generate actions
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      messages: [
        {
          role: "user",
          content: `You are a desktop automation assistant. The user said: "${command}"

Your task is to interpret this command and convert it into a sequence of computer actions.

Available actions:
- type: Type text (e.g., "type: Hello World")
- click: Click at coordinates (e.g., "click: 100,200")
- key: Press a key (e.g., "key: return", "key: cmd+space", "key: cmd+tab", "key: cmd+shift+]" for next browser tab, "key: cmd+shift+[" for previous browser tab)
- wait: Wait for seconds (e.g., "wait: 2")
- open_app: Open an application (e.g., "open_app: Safari")
- copy: Copy selected text (e.g., "copy")
- paste: Paste from clipboard (e.g., "paste")
- select_all: Select all text (e.g., "select_all")
- focus_url: Focus URL bar and navigate (e.g., "focus_url: scribe.heidihealth.com")

Respond with a JSON object containing:
{
  "interpretation": "brief description of what you understood",
  "actions": ["action1", "action2", ...]
}

Examples:
Command: "Open Safari and go to Google"
Response: {"interpretation": "Opening Safari browser and navigating to Google", "actions": ["key: cmd+space", "wait: 0.5", "type: Safari", "wait: 0.5", "key: return", "wait: 2", "key: cmd+l", "wait: 0.5", "type: google.com", "key: return"]}

Command: "Type hello world"
Response: {"interpretation": "Typing the text 'hello world'", "actions": ["type: hello world"]}

Command: "Copy notes from Heidi and paste to EMR"
Response: {"interpretation": "Copying text from Heidi Health scribe and pasting to EMR system", "actions": ["key: cmd+tab", "wait: 1", "select_all", "wait: 0.3", "copy", "wait: 0.5", "key: cmd+tab", "wait: 1", "click: 500,400", "wait: 0.5", "paste"]}

Command: "Click copy button on Heidi and paste to notes"
Response: {"interpretation": "Copying text from Heidi Health scribe and pasting to note app", "actions": ["key: cmd+tab", "wait: 1", "select_all", "wait: 0.3", "copy", "wait: 0.5", "key: cmd+tab", "wait: 1", "click: 500,400", "wait: 0.5", "paste"]}

IMPORTANT: For Heidi Health workflows:
- scribe.heidihealth.com is the medical scribe platform where clinical notes are generated
- EMR (Electronic Medical Record) is where doctors/nurses paste the notes
- You may need to switch browser tabs or applications to go between Heidi and EMR or notes app
- Use cmd+tab to switch between applications

Now interpret: "${command}"`,
        },
      ],
      temperature: 0.3,
    });

    console.log("AI Response:", result.text);

    // Parse the AI response
    let interpretation: { interpretation: string; actions: string[] };
    try {
      // Extract JSON from the response (it might be wrapped in markdown)
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      interpretation = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Error parsing AI response:", parseError);
      throw new Error("Failed to parse command interpretation");
    }

    if (!interpretation.actions || !Array.isArray(interpretation.actions)) {
      throw new Error("Invalid interpretation format");
    }

    console.log("Interpretation:", interpretation.interpretation);
    console.log("Actions to execute:", interpretation.actions);

    // Execute https://scribe.heidihealth.com/scribe/session/11587368312302962312175126235884623728#selectedOrganizationId=null&reviewMember=%22kp_c4f40bcb87d34128942e21442b5395f3%22&chooseNoteStructureModal=falseeach action sequentially
    const executedActions: string[] = [];
    for (const action of interpretation.actions) {
      const actionResult = await executeAction(action);
      executedActions.push(actionResult);
      console.log("Executed:", actionResult);
    }

    return {
      success: true,
      message: interpretation.interpretation,
      actions: executedActions,
    };
  } catch (error: unknown) {
    console.error("Error interpreting command:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to execute command",
    };
  }
}

/**
 * Execute a single action using computer.ts
 */
async function executeAction(action: string): Promise<string> {
  const [actionType, ...params] = action.split(":");
  const param = params.join(":").trim(); // Rejoin in case there were colons in the param

  switch (actionType.trim().toLowerCase()) {
    case "type": {
      return await Computer.type(param);
    }

    case "click": {
      const [x, y] = param.split(",").map((n) => parseInt(n.trim()));
      if (isNaN(x) || isNaN(y)) {
        throw new Error(`Invalid click coordinates: ${param}`);
      }
      return await Computer.clickAt(x, y);
    }

    case "key": {
      return await Computer.pressKey(param);
    }

    case "wait": {
      const seconds = parseFloat(param);
      if (isNaN(seconds)) {
        throw new Error(`Invalid wait duration: ${param}`);
      }
      return await Computer.wait(seconds);
    }

    case "open_app": {
      // Open app using Spotlight (Cmd+Space)
      await Computer.pressKey("cmd+space");
      await Computer.wait(0.5);
      await Computer.type(param);
      await Computer.wait(0.5);
      await Computer.pressKey("return");
      return `Opening ${param}`;
    }

    case "move": {
      const [x, y] = param.split(",").map((n) => parseInt(n.trim()));
      if (isNaN(x) || isNaN(y)) {
        throw new Error(`Invalid move coordinates: ${param}`);
      }
      return await Computer.moveMouse(x, y);
    }

    case "double_click": {
      const [x, y] = param.split(",").map((n) => parseInt(n.trim()));
      if (isNaN(x) || isNaN(y)) {
        throw new Error(`Invalid double click coordinates: ${param}`);
      }
      return await Computer.doubleClickAt(x, y);
    }

    case "right_click": {
      const [x, y] = param.split(",").map((n) => parseInt(n.trim()));
      if (isNaN(x) || isNaN(y)) {
        throw new Error(`Invalid right click coordinates: ${param}`);
      }
      return await Computer.rightClickAt(x, y);
    }

    case "copy": {
      return await Computer.pressKey("cmd+c");
    }

    case "paste": {
      return await Computer.pressKey("cmd+v");
    }

    case "select_all": {
      return await Computer.pressKey("cmd+a");
    }

    case "focus_url": {
      // Focus URL bar and type URL
      await Computer.pressKey("cmd+l");
      await Computer.wait(0.3);
      await Computer.type(param);
      await Computer.pressKey("return");
      return `Navigating to ${param}`;
    }

    default: {
      throw new Error(`Unknown action type: ${actionType}`);
    }
  }
}

/**
 * Simple command interpreter for basic commands without AI
 * This is a fallback or can be used for quick testing
 */
export async function executeSimpleCommand(
  command: string
): Promise<CommandResult> {
  try {
    const lowerCommand = command.toLowerCase();

    // Simple pattern matching for common commands
    if (lowerCommand.includes("open") && lowerCommand.includes("safari")) {
      await Computer.pressKey("cmd+space");
      await Computer.wait(0.5);
      await Computer.type("Safari");
      await Computer.wait(0.5);
      await Computer.pressKey("return");
      return {
        success: true,
        message: "Opened Safari",
        actions: ["cmd+space", "type Safari", "return"],
      };
    }

    if (lowerCommand.includes("type")) {
      const textMatch = lowerCommand.match(/type\s+(.+)/);
      if (textMatch) {
        const text = textMatch[1];
        await Computer.type(text);
        return {
          success: true,
          message: `Typed: ${text}`,
          actions: [`type ${text}`],
        };
      }
    }

    if (lowerCommand.includes("screenshot")) {
      await Computer.takeScreenshot();
      return {
        success: true,
        message: "Screenshot taken",
        actions: ["screenshot"],
      };
    }

    // Default: use AI interpreter
    return await interpretAndExecuteCommand(command);
  } catch (error: unknown) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to execute command",
    };
  }
}
