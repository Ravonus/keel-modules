/** A 32-bit hash of every number's float bits, in order. */
const hashOf = (...arrays) => {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const bits = new Uint32Array(Float32Array.from(a).buffer);
    for (const b of bits) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  return h;
};

const far = (exports, seed, face = 'A', hand = 'pinch') => exports.buildBust({ seed, face, hand, detail: exports.DETAIL.far });

/** What the far busts of three seeds, both faces, hash to: every vertex, normal and index to its last bit. It moves with any change to a shape, and must then come out the same on every Node: a hash that differs between two is a Math.sin or a Math.pow back in the geometry. */
const MESH_HASH = 1708943343;

export default [
  {
    name: 'the exact sine and cosine agree with the engine to the last few bits, and are their own on every engine',
    run: ({ sine, cosine, deg }) => {
      const angles = Array.from({ length: 200 }, (_, i) => (i - 100) * 0.173);
      const worst = Math.max(...angles.map((a) => Math.max(Math.abs(sine(a) - Math.sin(a)), Math.abs(cosine(a) - Math.cos(a)))));
      return [worst < 1e-14, sine(deg(30)), cosine(deg(60)), hashOf(angles.map(sine), angles.map(cosine))];
    },
    expect: [true, 0.49999999999999994, 0.5000000000000003, 2716173191],
  },
  {
    name: 'a seed decides the face within small shares of the mean, the same every time, and seeds differ',
    run: ({ featuresOf }) => {
      const all = Array.from({ length: 64 }, (_, seed) => featuresOf(seed));
      const within = all.every((f) => f.eyes >= 0.027 && f.eyes <= 0.0285 && f.nose >= 0.9 && f.nose <= 0.96 && f.jaw >= 0.95 && f.jaw <= 1.03);
      return [within, JSON.stringify(featuresOf(7)) === JSON.stringify(featuresOf(7)), JSON.stringify(featuresOf(7)) === JSON.stringify(featuresOf(8))];
    },
    expect: [true, true, false],
  },
  {
    name: 'settings fall back to their defaults and give a recipe and a palette',
    run: ({ portraitSettings, sitterOf, DETAIL, DEFAULT_PORTRAIT_SETTINGS }) => {
      const odd = portraitSettings({ seed: -4.6, face: 'C', detail: 'far', hand: 'wave', cap: '#ABCDEF', hair: 'red' });
      const { recipe, palette } = sitterOf(odd);
      return [portraitSettings() === DEFAULT_PORTRAIT_SETTINGS, odd.seed, odd.face, odd.hand, recipe.detail === DETAIL.far, palette.cap, palette.hair === DEFAULT_PORTRAIT_SETTINGS.hair];
    },
    expect: [true, 0, 'A', 'pinch', true, '#abcdef', true],
  },
  {
    name: 'a bust is whole: every part finite, its arrays in step, its indices in range, and the recipe cached by its digest',
    run: (exports) => {
      const bust = far(exports, 3);
      const whole = bust.parts.every((p) => {
        const n = p.position.length / 3;
        return n > 0 && p.normal.length === n * 3 && p.open.length === n && p.rest.length === n * 3 &&
          (!p.flow || p.flow.length === n * 4) && p.index.length % 3 === 0 && p.index.every((i) => i < n) &&
          p.position.every(Number.isFinite) && p.normal.every(Number.isFinite) && p.open.every((o) => o >= 0 && o <= 1);
      });
      const again = far(exports, 3);
      const names = bust.parts.map((p) => p.name).join();
      return [whole, again === bust, names, exports.digestOf({ seed: 3, face: 'A', hand: 'pinch', detail: exports.DETAIL.far })];
    },
    expect: [true, true, 'skin,chest,eye,eye,cap,under,hair,chemise,dress,gown,chain,hand,card', 'acec80a2'],
  },
  {
    name: 'faces A and B share the mass of hair behind the head; B turns the head away and down and pulls the cap a centimetre lower',
    run: (exports) => {
      const [a, b] = ['A', 'B'].map((face) => far(exports, 5, face));
      const part = (bust, name) => bust.parts.find((p) => p.name === name);
      const sameHair = hashOf(part(a, 'under').position) === hashOf(part(b, 'under').position);
      const t = b.pose.turn;
      // The head's forward axis (third row) in the bust's frame: B's points down and toward -x.
      return [sameHair, Math.round((a.cap.edge - b.cap.edge) * 1e4) / 1e4 > 0.009, t[7] < -0.3, t[6] < -0.3];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'the far busts of three seeds and both faces hash to the pinned number',
    run: (exports) => {
      const arrays = [];
      for (const seed of [1, 2, 3]) for (const face of ['A', 'B']) for (const p of far(exports, seed, face).parts) arrays.push(p.position, p.normal, p.index);
      return hashOf(...arrays);
    },
    expect: MESH_HASH,
  },
  {
    name: 'the pinch closes: the thumb\'s tip lies on the card\'s face, the index finger behind it',
    run: (exports) => {
      const bust = far(exports, 1, 'A', 'pinch');
      const thumb = bust.nails[4];
      const hand = bust.parts.find((p) => p.name === 'hand');
      // The hand's vertex nearest the thumb's tip, in the bust's frame, then in the card's (its rows take a point in).
      let best = Infinity, at = [0, 0, 0];
      for (let i = 0; i < hand.rest.length; i += 3) {
        const d = Math.hypot(hand.rest[i] - thumb.to[0], hand.rest[i + 1] - thumb.to[1], hand.rest[i + 2] - thumb.to[2]);
        if (d < best) { best = d; at = [hand.position[i], hand.position[i + 1], hand.position[i + 2]]; }
      }
      const m = bust.card.turn, q = at.map((v, i) => v - bust.card.at[i]);
      const local = [0, 1, 2].map((r) => m[r * 3] * q[0] + m[r * 3 + 1] * q[1] + m[r * 3 + 2] * q[2]);
      return Math.abs(local[0]) < 0.06 && Math.abs(local[1]) < 0.038 && Math.abs(local[2]) < 0.015;
    },
    expect: true,
  },
];
