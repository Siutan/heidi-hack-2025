import { keyboard, mouse, Point, Button, Key } from '@computer-use/nut-js';
import { desktopCapturer, screen, clipboard } from 'electron';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { RPAError, ElementNotFoundError, NoActionsGeneratedError, ScreenCaptureError } from './errors';

interface RPAAction {
  fieldLabel: string;
  value: string;
  coordinates: [number, number]; // [y, x] in 0-1000 scale
  explanation: string;
}

export class GeminiVisionRPA {
  private genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not found");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async captureScreen(sourceId?: string): Promise<{ buffer: Buffer, width: number, height: number }> {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      
      // Capture the screen
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width, height }
      });

      let targetSource = sources[0];
      if (sourceId) {
        targetSource = sources.find(s => s.id === sourceId) || sources[0];
      }

      const image = targetSource.thumbnail;
      
      return {
        buffer: image.toPNG(),
        width,
        height
      };
    } catch (e) {
      throw new ScreenCaptureError(e);
    }
  }

  async generateActions(conversation: string, imageBuffer: Buffer): Promise<RPAAction[]> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are an expert Robotic Process Automation agent for medical software.
      
      Task:
      1. Analyze the provided screenshot of a medical software interface.
      2. Read the consultation transcript below.
      3. Identify which fields in the software form should be filled based on the transcript.
      4. For each field, determine the text to type and the EXACT coordinates of the input box where the text should go.
      
      Transcript:
      "${conversation}"
      
      Output Format:
      Return a STRICT JSON array of objects. Each object must have:
      - "fieldLabel": The visual label of the field.
      - "value": The extracted text to type into the field.
      - "coordinates": A two-element array [y, x] representing the normalized coordinates (0-1000) of the CENTER of the input field. 0,0 is top-left, 1000,1000 is bottom-right.
      - "explanation": Brief reason for this action.
      
      Important:
      - Only include fields that are visible and relevant.
      - If a field requires a complex interaction (dropdown), try to type the value that would select it, or skip it.
      - Ensure coordinates point to the empty space where I should click to type.
      - Do not include markdown formatting.
      - If NO relevant fields are found on the screen, return an empty array [].
    `;

    try {
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: "image/png"
          }
        }
      ]);

      const text = result.response.text();
      console.log("Gemini Vision response:", text);
      
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanText);
    } catch (e) {
      console.error("Error generating RPA actions:", e);
      return [];
    }
  }

  async execute(conversation: string, sourceId?: string) {
    console.log("Capturing screen...");
    const { buffer, width, height } = await this.captureScreen(sourceId);
    
    console.log("Analyzing screen and conversation with Gemini...");
    const actions = await this.generateActions(conversation, buffer);
    console.log("actions", actions)
    
    if (actions.length === 0) {
      console.log("No actions generated.");
      throw new NoActionsGeneratedError();
    }

    console.log(`Executing ${actions.length} actions...`);
    
    const errors: RPAError[] = [];

    for (const action of actions) {
      console.log(`Action: Filling '${action.fieldLabel}' with '${action.value}' at coordinates ${action.coordinates}`);
      
      try {
        // Convert normalized coordinates to pixels
        // Gemini returns [y, x] in 0-1000 scale
        const targetX = (action.coordinates[1] / 1000) * width;
        const targetY = (action.coordinates[0] / 1000) * height;

        console.log(`Clicking at (${targetX}, ${targetY})`);

        // Move and Click
        await mouse.setPosition(new Point(targetX, targetY));
        await new Promise(r => setTimeout(r, 200)); // Hover effect
        await mouse.click(Button.LEFT);
        
        // Wait for focus
        await new Promise(r => setTimeout(r, 500));
        
        // Type value
        // await keyboard.type(action.value);
        
        // Use Copy & Paste instead
        clipboard.writeText(action.value);
        await new Promise(r => setTimeout(r, 200)); // Wait for clipboard update

        console.log("Pressing keys for paste:", Key.LeftSuper, Key.V);

        // Cmd+V (Mac)
        // Try pressing both at once
        await keyboard.pressKey(Key.LeftSuper, Key.V);
        await keyboard.releaseKey(Key.LeftSuper, Key.V);
        
        // Wait before next action
        await new Promise(r => setTimeout(r, 1000));
        
      } catch (e: any) {
        console.error(`Failed to execute action for label '${action.fieldLabel}':`, e);
        errors.push(new ElementNotFoundError(action.fieldLabel));
      }
    }
    
    if (errors.length > 0) {
        console.warn(`Completed with ${errors.length} errors.`);
        if (errors.length === actions.length) {
             throw new Error("Failed to execute ALL actions. Please check if the correct screen is visible.");
        }
    }
    
    console.log("Automation complete.");
  }
}
