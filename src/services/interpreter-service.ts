/**
 * CommandInterpreter - Converts natural language commands to computer actions
 *
 * This service uses Claude AI to interpret voice commands and convert them
 * into specific desktop automation actions that computer.ts can execute.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type ModelMessage } from "ai";
import { Computer } from "./computer-service";

interface CommandResult {
  success: boolean;
  message: string;
  actions?: string[];
}

const AI_MODEL = anthropic("claude-sonnet-4-5-20250929");

/**
 * Available actions that can be executed by the automation system
 */
const AVAILABLE_ACTIONS = `Available actions:
- type: Type text (e.g., "type: Hello World")
- click: Click at coordinates (e.g., "click: 100,200")
- key: Press a key (e.g., "key: return", "key: cmd+space", "key: cmd+tab", "key: cmd+shift+]", "key: cmd+a", "key: cmd+c", "key: cmd+v")
- double_click: Double click at coordinates (e.g., "double_click: 100,200")
- right_click: Right click at coordinates (e.g., "right_click: 100,200")
- move: Move mouse to coordinates (e.g., "move: 100,200")
- copy: Copy selected text (shorthand for "key: cmd+c")
- paste: Paste from clipboard (shorthand for "key: cmd+v")
- select_all: Select all text (shorthand for "key: cmd+a")
- open_app: Open application via Spotlight (e.g., "open_app: Safari")`;

/**
 * Execute Heidi Health to EMR workflow with vision-based loop
 */
