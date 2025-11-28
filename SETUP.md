# Setup Instructions

## Prerequisites

1. **Anthropic API Key** - Required for voice command interpretation
2. **cliclick** - Required for desktop automation on macOS
3. **Node.js/Bun** - For running the Electron app

## Step 1: Get Your Anthropic API Key

1. Go to [https://console.anthropic.com/](https://console.anthropic.com/)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the API key (it starts with `sk-ant-...`)

## Step 2: Configure Environment Variables

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your API key:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
   ```

   **Important:** Replace `your_api_key_here` with your actual API key from Step 1.

## Step 3: Install Dependencies

Using npm:

```bash
npm install
```

Or using bun (faster):

```bash
bun install
```

## Step 4: Install cliclick (macOS only)

```bash
brew install cliclick
```

## Step 5: Grant Permissions (macOS)

The app needs the following permissions:

1. **Microphone Access** - For voice input
   - macOS will prompt you when you first use the microphone
   - Or go to System Preferences → Security & Privacy → Privacy → Microphone

2. **Accessibility Access** - For desktop automation
   - Go to System Preferences → Security & Privacy → Privacy → Accessibility
   - Add your terminal app (Terminal.app or iTerm) and Electron

## Step 6: Run the App

```bash
npm start
```

Or with bun:

```bash
bun start
```

## Troubleshooting

### "ANTHROPIC_API_KEY environment variable is not set"

- Make sure you created a `.env` file in the project root
- Verify the API key is correctly set in the `.env` file
- Restart the app after creating/modifying `.env`

### Voice recognition not working

- Check microphone permissions in System Preferences
- Ensure you're using a Chromium-based browser engine (Electron uses Chromium)
- Check the console for any errors

### Desktop automation not working

- Install cliclick: `brew install cliclick`
- Grant Accessibility permissions to your terminal and Electron
- Check that cliclick works: `cliclick p` (should print mouse position)

### Native module errors (sharp, screenshot-desktop)

- Run: `npm rebuild` or `bun install`
- Make sure you're on a supported platform (macOS, Windows, Linux)

## Environment Variables Reference

| Variable            | Required | Description                          |
| ------------------- | -------- | ------------------------------------ |
| `ANTHROPIC_API_KEY` | Yes      | Your Anthropic API key for Claude AI |

## Security Notes

- **Never commit your `.env` file** - It contains sensitive API keys
- The `.env` file is already in `.gitignore`
- Keep your API key private and don't share it
- If you accidentally expose your API key, regenerate it immediately in the Anthropic console

## Next Steps

Once set up, you can:

1. Click the microphone button or press Space
2. Speak a command (e.g., "Open Safari and go to Google")
3. Watch the AI interpret and execute your command

See [VOICE_AUTOMATION_README.md](./VOICE_AUTOMATION_README.md) for more details on how the system works.
