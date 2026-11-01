// How long a file and a function may be, by what kind of file it is. First match wins, and nothing passes 1200 lines.
// A file of nothing but data or shader source can name itself so: `palette.data.ts`, `skin.glsl.ts`.
export const LIMITS = [
  { kind: "data", files: ["**/*.data.ts", "**/*.table.ts"], lines: 1200, fn: 300 },
  { kind: "shader", files: ["**/*.glsl.ts", "**/*.shader.ts"], lines: 1200, fn: 200 },
  { kind: "renderer", files: ["modules/*/render/*/src/**/*.ts"], lines: 1000, fn: 80 },
  { kind: "generator", files: ["modules/*/generative/*/src/**/*.ts", "modules/*/audio/*/src/**/*.ts"], lines: 800, fn: 60 },
  { kind: "tooling", files: ["scripts/**"], lines: 500, fn: 60 },
  { kind: "other", files: ["**"], lines: 500, fn: 60 },
];
