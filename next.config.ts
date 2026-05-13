import type { NextConfig } from "next";

const config: NextConfig = {
  // CLI lives in a sibling workspace; don't let Next try to typecheck it.
  typescript: { ignoreBuildErrors: false },
};

export default config;
