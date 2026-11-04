import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The scaffold enables `cacheComponents` + `partialPrefetching`. With them on, every page that
  // reads cookies must be wrapped in <Suspense>. Nearly every DevMap page depends on the signed-in
  // user, so there is nothing to cache yet. Revisit for the public /explore map in Sprint 2.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
