/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';

console.log(
  '👋 This message is being logged by "renderer.ts", included via Vite',
);

if (window.electron) {
  window.electron.onTranscriptUpdate((text) => {
    const el = document.getElementById('transcript');
    if (el) {
      el.innerText = text;
    }
  });
}

// Microphone Logic
const micSelect = document.getElementById('mic-select') as HTMLSelectElement;
const canvas = document.getElementById('audio-visualizer') as HTMLCanvasElement;
const canvasCtx = canvas.getContext('2d');
let audioContext: AudioContext;
let analyser: AnalyserNode;
let microphone: MediaStreamAudioSourceNode;
let javascriptNode: ScriptProcessorNode;

async function getMicrophones() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputDevices = devices.filter(device => device.kind === 'audioinput');

    micSelect.innerHTML = '';
    audioInputDevices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Microphone ${micSelect.length + 1}`;
      micSelect.appendChild(option);
    });

    // Load saved selection
    const savedDeviceId = localStorage.getItem('selectedMicId');
    if (savedDeviceId && audioInputDevices.some(d => d.deviceId === savedDeviceId)) {
      micSelect.value = savedDeviceId;
    }

    startVisualizer(micSelect.value);
  } catch (err) {
    console.error('Error enumerating devices:', err);
  }
}

async function startVisualizer(deviceId: string) {
  if (audioContext) {
    audioContext.close();
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    });

    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(stream);
    javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    javascriptNode.onaudioprocess = () => {
      const array = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(array);

      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        canvasCtx.fillStyle = '#f0f0f0';
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / array.length) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < array.length; i++) {
          barHeight = array[i] / 2;
          canvasCtx.fillStyle = 'rgb(' + (barHeight + 100) + ',50,50)';
          canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
      }
    };
  } catch (err) {
    console.error('Error starting visualizer:', err);
  }
}

micSelect.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement;
  localStorage.setItem('selectedMicId', target.value);
  startVisualizer(target.value);
});

// Initialize
getMicrophones();
