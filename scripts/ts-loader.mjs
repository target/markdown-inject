/**
 * Node.js module loader that rewrites relative .js imports to .ts
 * so source files can use .js extensions (correct for tsc NodeNext output)
 * while still running directly with --experimental-transform-types.
 */
export async function resolve(specifier, context, next) {
  if (
    specifier.endsWith('.js') &&
    !specifier.startsWith('node:') &&
    !specifier.startsWith('http') &&
    (specifier.startsWith('./') || specifier.startsWith('../'))
  ) {
    const tsSpecifier = specifier.replace(/\.js$/, '.ts')
    try {
      return await next(tsSpecifier, context)
    } catch {
      // fall back to original .js specifier
    }
  }
  return next(specifier, context)
}
