import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Restrained slate-on-white palette.
        page: "#fbfbfd",
        paper: "#ffffff",
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dde1ea",
          300: "#c2c9d6",
          400: "#94a0b4",
          500: "#5b6473",
          600: "#3f4754",
          700: "#2c333f",
          800: "#1a1f29",
          900: "#0e131c",
          950: "#070b12",
        },
        line: "#e4e7ec",
        accent: {
          DEFAULT: "#2563eb",
          dark: "#1d4ed8",
        },
        diff: {
          added: "#e9f6ee",
          removed: "#fdecec",
          removedText: "#9b1c1c",
        },
      },
    },
  },
  plugins: [],
};

export default config;
