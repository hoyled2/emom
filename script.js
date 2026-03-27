const countdownEl = document.getElementById("countdown");
const completedEl = document.getElementById("completed");
const remainingEl = document.getElementById("remaining");
const elapsedEl = document.getElementById("elapsed");
const statusEl = document.getElementById("status");

const iterationsInput = document.getElementById("iterations");
const roundLengthInput = document.getElementById("roundLength");
const openEndedInput = document.getElementById("openEnded");
const presetGrid = document.getElementById("presetGrid");
const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));
const roundPresetGrid = document.getElementById("roundPresetGrid");
const roundPresetButtons = Array.from(document.querySelectorAll(".preset-btn[data-round-length]"));

const beepTypeInput = document.getElementById("beepType");
const beepFrequencyInput = document.getElementById("beepFrequency");
const beepDurationInput = document.getElementById("beepDuration");
const beepVolumeInput = document.getElementById("beepVolume");
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
let activeRoundLengthSeconds = 60;
let audioContext = null;
let wakeLockSentinel = null;
let startCountdownActive = false;
let startCountdownToken = 0;
let hasAnnouncedHalfway = false;
let hasAnnouncedFinalRound = false;

const storageKey = "emomSettingsV1";

const presets = {
  quick10: {
    iterations: 10,
    roundLength: 1,
    openEnded: false,
    startCountdown: true,
    beepType: "sine",
    beepFrequency: 1000,
    beepDuration: 900,
    beepVolume: 25
  },
  standard20: {
    iterations: 20,
    roundLength: 1,
    openEnded: false,
    startCountdown: true,
    beepType: "triangle",
    beepFrequency: 900,
    beepDuration: 900,
    beepVolume: 28
  },
  endless: {
    iterations: 10,
    roundLength: 1,
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
    roundLength: clamp(Number.parseInt(roundLengthInput.value, 10), 1, 60, 1),
    openEnded: openEndedInput.checked,
    startCountdown: startCountdownInput.checked,
    beepType: ["sine", "square", "triangle", "sawtooth"].includes(beepTypeInput.value)
      ? beepTypeInput.value
      : "sine",
    beepFrequency: clamp(Number.parseInt(beepFrequencyInput.value, 10), 200, 2000, 1000),
    beepDuration: clamp(Number.parseInt(beepDurationInput.value, 10), 80, 900, 900),
    beepVolume: clamp(Number.parseInt(beepVolumeInput.value, 10), 0, 100, 25)
  };
}

function applySettings(settings) {
  if (!settings || typeof settings !== "object") {
    return;
  }

  iterationsInput.value = clamp(Number.parseInt(settings.iterations, 10), 1, 999, 10);
  roundLengthInput.value = clamp(Number.parseInt(settings.roundLength, 10), 1, 60, 1);
  openEndedInput.checked = Boolean(settings.openEnded);
  startCountdownInput.checked = settings.startCountdown !== false;
  beepTypeInput.value = ["sine", "square", "triangle", "sawtooth"].includes(settings.beepType)
    ? settings.beepType
    : "sine";
  beepFrequencyInput.value = clamp(Number.parseInt(settings.beepFrequency, 10), 200, 2000, 1000);
  beepDurationInput.value = clamp(Number.parseInt(settings.beepDuration, 10), 80, 900, 900);
  beepVolumeInput.value = clamp(Number.parseInt(settings.beepVolume, 10), 0, 100, 25);
  iterationsInput.disabled = openEndedInput.checked;
}

function saveSettings() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(getCurrentSettings()));
  } catch (error) {
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
  } catch (error) {
    return false;
  }
}

function setActivePreset(presetName) {
  presetButtons
    .filter((button) => button.dataset.preset)
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.preset === presetName);
    });
}

function setActiveRoundPreset(roundLength) {
  roundPresetButtons.forEach((button) => {
    const buttonRoundLength = Number.parseInt(button.dataset.roundLength || "", 10);
    button.classList.toggle("active", Number.isFinite(roundLength) && buttonRoundLength === roundLength);
  });
}

function syncRoundPresetIndicator() {
  const current = getCurrentSettings();
  const matchingButton = roundPresetButtons.find((button) => {
    const buttonRoundLength = Number.parseInt(button.dataset.roundLength || "", 10);
    return buttonRoundLength === current.roundLength;
  });

  if (!matchingButton) {
    setActiveRoundPreset(null);
    return;
  }

  const matchedRoundLength = Number.parseInt(matchingButton.dataset.roundLength || "", 10);
  setActiveRoundPreset(matchedRoundLength);
}

function sanitizeRoundLengthInput() {
  roundLengthInput.value = clamp(Number.parseInt(roundLengthInput.value, 10), 1, 60, 1);
}

