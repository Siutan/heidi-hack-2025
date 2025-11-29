# Heidi Hack 2025 - System Architecture

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            ELECTRON APPLICATION                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌────────────────────┐      ┌────────────────────┐      ┌────────────────────┐ │
│  │   MAIN PROCESS     │      │  RENDERER PROCESS  │      │  OVERLAY PROCESS   │ │
│  │    (main.ts)       │◄────►│   (renderer.ts)    │      │   (overlay.tsx)    │ │
│  │                    │ IPC  │                    │      │                    │ │
│  │  - App Lifecycle   │      │  - Audio Viz       │      │  - Voice UI        │ │
│  │  - IPC Handlers    │      │  - Mic Selection   │      │  - Recording       │ │
│  │  - Window Mgmt     │      │  - Dev Interface   │      │  - Assistant Chat  │ │
│  └────────┬───────────┘      └────────────────────┘      └──────┬─────────────┘ │
│           │                                                     │               │
│           │                                                     │               │
└───────────┼─────────────────────────────────────────────────────┼───────────────┘
            │                                                     │
            │                                                     │
            ▼                                                     ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           CORE SERVICES LAYER                                     │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌───────────────────────────────────────────────────────────────────────────┐    │
│  │                       WAKE WORD SERVICE (wake/)                           │    │
│  │                                                                           │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐    │    │
│  │  │ audioCapture │─►│ VAD (Voice   │─►│ Google Speech│─►│ Wake Word   │    │    │
│  │  │   (SoX)      │  │  Activity    │  │    STT       │  │  Matcher    │    │    │
│  │  │              │  │  Detection)  │  │              │  │  ("Hi Dee") │    │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────┬──────┘    │    │
│  │                                                               │           │    │
│  │                                    Triggers ▼                 │           │    │
│  │                          ┌────────────────────────────┐       │           │    │
│  │                          │   Gemini Live API          │       │           │    │
│  │                          │  (geminiCommand.ts)        │◄──────┘           │    │
│  │                          │  - Real-time conversation  │                   │    │
│  │                          │  - Audio responses         │                   │    │
│  │                          └────────────────────────────┘                   │    │
│  └───────────────────────────────────────────────────────────────────────────┘    │
│                                                                                   │
│  ┌───────────────────────────────────────────────────────────────────────────┐    │
│  │                    VOICE ASSISTANT SERVICE (voice/)                       │    │
│  │                                                                           │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐    │    │
│  │  │   NLU        │─►│   Policy     │─►│   Executor   │─►│   Tools     │    │    │
│  │  │ (nlu.ts)     │  │ (policy.ts)  │  │(executor.ts) │  │ (tools.ts)  │    │    │
│  │  │              │  │              │  │              │  │             │    │    │
│  │  │- Intent      │  │- Safety      │  │- Decision    │  │- Tool       │    │    │
│  │  │  parsing     │  │  checks      │  │  execution   │  │  registry   │    │    │
│  │  │- Entity      │  │- User prefs  │  │- Timeout     │  │- Schemas    │    │    │
│  │  │  extraction  │  │- Confirm     │  │  handling    │  │- Execute    │    │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘    │    │
│  └───────────────────────────────────────────────────────────────────────────┘    │
│                                                                                   │
│  ┌───────────────────────────────────────────────────────────────────────────┐    │
│  │                   COMMAND INTERPRETER (interpreter-service.ts)            │    │
│  │                                                                           │    │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │    │
│  │  │  Claude Sonnet 4.5 (Anthropic AI)                                  │   │    │
│  │  │  - Natural language → Computer actions                             │   │    │
│  │  │  - Vision-based workflow automation                                │   │    │
│  │  │  - Screenshot analysis                                             │   │    │
│  │  │  - Iterative action planning                                       │   │    │
│  │  └────────────────────┬───────────────────────────────────────────────┘   │    │
│  │                       │                                                   │    │
│  │                       ▼                                                   │    │
│  │  ┌────────────────────────────────────────────────────────────────────┐   │    │
│  │  │  Computer Service (computer-service.ts)                            │   │    │
│  │  │  - Mouse control (click, move, double-click, right-click)          │   │    │
│  │  │  - Keyboard control (type, key combinations)                       │   │    │
│  │  │  - Screenshot capture (via screenshot-desktop + sharp)             │   │    │
│  │  │  - Uses cliclick for macOS automation                              │   │    │
│  │  │  - Display dimensions                                              │   │    │
│  │  └────────────────────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────────────────────┘    │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐      │
│  │                        RPA SERVICE (rpa.ts / emr.ts)                    │      │
│  │                                                                         │      │
│  │  ┌────────────────────────────────────────────────────────────────────┐ │      │
│  │  │  Gemini Vision RPA                                                 │ │      │
│  │  │  - Vision-based automation for medical workflows                   │ │      │
│  │  │  - Heidi Health → EMR data transfer                                │ │      │
│  │  │  - Screenshot analysis and form filling                            │ │      │
│  │  │  - Uses @computer-use/nut-js for control                           │ │      │
│  │  └────────────────────────────────────────────────────────────────────┘ │      │
│  └─────────────────────────────────────────────────────────────────────────┘      │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐      │
│  │                    GEMINI TOOLS SERVICE (gemini-tools.ts)               │      │
│  │  - Template filling with AI                                             │      │
│  │  - Medical data extraction                                              │      │
│  │  - Context-aware processing                                             │      │
│  └─────────────────────────────────────────────────────────────────────────┘      │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SYSTEMS & APIs                                  │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐     │
│  │  Google Cloud    │  │  Anthropic       │  │  Google Gemini               │     │
│  │  Speech-to-Text  │  │  Claude API      │  │  - Generative AI             │     │
│  │  - Wake word     │  │  - Sonnet 4.5    │  │  - Vision models             │     │
│  │  - Transcription │  │  - Vision        │  │  - Live API                  │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────────┘     │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐     │
│  │  External Applications (via OS automation)                               │     │
│  │  - Heidi Health (scribe.heidihealth.com)                                 │     │
│  │  - Mock EHR Desktop App                                                  │     │
│  │  - Any macOS application                                                 │     │
│  └──────────────────────────────────────────────────────────────────────────┘     │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## Component Communication Flow

