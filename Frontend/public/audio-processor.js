class AudioProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const input = inputs[0];
		if (!input || !input[0]) {
			return true;
		}

		const channelData = input[0];
		this.port.postMessage({
			data: channelData,
		});

		return true;
	}
}

registerProcessor("audio-processor", AudioProcessor);
