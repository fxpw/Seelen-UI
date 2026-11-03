import { invoke, SeelenCommand, Widget } from "@seelen-ui/lib";
import type { ContextMenuCallbackPayload } from "@seelen-ui/lib/types";
import { join, resourceDir } from "@tauri-apps/api/path";
import { settingsState } from "./state/settings.svelte.ts";

const callbackEvent = "fxpw::wsl-action";
const identifier = crypto.randomUUID();
const actions = ["start", "restart", "stop"] as const;

Widget.self.webview.listen<ContextMenuCallbackPayload>(callbackEvent, async ({ payload }) => {
  if (!actions.some((action) => action === payload.key)) return;
  const program = await join(await resourceDir(), "static", "tools", "wsl", "WslControl.exe");
  await invoke(SeelenCommand.Run, { program, args: [payload.key], workingDir: null, elevated: false });
});

export async function showWslMenu(t: (key: string) => string): Promise<void> {
  await invoke(SeelenCommand.TriggerContextMenu, {
    menu: {
      identifier,
      alignY: settingsState.popupAlignY,
      items: actions.map((action, index) => ({
        type: "Item" as const,
        key: action,
        label: t(`wsl.${action}`),
        icon: ["IoPlay", "VscDebugRestart", "IoPower"][index]!,
        callbackEvent,
      })),
    },
    forwardTo: null,
  });
}
