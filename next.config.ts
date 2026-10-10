import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gemini's system instruction and the demo transcripts are read from knowledge/ at runtime.
  outputFileTracingIncludes: {
    "/**/*": ["./knowledge/**/*"],
  },
};

export default nextConfig;
