import type { CSSProperties } from "react";

/**
 * The admin app is dark-themed but the shared DialogContent forces a white
 * surface. Pages opt back into the theme tokens (same surface as
 * AlertDialogContent) so dialogs match the rest of the Admin UI.
 *
 * The shared DialogContent/DialogTitle force light colours BOTH via classes
 * and via INLINE styles (which beat any class). They spread `props.style`
 * last, so these call-site overrides restore the theme tokens without
 * touching the shared components (which other apps may rely on).
 * Inputs/textareas/selects are already theme-forced globally in index.css
 * with !important, which outranks their inline styles.
 */
export const DARK_DIALOG_CLASS = "bg-background text-foreground border-border";

export const DARK_DIALOG_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
};

export const DARK_TITLE_STYLE: CSSProperties = {
  color: "hsl(var(--foreground))",
};
