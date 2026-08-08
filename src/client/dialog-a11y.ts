import { useEffect, useRef, type RefObject } from "react";

const dialogFocusable = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Gives a mounted dialog initial focus, a contained Tab order, Escape handling,
 * scroll locking, and focus restoration. The active flag supports dialogs that
 * are rendered conditionally inside a long-lived page component.
 */
export function useDialogA11y<T extends HTMLElement>(
  onClose: () => void,
  active = true,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = returnFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")
      ?? dialog.querySelector<HTMLElement>(dialogFocusable)
      ?? dialog;
    if (!dialog.contains(document.activeElement)) initialFocus.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(dialogFocusable)]
        .filter((element) => element.getAttribute("aria-hidden") !== "true" && !element.closest("[inert]"));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, returnFocusRef]);

  return dialogRef;
}
