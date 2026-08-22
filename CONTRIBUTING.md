# Publishing a verified KEEL module

Anyone can publish a verified module. You do not need permission, you do not
need to be in an organisation here, and you do not have to hand your code over
to anybody.

The reason is the trust model. A module is verified because a deterministic
rebuild of its readable source produces the exact minified bytes, and *anyone*
can run that rebuild. Verification is a check you pass, not a favour somebody
does you. So this repository is not a gatekeeper and is deliberately not a code
host: it records which sources reproduce which bytes, and points at where those
sources live.

## Verify anything, right now

You do not need to be a contributor to check any published module. This works
on any public repository, including this one:

```bash
keel module verify --repo keel-web3/noise2d --commit <sha> --expect <0xdigest>
```

It fetches the archive at that exact commit, rebuilds it in a temporary
directory, prints the digests, deletes the checkout, and exits non-zero if the
rebuild does not match what you expected. Nothing is trusted: not the
publisher, not this repository, not the site. Run it against a module before
you depend on it.

## Path A: your own repository

Best when the module is yours and you want to keep it that way.

1. **Write it.**

   ```bash
   keel module init ./my-module
   cd my-module
   ```

   Keep the dependency-injection style: a module takes its environment (audio
   contexts, event targets, GL contexts, resolvers) as parameters and never
   reaches for globals. Nothing may import from a CDN or the network. The build
   refuses to run if you weaken `strict`, `noUncheckedIndexedAccess`, or
   `exactOptionalPropertyTypes`, because the readable source is the part people
   audit.

2. **Write vectors.** `test/vectors.mjs` exports
   `[{ name, run(moduleExports), expect }]`. They are the only evidence anyone
   has that the minified bytes still behave like the source you published, and
   a module with no vectors cannot be behaviourally verified at all.

3. **Prove it.**

   ```bash
   keel module build .   # strict typecheck, minify, recipe, receipt
   keel module test .    # vectors against BOTH the readable and minified builds
   ```

   `keel module build` prints three digests. The output digest is the one that
   matters: it is the sha256 of the bytes that would go on chain.

4. **Push it to a public repository and note the commit.** The commit has to be
   a full sha. A branch or a tag moves, and a proof pinned to something that
   moves expires without telling anybody.

5. **Register it** by opening a pull request here that adds a registration for
   your module. Registration records where the source lives and what it builds
   to; it does not copy your code into this repository. See "Registering by
   origin" below.

## Path B: contribute into this repository

Best for modules meant to be maintained as part of the shared library.

1. Copy `template/` to `modules/<org>/<category>/<your-id>/`.
2. Add yourself to `modules/<org>/org.json`, or add a new org (see below).
3. Set `category` and `owner` in `keel.module.json`.
4. `pnpm lint`, `pnpm typecheck`, `pnpm vectors` must pass.
5. Open a pull request. CI reproduces your build before it can merge.

Modules in this repository are also mirrored to their own public repository
under the org, so Path B gets you a standalone repo too. The mirror is
generated (`node scripts/mirror.mjs`), and it is checked to rebuild to the same
digest standing alone before it is ever pushed.

## Registering an organisation

An organisation is a file. Add `modules/<your-org>/org.json`:

```json
{
  "schema": "keel.org@1",
  "id": "your-org",
  "title": "Your Org",
  "summary": "What you build.",
  "url": "https://github.com/your-org",
  "organizationId": null,
  "members": [
    { "id": "you", "name": "Your Name", "role": "owner", "github": "yourhandle", "address": null }
  ],
  "groups": [
    { "id": "core", "title": "Core", "summary": "The main line.", "members": ["you"] }
  ]
}
```

`organizationId` is your on-chain organisation id once you have one, and `null`
until then. That is not a placeholder to be embarrassed about: an org, its
people, and its modules all exist and list correctly before anything is
deployed, in exactly the same way a module is verified before it is published.

A module then points into that org with `owner`:

```json
{ "owner": { "org": "your-org", "group": "core", "member": "you" } }
```

`group` and `member` are both optional, so `org > modules`,
`org > group > modules`, and `org > group > member > modules` are all valid
listings. Indexing refuses an owner path that does not resolve, so you cannot
list under a heading that does not exist.

`category` is a separate thing from `group`: it is what the module *is*
(`audio`, `generative`, `input`, `render`, `timing`, `viewer`), and it is the
directory the module lives in. Your team can own a module filed under any
category.

## Verified is not deployed

Your module is VERIFIED the moment its readable source is proven to rebuild
into its minified bytes. That happens on your laptop. It does not require a
chain, a wallet, gas, or anyone's approval, and it does not stop being true if
you never publish.

Publishing is a separate, later step with its own record. When a revision goes
on chain it gets an entry in `deployments/<chainId>.json` naming the KeelHold
instance and object id it lives at, plus the output digest tying it back to the
bytes the receipt verified. Until then the module lists as verified and not
deployed, which is a normal state and how every module here started.

## What will get your pull request rejected

- The build does not reproduce. This is not negotiable and is not a judgement
  about your code: if a clean rebuild does not produce the exact bytes, the
  receipt is not true.
- No test vectors.
- Weakened compiler strictness.
- Network access, CDN imports, or reaching for ambient globals instead of
  taking them as parameters.
- A registration pinned to a branch or tag instead of a full commit sha.
