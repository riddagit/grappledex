// Ambient declaration so `tsc --noEmit` accepts side-effect CSS imports.
// (Next.js handles CSS via its own loaders; this only satisfies the type-checker.)
declare module "*.css";
