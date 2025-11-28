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
 * Interpret a natural language command and execute it using computer.ts
 */
export async function interpretAndExecuteCommand(
  command: string
): Promise<CommandResult> {
  try {
    console.log("Interpreting command:", command);

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
- key: Press a key (e.g., "key: return", "key: cmd+space", "key: cmd+tab")
- wait: Wait for seconds (e.g., "wait: 2")
- open_app: Open an application (e.g., "open_app: Safari")

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

Now interpret: "${command}"`,
        },
      ],
      temperature: 0.3,
    });

    console.log("AI Response:", result.text);

    // Parse the AI response
    let interpretation: any;
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

    // Execute each action sequentially
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
  } catch (error: any) {
    console.error("Error interpreting command:", error);
    return {
      success: false,
      message: error.message || "Failed to execute command",
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
  } catch (error: any) {
    return {
      success: false,
      message: error.message || "Failed to execute command",
    };
  }
}
