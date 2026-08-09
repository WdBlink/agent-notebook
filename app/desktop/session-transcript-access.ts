import type { SessionTranscriptRequest } from "./api";
import type { NotebookDocument } from "./notebook-store";
import type { AgentPlatform, AgentTranscriptCapture, AgentWorkSession } from "../../src/types";
import type { DailyReviewEvidence } from "../../src/workline-review";

export interface AuthorizedSessionTranscriptReference {
  id: string;
  platform: AgentPlatform;
  path: string;
  readPath: string;
  title: string;
  origin: "current-snapshot" | "sealed-package";
  evidenceUpdatedAt?: string;
  transcriptCapture?: AgentTranscriptCapture;
}

export function authorizeSessionTranscriptRequest(
  request: SessionTranscriptRequest,
  currentSessions: AgentWorkSession[],
  document: NotebookDocument
): AuthorizedSessionTranscriptReference {
  const packageRef = request?.packageRef;
  if (!packageRef) {
    const current = currentSessions.find((session) =>
      session.id === request?.id && session.platform === request?.platform && session.path === request?.path
    );
    if (current) return pickReference(current);
    throw new Error("这条会话不在当前只读快照中，也没有封存证据授权。");
  }
  const page = document.pages[packageRef.logicalDate];
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
  if (evidence.transcriptCapture && evidence.transcriptCapture.canonicalPath !== evidence.path) {
    throw new Error("封存证据的 canonical path 与会话元组不匹配，拒绝读取。");
  }
  if (evidence.transcriptCapture) return pickPackageReference(evidence);
  if (page.status !== "sealed") {
    const current = currentSessions.find((session) =>
      session.id === evidence.sessionId && session.platform === evidence.platform && session.path === evidence.path
    );
    if (!current) throw new Error("指定日期尚未封页，不能用工作包回开历史会话。");
    return pickReference(current);
  }
  return pickPackageReference(evidence);
}

function pickPackageReference(evidence: DailyReviewEvidence): AuthorizedSessionTranscriptReference {
  return {
    id: evidence.sessionId,
    platform: evidence.platform,
    path: evidence.path,
    readPath: evidence.transcriptCapture?.canonicalPath ?? evidence.path,
    title: evidence.label,
    origin: "sealed-package",
    ...(evidence.transcriptCapture
      ? { transcriptCapture: structuredClone(evidence.transcriptCapture) }
      : evidence.updatedAt ? { evidenceUpdatedAt: evidence.updatedAt } : {})
  };
}

function pickReference(session: AgentWorkSession): AuthorizedSessionTranscriptReference {
  return {
    id: session.id,
    platform: session.platform,
    path: session.path,
    readPath: session.transcriptCapture?.canonicalPath ?? session.path,
    title: session.title,
    origin: "current-snapshot",
    ...(session.transcriptCapture ? { transcriptCapture: structuredClone(session.transcriptCapture) } : {})
  };
}
