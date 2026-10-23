// Accumulate render quanta before crossing the AudioWorklet message port.
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.offset = 0
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        if (this.offset) this.port.postMessage({ samples: this.buffer.slice(0, this.offset) })
        this.offset = 0
        this.port.postMessage({ flushed: true })
      }
    }
  }
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples) return true
    for (const sample of samples) {
      this.buffer[this.offset++] = sample
      if (this.offset === this.buffer.length) {
        this.port.postMessage({ samples: this.buffer })
        this.buffer = new Float32Array(2048)
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor("typedance-pcm-recorder", PcmRecorder)
