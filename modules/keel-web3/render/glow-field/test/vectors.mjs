import assert from 'node:assert/strict';

function recorder() {
  const events = [];
  const context = new Proxy({}, {
    set(target, key, value) { events.push([key, value]); target[key] = value; return true; },
    get(target, key) {
      if (key === 'createRadialGradient') return (...args) => {
        events.push([key, ...args]);
        return { addColorStop: (...stop) => events.push(['stop', ...stop]) };
      };
      return (...args) => events.push([key, ...args]);
    },
  });
  return { context, events };
}

export default [
  {
    name: 'unsafe settings cannot escape colors or unbound the ring budget',
    run: ({ glowSettings }) => {
      const settings = glowSettings({ color: '<script>', rings: 1000, speed: Infinity, accents: ['#abcdef', '<img>'] });
      return [settings.color, settings.rings, settings.speed, settings.accents];
    },
    expect: ['#7c83ff', 24, 1, ['#abcdef']],
  },
  {
    name: 'the reveal day controls whether any rings draw',
    run: ({ glowSettings, drawGlow }) => {
      const settings = glowSettings({ revealOn: '2026-10-05', rings: 2 });
      const before = recorder(), after = recorder();
      drawGlow(before.context, 320, 180, 1, settings, '2026-10-04');
      drawGlow(after.context, 320, 180, 1, settings, '2026-10-05');
      return [before.events.filter(row => row[0] === 'arc').length, after.events.filter(row => row[0] === 'arc').length];
    },
    expect: [0, 2],
  },
  {
    name: 'injected time and settings reproduce every drawing command',
    run: ({ glowSettings, drawGlow }) => {
      const settings = glowSettings({ rings: 3, accents: ['#abcdef'] });
      const first = recorder(), replay = recorder(), next = recorder();
      drawGlow(first.context, 320, 180, 1, settings);
      drawGlow(replay.context, 320, 180, 1, settings);
      drawGlow(next.context, 320, 180, 2, settings);
      assert.deepEqual(first.events, replay.events);
      assert.notDeepEqual(first.events, next.events);
      return true;
    },
    expect: true,
  },
];
