# film-takes

Overdub takes for a fixed film. Rewinding plays a take back and never erases it, a touch starts a new take, and frames jumped over ease to a rest pose. Pass any few numbers a frame: a camera, a ride, a mix.

```js
const takes = createFilmTakes({ frames: 9000, rest: [0, 0, 1], angles: [0] });
const { value } = takes.record(frame, hand);
takes.retake(); // the viewer touched the lens
takes.jump(frame, target, hand);
```
