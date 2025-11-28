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
 * Find and click an element on screen using AI vision
 */
async function findAndClickElement(elementText: string): Promise<string> {
  try {
    console.log(`Finding element with text: "${elementText}"`);

    // Take a screenshot
    const screenshot = await Computer.takeScreenshot();
    const displayDimensions = await Computer.getDisplayDimensions();

    // Use Claude to locate the element
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
              text: `Find the button or clickable element with the text "${elementText}" (case insensitive) on this screen.

Screen dimensions: ${displayDimensions.width}x${displayDimensions.height}

IMPORTANT: Look carefully for:
- Buttons with text "${elementText}" or "Copy to clipboard" or icons that look like copy/clipboard
- Links or clickable text containing "${elementText}"
- Icon buttons (may have copy icon like two overlapping squares/documents)
- The element might be in the top-right area, toolbar, or near clinical notes
- On scribe.heidihealth.com, copy buttons are often blue or purple colored

Scan the ENTIRE screen systematically from top to bottom.

Return ONLY a JSON object with the EXACT center coordinates of the clickable element:
{"x": 123, "y": 456, "description": "brief description of what you found"}

If you cannot find ANY copy-related element, return:
{"error": "Element not found", "suggestion": "describe what IS visible on screen"}`,
            },
          ],
        },
      ],
      temperature: 0,
    });

    console.log("Vision AI Response:", result.text);

    // Parse the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in AI response");
    }
    const coordinates = JSON.parse(jsonMatch[0]);

    if (coordinates.error) {
      const errorMsg = coordinates.suggestion
        ? `${coordinates.error}. ${coordinates.suggestion}`
        : coordinates.error;
      throw new Error(errorMsg);
    }

    if (!coordinates.x || !coordinates.y) {
      throw new Error("Invalid coordinates returned");
    }

    console.log(`Found element: ${coordinates.description || elementText}`);
    console.log(
      `Clicking at coordinates: (${coordinates.x}, ${coordinates.y})`
    );

    // Click at the found coordinates
    await Computer.clickAt(coordinates.x, coordinates.y);

    const resultMsg = coordinates.description
      ? `Clicked "${coordinates.description}" at (${coordinates.x}, ${coordinates.y})`
      : `Clicked "${elementText}" at (${coordinates.x}, ${coordinates.y})`;

    return resultMsg;
  } catch (error) {
    console.error("Error finding and clicking element:", error);
    throw new Error(
      `Failed to find and click "${elementText}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
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

    // Step 2: If Heidi Health is not visible, try to find it
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
    }

    // Step 3: Click the copy button on Heidi
    executedActions.push("Looking for copy button on Heidi Health...");
    try {
      const copyResult = await findAndClickElement("Copy");
      executedActions.push(copyResult);
      await Computer.wait(1);
    } catch (copyError) {
      // If "Copy" fails, try looking for clipboard icon or "Copy to clipboard"
      executedActions.push(
        `First attempt failed: ${copyError instanceof Error ? copyError.message : String(copyError)}`
      );
      executedActions.push(
        "Trying alternative: looking for clipboard icon or copy-related buttons..."
      );

      try {
        const altResult = await findAndClickElement("Copy to clipboard");
        executedActions.push(altResult);
        await Computer.wait(1);
      } catch (altError) {
        return {
          success: false,
          message:
            "Could not find copy button on Heidi Health page. Please ensure the clinical notes are visible and the copy button is on screen.",
          actions: executedActions,
        };
      }
    }

    // Step 4: Find and switch to EMR
    if (analysis.hasEMR) {
      executedActions.push("EMR detected - switching to it");

      // If we know the tab index, calculate how many tabs to switch
      if (analysis.emrTabIndex && analysis.heidiTabIndex) {
        const tabDiff = analysis.emrTabIndex - analysis.heidiTabIndex;
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
      } else {
        // Just try next tab
        await Computer.pressKey("cmd+shift+]");
        await Computer.wait(0.5);
      }
      executedActions.push("Switched to EMR tab");
    } else {
      executedActions.push("EMR not detected - trying next tab");
      await Computer.pressKey("cmd+shift+]");
      await Computer.wait(0.5);
    }

    // Step 5: Click in a text area and paste
    executedActions.push("Looking for text input area...");
    const displayDimensions = await Computer.getDisplayDimensions();
    // Click in the center of the screen (likely where a text field would be)
    await Computer.clickAt(
      displayDimensions.width / 2,
      displayDimensions.height / 2
    );
    await Computer.wait(0.3);
    executedActions.push("Clicked in text area");

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
- find_and_click: Search for text on screen and click it (e.g., "find_and_click: Copy" to click a copy button)

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
Response: {"interpretation": "Clicking the copy button on Heidi Health page and pasting to notes tab", "actions": ["find_and_click: Copy", "wait: 1", "key: cmd+shift+]", "wait: 0.5", "click: 500,300", "wait: 0.3", "paste"]}

IMPORTANT: For Heidi Health workflows:
- scribe.heidihealth.com is the medical scribe platform where clinical notes are generated
- The page has UI buttons like "Copy", "Copy to Clipboard", "Export", etc.
- EMR (Electronic Medical Record) is where doctors/nurses paste the notes
- Use "find_and_click: ButtonText" to click buttons on web pages
- Use cmd+shift+] to switch to next browser tab, cmd+shift+[ for previous tab
- Use cmd+tab to switch between applications
- Common workflow: Click copy button on Heidi → switch tab → paste to EMR/notes

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

    case "find_and_click": {
      // Take screenshot, use AI to find the element, then click it
      return await findAndClickElement(param);
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
