/* eslint-disable @typescript-eslint/no-namespace */
/**
 * @fileoverview This file defines the `Computer` namespace, which provides functions to automate computer actions like mouse movements, clicks, typing, and screenshots using the `cliclick` command-line tool. It includes functions like `executeComputerAction`, `takeScreenshot`, and helper functions for key mapping and error handling. The `getComputerTool` function returns an AI tool definition for interacting with the computer.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { exec } from "child_process";
import screenshot from "screenshot-desktop";
import sharp from "sharp";
import { promisify } from "util";

const execPromise = promisify(exec);

export const getComputerTool = async () => {
  const displayDimensions = await Computer.getDisplayDimensions();

  return anthropic.tools.computer_20250124({
    displayWidthPx: displayDimensions.width,
    displayHeightPx: displayDimensions.height,
    execute: async (toolParams) => {
      switch (toolParams.action) {
        case "screenshot": {
          return {
            type: "image",
            data: await Computer.takeScreenshot(),
          };
        }
        default: {
          return await Computer.executeComputerAction(toolParams);
        }
      }
    },
  });
};

let commandCount = 0;
/**
 * Helper function to execute cliclick commands
 * @param command - The cliclick command and arguments
 * @returns Promise that resolves with the stdout of the command
 */
async function executeCliClickCommand(command: string): Promise<string> {
  // We print the command count because for some reason this makes cliclick work
  // https://github.com/BlueM/cliclick/issues/164
  commandCount++;
  return (await execPromise(`cliclick ${command} p:${commandCount}`)).stdout;
}

/**
 * Helper function to execute a computer action with error handling
 * @param action - Function to execute
 * @param errorMsg - Error message prefix
 * @returns Promise that resolves with the action result or throws an error
 */
async function executeWithErrorHandling<T>(
  action: () => Promise<T>,
  errorMsg: string
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    console.error(`${errorMsg}:`, error);
    throw error;
  }
}

/**
 * Map xdotool key names to cliclick key names
 * @param xdotoolKey - Key name in xdotool format
 * @returns Key name in cliclick format
 */
function mapXdotoolToClichickKey(xdotoolKey: string): string {
  // Handle key combinations like alt+Tab, ctrl+s, etc.
  if (xdotoolKey.includes("+")) {
    const parts = xdotoolKey.split("+");

    // For cliclick, modifiers (alt, cmd, ctrl, fn, shift) are separate from keys
    // If used with kd: and ku: they should remain as-is
    // But we need to map the actual key (the last part) if needed
    const modifiers = parts.slice(0, parts.length - 1);
    const lastKey = parts[parts.length - 1];

    // Special handling for key combinations - return just the modifiers for kd/ku usage
    if (modifiers.length > 0) {
      return modifiers.join(",");
    }

    // Otherwise, map the actual key
    return mapSingleKey(lastKey);
  }

  // Handle single keys
  return mapSingleKey(xdotoolKey);
}

/**
 * Map a single key from xdotool format to cliclick format
 * @param key - Key name in xdotool format
 * @returns Key name in cliclick format
 */
function mapSingleKey(key: string): string {
  const keyMap: Record<string, string> = {
    // Special keys
    return: "return",
    tab: "tab",
    space: "space",
    escape: "esc",
    backspace: "delete",
    delete: "fwd-delete",
    home: "home",
    end: "end",
    page_up: "page-up",
    page_down: "page-down",
    up: "arrow-up",
    down: "arrow-down",
    left: "arrow-left",
    right: "arrow-right",

    // Function keys
    f1: "f1",
    f2: "f2",
    f3: "f3",
    f4: "f4",
    f5: "f5",
    f6: "f6",
    f7: "f7",
    f8: "f8",
    f9: "f9",
    f10: "f10",
    f11: "f11",
    f12: "f12",
    f13: "f13",
    f14: "f14",
    f15: "f15",
    f16: "f16",

    // Numpad keys
    kp_0: "num-0",
    kp_1: "num-1",
    kp_2: "num-2",
    kp_3: "num-3",
    kp_4: "num-4",
    kp_5: "num-5",
    kp_6: "num-6",
    kp_7: "num-7",
    kp_8: "num-8",
    kp_9: "num-9",
    kp_enter: "num-enter",
    kp_add: "num-plus",
    kp_subtract: "num-minus",
    kp_multiply: "num-multiply",
    kp_divide: "num-divide",
    kp_equal: "num-equals",
    kp_clear: "num-clear",

    // Modifiers - these will be handled specially for key combinations
    alt: "alt",
    shift: "shift",
    control: "ctrl",
    meta: "cmd", // Meta/Super/Windows key maps to Command on Mac
    command: "cmd",
    super: "cmd",
  };

  const normalizedKey = key.toLowerCase();
  // Return the mapped key if it exists, otherwise return the original key (which might work as-is)
  return keyMap[normalizedKey] || normalizedKey;
}
/**
 * Computer class to automate mouse and keyboard actions using cliclick
 */
