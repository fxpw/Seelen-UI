import { HideMode, WegAttentionReveal, WindowAttention } from "@seelen-ui/lib/types";
import { mousePos, virtualDesktops } from "./getters.svelte.ts";
import { settingsState } from "./settings.svelte.ts";
import { systemState } from "./system.svelte.ts";
import { windowsState } from "./windows.svelte.ts";
import { isThisWebviewFocused, isTouchPrimary } from "libs/ui/svelte/utils";
import { type DockBounds, isDockRevealPoint } from "../reveal.ts";

const isSwitchingWorkspace = $derived(virtualDesktops.value.switching);

/** a window shown on this dock asks for attention and the user wants to see it */
const isRevealedByAttention = $derived.by(() => {
  const reveal = settingsState.value.revealOnAttention;
  if (reveal === WegAttentionReveal.Never) return false;

  return windowsState.dockWindows.some((w) =>
    reveal === WegAttentionReveal.WhileFlashing
      ? w.attention === WindowAttention.Flashing
      : w.attention === WindowAttention.Highlighted
  );
});

let _hiddenByAutohide = $state(false);
let _isDraggingItem = $state(false);
let _isPointerOverDock = $state(false);
let _dockBounds = $state.raw<DockBounds | null>(null);
const isAtRevealEdge = $derived(isDockRevealPoint(
  mousePos.value,
  systemState.currentMonitor.rect,
  settingsState.widgetRect.hitboxRect,
  settingsState.position,
  _dockBounds,
));
// Cursor pass-through can delay DOM pointerenter until another movement arrives.
// Keep an already revealed dock open using its physical bounds as well.
const isOverVisibleDock = $derived(
  !_hiddenByAutohide && _dockBounds !== null &&
    mousePos.value.x >= _dockBounds.left && mousePos.value.x < _dockBounds.right &&
    mousePos.value.y >= _dockBounds.top && mousePos.value.y < _dockBounds.bottom,
);
const wantsReveal = $derived(
  !windowsState.topInteractableWindow?.isFullscreen &&
    (isAtRevealEdge || isOverVisibleDock || _isPointerOverDock || _isDraggingItem || isThisWebviewFocused.value),
);

export function setPointerOverDock(value: boolean): void {
  _isPointerOverDock = value;
}

export function setDockBounds(bounds: DockBounds | null): void {
  _dockBounds = bounds;
}

export const dockShouldBeHidden = {
  get value() {
    return _hiddenByAutohide;
  },
};

export function setDockIsDraggingItem(isDragging: boolean): void {
  _isDraggingItem = isDragging;
}

export const dockIsDragging = {
  get value() {
    return _isDraggingItem;
  },
};

$effect.root(() => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (isSwitchingWorkspace) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      return;
    }

    const { delayToHide, delayToShow, hideMode } = settingsState;

    let hidden = false;
    let flush = false;

    switch (hideMode) {
      case HideMode.Never:
        hidden = false;
        flush = true;
        break;
      case HideMode.Always:
        hidden = !isTouchPrimary.value && !wantsReveal;
        flush = isTouchPrimary.value;
        break;
      case HideMode.OnOverlap:
        hidden = !isTouchPrimary.value &&
          windowsState.isDockOverlapped &&
          !wantsReveal;
        flush = isTouchPrimary.value;
        break;
    }

    if (_isDraggingItem) {
      hidden = false;
      flush = true;
    }

    if (hidden && isRevealedByAttention) {
      hidden = false;
    }

    if (hidden) {
      timeout = setTimeout(() => {
        _hiddenByAutohide = true;
      }, delayToHide);
    } else {
      if (flush) {
        _hiddenByAutohide = false;
      } else {
        timeout = setTimeout(() => {
          _hiddenByAutohide = false;
        }, delayToShow);
      }
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
  });
});
