let lastPlayedAt = 0;
let audioContext: AudioContext | null = null;

export async function playMessageSound() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayedAt < 1200) return;
  lastPlayedAt = now;

  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    if (!audioContext || audioContext.state === "closed") {
      audioContext = new Ctx();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;

    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start();
    osc.stop(audioContext.currentTime + 0.32);
  } catch {
    // Ignore autoplay or device errors.
  }
}
