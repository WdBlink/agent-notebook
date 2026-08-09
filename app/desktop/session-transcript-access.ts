import type { SessionTranscriptRequest } from "./api";
import type { NotebookDocument } from "./notebook-store";
import type { AgentPlatform, AgentWorkSession } from "../../src/types";

export interface AuthorizedSessionTranscriptReference {
  id: string;
  platform: AgentPlatform;
  path: string;
  title: string;
  origin: "current-snapshot" | "sealed-package";
  evidenceUpdatedAt?: string;
}

export function authorizeSessionTranscriptRequest(
  request: SessionTranscriptRequest,
  currentSessions: AgentWorkSession[],
  document: NotebookDocument
): AuthorizedSessionTranscriptReference {
  const current = currentSessions.find((session) =>
    session.id === request?.id && session.platform === request?.platform && session.path === request?.path
  );
  if (current) return pickReference(current);

  const packageRef = request?.packageRef;
  if (!packageRef) throw new Error("这条会话不在当前只读快照中，也没有封存证据授权。");
  const page = document.pages[packageRef.logicalDate];
  if (!page || page.status !== "sealed") {
    throw new Error("指定日期尚未封页，不能用工作包回开历史会话。");
  }
  if (!page || page.activePackageGenerationId !== packageRef.generationId) {
    throw new Error("指定的证据包不是当前封存证据包，拒绝读取。");
  }
  const generation = page.packageGenerations?.find((candidate) => candidate.id === packageRef.generationId);
  if (!generation) throw new Error("指定的证据包不是当前封存证据包，拒绝读取。");
  const evidence = generation.package.evidence.find((candidate) =>
    candidate.id === packageRef.evidenceId && candidate.kind === "session"
  );
  if (!evidence) throw new Error("封存证据包中没有找到这条会话证据。");
  if (evidence.sessionId !== request.id || evidence.platform !== request.platform || evidence.path !== request.path) {
    throw new Error("请求的会话元组与封存证据不匹配，拒绝读取。");
  }
  return {
    id: evidence.sessionId,
    platform: evidence.platform,
    path: evidence.path,
    title: evidence.label,
    origin: "sealed-package",
    ...(evidence.updatedAt ? { evidenceUpdatedAt: evidence.updatedAt } : {})
  };
}

function pickReference(session: AgentWorkSession): AuthorizedSessionTranscriptReference {
  return { id: session.id, platform: session.platform, path: session.path, title: session.title, origin: "current-snapshot" };
}
