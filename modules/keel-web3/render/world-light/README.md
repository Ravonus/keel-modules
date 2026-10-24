# world-light

The light of a real place at a real instant, for scenes that should look
different depending on where and when they are opened.

- **Sun and moon.** `solarPosition` is the low-precision almanac (about a
  degree): declination, hour angle, elevation and azimuth for any latitude,
  longitude and time, so the sun's path changes with season and place.
  `moonState` gives the phase, lit fraction and an approximate position.
- **Places.** `locateTimeZone(zone, offsetMinutes)` places a viewer from an
  IANA time zone (about 55 known cities), falling back to the UTC offset.
- **Sky.** Keyframes by sun elevation (night, twilight, blue hour, golden
  hour, day, high sun) set the zenith, horizon, ground, sun colour and fill.
  Season, climate and weather moods lean those colours and scale the light.
- **Air.** Haze rises with wet seasons, weather and morning mist; fog colour
  and range follow it.
- **God rays.** `rays` names the source (sun, moon or none), strength,
  colour, decay and reach, strongest low in the sky and in haze. The
  `voxel-dither` module draws them with `setRays`.

Directions are +y up, −z north, +x east.

```ts
import { locateTimeZone, worldLight } from "keel://module/world-light.js";

const place = locateTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone, -new Date().getTimezoneOffset());
const light = worldLight({ timestamp: Date.now(), lat: place.lat, lon: place.lon, season: "spring", climate: "temperate", weather: "clear" });
sun.position.fromArray(light.sun.direction).multiplyScalar(20);
sun.color.set(light.sun.color);
sun.intensity = light.sun.intensity;
```
