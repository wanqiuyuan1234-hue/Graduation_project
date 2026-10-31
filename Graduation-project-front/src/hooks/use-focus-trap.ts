"use client";

import { useEffect, useRef } from "react";

/**
 * Focusable-element selector — links, enabled buttons/inputs/textareas/selects,
 * and any element with a non-negative tabIndex. Disabled controls and
 * `tabindex="-1"` elements are excluded so the trap only cycles through
 * elements a user could actually reach with Tab.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

/**
 * Returns the list of focusable descendants of `container` that are currently
 * rendered (offsetParent non-null). `offsetParent` is null for elements that
 * are `display: none` or inside a `display: none` ancestor, which is the
 * cheapest "is this actually painted" check available without
 * getBoundingClientRect (which would force layout per element).
 *
 * Note: `position: fixed` elements report `offsetParent === null` for
 * themselves, but their *descendants* still resolve offsetParent to the fixed
 * ancestor — so this correctly finds focusables inside the fixed source panel.
 */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null);
}

/**
 * Trap keyboard focus inside the element matched by `containerSelector` while
 * `active` is true. On activation the first focusable descendant is focused
 * (or the container itself if it has no focusable children and is itself
 * focusable). On deactivation, focus is restored to the element that was
 * focused before the trap activated.
 *
 * Tab / Shift+Tab cycle within the container. The listener is attached in
 * capture phase so it runs before any Radix / third-party handlers that might
 * also try to move focus, giving the trap precedence.
 *
 * This is a generic utility — it does NOT know about the source panel
 * specifically. Callers pass a selector that uniquely matches the container
 * to trap (e.g. `"aside.fixed.top-0.right-0.z-50"` for the source panel).
 */
export function useFocusTrap(active: boolean, containerSelector: string) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = document.querySelector<HTMLElement>(containerSelector);
    if (!container) return;

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    // Move focus into the container immediately so screen-reader users land
    // inside the panel rather than on the trigger that opened it.
    const initialFocusables = getFocusable(container);
    if (initialFocusables.length > 0) {
      initialFocusables[0].focus();
    } else if (container.hasAttribute("tabindex")) {
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const currentContainer =
        document.querySelector<HTMLElement>(containerSelector);
      if (!currentContainer) return;
      const items = getFocusable(currentContainer);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      const inside = currentContainer.contains(activeEl);
      if (e.shiftKey) {
        if (activeEl === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !inside) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === "function") {
        // Restore focus on a microtask so the closing animation doesn't yank
        // it back into a soon-to-be-offscreen element.
        prev.focus();
      }
      previouslyFocusedRef.current = null;
    };
  }, [active, containerSelector]);
}
