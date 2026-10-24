const DENVER = [39.74, -104.99];
const noonDenver = (date) => Date.parse(`${date}T19:00:00Z`);

export default [
  {
    name: 'the sun stands high at the June solstice and low at the December one',
    run: ({ solarPosition }) => [solarPosition(noonDenver('2026-06-21'), ...DENVER), solarPosition(noonDenver('2026-12-21'), ...DENVER)].map((sun) => Math.round(sun.elevation)),
    expect: [74, 27],
  },
  {
    name: 'solar noon faces south in the north and north in the south',
    run: ({ solarPosition }) => {
      const north = solarPosition(noonDenver('2026-03-20'), ...DENVER).azimuth;
      const south = solarPosition(Date.parse('2026-03-20T02:00:00Z'), -33.87, 151.21).azimuth;
      return [north > 150 && north < 210, south < 30 || south > 330];
    },
    expect: [true, true],
  },
  {
    name: 'a sky direction is a unit vector, up for the zenith and toward -z for the north horizon',
    run: ({ skyDirection }) => [skyDirection({ elevation: 90, azimuth: 0 }).map((value) => Math.round(value * 1000) / 1000 + 0), skyDirection({ elevation: 0, azimuth: 0 }).map((value) => Math.round(value * 1000) / 1000 + 0)],
    expect: [[0, 1, 0], [0, 0, -1]],
  },
  {
    name: 'the moon is full about half a synodic month after a new moon',
    run: ({ moonState }) => {
      const newMoon = moonState(Date.parse('2026-01-18T19:52:00Z'), ...DENVER);
      const full = moonState(Date.parse('2026-02-01T22:09:00Z'), ...DENVER);
      return [newMoon.illumination < 0.03, full.illumination > 0.97];
    },
    expect: [true, true],
  },
  {
    name: 'a time zone places the viewer; an unknown zone falls back to its UTC offset',
    run: ({ locateTimeZone }) => {
      const tokyo = locateTimeZone('Asia/Tokyo');
      const unknown = locateTimeZone('Mars/Olympus', -300);
      return [Math.round(tokyo.lat), Math.round(tokyo.lon), tokyo.exact, unknown.lon, unknown.exact];
    },
    expect: [36, 140, true, -75, false],
  },
  {
    name: 'light phases follow the sun from night to high sun',
    run: ({ lightPhase }) => [-20, -8, -2, 5, 30, 70].map(lightPhase),
    expect: ['night', 'twilight', 'blue hour', 'golden hour', 'day', 'high sun'],
  },
  {
    name: 'noon is bright with no stars; midnight is dark with stars and no sun',
    run: ({ worldLight }) => {
      const noon = worldLight({ timestamp: noonDenver('2026-07-15'), lat: DENVER[0], lon: DENVER[1] });
      const midnight = worldLight({ timestamp: Date.parse('2026-07-15T07:00:00Z'), lat: DENVER[0], lon: DENVER[1] });
      return [noon.night, noon.sun.intensity > 1, midnight.night, midnight.sun.intensity];
    },
    expect: [0, true, 1, 0],
  },
  {
    name: 'golden hour casts long sun rays; rain dims them and thickens the haze',
    run: ({ worldLight }) => {
      const evening = { timestamp: Date.parse('2026-07-16T02:00:00Z'), lat: DENVER[0], lon: DENVER[1] };
      const clear = worldLight(evening);
      const rain = worldLight({ ...evening, weather: 'rain' });
      return [clear.phase, clear.rays.source, clear.rays.strength > rain.rays.strength, rain.haze > clear.haze];
    },
    expect: ['golden hour', 'sun', true, true],
  },
  {
    name: 'colors mix in sRGB hex and clamp the amount',
    run: ({ mixHex }) => [mixHex('#000000', '#ffffff', 0.5), mixHex('#ff0000', '#0000ff', 2)],
    expect: ['#808080', '#0000ff'],
  },
];