async function executeHeidiToEMRWorkflow(): Promise<CommandResult> {
  try {
    console.log("Starting Heidi to EMR workflow with vision loop...");

    const executedActions: string[] = [];
    let iteration = 0;
    const maxIterations = 20;
    let conversationHistory: ModelMessage[] = [];
    let isComplete = false;

    const goal =
      "Copy medical notes from Heidi Health scribe (scribe.heidihealth.com) and paste them into the EMR or notes application";

    while (iteration < maxIterations && !isComplete) {
      iteration++;
      console.log(
        `\n=== Heidi Workflow Iteration ${iteration}/${maxIterations} ===`
      );

      // Take screenshot
      const screenshot = await Computer.takeScreenshot();
      const displayDimensions = await Computer.getDisplayDimensions();

      // Build the prompt for this iteration
      const prompt =
        iteration === 1
          ? `You are a medical workflow automation assistant. Your goal: "${goal}"

Screen dimensions: ${displayDimensions.width}x${displayDimensions.height}

CONTEXT:
- Heidi Health (scribe.heidihealth.com) is a medical scribe platform with clinical notes
- EMR (Electronic Medical Record) or mock ehr desktop app is where these notes need to be pasted
- You need to: 1) Find and focus Heidi, 2) Select and copy the notes, 3) Switch to EMR/notes app, 4) Paste

Look at the current screen and decide the NEXT SINGLE ACTION to accomplish this goal.

${AVAILABLE_ACTIONS}

Respond with JSON:
{
  "thinking": "what you see and why you're taking these actions",
  "actions": ["action1", "action2", "action3"],
  "isComplete": false
}

When notes are successfully pasted in the EMR/notes app, set "isComplete": true and "actions": ["done"].

IMPORTANT: You can return MULTIPLE actions that will be executed in sequence. Group related actions together (e.g., ["click: 500,300", "key: cmd+a", "key: cmd+c"]).`
          : `Continue: "${goal}"

Previous actions: ${executedActions.slice(-5).join(" → ")}

What are the NEXT ACTIONS to take? Same JSON format with actions array.`;

      // Query Claude with vision
      const result = await generateText({
        model: AI_MODEL,
        messages: [
          ...conversationHistory,
          {
            role: "user" as const,
            content: [
              {
                type: "image",
                image: screenshot,
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
        temperature: 0.1,
      });

      console.log("AI Response:", result.text);

      // Parse the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in AI response");
      }

      const decision = JSON.parse(jsonMatch[0]);
      console.log("Decision:", decision);
      console.log("Thinking:", decision.thinking);

      // Add to conversation history
      conversationHistory.push({
        role: "user",
        content: prompt,
      });
      conversationHistory.push({
        role: "assistant",
        content: result.text,
      });

      // Keep conversation history manageable
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }

      // Check if complete
      if (decision.isComplete) {
        console.log("✓ Workflow marked as complete!");
        isComplete = true;
        break;
      }

      // Execute the actions
      const actions = Array.isArray(decision.actions)
        ? decision.actions
        : [decision.action].filter(Boolean);
      if (actions.length > 0 && actions[0] !== "done") {
        console.log(
          `Executing ${actions.length} action(s): ${actions.join(", ")}`
        );
        for (const action of actions) {
          const actionResult = await executeAction(action);
          executedActions.push(action);
          console.log(`Result: ${actionResult}`);
        }
      }
    }

    if (!isComplete && iteration >= maxIterations) {
      return {
        success: false,
        message: `Heidi workflow not completed after ${maxIterations} iterations`,
        actions: executedActions,
      };
    }

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
 * Interpret a natural language command and execute it using computer.ts with vision-based loop
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

    // Use vision-based loop for complex commands
    return await executeCommandWithVisionLoop(command);
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
 * Execute command using a vision-based loop where AI sees the screen and decides next action
 */
async function executeCommandWithVisionLoop(
  command: string,
  maxIterations = 20
): Promise<CommandResult> {
  try {
    console.log("Starting vision-based command loop for:", command);

    const executedActions: string[] = [];
    let iteration = 0;
    let isComplete = false;
    let conversationHistory: ModelMessage[] = [];

    while (iteration < maxIterations && !isComplete) {
      iteration++;
      console.log(`\n=== Iteration ${iteration}/${maxIterations} ===`);

      // Take screenshot
      const screenshot = await Computer.takeScreenshot();
      const displayDimensions = await Computer.getDisplayDimensions();

      // Build the prompt for this iteration
      const prompt =
        iteration === 1
          ? `You are a desktop automation assistant. The user wants you to: "${command}"

Screen dimensions: ${displayDimensions.width}x${displayDimensions.height}

Look at the current screen and decide the NEXT SINGLE ACTION to take to accomplish this goal.

${AVAILABLE_ACTIONS}

Respond with a JSON object:
{
  "thinking": "what you see and why you're taking these actions",
  "actions": ["action1", "action2", "action3"],
  "isComplete": false
}

When the task is fully complete, set "isComplete": true and set "actions": ["done"].

IMPORTANT: You can return MULTIPLE actions that will be executed in sequence. Group related actions together for speed (e.g., ["key: cmd+space", "type: Safari", "key: return"]).`
          : `Continue with: "${command}"

Previous actions: ${executedActions.slice(-5).join(" → ")}

What are the NEXT ACTIONS to take? Return the same JSON format with actions array.`;

      // Query Claude with vision
      const result = await generateText({
        model: AI_MODEL,
        messages: [
          ...conversationHistory,
          {
            role: "user" as const,
            content: [
              {
                type: "image",
                image: screenshot,
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
        temperature: 0.2,
      });

      console.log("AI Response:", result.text);

      // Parse the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in AI response");
      }

      const decision = JSON.parse(jsonMatch[0]);
      console.log("Decision:", decision);

      // Add to conversation history (without the image to save tokens)
      conversationHistory.push({
        role: "user",
        content: prompt,
      });
      conversationHistory.push({
        role: "assistant",
        content: result.text,
      });

      // Keep conversation history manageable (last 4 exchanges)
      if (conversationHistory.length > 8) {
        conversationHistory = conversationHistory.slice(-8);
      }

      // Check if complete
      if (decision.isComplete) {
        console.log("Task marked as complete!");
        isComplete = true;
        break;
      }

      // Execute the actions
      const actions = Array.isArray(decision.actions)
        ? decision.actions
        : [decision.action].filter(Boolean);
      if (actions.length > 0 && actions[0] !== "done") {
        console.log(
          `Executing ${actions.length} action(s): ${actions.join(", ")}`
        );
        for (const action of actions) {
          const actionResult = await executeAction(action);
          executedActions.push(action);
          console.log(`Result: ${actionResult}`);
        }
      }
    }

    if (!isComplete && iteration >= maxIterations) {
      return {
        success: false,
        message: `Command not completed after ${maxIterations} iterations`,
        actions: executedActions,
      };
    }

    return {
      success: true,
      message: `Completed: ${command}`,
      actions: executedActions,
    };
  } catch (error: unknown) {
    console.error("Error in vision loop:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Vision loop failed",
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

    default: {
      throw new Error(`Unknown action type: ${actionType}`);
    }
  }
}
