import { keyboard, mouse, Point, Button, Key } from '@computer-use/nut-js';
import { desktopCapturer, screen, clipboard } from 'electron';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { exec } from 'child_process';

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

  async generateActions(conversation: string, imageBuffer: Buffer, screenWidth?: number, screenHeight?: number): Promise<RPAAction[]> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are an expert Robotic Process Automation agent for medical software.
      ${screenWidth && screenHeight ? `The screen resolution is ${screenWidth}x${screenHeight}.` : ''}
      
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
      - **ACCURACY IS CRITICAL**: You must return the coordinates of the **CENTER of the input text box**, NOT the label.
      - Look for the rectangular box or underline where text is entered.
      - Do not click on the field label text itself. Click inside the empty input area.
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

  async execute(conversation: string, sourceId?: string, onUpdate?: (data: any) => void) {
    if (onUpdate) onUpdate({ status: 'Capturing Screen', details: 'Taking a screenshot of the EMR...' });
    console.log("Capturing screen...");
    
    // Attempt to focus window if sourceId is provided
    if (sourceId) {
        try {
            const sources = await desktopCapturer.getSources({ types: ['window'] });
            const targetSource = sources.find(s => s.id === sourceId);
            if (targetSource) {
                 if (onUpdate) onUpdate({ status: 'Focusing Window', details: `Switching to ${targetSource.name}...` });
                 console.log(`Attempting to focus window: ${targetSource.name}`);
                 
                 const script = `
                    tell application "System Events"
                        set procs to processes
                        repeat with proc in procs
                            try
                                if exists (window 1 of proc) then
                                    if name of window 1 of proc contains "${targetSource.name}" then
                                        set frontmost of proc to true
                                        exit repeat
                                    end if
                                end if
                            end try
                        end repeat
                    end tell
                 `;
                 
                 exec(`osascript -e '${script}'`, (error) => {
                     if (error) console.error("AppleScript error:", error);
                 });
                 
                 await new Promise(r => setTimeout(r, 1000)); // Wait for focus
            }
        } catch (e) {
            console.error("Failed to focus window:", e);
        }
    }

    let iteration = 0;
    const MAX_ITERATIONS = 5;

    while (iteration < MAX_ITERATIONS) {
        iteration++;
        console.log(`Starting iteration ${iteration}`);

        const { buffer, width, height } = await this.captureScreen(sourceId);
        
        if (onUpdate) onUpdate({ status: 'Analyzing', details: `Dee is reading the screen (Attempt ${iteration})...` });
        console.log("Analyzing screen and conversation with Dee...");
        const actions = await this.generateActions(conversation, buffer, width, height);
        console.log("actions", actions)
        
        if (actions.length === 0) {
          console.log("No actions generated.");
          if (iteration === 1) {
              if (onUpdate) onUpdate({ status: 'Done', details: 'No actions needed.' });
              throw new NoActionsGeneratedError();
          }
          break;
        }

        console.log(`Executing ${actions.length} actions...`);
        
        const errors: RPAError[] = [];

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          if (onUpdate) onUpdate({ 
              status: 'Executing', 
              details: `Filling ${action.fieldLabel}...`, 
              step: i + 1, 
              totalSteps: actions.length 
          });
          console.log(`Action: Filling '${action.fieldLabel}' with '${action.value}' at coordinates ${action.coordinates}`);
          
          try {
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
            
            // Use Copy & Paste instead
            clipboard.writeText(action.value);
            await new Promise(r => setTimeout(r, 200)); // Wait for clipboard update

            console.log("Pressing keys for paste:", Key.LeftSuper, Key.V);


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
            console.warn(`Iteration ${iteration} completed with ${errors.length} errors.`);
            if (errors.length === actions.length && iteration === 1) {
                 throw new Error("Failed to execute ALL actions. Please check if the correct screen is visible.");
            }
        }

        // Wait for UI to settle before next screenshot
        await new Promise(r => setTimeout(r, 2000));
    }
    
    console.log("Automation complete.");
    if (onUpdate) onUpdate({ status: 'Complete', details: 'All fields filled successfully.' });
  }
}