### 1. Wake Word Detection Flow

```
User speaks "Hi Dee"
    ↓
Audio Capture (SoX) → VAD → Google Speech STT → Wake Word Matcher
    ↓
Wake Detected Event
    ↓
Gemini Live API activated → Real-time conversation
    ↓
Audio response played back to user
```

### 2. Voice Command Execution Flow

```
User gives voice command (via overlay)
    ↓
Recording → Audio data collected
    ↓
Main Process IPC Handler (execute-voice-command)
    ↓
Interpreter Service (Claude AI)
    ↓
Computer Service → Desktop automation actions
    ↓
Result returned to overlay UI
```

### 3. Medical Workflow Automation Flow

```
User triggers Heidi → EMR workflow
    ↓
Interpreter Service (vision loop)
    ↓
Screenshot → Claude AI analysis → Action planning
    ↓
Computer Service executes actions (navigate, click, copy, paste)
    ↓
Iterative: Repeat until goal achieved (max 20 iterations)
    ↓
Success/failure reported back
```

### 4. RPA Automation Flow

```
User initiates automation with source selection
    ↓
Gemini Vision RPA
    ↓
Screenshot analysis → Form field detection
    ↓
nut-js keyboard/mouse control
    ↓
Medical data entry into EMR
    ↓
Progress updates sent to UI
```

## Key Technologies

- **Electron**: Desktop app framework (main, renderer, overlay processes)
- **React**: UI components (overlay interface)
- **TypeScript**: Type-safe development
- **Vite**: Build tooling
- **Tailwind CSS**: Styling

### AI/ML Services

- **Anthropic Claude Sonnet 4.5**: Command interpretation, vision-based automation
- **Google Gemini**: Live API for conversations, vision models for RPA
- **Google Cloud Speech-to-Text**: Wake word detection and transcription

### Automation Tools

- **cliclick**: macOS mouse/keyboard control (via computer-service)
- **@computer-use/nut-js**: Cross-platform automation (via RPA)
- **screenshot-desktop + sharp**: Screen capture and image processing
- **SoX**: Audio capture for wake word detection

### Audio Processing

- **VAD (Voice Activity Detection)**: Reduce API costs
- **Web Audio API**: Audio visualization and playback

## State Management

### Main State Machine

```
Idle → Listening → Wake Detected → Command Window → Processing → Executing → Reporting → Idle
```

### UI View States

```
idle → expanded → recording → response → automating → selecting-source
```

## Security & Safety

1. **Policy Layer**: Safety checks before action execution
2. **User Preferences**: Always confirm mode available
3. **Timeouts**: 5-second timeout on tool execution
4. **Tool Registry**: Strict schemas and preconditions
5. **Sandboxed Execution**: Structured results and error handling

## Data Flow

1. **Audio In** → VAD → STT → NLU → Intent
2. **Intent** → Policy Check → Tool Selection → Execution
3. **Execution** → Computer Actions → Result
4. **Result** → UI Update → User Feedback

## IPC Communication Channels

- `resize-window`: Resize overlay window
- `check-and-open-app`: Launch external apps
- `execute-voice-command`: Process voice commands
- `transcript-update`: Send transcription updates
- `wake-status`: Wake word service status
- `gemini-response`: Gemini API responses

## File Structure Purpose

- **src/main.ts**: Electron main process, IPC handlers, app lifecycle
- **src/overlay.tsx**: Voice assistant UI overlay
- **src/renderer.ts**: Development interface with audio visualization
- **src/wake/**: Wake word detection system
- **src/voice/**: Voice assistant pipeline (NLU, policy, executor, tools)
- **src/services/**: Core services (interpreter, computer, voice, gemini tools)
- **src/rpa.ts / emr.ts**: Medical workflow automation
- **src/hooks/useVoiceAssistant.ts**: React hook for voice features
