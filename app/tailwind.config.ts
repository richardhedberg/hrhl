import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./client/index.html",
    "./client/src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        heading: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        background: "#070707",
        foreground: "#f7f7f7",
        muted: {
          DEFAULT: "#6b7280",
          foreground: "#9ca3af"
        },
        card: {
          DEFAULT: "#0f0f0f",
          foreground: "#f7f7f7"
        },
        border: "#1f1f1f",
        accent: {
          DEFAULT: "#111111",
          foreground: "#f7f7f7"
        }
      },
      borderRadius: {
        xl: "1rem",
      }
    },
    fontSize: {
      ...defaultTheme.fontSize,
      "3xl": ["clamp(32px, 4vw, 128px)", { lineHeight: "1.1" }],
    },
  },
  plugins: [animate]
};

export default config;
