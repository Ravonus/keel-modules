# frame-clock

Fixed-timestep animation clock. It simulates frames at an exact FPS regardless of display refresh, clamps catch-up after tab throttling to a bounded number of frames, and supports seeking to any frame for deterministic replay.

## Injected dependencies

- `onFrame` callback receiving `{ frame, time, delta }` per simulated frame

Scheduling uses the environment's `requestAnimationFrame` and `cancelAnimationFrame`, matching the verified source exactly.

## Usage

```ts
import { createFrameClock } from "./src/index.ts";

const clock = createFrameClock({
  fps: 12,
  onFrame: ({ frame, time }) => draw(frame, time),
});
clock.start();
// later: clock.seek(120); clock.stop();
```
