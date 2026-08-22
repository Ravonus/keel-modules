/** Small deterministic oscillator/envelope primitives for Web Audio authoring. MIT. */

/** Optional ADSR shape for {@link scheduleEnvelope}. All values are seconds. */
export interface EnvelopeOptions {
  /** Ramp time from silence to the peak value. */
  readonly attack?: number;
  /** Ramp time from the peak down to the sustain level. */
  readonly decay?: number;
  /** Sustain level as a fraction of the peak value. */
  readonly sustain?: number;
  /** Ramp time from the sustain level back to silence. */
  readonly release?: number;
  /** Minimum time the note is held before the release ramp starts. */
  readonly duration?: number;
}

/** Options for {@link oscillatorVoice}. */
export interface OscillatorVoiceOptions {
  /** Oscillator waveform. Defaults to "sine". */
  readonly type?: OscillatorType;
  /** Oscillator frequency in hertz. Defaults to 440. */
  readonly frequency?: number;
}

/** An oscillator connected through a gain node to a destination. */
export interface OscillatorVoice {
  readonly oscillator: OscillatorNode;
  readonly gain: GainNode;
}

/**
 * Converts a MIDI note number to a frequency in hertz.
 *
 * @param note MIDI note number, where 69 is the tuning reference pitch.
 * @param tuning Reference frequency for note 69 in hertz. Defaults to 440.
 * @returns The frequency in hertz.
 * @throws RangeError when the note is not finite or the tuning is not a finite positive number.
 */
export function noteFrequency(note: number, tuning = 440): number {
  if (!Number.isFinite(note) || !Number.isFinite(tuning) || tuning <= 0) throw new RangeError("Invalid note or tuning.");
  return tuning * 2 ** ((note - 69) / 12);
}

/**
 * Schedules a linear ADSR envelope on an audio parameter.
 *
 * @param parameter The audio parameter to automate, typically a gain value.
 * @param startTime Context time in seconds when the envelope begins.
 * @param peak Value reached at the end of the attack ramp.
 * @param options ADSR timing and level overrides.
 * @returns The context time in seconds when the envelope reaches silence.
 * @throws RangeError when any envelope value is negative or not finite.
 */
export function scheduleEnvelope(
  parameter: AudioParam,
  startTime: number,
  peak: number,
  { attack = 0.01, decay = 0.08, sustain = 0.6, release = 0.18, duration = 0.4 }: EnvelopeOptions = {},
): number {
  for (const value of [startTime, peak, attack, decay, sustain, release, duration]) if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid envelope value.");
  const releaseAt = startTime + Math.max(duration, attack + decay);
  parameter.cancelScheduledValues(startTime);
  parameter.setValueAtTime(0, startTime);
  parameter.linearRampToValueAtTime(peak, startTime + attack);
  parameter.linearRampToValueAtTime(peak * sustain, startTime + attack + decay);
  parameter.setValueAtTime(peak * sustain, releaseAt);
  parameter.linearRampToValueAtTime(0, releaseAt + release);
  return releaseAt + release;
}

/**
 * Creates an oscillator wired through a silent gain node into a destination.
 *
 * @param context The injected audio context that owns the new nodes.
 * @param destination The injected node the voice connects to.
 * @param options Waveform and frequency overrides.
 * @returns The oscillator and its gain node; the gain starts at 0.
 */
export function oscillatorVoice(context: BaseAudioContext, destination: AudioNode, options: OscillatorVoiceOptions = {}): OscillatorVoice {
  const oscillator = new OscillatorNode(context, { type: options.type ?? "sine", frequency: options.frequency ?? 440 });
  const gain = new GainNode(context, { gain: 0 });
  oscillator.connect(gain).connect(destination);
  return { oscillator, gain };
}
