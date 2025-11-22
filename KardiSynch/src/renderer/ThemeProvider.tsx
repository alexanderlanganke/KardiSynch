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

    console.log('Applying theme:', theme);
    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      console.log('System theme detected:', systemTheme);
      root.classList.add(systemTheme)
      return
    }

    console.log('Adding class:', theme);
    root.classList.add(theme)
  }, [theme])

  useEffect(() => {
    const syncTheme = async () => {
      try {
        // Only sync from backend if there's no local preference
        const localTheme = localStorage.getItem(storageKey);
        console.log('Local theme preference:', localTheme);

        if (!localTheme) {
          const settings = await window.electronAPI.getSettings();
          console.log('Backend settings:', settings);
          if (settings && settings.theme) {
            console.log('Syncing theme from backend:', settings.theme);
            setTheme(settings.theme);
          }
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
      console.log('Setting theme to:', newTheme);
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
