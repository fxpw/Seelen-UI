<script lang="ts">
  import { invoke, SeelenCommand } from "@seelen-ui/lib";
  import { FileIcon, Icon, SpecificIcon } from "libs/ui/svelte/components/Icon/index.ts";
  import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
  import { t } from "../../i18n/index.ts";
  import type { MediaWegItem } from "../../types.ts";
  import type { WidgetId } from "@seelen-ui/lib/types";
  import { settingsState } from "../../state/settings.svelte.ts";
  import { getMenuForItem } from "../../generalMenu.ts";
  import { players } from "../../state/getters.svelte.ts";
  import { triggerWidget } from "../../pluginEval.svelte.ts";

  interface Props {
    item: MediaWegItem;
  }
  let { item }: Props = $props();

  const session = $derived(players.value.find((s) => s.default));
  const thumbnailSrc = $derived(session?.thumbnail ? convertFileSrc(session.thumbnail) : null);
  const tooltip = $derived(session ? `${session.title} - ${session.author}` : $t("media.not_playing"));
  const controls = $derived([
    { command: "media_prev", icon: "IoPlaySkipBack", label: $t("media.previous_track") },
    {
      command: "media_toggle_play_pause",
      icon: session?.playing ? "IoPause" : "IoPlay",
      label: $t(session?.playing ? "media.pause" : "media.play"),
    },
    { command: "media_next", icon: "IoPlaySkipForward", label: $t("media.next_track") },
  ] as const);

  function onContextMenu(e: MouseEvent) {
    e.stopPropagation();
    invoke(SeelenCommand.TriggerContextMenu, {
      menu: { ...getMenuForItem($t, item), alignX: settingsState.popupAlignX, alignY: settingsState.popupAlignY },
      forwardTo: null,
      toggleSource: null,
    });
  }

  function onClickBtn(cmd: string) {
    if (session) tauriInvoke(cmd, { id: session.umid }).catch(console.error);
  }
</script>

<div class="media-session-container" role="group" aria-label={$t("media.label")} oncontextmenu={onContextMenu}>
  <div class="weg-media-slot" data-dock-media-slot data-item-kind="Media">
    <div class="weg-item-overlay">
      <button
        id={`${item.id}-cover`}
        class="weg-item weg-media-button weg-media-cover"
        data-skin="transparent"
        aria-label={$t("media.label")}
        data-tooltip={tooltip}
        data-tooltip-origin-y={settingsState.tooltipOrigin.y}
        data-tooltip-origin-x={settingsState.tooltipOrigin.x}
        data-tooltip-align-x={settingsState.popupAlignX}
        data-tooltip-align-y={settingsState.popupAlignY}
        onclick={() => triggerWidget("@seelen/media-popup" as WidgetId, `${item.id}-cover`)}
      >
        {#if thumbnailSrc}
          <img class="media-session-thumbnail" src={thumbnailSrc} loading="lazy" alt="" draggable="false" />
        {:else}
          <SpecificIcon class="media-session-thumbnail" name="defaultPlayerThumbnail" />
        {/if}
        {#if session}
          <FileIcon class="media-session-app-icon" umid={session.umid} />
        {/if}
      </button>
    </div>
  </div>
  {#each controls as control (control.command)}
    <div class="weg-media-slot" data-dock-media-slot data-item-kind="Media">
      <div class="weg-item-overlay">
        <button
          class="weg-item weg-media-button"
          data-skin="transparent"
          aria-label={control.label}
          data-tooltip={control.label}
          data-tooltip-origin-y={settingsState.tooltipOrigin.y}
          data-tooltip-origin-x={settingsState.tooltipOrigin.x}
          data-tooltip-align-x={settingsState.popupAlignX}
          data-tooltip-align-y={settingsState.popupAlignY}
          disabled={!session}
          onclick={() => onClickBtn(control.command)}
        >
          <Icon class="weg-item-icon" iconName={control.icon} />
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  .media-session-container {
    display: flex;
    align-items: center;
    gap: var(--config-space-between-items);
    :global(.vertical) & {
      flex-direction: column;
    }
  }
  .weg-media-slot {
    position: relative;
    flex-shrink: 0;
    width: var(--config-item-size);
    height: var(--config-item-size);
  }
</style>
