import path from "node:path";
import type { SessionTranscriptRequest } from "./api";
import type { NotebookDocument } from "./notebook-store";
import { findTraceinkArtifact, type TraceinkAssetStoreDocumentV1 } from "./traceink-asset-store";
import type { AgentPlatform, AgentTranscriptCapture, AgentWorkSession } from "../../src/types";
import type { DailyReviewEvidence } from "../../src/workline-review";

export interface AuthorizedSessionTranscriptReference {
  id: string;
  platform: AgentPlatform;
  path: string;
  readPath: string;
  title: string;
  origin: "current-snapshot" | "sealed-package" | "traceink-asset";
  evidenceUpdatedAt?: string;
  transcriptCapture?: AgentTranscriptCapture;
}

export function authorizeSessionTranscriptRequest(
  request: SessionTranscriptRequest,
  currentSessions: AgentWorkSession[],
  document: NotebookDocument,
  traceinkAssets?: TraceinkAssetStoreDocumentV1
): AuthorizedSessionTranscriptReference {
  if (request?.packageRef && request?.traceinkRef) {
    throw new Error("一次会话读取不能同时使用旧证据包和 Traceink 证据授权。");
  }
  if (request?.traceinkRef) return authorizeTraceinkTranscript(request, traceinkAssets);
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

function authorizeTraceinkTranscript(
  request: SessionTranscriptRequest,
  document: TraceinkAssetStoreDocumentV1 | undefined
): AuthorizedSessionTranscriptReference {
  const traceinkRef = request.traceinkRef;
  if (!traceinkRef || !document) throw new Error("Traceink 证据资产尚未加载，拒绝读取。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(traceinkRef.logicalDate)) {
    throw new Error("Traceink 证据日期无效，拒绝读取。");
  }
  const artifact = findTraceinkArtifact(document, traceinkRef);
  if (!artifact || artifact.logicalDate !== traceinkRef.logicalDate) {
    throw new Error("找不到请求所指向的精确 Traceink 资产版本，拒绝读取。");
  }
  const evidence = artifact.evidence.find((candidate) => candidate.id === traceinkRef.evidenceId);
  if (!evidence) throw new Error("Traceink 资产中找不到指定证据，拒绝读取。");
  if (evidence.kind !== "session") throw new Error("只有 Traceink Session 证据可以在会话阅读器中重开。");
  if (
    evidence.sessionId !== request.id ||
    evidence.provider !== request.platform ||
    evidence.path !== request.path
  ) {
    throw new Error("请求的会话元组与 Traceink 证据不匹配，拒绝读取。");
  }
  if (!path.isAbsolute(evidence.path) || evidence.path.includes("\0")) {
    throw new Error("Traceink 会话证据路径无效，拒绝读取。");
  }
  const match = /^bytes 0-(\d+)$/.exec(evidence.locator);
  const byteLength = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error("Traceink 会话证据的冻结范围无效，拒绝读取。");
  }
  if (!evidence.contentHash || !/^[a-f0-9]{64}$/.test(evidence.contentHash)) {
    throw new Error("Traceink 会话证据缺少有效的 SHA-256，拒绝读取。");
  }
  const transcriptCapture: AgentTranscriptCapture = {
    canonicalPath: evidence.path,
    sha256: evidence.contentHash,
    byteLength,
    coverage: { startByte: 0, endByte: byteLength }
  };
  return {
    id: evidence.sessionId,
    platform: evidence.provider,
    path: evidence.path,
    readPath: evidence.path,
    title: evidence.sessionId,
    origin: "traceink-asset",
    transcriptCapture
  };
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