function sanitizeIterationsInput() {
  iterationsInput.value = clamp(Number.parseInt(iterationsInput.value, 10), 1, 999, 10);
}

function syncPresetIndicator() {
  const current = getCurrentSettings();
  const matchedPreset = Object.entries(presets).find((entry) => {
    const [name, preset] = entry;
    return (
      preset.iterations === current.iterations &&
      preset.roundLength === current.roundLength &&
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
  const roundLengthMs = running || paused ? activeRoundLengthSeconds * 1000 : getRoundLengthMs();
  const roundLengthSeconds = Math.floor(roundLengthMs / 1000);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const completedRounds = Math.floor(elapsedMs / roundLengthMs);

  let secondsToNextRound = roundLengthSeconds - (elapsedSeconds % roundLengthSeconds);
  if (secondsToNextRound === roundLengthSeconds && elapsedSeconds > 0 && elapsedSeconds % roundLengthSeconds !== 0) {
    secondsToNextRound = 0;
  }

  completedEl.textContent = completedRounds.toString();
  if (targetIterations === null) {
    remainingEl.textContent = "\u221E";
  } else {
    remainingEl.textContent = Math.max(0, targetIterations - completedRounds).toString();
  }
  elapsedEl.textContent = formatClock(elapsedSeconds);
  countdownEl.textContent = formatClock(secondsToNextRound);
}

function getRoundLengthSeconds() {
  return clamp(Number.parseInt(roundLengthInput.value, 10), 1, 60, 1) * 60;
}

function getRoundLengthMs() {
  return getRoundLengthSeconds() * 1000;
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
  } catch (error) {
    // Ignore failures when policy, battery, or browser conditions deny the lock.
  }
}

async function releaseWakeLock() {
  if (!wakeLockSentinel) {
    return;
  }

  try {
    await wakeLockSentinel.release();
  } catch (error) {
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

function primeSpeechSynthesis() {
  if (!canSpeak()) {
    return;
  }

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
  utterance.lang = document.documentElement.lang || "en-US";
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
  elapsedBeforePause = targetIterations * activeRoundLengthSeconds * 1000;
  stopInterval();
  releaseWakeLock();
  updateReadout();
  updateControlState();
  setStatus(`Done. Completed ${targetIterations} iteration(s).`);
}

function tick() {
  const elapsedMs = getElapsedMs();
  const roundLengthSeconds = activeRoundLengthSeconds;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const secondsIntoRound = elapsedSeconds % roundLengthSeconds;
  const secondsToNextRound = roundLengthSeconds - secondsIntoRound;
  const completedRounds = Math.floor(elapsedMs / (roundLengthSeconds * 1000));

  if (secondsToNextRound <= 3 && secondsToNextRound >= 1 && elapsedSeconds !== lastCountdownBeepSecond) {
    playCountdownBeep(secondsToNextRound);
    lastCountdownBeepSecond = elapsedSeconds;
  }

  if (completedRounds > lastCompletedMinutes) {
    const newBeeps = completedRounds - lastCompletedMinutes;
    for (let i = 0; i < newBeeps; i += 1) {
      beep();
    }
    maybeSpeakProgressAnnouncements(completedRounds);
    lastCompletedMinutes = completedRounds;
  }

  if (targetIterations !== null && completedRounds >= targetIterations) {
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

  activeRoundLengthSeconds = getRoundLengthSeconds();
  elapsedBeforePause = 0;
  lastCompletedMinutes = -1;
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
  activeRoundLengthSeconds = getRoundLengthSeconds();
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
  syncRoundPresetIndicator();
});

iterationsInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

iterationsInput.addEventListener("blur", () => {
  sanitizeIterationsInput();
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

roundLengthInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

roundLengthInput.addEventListener("blur", () => {
  sanitizeRoundLengthInput();
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

beepTypeInput.addEventListener("change", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

beepFrequencyInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

beepDurationInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

beepVolumeInput.addEventListener("input", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
});

startCountdownInput.addEventListener("change", () => {
  saveSettings();
  syncPresetIndicator();
  syncRoundPresetIndicator();
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
  syncRoundPresetIndicator();
  saveSettings();
  setStatus(`Preset selected: ${target.textContent}.`);
});

if (roundPresetGrid) {
  roundPresetGrid.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const roundLength = Number.parseInt(target.dataset.roundLength || "", 10);
    if (!Number.isFinite(roundLength)) {
      return;
    }

    roundLengthInput.value = clamp(roundLength, 1, 60, 1);
    saveSettings();
    syncPresetIndicator();
    setActiveRoundPreset(roundLength);
    setStatus(`Round length set to ${roundLength} minute(s).`);
    updateReadout();
  });
}

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

if (!loadSavedSettings()) {
  applySettings(presets.quick10);
}
updateReadout();
updateControlState();
syncPresetIndicator();
syncRoundPresetIndicator();
