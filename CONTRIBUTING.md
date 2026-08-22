# Publishing a verified KEEL module

Anyone can publish a verified module. You do not need permission, you do not
need to belong to an organisation, and you do not have to hand your code over
to anybody.

The reason is the trust model. A module is verified because a deterministic
rebuild of its readable source produces the exact minified bytes, and *anyone*
can run that rebuild. Verification is a check you pass, not a favour somebody
does you. So this repository is not a gatekeeper and is deliberately not a code
host: it records which sources reproduce which bytes, and points at where those
sources live.

## Verify anything, right now

You do not need to be a contributor to check any published module:

```bash
keel module verify --repo <owner>/<name> --commit <sha> --expect <0xdigest>
```

It fetches the archive at that exact commit, rebuilds it in a temporary
directory, prints the digests, deletes the checkout, and exits non-zero if the
rebuild does not match. Nothing is trusted: not the publisher, not this
repository, not the site. Run it against a module before you depend on it.

---

## What we require of YOUR repository

Almost nothing, and this is deliberate. Our conventions are conventions for
*our* repository. Outside it they are none of our business.

The only things a verification can honestly demand:

1. **A public repository.** A verification nobody else can repeat is not a
   verification.
2. **A full commit sha**, not a branch or a tag. A proof pinned to something
   that moves expires without telling anybody.
3. **An entry point path.** Any path. `src/index.ts`, `lib/thing.mjs`,
   `weird/nested/main.js` are all fine.
4. **A build that reproduces.** Same source in, same bytes out, every time.

That is the whole list. In particular we do **not** require, and will not check,
that your repository uses:

- **TypeScript.** Plain JavaScript is fine. `.js`, `.mjs`, `.ts`, `.jsx`,
  whatever esbuild can read.
- **Our tsconfig, or any tsconfig.** The strictness gate in `keel module build`
  is our house rule for this repository. `keel module verify` does not run it
  and never will.
- **A `src/` directory**, or any particular layout.
- **A `keel.module.json`.** That is our manifest for our tree.
- **Test vectors.** They are excellent and we use them heavily, but a
  reproducible build is proven by rebuilding, not by vectors.
- **A licence header, a code style, dependency injection, or a formatter.**

Only the files your entry point actually imports are pinned by the recipe. A
Makefile, a README, a CI config, your own tooling: not our concern, not in the
digest.

If you want our opinions you are welcome to them, and `keel module init`
scaffolds them for you. You are equally welcome to ignore all of it and still
be verified.

## Registering

A publisher is a **person** or an **organisation**. Most people are not an
organisation and should not have to invent one, so publishing under yourself is
the normal case, not a lesser one.

Add `modules/<your-handle>/publisher.json`:

```json
{
  "schema": "keel.publisher@1",
  "kind": "user",
  "id": "your-handle",
  "title": "Your Name",
  "summary": "What you make.",
  "url": "https://github.com/your-handle",
  "identityId": null,
  "members": [],
  "groups": []
}
```

Then a module names you as its owner:

```json
{ "owner": { "user": "your-handle" } }
```

That is the entire hierarchy for a person: you own your modules directly. You
have no groups, and none are implied.

An organisation uses `"kind": "org"` and may additionally declare `members` and
`groups`, which unlocks the longer listing paths:

```json
{ "owner": { "org": "your-org" } }
{ "owner": { "org": "your-org", "group": "tools" } }
{ "owner": { "org": "your-org", "group": "tools", "member": "dana" } }
```

Naming both a user and an org is refused rather than guessed at, and so is a
member without a group, because the site renders `org > group > member` and
there is no way back up from a member alone.

`identityId` is your on-chain identity once you have one, and `null` until then.
That is not a placeholder to be embarrassed about: a publisher, their people,
and their modules all exist and list correctly before anything is deployed, in
exactly the same way a module is verified before it is published.

`category` is a separate thing from `group`. It is what the module *is*
(`audio`, `generative`, `input`, `render`, `timing`, `viewer`), and it is the
directory the module lives in. Ownership and kind are different questions.

## Two ways in

**Path A: keep your own repository.** Write it however you like, push it, and
open a pull request here that registers the origin: your repository, the commit,
the entry path, and the digest it builds to. We reproduce it; we never copy it.

**Path B: contribute into this tree.** Copy `template/` to
`modules/<publisher>/<category>/<id>/` and open a pull request. Inside this
repository our house rules do apply, because it is our repository:

- strict TypeScript, and `keel module build` refuses weakened `strict`,
  `noUncheckedIndexedAccess`, or `exactOptionalPropertyTypes`;
- `test/vectors.mjs` with real cases;
- dependency injection rather than ambient globals, and no network or CDN
  imports;
- `pnpm lint`, `pnpm typecheck`, `pnpm vectors`, `pnpm check:catalog` all green.

Modules in this repository are also mirrored to their own public repository, so
Path B gets you a standalone repo too. Mirrors are generated by
`node scripts/mirror.mjs` and are checked to rebuild to the same digest standing
alone before they are ever pushed.

## Verified is not deployed

Your module is VERIFIED the moment its readable source is proven to rebuild into
its minified bytes. That happens on your laptop. It does not require a chain, a
wallet, gas, or anyone's approval, and it does not stop being true if you never
publish.

Publishing is a separate, later step with its own record. When a revision goes
on chain it gets an entry in `deployments/<chainId>.json` naming the KeelHold
instance and object id it lives at, plus the output digest tying it back to the
bytes the receipt verified. Until then the module lists as verified and not
deployed, which is normal and how every module here started.

## What will actually get a registration rejected

- The build does not reproduce. Not negotiable, and not a judgement about your
  code: if a clean rebuild does not produce the exact bytes, the receipt is not
  true.
- A branch or tag instead of a full commit sha.
- A repository nobody else can fetch.
- An owner path that does not resolve to a real publisher.

Note what is not on that list: your language, your layout, your tooling, and
your taste.
