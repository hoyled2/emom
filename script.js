const countdownEl = document.getElementById("countdown");
const completedEl = document.getElementById("completed");
const elapsedEl = document.getElementById("elapsed");
const statusEl = document.getElementById("status");

const iterationsInput = document.getElementById("iterations");
const openEndedInput = document.getElementById("openEnded");
const presetGrid = document.getElementById("presetGrid");
const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));

const beepTypeInput = document.getElementById("beepType");
const beepFrequencyInput = document.getElementById("beepFrequency");
const beepDurationInput = document.getElementById("beepDuration");
const beepVolumeInput = document.getElementById("beepVolume");
const testBeepBtn = document.getElementById("testBeepBtn");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");

let timerId = null;
let startTime = 0;
let elapsedBeforePause = 0;
let running = false;
let paused = false;
let lastCompletedMinutes = 0;
let targetIterations = null;
let audioContext = null;

const storageKey = "emomSettingsV1";

const presets = {
  quick10: {
    iterations: 10,
    openEnded: false,
    beepType: "sine",
    beepFrequency: 1000,
    beepDuration: 220,
    beepVolume: 25
  },
  standard20: {
    iterations: 20,
    openEnded: false,
    beepType: "triangle",
    beepFrequency: 900,
    beepDuration: 240,
    beepVolume: 28
  },
  endless: {
    iterations: 10,
    openEnded: true,
    beepType: "square",
    beepFrequency: 1100,
    beepDuration: 200,
    beepVolume: 30
  }
};

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function getCurrentSettings() {
  return {
    iterations: clamp(Number.parseInt(iterationsInput.value, 10), 1, 999, 10),
    openEnded: openEndedInput.checked,
    beepType: ["sine", "square", "triangle", "sawtooth"].includes(beepTypeInput.value)
      ? beepTypeInput.value
      : "sine",
    beepFrequency: clamp(Number.parseInt(beepFrequencyInput.value, 10), 200, 2000, 1000),
    beepDuration: clamp(Number.parseInt(beepDurationInput.value, 10), 80, 900, 220),
    beepVolume: clamp(Number.parseInt(beepVolumeInput.value, 10), 0, 100, 25)
  };
}

function applySettings(settings) {
  if (!settings || typeof settings !== "object") {
    return;
  }

  iterationsInput.value = clamp(Number.parseInt(settings.iterations, 10), 1, 999, 10);
  openEndedInput.checked = Boolean(settings.openEnded);
  beepTypeInput.value = ["sine", "square", "triangle", "sawtooth"].includes(settings.beepType)
    ? settings.beepType
    : "sine";
  beepFrequencyInput.value = clamp(Number.parseInt(settings.beepFrequency, 10), 200, 2000, 1000);
  beepDurationInput.value = clamp(Number.parseInt(settings.beepDuration, 10), 80, 900, 220);
  beepVolumeInput.value = clamp(Number.parseInt(settings.beepVolume, 10), 0, 100, 25);
  iterationsInput.disabled = openEndedInput.checked;
}

function saveSettings() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(getCurrentSettings()));
  } catch {
    // Ignore write errors in private browsing or blocked storage scenarios.
  }
}

function loadSavedSettings() {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw);
    applySettings(parsed);
    return true;
  } catch {
    return false;
  }
}

function setActivePreset(presetName) {
  presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === presetName);
  });
}

function syncPresetIndicator() {
  const current = getCurrentSettings();
  const matchedPreset = Object.entries(presets).find((entry) => {
    const [name, preset] = entry;
    return (
      preset.iterations === current.iterations &&
      preset.openEnded === current.openEnded &&
      preset.beepType === current.beepType &&
      preset.beepFrequency === current.beepFrequency &&
      preset.beepDuration === current.beepDuration &&
      preset.beepVolume === current.beepVolume &&
      name
    );
  });

  setActivePreset(matchedPreset ? matchedPreset[0] : null);
}

