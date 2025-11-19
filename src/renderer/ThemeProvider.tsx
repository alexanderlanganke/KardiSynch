import { createContext, useContext, useEffect, useState } from "react"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: "system" | "light" | "dark"
  storageKey?: string
}

type ThemeProviderState = {
  theme: "system" | "light" | "dark"
  setTheme: (theme: "system" | "light" | "dark") => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<"system" | "light" | "dark">(
    () => (localStorage.getItem(storageKey) as "system" | "light" | "dark") || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  useEffect(() => {
    const syncTheme = async () => {
      try {
        const settings = await window.electronAPI.getSettings();
        if (settings && settings.theme && settings.theme !== theme) {
          setTheme(settings.theme);
        }
      } catch (error) {
        console.error("Failed to sync theme from backend:", error);
      }
    };
    syncTheme();
  }, []);

  const value = {
    theme,
    setTheme: (newTheme: "system" | "light" | "dark") => {
      localStorage.setItem(storageKey, newTheme);
      setTheme(newTheme);
      window.electronAPI.setSettings({ theme: newTheme }).catch(err =>
        console.error("Failed to save theme to backend:", err)
      );
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
