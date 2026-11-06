// One audio graph serves all three views. Switching views never restarts the track.
export function musicTrace(audio, path, mode, comparisons = []) {
  let context, analyser, samples, bands;
  let frame = 0,
    last = 0,
    moving = false;
  const envelope = new Float32Array(100);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  function drawLine(target, mode) {
    let line = "";
    if (mode === "trace") {
      for (let i = 0; i < envelope.length; i++) {
        const x = (240 * i) / (envelope.length - 1);
        line +=
          (i ? "L" : "M") + x.toFixed(1) + "," + (18 - envelope[i]).toFixed(2);
      }
    } else if (mode === "keys") {
      analyser.getByteFrequencyData(bands);
      for (let i = 0; i < 46; i++) {
        const bin = Math.round(2 * Math.pow(150, i / 45));
        const h = 15 * Math.pow(bands[bin] / 255, 2);
        line +=
          "M" +
          (5 + 5 * i) +
          "," +
          (24 - h).toFixed(2) +
          "v" +
          (h + 0.7).toFixed(2);
      }
    } else {
      // Start at a rising zero crossing to keep periodic notes visually stable.
      let start = 1;
      while (start < 512 && !(samples[start - 1] <= 0 && samples[start] > 0))
        start++;
      for (let i = 0; i <= 240; i++) {
        const y = 18 - Math.tanh(samples[start + i * 4] * 3) * 14;
        line += (i ? "L" : "M") + i + "," + y.toFixed(2);
      }
    }
    target.setAttribute("d", line);
  }
  function draw() {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(samples);
    drawLine(path, mode);
    for (const { target, mode } of comparisons) drawLine(target, mode);
  }
  function tick(now) {
    if (!moving || audio.paused || document.hidden) return;
    if (now - last >= (reduced.matches ? 250 : 50)) {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      envelope.copyWithin(0, 1);
      envelope[envelope.length - 1] =
        15 * Math.tanh(6 * Math.sqrt(sum / samples.length));
      draw();
      last = now;
    }
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    moving = false;
    cancelAnimationFrame(frame);
  }
  function start() {
    stop();
    if (!analyser || audio.paused || audio.ended || audio.readyState < 3)
      return;
    moving = true;
    frame = requestAnimationFrame(tick);
  }
  audio.addEventListener("playing", start);
  for (const event of [
    "pause",
    "ended",
    "waiting",
    "seeking",
    "emptied",
    "error",
  ])
    audio.addEventListener(event, stop);
  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start(),
  );
  return async function enable() {
    if (!context) {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      samples = new Float32Array(analyser.fftSize);
      bands = new Uint8Array(analyser.frequencyBinCount);
      context
        .createMediaElementSource(audio)
        .connect(analyser)
        .connect(context.destination);
    }
    await context.resume();
    start();
  };
}
