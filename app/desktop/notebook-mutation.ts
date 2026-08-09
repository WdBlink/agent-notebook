import type { AgentWorkSession } from "../../src/types";
import type { DesktopNotebookState } from "./api";
import {
  normalizeNotebookDocument,
  notebookStateForDate,
  type NotebookDocument
} from "./notebook-store";

export interface NotebookMutationInput {
  current: NotebookDocument;
  logicalDate: string;
  viewSessions: AgentWorkSession[];
  operation(current: NotebookDocument): NotebookDocument;
  persist(next: NotebookDocument): Promise<void>;
  publish(next: NotebookDocument): void;
}

export async function commitNotebookMutation(input: NotebookMutationInput): Promise<DesktopNotebookState> {
  const next = normalizeNotebookDocument(input.operation(input.current));
  await input.persist(next);
  input.publish(next);
  return notebookStateForDate(next, input.logicalDate, input.viewSessions);
}
