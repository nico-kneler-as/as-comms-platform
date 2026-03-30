import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f7fb",
        ink: "#0f172a",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
} satisfies Config;
