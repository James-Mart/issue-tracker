declare module "sherpa-onnx-node" {
  interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }

  interface OfflineStream {
    acceptWaveform(wave: Wave): void;
  }

  interface OfflineRecognitionResult {
    text: string;
  }

  class OfflineRecognizer {
    constructor(config: object);
    static createAsync(config: object): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): OfflineRecognitionResult;
  }

  const sherpaOnnx: {
    OfflineRecognizer: typeof OfflineRecognizer;
    readWave(filename: string): Wave;
  };

  export default sherpaOnnx;
}
