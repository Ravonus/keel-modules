// Maths with the same bits on every engine. A language promises that of plus, minus, times, divide, remainder and
// the square root, and of nothing else: Math.pow and Math.sin may differ in their last bit from one engine or version
// to the next. What a seed decides is worked out here, so a seed is the same person wherever it is asked.

/** The fifth root of a number from 0 up, by Newton's steps down from above it. */
export function root5(x: number): number {
  if (!(x > 0)) return 0;
  const step = (root: number): number => {
    const squared = root * root;
    return (4 * root + x / (squared * squared)) / 5;
  };
  // (The mean of x and four ones is never under the root, and from above every step comes down until it has it.)
  let root = (x + 4) / 5;
  for (let next = step(root); next < root; next = step(root)) root = next;
  return root;
}

/** `x` to a power of `whole` and `fifths` fifths: 1 and 2 for a power of 1.4. For x from 0 up. */
export function raised(x: number, whole: number, fifths: number): number {
  const root = fifths > 0 ? root5(x) : 1;
  let out = 1;
  for (let i = 0; i < whole; i += 1) out *= x;
  for (let i = 0; i < fifths; i += 1) out *= root;
  return out;
}

// A quarter turn as the nearest double, and what that leaves out of it.
const QUARTER = 1.5707963267948966;
const QUARTER_REST = 6.123233995736766e-17;

/** A sine's or a cosine's series from its `first` term, for the square of an angle within an eighth of a turn. */
function series(first: number, squared: number, from: number): number {
  let term = first;
  let sum = first;
  for (let n = from; n < from + 16; n += 2) {
    term *= -squared / (n * (n + 1));
    sum += term;
  }
  return sum;
}

/** The sine of an angle of any size, within 5e-16 of Math.sin's. */
export function sine(x: number): number {
  // (A remainder is exact, so the angle is taken down to the nearest quarter turn with nothing lost.)
  const over = x % QUARTER;
  const near = Math.abs(over) > QUARTER / 2 ? over - Math.sign(x) * QUARTER : over;
  const turns = Math.round((x - near) / QUARTER);
  const angle = near - turns * QUARTER_REST;
  const quarter = ((turns % 4) + 4) % 4;
  const part = quarter % 2 === 1 ? series(1, angle * angle, 1) : series(angle, angle * angle, 2);
  return quarter < 2 ? part : -part;
}