export namespace Computer {
  export async function executeComputerAction(toolParams: {
    action: string;
    coordinate?: number[];
    text?: string;
    start_coordinate?: number[];
    duration?: number;
    scroll_amount?: number;
    scroll_direction?: "up" | "down" | "left" | "right";
  }): Promise<string> {
    switch (toolParams.action) {
      case "key": {
        if (!toolParams.text) {
          throw new Error("Text parameter is required for key action");
        }
        return pressKey(toolParams.text);
      }
      case "hold_key": {
        if (!toolParams.text || !toolParams.duration) {
          throw new Error(
            "Text and duration parameters are required for hold_key action"
          );
        }
        return holdKey(toolParams.text, toolParams.duration);
      }
      case "type": {
        if (!toolParams.text) {
          throw new Error("Text parameter is required for type action");
        }
        return type(toolParams.text);
      }
      case "cursor_position": {
        return getCursorPosition();
      }
      case "mouse_move": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for mouse_move action"
          );
        }
        return moveMouse(toolParams.coordinate[0], toolParams.coordinate[1]);
      }
      case "left_mouse_down": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for left_mouse_down action"
          );
        }
        return mouseDown(toolParams.coordinate[0], toolParams.coordinate[1]);
      }
      case "left_mouse_up": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for left_mouse_up action"
          );
        }
        return mouseUp(toolParams.coordinate[0], toolParams.coordinate[1]);
      }
      case "left_click": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for left_click action"
          );
        }
        if (toolParams.text) {
          // If text is provided, hold those keys while clicking
          return clickWithModifiers(
            toolParams.coordinate[0],
            toolParams.coordinate[1],
            toolParams.text
          );
        }
        return clickAt(toolParams.coordinate[0], toolParams.coordinate[1]);
      }
      case "left_click_drag": {
        if (!toolParams.coordinate || !toolParams.start_coordinate) {
          throw new Error(
            "Coordinate and startCoordinate parameters are required for left_click_drag action"
          );
        }
        return dragMouse(
          toolParams.start_coordinate[0],
          toolParams.start_coordinate[1],
          toolParams.coordinate[0],
          toolParams.coordinate[1]
        );
      }
      case "right_click": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for right_click action"
          );
        }
        return rightClickAt(toolParams.coordinate[0], toolParams.coordinate[1]);
      }
      case "middle_click": {
        throw new Error("Middle click is not supported by cliclick");
      }
      case "double_click": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for double_click action"
          );
        }
        return doubleClickAt(
          toolParams.coordinate[0],
          toolParams.coordinate[1]
        );
      }
      case "triple_click": {
        if (!toolParams.coordinate) {
          throw new Error(
            "Coordinate parameter is required for triple_click action"
          );
        }
        return tripleClickAt(
          toolParams.coordinate[0],
          toolParams.coordinate[1]
        );
      }
      case "scroll": {
        if (
          !toolParams.coordinate ||
          !toolParams.scroll_amount ||
          !toolParams.scroll_direction
        ) {
          throw new Error(
            "Coordinate, scrollAmount, and scrollDirection parameters are required for scroll action"
          );
        }
        return scroll(
          toolParams.coordinate[0],
          toolParams.coordinate[1],
          toolParams.scroll_amount,
          toolParams.scroll_direction
        );
      }
      case "wait": {
        if (!toolParams.duration) {
          throw new Error("Duration parameter is required for wait action");
        }
        return wait(toolParams.duration);
      }
      case "screenshot": {
        return takeScreenshot();
      }
      default: {
        return "This computer action is not supported on this device.";
      }
    }
  }

  /**
   * Move the mouse cursor to the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Promise that resolves with a success message
   */
  export async function moveMouse(x: number, y: number): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);
      await executeCliClickCommand(`m:${roundedX},${roundedY}`);
      return `Mouse moved to (${roundedX}, ${roundedY})`;
    }, "Error moving mouse");
  }

  /**
   * Type the specified text in the current application
   * @param text - Text to type
   * @returns Promise that resolves with a success message
   */
  export async function type(text: string): Promise<string> {
    return executeWithErrorHandling(async () => {
      // If text contains spaces or special characters, we need to enclose it in quotes
      const formattedText = text.includes(" ") ? `'${text}'` : text;
      await executeCliClickCommand(`t:${formattedText}`);
      return `Typed text: "${text}"`;
    }, "Error typing text");
  }

  /**
   * Click at the current mouse position
   * @returns Promise that resolves with a success message
   */
  export async function click(): Promise<string> {
    return executeWithErrorHandling(async () => {
      await executeCliClickCommand("c:.");
      return "Clicked at current position";
    }, "Error clicking");
  }

  /**
   * Click at the specified coordinates with smart retry logic
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param verify - Whether to verify the click and retry with position adjustments (default: true)
   * @returns Promise that resolves with a success message
   */
  export async function clickAt(
    x: number,
    y: number,
    verify = true
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);

      if (!verify) {
        await executeCliClickCommand(`c:${roundedX},${roundedY}`);
        return `Clicked at (${roundedX}, ${roundedY})`;
      }

      // Try clicking with position adjustments if needed
      const offsets = [
        [0, 0], // Original position
        [10, 0], // Right
        [-10, 0], // Left
        [0, 10], // Down
        [0, -10], // Up
        [10, 10], // Bottom-right
        [-10, -10], // Top-left
        [10, -10], // Top-right
        [-10, 10], // Bottom-left
      ];

      let lastError: Error | null = null;

      for (let i = 0; i < offsets.length; i++) {
        const [offsetX, offsetY] = offsets[i];
        const tryX = roundedX + offsetX;
        const tryY = roundedY + offsetY;

        try {
          await executeCliClickCommand(`c:${tryX},${tryY}`);

          // Small delay to let the UI respond
          await new Promise((resolve) => setTimeout(resolve, 100));

          // If this is not the first attempt, log that we repositioned
          if (i > 0) {
            console.log(
              `[Computer] Click succeeded with offset (${offsetX}, ${offsetY}) at (${tryX}, ${tryY})`
            );
            return `Clicked at (${roundedX}, ${roundedY}) [adjusted to (${tryX}, ${tryY})]`;
          }

          return `Clicked at (${roundedX}, ${roundedY})`;
        } catch (error) {
          lastError = error as Error;
          // Try next offset
          continue;
        }
      }

      // If all attempts failed, throw the last error
      throw (
        lastError || new Error(`Failed to click at (${roundedX}, ${roundedY})`)
      );
    }, "Error clicking at coordinates");
  }

  /**
   * Perform a right-click at the current mouse position
   * @returns Promise that resolves with a success message
   */
  export async function rightClick(): Promise<string> {
    return executeWithErrorHandling(async () => {
      await executeCliClickCommand("rc:.");
      return "Right-clicked at current position";
    }, "Error right-clicking");
  }

  /**
   * Perform a right-click at the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param verify - Whether to verify and retry with position adjustments (default: true)
   * @returns Promise that resolves with a success message
   */
  export async function rightClickAt(
    x: number,
    y: number,
    verify = true
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);

      if (!verify) {
        await executeCliClickCommand(`dc:${roundedX},${roundedY}`);
        return `Double-clicked at (${roundedX}, ${roundedY})`;
      }

      const offsets = [
        [0, 0],
        [10, 0],
        [-10, 0],
        [0, 10],
        [0, -10],
        [10, 10],
        [-10, -10],
        [10, -10],
        [-10, 10],
      ];

      let lastError: Error | null = null;

      for (let i = 0; i < offsets.length; i++) {
        const [offsetX, offsetY] = offsets[i];
        const tryX = roundedX + offsetX;
        const tryY = roundedY + offsetY;

        try {
          await executeCliClickCommand(`rc:${tryX},${tryY}`);
          await new Promise((resolve) => setTimeout(resolve, 100));

          if (i > 0) {
            console.log(
              `[Computer] Right-click succeeded with offset (${offsetX}, ${offsetY})`
            );
            return `Right-clicked at (${roundedX}, ${roundedY}) [adjusted to (${tryX}, ${tryY})]`;
          }

          return `Right-clicked at (${roundedX}, ${roundedY})`;
        } catch (error) {
          lastError = error as Error;
          continue;
        }
      }

      throw (
        lastError ||
        new Error(`Failed to right-click at (${roundedX}, ${roundedY})`)
      );
    }, "Error right-clicking at coordinates");
  }

  /**
   * Double-click at the current mouse position
   * @returns Promise that resolves with a success message
   */
  export async function doubleClick(): Promise<string> {
    return executeWithErrorHandling(async () => {
      await executeCliClickCommand("dc:.");
      return "Double-clicked at current position";
    }, "Error double-clicking");
  }

  /**
   * Double-click at the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param verify - Whether to verify and retry with position adjustments (default: true)
   * @returns Promise that resolves with a success message
   */
  export async function doubleClickAt(
    x: number,
    y: number,
    verify = true
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);

      if (!verify) {
        await executeCliClickCommand(`dc:${roundedX},${roundedY}`);
        return `Double-clicked at (${roundedX}, ${roundedY})`;
      }

      const offsets = [
        [0, 0],
        [10, 0],
        [-10, 0],
        [0, 10],
        [0, -10],
        [10, 10],
        [-10, -10],
        [10, -10],
        [-10, 10],
      ];

      let lastError: Error | null = null;

      for (let i = 0; i < offsets.length; i++) {
        const [offsetX, offsetY] = offsets[i];
        const tryX = roundedX + offsetX;
        const tryY = roundedY + offsetY;

        try {
          await executeCliClickCommand(`dc:${tryX},${tryY}`);
          await new Promise((resolve) => setTimeout(resolve, 100));

          if (i > 0) {
            console.log(
              `[Computer] Double-click succeeded with offset (${offsetX}, ${offsetY})`
            );
            return `Double-clicked at (${roundedX}, ${roundedY}) [adjusted to (${tryX}, ${tryY})]`;
          }

          return `Double-clicked at (${roundedX}, ${roundedY})`;
        } catch (error) {
          lastError = error as Error;
          continue;
        }
      }

      throw (
        lastError ||
        new Error(`Failed to double-click at (${roundedX}, ${roundedY})`)
      );
    }, "Error double-clicking at coordinates");
  }

  /**
   * Triple-click at the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Promise that resolves with a success message
   */
  export async function tripleClickAt(x: number, y: number): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);
      await executeCliClickCommand(`tc:${roundedX},${roundedY}`);
      return `Triple-clicked at (${roundedX}, ${roundedY})`;
    }, "Error triple-clicking at coordinates");
  }

  /**
   * Press a key
   * @param key - Key to press (see cliclick documentation for supported keys)
   * @returns Promise that resolves with a success message
   */
  export async function pressKey(key: string): Promise<string> {
    return executeWithErrorHandling(async () => {
      // List of keys that should be handled with kp command
      const kpKeys = [
        "arrow-down",
        "arrow-left",
        "arrow-right",
        "arrow-up",
        "brightness-down",
        "brightness-up",
        "delete",
        "end",
        "enter",
        "esc",
        "f1",
        "f2",
        "f3",
        "f4",
        "f5",
        "f6",
        "f7",
        "f8",
        "f9",
        "f10",
        "f11",
        "f12",
        "f13",
        "f14",
        "f15",
        "f16",
        "fwd-delete",
        "home",
        "keys-light-down",
        "keys-light-toggle",
        "keys-light-up",
        "mute",
        "num-0",
        "num-1",
        "num-2",
        "num-3",
        "num-4",
        "num-5",
        "num-6",
        "num-7",
        "num-8",
        "num-9",
        "num-clear",
        "num-divide",
        "num-enter",
        "num-equals",
        "num-minus",
        "num-multiply",
        "num-plus",
        "page-down",
        "page-up",
        "play-next",
        "play-pause",
        "play-previous",
        "return",
        "space",
        "tab",
        "volume-down",
        "volume-up",
      ];

      // For key combinations, we need to handle them differently
      if (key.includes("+")) {
        const parts = key.split("+").map(mapXdotoolToClichickKey);
        const modifiers = parts.slice(0, parts.length - 1).join(",");
        const lastKey = mapSingleKey(parts[parts.length - 1]);

        console.log("========= Press key ==========");
        console.log(
          JSON.stringify(
            {
              parts,
              modifiers,
              lastKey,
            },
            null,
            2
          )
        );
        console.log("=================================");
        // Hold modifiers
        await executeCliClickCommand(`kd:${modifiers}`);

        // Press the key - use kp if it's in the list, otherwise use type
        if (kpKeys.includes(lastKey)) {
          await executeCliClickCommand(`kp:${lastKey}`);
        } else {
          await executeCliClickCommand(`t:${lastKey}`);
        }

        // Release modifiers
        await executeCliClickCommand(`ku:${modifiers}`);
      } else {
        // For single keys, check if it should use kp or type
        const mappedKey = mapXdotoolToClichickKey(key);
        if (kpKeys.includes(mappedKey)) {
          await executeCliClickCommand(`kp:${mappedKey}`);
        } else {
          await executeCliClickCommand(`t:${mappedKey}`);
        }
      }

      return `Pressed key: ${key}`;
    }, "Error pressing key");
  }

  /**
   * Hold a key down for a specified duration
   * @param key - Key to hold down
   * @param duration - Duration in seconds to hold the key
   * @returns Promise that resolves with a success message
   */
  export async function holdKey(
    key: string,
    duration: number
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      // Map the xdotool key format to cliclick format
      const cliclickKey = mapXdotoolToClichickKey(key);

      // Hold key down
      await executeCliClickCommand(`kd:${cliclickKey}`);
      // Wait for the specified duration
      await new Promise((resolve) => setTimeout(resolve, duration * 1000));
      // Release key
      await executeCliClickCommand(`ku:${cliclickKey}`);

      return `Held key ${key} for ${duration} seconds`;
    }, "Error holding key");
  }

  /**
   * Press mouse down at the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Promise that resolves with a success message
   */
  export async function mouseDown(x: number, y: number): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);
      await executeCliClickCommand(`dd:${roundedX},${roundedY}`);
      return `Mouse down at (${roundedX}, ${roundedY})`;
    }, "Error pressing mouse down");
  }

  /**
   * Release mouse at the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @returns Promise that resolves with a success message
   */
  export async function mouseUp(x: number, y: number): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);
      await executeCliClickCommand(`du:${roundedX},${roundedY}`);
      return `Mouse up at (${roundedX}, ${roundedY})`;
    }, "Error releasing mouse");
  }

  /**
   * Drag the mouse from one position to another
   * @param startX - Starting X coordinate
   * @param startY - Starting Y coordinate
   * @param endX - Ending X coordinate
   * @param endY - Ending Y coordinate
   * @returns Promise that resolves with a success message
   */
  export async function dragMouse(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedStartX = Math.round(startX);
      const roundedStartY = Math.round(startY);
      const roundedEndX = Math.round(endX);
      const roundedEndY = Math.round(endY);
      // Press down at start position
      await executeCliClickCommand(`dd:${roundedStartX},${roundedStartY}`);
      // Move to end position
      await executeCliClickCommand(`dm:${roundedEndX},${roundedEndY}`);
      // Release at end position
      await executeCliClickCommand(`du:${roundedEndX},${roundedEndY}`);
      return `Dragged mouse from (${roundedStartX}, ${roundedStartY}) to (${roundedEndX}, ${roundedEndY})`;
    }, "Error dragging mouse");
  }

  /**
   * Click at coordinates while holding modifier keys
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param modifiers - Modifier keys to hold during click (comma-separated)
   * @returns Promise that resolves with a success message
   */
  export async function clickWithModifiers(
    x: number,
    y: number,
    modifiers: string
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);

      // Map modifiers to cliclick format, as Claude will use xdotool format like "alt+ctrl"
      let formattedModifiers = modifiers;

      // If the modifiers are provided in xdotool format with + signs, convert to cliclick format
      if (modifiers.includes("+")) {
        const parts = modifiers.split("+");
        formattedModifiers = parts.map((part) => mapSingleKey(part)).join(",");
      }

      // Hold modifier keys
      await executeCliClickCommand(`kd:${formattedModifiers}`);
      // Click at coordinates
      await executeCliClickCommand(`c:${roundedX},${roundedY}`);
      // Release modifier keys
      await executeCliClickCommand(`ku:${formattedModifiers}`);
      return `Clicked at (${roundedX}, ${roundedY}) while holding ${modifiers}`;
    }, "Error clicking with modifiers");
  }

  /**
   * Wait for the specified duration
   * @param seconds - Duration in seconds to wait
   * @returns Promise that resolves with a success message
   */
  export async function wait(seconds: number): Promise<string> {
    return executeWithErrorHandling(async () => {
      const milliseconds = seconds * 1000;
      await executeCliClickCommand(`w:${milliseconds}`);
      return `Waited for ${seconds} seconds`;
    }, "Error waiting");
  }

  /**
   * Get the current cursor position
   * @returns Promise that resolves with a string representation of cursor position
   */
  export async function getCursorPosition(): Promise<string> {
    return executeWithErrorHandling(async () => {
      const stdout = await executeCliClickCommand("p");
      const match = stdout.match(/(\d+),(\d+)/);
      if (match && match.length >= 3) {
        const x = parseInt(match[1]);
        const y = parseInt(match[2]);
        return `Cursor position: (${x}, ${y})`;
      }
      throw new Error("Failed to parse cursor position");
    }, "Error getting cursor position");
  }

  /**
   * Scroll at the specified coordinates
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param amount - Number of scroll wheel clicks
   * @param direction - Direction to scroll ('up', 'down', 'left', 'right')
   * @returns Promise that resolves with a success message
   */
  export async function scroll(
    x: number,
    y: number,
    amount: number,
    direction: "up" | "down" | "left" | "right"
  ): Promise<string> {
    return executeWithErrorHandling(async () => {
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);

      // cliclick doesn't have a built-in scroll command
      // We need to move to the position first
      await executeCliClickCommand(`m:${roundedX},${roundedY}`);

      // For each scroll amount, simulate a key press
      const key =
        direction === "up"
          ? "page-up"
          : direction === "down"
            ? "page-down"
            : direction === "left"
              ? "arrow-left"
              : "arrow-right";

      for (let i = 0; i < amount; i++) {
        await executeCliClickCommand(`kp:${key}`);
        // Small delay between scrolls
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return `Scrolled ${direction} ${amount} times at (${roundedX}, ${roundedY})`;
    }, "Error scrolling");
  }

  /**
   * Take a screenshot of the desktop
   * @param resizeToFit - Optional dimensions to resize the screenshot to. If not provided, the screenshot is returned as is.
   * @returns Promise of b64 image data
   */
  export async function takeScreenshot(resizeToFit?: {
    width: number;
    height: number;
  }): Promise<string> {
    return executeWithErrorHandling(async () => {
      // Capture the screenshot as a Buffer
      const imgBuffer = await screenshot({ format: "png" });
      const sharpImg = sharp(imgBuffer.buffer);

      if (resizeToFit) {
        const resizedBuffer = await sharpImg
          .resize(resizeToFit.width, resizeToFit.height, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .toBuffer();
        return Buffer.from(resizedBuffer).toString("base64");
      } else {
        return Buffer.from(imgBuffer.buffer).toString("base64");
      }
    }, "Error taking screenshot");
  }

  /**
   * Get the dimensions of the screen
   * @returns Promise that resolves with the screen dimensions
   */
  export async function getDisplayDimensions(): Promise<{
    width: number;
    height: number;
  }> {
    return executeWithErrorHandling(async () => {
      const imgBuffer = await screenshot({ format: "png" });
      const sharpImg = sharp(imgBuffer.buffer);
      const metadata = await sharpImg.metadata();
      return { width: metadata.width || 0, height: metadata.height || 0 };
    }, "Error getting display dimensions");
  }
}
