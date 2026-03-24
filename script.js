const countdownEl = document.getElementById("countdown");
const completedEl = document.getElementById("completed");
const remainingEl = document.getElementById("remaining");
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
const speechVoiceInput = document.getElementById("speechVoice");
const startCountdownInput = document.getElementById("startCountdown");
const testBeepBtn = document.getElementById("testBeepBtn");
const testVoiceBtn = document.getElementById("testVoiceBtn");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");

let timerId = null;
let startTime = 0;
let elapsedBeforePause = 0;
let running = false;
let paused = false;
let lastCompletedMinutes = 0;
let lastCountdownBeepSecond = -1;
let targetIterations = null;
let audioContext = null;
let wakeLockSentinel = null;
let startCountdownActive = false;
let startCountdownToken = 0;
let hasAnnouncedHalfway = false;
let hasAnnouncedFinalRound = false;
let availableSpeechVoices = [];
let pendingSpeechVoiceURI = "";

const storageKey = "emomSettingsV1";

const presets = {
  quick10: {
    iterations: 10,
    openEnded: false,
    startCountdown: true,
    beepType: "sine",
    beepFrequency: 1000,
    beepDuration: 900,
    beepVolume: 25
  },
  standard20: {
    iterations: 20,
    openEnded: false,
    startCountdown: true,
    beepType: "triangle",
    beepFrequency: 900,
    beepDuration: 900,
    beepVolume: 28
  },
  endless: {
    iterations: 10,
    openEnded: true,
    startCountdown: true,
    beepType: "square",
    beepFrequency: 1100,
    beepDuration: 900,
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
    startCountdown: startCountdownInput.checked,
    beepType: ["sine", "square", "triangle", "sawtooth"].includes(beepTypeInput.value)
      ? beepTypeInput.value
      : "sine",
    beepFrequency: clamp(Number.parseInt(beepFrequencyInput.value, 10), 200, 2000, 1000),
    beepDuration: clamp(Number.parseInt(beepDurationInput.value, 10), 80, 900, 900),
    beepVolume: clamp(Number.parseInt(beepVolumeInput.value, 10), 0, 100, 25),
    speechVoice: speechVoiceInput.value || ""
  };
}

function applySettings(settings) {
  if (!settings || typeof settings !== "object") {
    return;
  }

  iterationsInput.value = clamp(Number.parseInt(settings.iterations, 10), 1, 999, 10);
  openEndedInput.checked = Boolean(settings.openEnded);
  startCountdownInput.checked = settings.startCountdown !== false;
  beepTypeInput.value = ["sine", "square", "triangle", "sawtooth"].includes(settings.beepType)
    ? settings.beepType
    : "sine";
  beepFrequencyInput.value = clamp(Number.parseInt(settings.beepFrequency, 10), 200, 2000, 1000);
  beepDurationInput.value = clamp(Number.parseInt(settings.beepDuration, 10), 80, 900, 900);
  beepVolumeInput.value = clamp(Number.parseInt(settings.beepVolume, 10), 0, 100, 25);
  pendingSpeechVoiceURI = typeof settings.speechVoice === "string" ? settings.speechVoice : "";
  applySpeechVoiceSelection();
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
      preset.startCountdown === current.startCountdown &&
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
  if (targetIterations === null) {
    remainingEl.textContent = "\u221E";
  } else {
    remainingEl.textContent = Math.max(0, targetIterations - completedMinutes).toString();
  }
  elapsedEl.textContent = formatClock(elapsedSeconds);
  countdownEl.textContent = formatClock(secondsToNextMinute);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function supportsWakeLock() {
  return "wakeLock" in navigator;
}

async function requestWakeLock() {
  if (!supportsWakeLock()) {
    return;
  }

  if (wakeLockSentinel) {
    return;
  }

  if (document.visibilityState !== "visible") {
    return;
  }

  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
  } catch {
    // Ignore failures when policy, battery, or browser conditions deny the lock.
  }
}

