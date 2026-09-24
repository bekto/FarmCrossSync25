// Production folder picker for onboarding "Select Folder".
// Injected into the onboarding module so the flow stays testable with fakes;
// this is the only place the Tauri dialog plugin is touched.

import { open } from "@tauri-apps/plugin-dialog";

export async function pickFolder(): Promise<string | null> {
  const selection = await open({ directory: true, multiple: false });
  return typeof selection === "string" ? selection : null;
}
