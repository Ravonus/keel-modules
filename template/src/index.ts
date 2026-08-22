/**
 * <module-id>: one line on what this module does. MIT.
 *
 * Keep the dependency-injection style: take your environment (contexts,
 * targets, resolvers, callbacks) as parameters instead of reaching for
 * globals. This file is the VERIFIED readable source; the platform
 * minifies it for on-chain bytes and links the two with a hash receipt.
 */

/** Options for {@link exampleGreeting}. */
export interface ExampleOptions {
  /** Name to greet. Defaults to "keel". */
  readonly name?: string;
}

/**
 * Replace this example with your module's real exports.
 *
 * Every exported function gets concise TSDoc: what it does, each
 * parameter, the return value, and any errors it throws.
 *
 * @param options Greeting overrides.
 * @returns The greeting string.
 */
export function exampleGreeting({ name = "keel" }: ExampleOptions = {}): string {
  return `hello, ${name}`;
}
