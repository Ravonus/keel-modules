# audio-envelope

Deterministic oscillator and ADSR envelope primitives for Web Audio authoring: MIDI note to frequency conversion, linear envelope scheduling on any `AudioParam`, and a small oscillator-plus-gain voice factory.

## Injected dependencies

- `parameter: AudioParam` for `scheduleEnvelope`
- `context: BaseAudioContext` and `destination: AudioNode` for `oscillatorVoice`

The module never reaches for a global audio context; the caller supplies every audio object.

## Usage

```ts
import { noteFrequency, oscillatorVoice, scheduleEnvelope } from "./src/index.ts";

const context = new AudioContext();
const voice = oscillatorVoice(context, context.destination, { type: "triangle" });
voice.oscillator.frequency.value = noteFrequency(60);
voice.oscillator.start();
const endsAt = scheduleEnvelope(voice.gain.gain, context.currentTime, 0.8, { attack: 0.02 });
voice.oscillator.stop(endsAt);
```
