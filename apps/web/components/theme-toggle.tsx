"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): "dark" | "light" {
  try {
    return localStorage.getItem("block-insure-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function getServerSnapshot(): "dark" | "light" {
  return "dark";
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("block-insure-theme", nextTheme);
      const root = document.documentElement;
      if (nextTheme === "dark") {
        root.classList.add("dark");
        root.classList.remove("light");
        root.setAttribute("data-theme", "dark");
        root.style.colorScheme = "dark";
      } else {
        root.classList.remove("dark");
        root.classList.add("light");
        root.setAttribute("data-theme", "light");
        root.style.colorScheme = "light";
      }
      window.dispatchEvent(new Event("storage"));
    } catch {
      // Ignore storage errors in restricted sandboxes
    }
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className={`themeToggle ${className ?? ""}`.trim()}
      onClick={toggleTheme}
      aria-label={
        isDark
          ? "Switch to light mode (Norway Sage)"
          : "Switch to dark mode (Spruce Noir)"
      }
      title={
        isDark
          ? "Switch to light mode (Norway Sage)"
          : "Switch to dark mode (Spruce Noir)"
      }
    >
      {isDark ? (
        <svg
          aria-hidden="true"
          className="themeIcon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          className="themeIcon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
      <span className="themeLabel">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
