/** Deterministic test vectors for device-profile. Run by `keel module test`. */

const base = { touchPoints: 0, shortSide: 1080, pixelRatio: 2, uniforms: 1024 };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

export default [
  {
    name: 'a user agent or a touch screen names the class; an iPad calling itself a Mac is found by its touch points',
    run: ({ classOf }) => [
      classOf({ ...base, userAgent: IPHONE }), classOf({ ...base, userAgent: PIXEL }), classOf({ ...base, userAgent: MAC }),
      classOf({ ...base, userAgent: MAC, touchPoints: 5 }), classOf({ ...base, userAgent: 'x', mobile: true, shortSide: 390 }),
    ],
    expect: ['phone', 'phone', 'desktop', 'tablet', 'phone'],
  },
  {
    name: 'a software GPU or little memory is low on any class; a handheld gets 48 parts, a desktop 64, each a capped pixel ratio',
    run: ({ profileOf }) => [
      profileOf({ ...base, userAgent: MAC, gpu: 'ANGLE (SwiftShader)' }).tier,
      profileOf({ ...base, userAgent: PIXEL, memory: 2 }).tier,
      profileOf({ ...base, userAgent: IPHONE, pixelRatio: 3 }).parts, profileOf({ ...base, userAgent: IPHONE, pixelRatio: 3 }).pixelRatio,
      profileOf({ ...base, userAgent: MAC }).parts,
    ],
    expect: ['low', 'low', 48, 1.5, 64],
  },
  {
    name: 'a device can be forced to another class, to try a phone\'s detail on a desktop',
    run: ({ profileOf }) => profileOf({ ...base, userAgent: MAC }, { force: 'phone' }).parts,
    expect: 48,
  },
];
