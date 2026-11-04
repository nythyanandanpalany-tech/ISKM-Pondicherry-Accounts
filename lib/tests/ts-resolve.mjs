// Lets `node --test` load the app's TypeScript sources unchanged.
//
// The app is written for a bundler, so its relative imports carry no file extension
// (`import { daysBetween } from "./format"`). Node's ESM resolver needs one. Rather than litter
// the source with ".ts" just to suit the test runner, this hook adds it during resolution.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* not a .ts file: resolve as given */ }
    }
    return next(specifier, context);
  },
});
