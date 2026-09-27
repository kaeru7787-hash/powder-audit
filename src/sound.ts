let audio: AudioContext | undefined;
export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
    void audio.resume();
  } catch {
    /* Visible warnings always remain available. */
  }
}
export function sound(kind: "ok" | "over" | "wrong") {
  try {
    unlockAudio();
    if (!audio) return;
    const notes =
      kind === "ok"
        ? [660, 880]
        : kind === "over"
          ? [390, 390, 260]
          : [850, 280, 850, 280, 850, 280];
    const duration = kind === "ok" ? 0.13 : kind === "over" ? 0.23 : 0.32;
    notes.forEach((hz, i) => {
      const oscillator = audio!.createOscillator(),
        gain = audio!.createGain(),
        t = audio!.currentTime + i * (duration + 0.07);
      oscillator.type = kind === "wrong" ? "sawtooth" : "sine";
      oscillator.frequency.value = hz;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(
        kind === "wrong" ? 0.12 : 0.1,
        t + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      oscillator.connect(gain);
      gain.connect(audio!.destination);
      oscillator.start(t);
      oscillator.stop(t + duration);
    });
    if (kind === "wrong")
      navigator.vibrate?.([600, 150, 200, 150, 600, 150, 200, 150, 600]);
    else if (kind === "over") navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* Sound availability never controls audit judgement. */
  }
}
