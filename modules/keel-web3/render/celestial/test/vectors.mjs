import { readFileSync } from 'node:fs';

const pack = readFileSync(new URL('../data/sky.pack', import.meta.url));
const at = (iso) => Date.parse(iso);

export default [
  {
    name: 'a pack opens with its stars and all twelve zodiac figures',
    run: ({ openSky }) => {
      const sky = openSky(pack);
      return [sky.stars.length > 400, sky.zodiac.length];
    },
    expect: [true, 12],
  },
  {
    name: 'a reader skips a section it does not know',
    run: ({ readPack }) => {
      const extended = new Uint8Array([...pack, 200, 3, 1, 2, 3]);
      return readPack(extended).stars.length === readPack(pack).stars.length;
    },
    expect: true,
  },
  {
    name: 'the total lunar eclipse of 31 December 2028 goes fully dark, and a night a month before does not',
    run: ({ openSky }) => {
      const { skyAt } = openSky(pack);
      return [skyAt(at('2028-12-31T16:52:00Z')).lunar, skyAt(at('2028-12-01T16:52:00Z')).lunar];
    },
    expect: [1, 0],
  },
  {
    name: 'from Luxor the moon covers the whole sun on 2 August 2027, and only there is it total',
    run: ({ openSky, horizonMatrix, toScene, moonFrom, angleBetween }) => {
      const { skyAt } = openSky(pack);
      const closest = (lat, lon) => {
        let best = 9;
        for (let minute = 480; minute < 780; minute += 1) {
          const when = at('2027-08-02T00:00:00Z') + minute * 60000;
          const sky = skyAt(when);
          const matrix = horizonMatrix(when, lat, lon);
          best = Math.min(best, angleBetween(toScene(matrix, sky.bodies.sun.direction), moonFrom(matrix, sky.bodies.moon)));
        }
        return best;
      };
      return [closest(25.69, 32.64) < 0.027, closest(39.74, -104.99) < 0.5];
    },
    expect: [true, false],
  },
  {
    name: 'Mercury runs backward in its retrograde of late October 2026',
    run: ({ openSky }) => openSky(pack).skyAt(at('2026-10-30T12:00:00Z')).bodies.mercury.retrograde,
    expect: true,
  },
  {
    name: 'the Perseids run in mid August and nothing runs in early March',
    run: ({ openSky }) => {
      const { skyAt } = openSky(pack);
      return [skyAt(at('2027-08-13T00:00:00Z')).shower.rate > 80, skyAt(at('2027-03-05T00:00:00Z')).shower];
    },
    expect: [true, null],
  },
  {
    name: 'a chart lists its aspects and a chart of the future holds up',
    run: ({ openSky }) => {
      const { chartAt } = openSky(pack);
      return [chartAt(at('2026-10-30T12:00:00Z'), 39.74, -104.99).aspects.length > 0, Number.isFinite(chartAt(at('4020-06-01T00:00:00Z'), 0, 0).ascendant)];
    },
    expect: [true, true],
  },
];
