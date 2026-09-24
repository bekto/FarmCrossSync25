/**
 * Test-only ESM resolve hook: Node's type stripping needs explicit file
 * extensions, but `src/index.ts` uses bundler-style extensionless imports
 * (`./farms`, `./saves`). This resolves a relative extensionless specifier to
 * its `.ts` sibling so tests can import the real Worker entrypoint, then falls
 * back to the default resolver. Not used by wrangler (which bundles itself).
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to the default resolution.
    }
  }
  return nextResolve(specifier, context);
}