async function releaseWakeLock() {
  if (!wakeLockSentinel) {
    return;
  }

  try {
    await wakeLockSentinel.release();
  } catch {
    // Ignore errors if the lock has already been released by the browser.
  } finally {
    wakeLockSentinel = null;
  }
}

function updateControlState() {
  startBtn.disabled = running || startCountdownActive;
  pauseBtn.disabled = !running;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  document.body.classList.toggle("focus-mode", running);
}

function playTone(options = {}) {
  if (!audioContext) {
    return;
  }

  const settings = getCurrentSettings();
  const frequency = Number.isFinite(options.frequency) ? options.frequency : settings.beepFrequency;
  const waveform = options.waveform || settings.beepType;
  const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : settings.beepDuration;
  const volumeScale = Number.isFinite(options.volumeScale) ? options.volumeScale : 1;

  const volume = Math.max((settings.beepVolume / 100) * volumeScale, 0.0001);
  const durationSeconds = Math.max(durationMs, 30) / 1000;

  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = waveform;
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

  osc.connect(gain);
  gain.connect(audioContext.destination);

  osc.start(now);
  osc.stop(now + durationSeconds + 0.01);
}

function beep() {
  playTone();
}

function playCountdownBeep(secondsLeft) {
  const pitchStep = 3 - secondsLeft;
  const frequency = 780 + pitchStep * 90;
  playTone({
    frequency,
    durationMs: 130,
    volumeScale: 1.4
  });
}

function playSessionEndSignal() {
  [0, 170, 340].forEach((delayMs, index) => {
    window.setTimeout(() => {
      playTone({
        frequency: 1100 + index * 90,
        durationMs: 110,
        volumeScale: 1
      });
    }, delayMs);
  });
}

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function applySpeechVoiceSelection() {
  if (!speechVoiceInput) {
    return;
  }

  const targetVoiceURI = pendingSpeechVoiceURI || speechVoiceInput.value;
  if (!targetVoiceURI) {
    speechVoiceInput.value = "";
    pendingSpeechVoiceURI = "";
    return;
  }

  const hasMatchingVoice = availableSpeechVoices.some((voice) => voice.voiceURI === targetVoiceURI);
  speechVoiceInput.value = hasMatchingVoice ? targetVoiceURI : "";
  pendingSpeechVoiceURI = "";
}

