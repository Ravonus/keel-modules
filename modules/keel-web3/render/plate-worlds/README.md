# plate-worlds

Several full scenes in one page, each with its own document, window, address and GL contexts, for pages that cannot use iframes. Run the scene as a function that takes the world's scope in place of its globals.

```js
const world = createPlateWorld({ address: "plate:one", html, globals: { seed } });
await scene(world.scope);
world.end();
```
