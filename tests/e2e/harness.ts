import { renderCockpit } from "../../src/render";
import { archiveItem, captureItem, completeItem, createSeedData, moveItem, setLastExportPath } from "../../src/state";
import type { CockpitData, RendererState } from "../../src/types";

let data: CockpitData = createSeedData();
let state: RendererState = {
  data,
  activeSection: "today",
  loading: false
};

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #root");
}

const controller = renderCockpit(root, state, {
  async capture(input) {
    const result = captureItem(data, input, "2026-07-02T12:00:00.000Z");
    if (result.ok) {
      data = result.data;
      update({ data, activeSection: "inbox", loading: false });
    } else {
      update({ ...state, error: result.error });
    }
    return result;
  },
  async move(id, target) {
    const result = moveItem(data, id, target, "2026-07-02T12:05:00.000Z");
    if (result.ok) {
      data = result.data;
      update({ data, activeSection: target, loading: false });
    } else {
      update({ ...state, error: result.error });
    }
    return result;
  },
  async complete(id) {
    const result = completeItem(data, id, "2026-07-02T12:10:00.000Z");
    if (result.ok) {
      data = result.data;
      update({ data, activeSection: "done", loading: false });
    }
    return result;
  },
  async archive(id) {
    const result = archiveItem(data, id, "2026-07-02T12:15:00.000Z");
    if (result.ok) {
      data = result.data;
      update({ data, activeSection: "archive", loading: false });
    }
    return result;
  },
  async exportDailyNote() {
    const path = "Daily Cockpit/2026-07-02.md";
    data = setLastExportPath(data, path);
    update({ data, activeSection: "export", loading: false, exportPath: path });
    return { ok: true, data: { path: "Daily Cockpit/2026-07-02.md" } };
  },
  clearError() {
    const { error: _error, ...withoutError } = state;
    update(withoutError);
  }
});

function update(next: RendererState): void {
  state = next;
  controller.update(state);
}
