import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#16A34A",
          foreground: "#FFFFFF",
          50: "#F0FDF4",
          100: "#DCFCE7",
          200: "#BBF7D0",
          300: "#86EFAC",
          400: "#4ADE80",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          800: "#166534",
          900: "#14532D"
        },
        secondary: {
          DEFAULT: "#0F172A",
          foreground: "#F8FAFC"
        },
        background: "#F8FAFC",
        surface: "#FFFFFF",
        foreground: "#1E293B",
        muted: {
          DEFAULT: "#64748B",
          foreground: "#F1F5F9"
        },
        danger: {
          DEFAULT: "#DC2626",
          foreground: "#FFFFFF"
        },
        warning: {
          DEFAULT: "#F59E0B",
          foreground: "#FFFFFF"
        },
        border: "#E2E8F0",
        ring: "#16A34A"
      },
      fontFamily: {
        sans: ["Cairo", "system-ui", "sans-serif"]
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem"
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
