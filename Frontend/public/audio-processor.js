class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      // Post the Float32Array chunk to the main thread
      this.port.postMessage({ type: "audio", data: channelData });
    }
    return true; // Keep the processor alive
  }
}

registerProcessor("audio-processor", AudioProcessor);