function refreshSpeechVoiceOptions() {
  if (!canSpeak() || !speechVoiceInput) {
    return;
  }

  availableSpeechVoices = window
    .speechSynthesis
    .getVoices()
    .slice()
    .sort((a, b) => {
      if (a.default && !b.default) {
        return -1;
      }
      if (!a.default && b.default) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

  speechVoiceInput.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "System default";
  speechVoiceInput.append(defaultOption);

  availableSpeechVoices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})${voice.default ? " - default" : ""}`;
    speechVoiceInput.append(option);
  });

  applySpeechVoiceSelection();
}

function getSelectedSpeechVoice() {
  if (!speechVoiceInput) {
    return null;
  }

  const selectedVoiceURI = speechVoiceInput.value;
  if (!selectedVoiceURI) {
    return null;
  }

  return availableSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceURI) || null;
}

function primeSpeechSynthesis() {
  if (!canSpeak()) {
    return;
  }

  refreshSpeechVoiceOptions();
  window.speechSynthesis.resume();
}

function speakAnnouncement(message) {
  if (!canSpeak()) {
    return;
  }

  if (document.visibilityState !== "visible") {
    return;
  }

  window.speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(message);
  const selectedVoice = getSelectedSpeechVoice();
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  } else {
    utterance.lang = document.documentElement.lang || "en-US";
  }
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function maybeSpeakProgressAnnouncements(completedMinutes) {
  if (targetIterations === null || targetIterations < 2) {
    return;
  }

  const announcements = [];
  const halfwayCompletedMinutes = Math.floor(targetIterations / 2);

  if (!hasAnnouncedHalfway && halfwayCompletedMinutes > 0 && completedMinutes >= halfwayCompletedMinutes) {
    announcements.push("You are half way through");
    hasAnnouncedHalfway = true;
  }

  if (!hasAnnouncedFinalRound && completedMinutes >= targetIterations - 1) {
    announcements.push("Final round");
    hasAnnouncedFinalRound = true;
  }

  if (announcements.length > 0) {
    speakAnnouncement(announcements.join(". "));
  }
}

async function runStartCountdown() {
  startCountdownActive = true;
  const token = ++startCountdownToken;
  updateControlState();

  for (let seconds = 3; seconds >= 1; seconds -= 1) {
    if (token !== startCountdownToken) {
      startCountdownActive = false;
      updateControlState();
      return false;
    }

    countdownEl.textContent = formatClock(seconds);
    setStatus(`Starting in ${seconds}...`);
    await ensureAudioContext();
    playCountdownBeep(seconds);
    await waitMs(1000);
  }

  if (token !== startCountdownToken) {
    startCountdownActive = false;
    updateControlState();
    return false;
  }

  startCountdownActive = false;
  updateControlState();
  return true;
}

async function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    audioContext = new AudioContextClass();
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

function waitMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function finishRun() {
  playSessionEndSignal();
  running = false;
  paused = false;
  elapsedBeforePause = targetIterations * 60000;
  stopInterval();
  releaseWakeLock();
  updateReadout();
  updateControlState();
  setStatus(`Done. Completed ${targetIterations} iteration(s).`);
}

function tick() {
  const elapsedMs = getElapsedMs();
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const secondsIntoMinute = elapsedSeconds % 60;
  const secondsToNextMinute = 60 - secondsIntoMinute;
  const completedMinutes = Math.floor(elapsedMs / 60000);

  if (secondsToNextMinute <= 3 && secondsToNextMinute >= 1 && elapsedSeconds !== lastCountdownBeepSecond) {
    playCountdownBeep(secondsToNextMinute);
    lastCountdownBeepSecond = elapsedSeconds;
  }

  if (completedMinutes > lastCompletedMinutes) {
    const newBeeps = completedMinutes - lastCompletedMinutes;
    for (let i = 0; i < newBeeps; i += 1) {
      beep();
    }
    maybeSpeakProgressAnnouncements(completedMinutes);
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
  lastCountdownBeepSecond = -1;
  hasAnnouncedHalfway = false;
  hasAnnouncedFinalRound = false;
  running = true;
  paused = false;
  startTime = Date.now();

  stopInterval();
  timerId = setInterval(tick, 150);
  tick();
  requestWakeLock();

  if (targetIterations === null) {
    setStatus("Running open-ended EMOM.");
  } else {
    setStatus(`Running ${targetIterations} iteration(s).`);
    if (targetIterations === 1) {
      speakAnnouncement("Final round");
      hasAnnouncedFinalRound = true;
    }
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
  startCountdownToken += 1;
  startCountdownActive = false;
  running = false;
  paused = false;
  elapsedBeforePause = 0;
  lastCompletedMinutes = 0;
  lastCountdownBeepSecond = -1;
  hasAnnouncedHalfway = false;
  hasAnnouncedFinalRound = false;
  targetIterations = null;
  stopInterval();
  releaseWakeLock();
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

speechVoiceInput.addEventListener("change", () => {
  saveSettings();
});

startCountdownInput.addEventListener("change", () => {
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
  primeSpeechSynthesis();
  if (!running) {
    if (startCountdownInput.checked) {
      const shouldStart = await runStartCountdown();
      if (!shouldStart) {
        updateReadout();
        return;
      }
    }
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

testVoiceBtn.addEventListener("click", () => {
  primeSpeechSynthesis();
  speakAnnouncement("Voice test. You are half way through. Final round.");
  setStatus("Voice test played.");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && running) {
    requestWakeLock();
    return;
  }

  releaseWakeLock();
});

window.addEventListener("beforeunload", () => {
  releaseWakeLock();
});

if (canSpeak()) {
  refreshSpeechVoiceOptions();
  window.speechSynthesis.addEventListener("voiceschanged", refreshSpeechVoiceOptions);
}

if (!loadSavedSettings()) {
  applySettings(presets.quick10);
}
updateReadout();
updateControlState();
syncPresetIndicator();
