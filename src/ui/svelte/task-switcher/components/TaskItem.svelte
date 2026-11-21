<script lang="ts">
  import type { UserAppWindow } from "@seelen-ui/lib/types";
  import { invoke, SeelenCommand } from "@seelen-ui/lib";
  import { globalState } from "../state/index.svelte.ts";
  import { FileIcon, Icon } from "libs/ui/svelte/components/Icon";
  import MissingIcon from "libs/ui/svelte/components/Icon/MissingIcon.svelte";

  interface Props {
    task: UserAppWindow;
  }

  let { task }: Props = $props();

  let boxRef: HTMLDivElement | undefined = $state();
  const isSelected = $derived(task.hwnd === globalState.selectedWindow);
  const preview = $derived(globalState.previews[task.hwnd]);
  let terminating = $state(false);

  // Focus button when selected
  $effect(() => {
    if (isSelected && boxRef) {
      boxRef.focus({ preventScroll: true });
      const panel = boxRef.closest<HTMLElement>(".task-switcher");
      if (panel) {
        const taskRect = boxRef.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const scale = panel.clientHeight > 0 ? panelRect.height / panel.clientHeight : 1;
        if (taskRect.top < panelRect.top) panel.scrollTop -= (panelRect.top - taskRect.top) / scale;
        if (taskRect.bottom > panelRect.bottom) panel.scrollTop += (taskRect.bottom - panelRect.bottom) / scale;
      }
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    // Handle Enter key to activate the window
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      boxRef?.click();
      return;
    }

    // Handle navigation keys
    const isNavigationKey = e.key === "Tab" || e.key === "ArrowRight" || e.key === "ArrowLeft";

    if (isNavigationKey) {
      e.preventDefault();

      const direction =
        e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey) ? "previous" : "next";

      globalState.navigate(direction, task.hwnd);
    }
  }

  function handleClick() {
    globalState.showing = false;
    invoke(SeelenCommand.WegToggleWindowState, {
      hwnd: task.hwnd,
      wasFocused: false,
    });
  }

  function handleFocus() {
    globalState.selectedWindow = task.hwnd;
  }

  async function handleAuxClick(e: MouseEvent) {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    if (terminating) return;
    terminating = true;
    try {
      await invoke(SeelenCommand.WegKillApp, { hwnd: task.hwnd });
      // Alt release must not try to activate a window from the terminating process.
      const selected = globalState.windows.find((win) => win.hwnd === globalState.selectedWindow);
      if (selected?.process.id === task.process.id) {
        globalState.selectedWindow = globalState.windows.find((win) => win.process.id !== task.process.id)?.hwnd ?? null;
      }
    } catch (error) {
      console.error("Failed to terminate selected application:", error);
    } finally {
      terminating = false;
    }
  }

</script>

<div
  bind:this={boxRef}
  class="task"
  data-selected={isSelected}
  role="button"
  tabindex="0"
  onkeydown={handleKeyDown}
  onclick={handleClick}
  onauxclick={handleAuxClick}
  onpointerdown={(e) => { if (e.button === 1) e.preventDefault(); }}
  onfocus={handleFocus}
>
  <div class="task-header">
    <FileIcon class="task-icon" path={task.relaunch?.icon || task.process.path} umid={task.umid} />
    <div class="task-title">{task.title}</div>
    <button
      data-skin="transparent"
      onclick={(e) => {
        e.stopPropagation();
        invoke(SeelenCommand.WegCloseApp, { hwnd: task.hwnd });
      }}
    >
      <Icon iconName="TbX" />
    </button>
  </div>
  <div class="task-preview-container">
    {#if preview}
      <img class="task-preview" src={`data:image/webp;base64,${preview.data}`} alt="" />
    {:else}
      <MissingIcon class="task-no-preview" />
    {/if}
  </div>
</div>
