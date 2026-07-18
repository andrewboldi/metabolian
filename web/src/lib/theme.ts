// Theme: dark (microscopy field) <-> light (cellular plate). Persisted, respects OS default.
const KEY = "metabolian-theme";
type Theme = "dark" | "light";

export function initTheme(): void {
  const saved = localStorage.getItem(KEY) as Theme | null;
  if (saved) document.documentElement.setAttribute("data-theme", saved);
}

export function toggleTheme(): Theme {
  const current =
    (document.documentElement.getAttribute("data-theme") as Theme | null) ??
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const next: Theme = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(KEY, next);
  return next;
}
