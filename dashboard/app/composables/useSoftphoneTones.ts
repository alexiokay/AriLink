// Web Audio API tone generator for softphone
// Generates DTMF key tones, ringback (outbound ringing), and ringtone (incoming call)

// Standard DTMF frequency pairs
const DTMF_FREQ: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

let audioCtx: AudioContext | null = null;
let ringbackInterval: ReturnType<typeof setInterval> | null = null;
let ringtoneInterval: ReturnType<typeof setInterval> | null = null;
let activeOscillators: OscillatorNode[] = [];

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// ── DTMF tone (short beep when pressing dialpad key) ──

export function playDtmfTone(digit: string, duration = 120) {
  const freqs = DTMF_FREQ[digit];
  if (!freqs) return;

  const ctx = getCtx();
  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  gain.connect(ctx.destination);

  const [f1, f2] = freqs;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.frequency.value = f1;
  osc2.frequency.value = f2;
  osc1.connect(gain);
  osc2.connect(gain);

  osc1.start();
  osc2.start();

  // Fade out at the end to avoid click
  const fadeTime = duration / 1000;
  gain.gain.setValueAtTime(0.15, ctx.currentTime + fadeTime - 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeTime);

  osc1.stop(ctx.currentTime + fadeTime);
  osc2.stop(ctx.currentTime + fadeTime);
}

// ── Ringback tone (outbound call ringing — caller hears this) ──
// US pattern: 440+480 Hz, 2s on / 4s off

export function startRingback() {
  stopRingback();

  function playBurst() {
    const ctx = getCtx();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    osc1.connect(gain);
    osc2.connect(gain);

    osc1.start();
    osc2.start();

    // 2s burst with fade in/out
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.08, ctx.currentTime + 1.95);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.0);

    osc1.stop(ctx.currentTime + 2.0);
    osc2.stop(ctx.currentTime + 2.0);

    activeOscillators.push(osc1, osc2);
    osc1.onended = () => {
      activeOscillators = activeOscillators.filter((o) => o !== osc1 && o !== osc2);
    };
  }

  playBurst();
  ringbackInterval = setInterval(playBurst, 6000); // 2s on + 4s off = 6s cycle
}

export function stopRingback() {
  if (ringbackInterval) { clearInterval(ringbackInterval); ringbackInterval = null; }
  stopActiveOscillators();
}

// ── Ringtone (incoming call — device rings) ──
// Classic double-ring: 440+480 Hz, 0.4s on / 0.2s off / 0.4s on / 2s off

export function startRingtone() {
  stopRingtone();

  function playRing() {
    const ctx = getCtx();

    function burst(startAt: number, dur: number) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      osc1.connect(gain);
      osc2.connect(gain);

      osc1.start(ctx.currentTime + startAt);
      osc2.start(ctx.currentTime + startAt);

      // Envelope
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + startAt + 0.02);
      gain.gain.setValueAtTime(0.12, ctx.currentTime + startAt + dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + dur);

      osc1.stop(ctx.currentTime + startAt + dur);
      osc2.stop(ctx.currentTime + startAt + dur);

      activeOscillators.push(osc1, osc2);
      osc1.onended = () => {
        activeOscillators = activeOscillators.filter((o) => o !== osc1 && o !== osc2);
      };
    }

    burst(0, 0.4);     // First ring
    burst(0.6, 0.4);   // Second ring (0.2s gap)
  }

  playRing();
  ringtoneInterval = setInterval(playRing, 3000); // Double-ring every 3s
}

export function stopRingtone() {
  if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
  stopActiveOscillators();
}

// ── Cleanup ──

function stopActiveOscillators() {
  for (const osc of activeOscillators) {
    try { osc.stop(); } catch {}
  }
  activeOscillators = [];
}

export function stopAllTones() {
  stopRingback();
  stopRingtone();
  stopActiveOscillators();
}
