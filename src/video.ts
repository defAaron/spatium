export function canExportVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function encodeCanvas(canvas: HTMLCanvasElement, duration: number, signal: AbortSignal,
                                   draw: (progress: number) => void) {
  const { BufferTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } = await import('mediabunny');
  const frameRate = 30;
  const frameCount = duration / 1000 * frameRate;
  const bitrate = 3_000_000;
  if (!await canEncodeVideo('vp8', { width: canvas.width, height: canvas.height, bitrate })) {
    throw new Error('This browser does not have a compatible WebM encoder.');
  }
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  try {
    const source = new CanvasSource(canvas, { codec: 'vp8', bitrate });
    output.addVideoTrack(source, { frameRate });
    await output.start();

    for (let frame = 0; frame < frameCount; frame++) {
      signal.throwIfAborted();
      draw(frame / (frameCount - 1));
      await source.add(frame / frameRate, 1 / frameRate);
      if (frame % 10 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }

    await output.finalize();
    if (!target.buffer) throw new Error('The browser could not finish the WebM file.');
    return new Blob([target.buffer], { type: 'video/webm' });
  } catch (error) {
    await output.cancel();
    throw error;
  }
}
