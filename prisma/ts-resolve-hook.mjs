// Lets Node run TypeScript sources directly (native type stripping, Node >= 22.18)
// without tsx/esbuild: the project uses NodeNext-style `./file.js` specifiers, so
// when such a file does not exist next to a .ts importer, resolve `./file.ts`.
// Used by the seed: `node --import ./prisma/ts-resolve-hook.mjs prisma/seed.ts`.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelativeJs =
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      specifier.endsWith('.js');
    if (!isRelativeJs || !context.parentURL?.endsWith('.ts')) {
      return nextResolve(specifier, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});