function formatClock(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

function getElapsedMs() {
  if (!running) {
    return elapsedBeforePause;
  }
  if (paused) {
    return elapsedBeforePause;
  }
  return elapsedBeforePause + (Date.now() - startTime);
}

function updateReadout() {
  const elapsedMs = getElapsedMs();
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const completedMinutes = Math.floor(elapsedMs / 60000);

  let secondsToNextMinute = 60 - (elapsedSeconds % 60);
  if (secondsToNextMinute === 60 && elapsedSeconds > 0 && elapsedSeconds % 60 !== 0) {
    secondsToNextMinute = 0;
  }

  completedEl.textContent = completedMinutes.toString();
  elapsedEl.textContent = formatClock(elapsedSeconds);
  countdownEl.textContent = formatClock(secondsToNextMinute);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function updateControlState() {
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
}

function beep() {
  if (!audioContext) {
    return;
  }

  const settings = getCurrentSettings();
  const volume = Math.max(settings.beepVolume / 100, 0.0001);
  const durationSeconds = settings.beepDuration / 1000;

  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = settings.beepType;
  osc.frequency.setValueAtTime(settings.beepFrequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.start(now);
  osc.stop(now + durationSeconds + 0.01);
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new window.AudioContext();
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function stopInterval() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function finishRun() {
  running = false;
  paused = false;
  elapsedBeforePause = targetIterations * 60000;
  stopInterval();
  updateReadout();
  updateControlState();
  setStatus(`Done. Completed ${targetIterations} iteration(s).`);
}

function tick() {
  const elapsedMs = getElapsedMs();
  const completedMinutes = Math.floor(elapsedMs / 60000);

  if (completedMinutes > lastCompletedMinutes) {
    const newBeeps = completedMinutes - lastCompletedMinutes;
    for (let i = 0; i < newBeeps; i += 1) {
      beep();
    }
    lastCompletedMinutes = completedMinutes;
  }

  if (targetIterations !== null && completedMinutes >= targetIterations) {
    finishRun();
    return;
  }

  updateReadout();
}

function getTargetIterations() {
  if (openEndedInput.checked) {
    return null;
  }

  const parsed = Number.parseInt(iterationsInput.value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function startFreshRun() {
  targetIterations = getTargetIterations();
  if (!openEndedInput.checked && targetIterations === null) {
    setStatus("Enter a valid number of iterations (1 or more).");
    return;
  }

  elapsedBeforePause = 0;
  lastCompletedMinutes = 0;
  running = true;
  paused = false;
  startTime = Date.now();

  stopInterval();
  timerId = setInterval(tick, 150);
  tick();

  if (targetIterations === null) {
    setStatus("Running open-ended EMOM.");
  } else {
    setStatus(`Running ${targetIterations} iteration(s).`);
  }

  updateControlState();
}

function togglePause() {
  if (!running) {
    return;
  }

  if (!paused) {
    elapsedBeforePause += Date.now() - startTime;
    paused = true;
    setStatus("Paused.");
  } else {
    startTime = Date.now();
    paused = false;
    setStatus("Resumed.");
  }

  updateControlState();
  updateReadout();
}

function resetRun() {
  running = false;
  paused = false;
  elapsedBeforePause = 0;
  lastCompletedMinutes = 0;
  targetIterations = null;
  stopInterval();
  updateReadout();
  updateControlState();
  setStatus("Ready.");
}

openEndedInput.addEventListener("change", () => {
  iterationsInput.disabled = openEndedInput.checked;
  saveSettings();
  syncPresetIndicator();
});

iterationsInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
});

beepTypeInput.addEventListener("change", () => {
  saveSettings();
  syncPresetIndicator();
});

beepFrequencyInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
});

beepDurationInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
});

beepVolumeInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
});

presetGrid.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const presetName = target.dataset.preset;
  if (!presetName || !presets[presetName]) {
    return;
  }

  applySettings(presets[presetName]);
  setActivePreset(presetName);
  saveSettings();
  setStatus(`Preset selected: ${target.textContent}.`);
});

startBtn.addEventListener("click", async () => {
  await ensureAudioContext();
  if (!running) {
    startFreshRun();
  }
});

pauseBtn.addEventListener("click", () => {
  togglePause();
});

resetBtn.addEventListener("click", () => {
  resetRun();
});

testBeepBtn.addEventListener("click", async () => {
  await ensureAudioContext();
  beep();
});

if (!loadSavedSettings()) {
  applySettings(presets.quick10);
}
updateReadout();
updateControlState();
syncPresetIndicator();
