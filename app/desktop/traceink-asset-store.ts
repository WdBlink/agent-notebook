import { isDeepStrictEqual } from "node:util";
import {
  isTraceinkLogicalDate,
  normalizeTraceinkArtifactReferenceV1,
  normalizeTraceinkArtifactV1,
  normalizeUserReflectionAssetV1,
  sha256TraceinkText,
  traceinkArtifactReference,
  type TraceinkArtifactReferenceV1,
  type TraceinkArtifactV1,
  type TraceinkDossierArtifactDraftV1,
  type TraceinkDossierArtifactV1,
  type TraceinkIndexArtifactDraftV1,
  type TraceinkIndexArtifactV1,
  type TraceinkProposalNavigationItemV1,
  type UserReflectionAssetV1
} from "../../src/traceink-review-assets";

export type TraceinkIndexArtifactReferenceV1 = TraceinkArtifactReferenceV1 & { stage: "index" };

export interface TraceinkAssetStoreDocumentV1 {
  schemaVersion: 1;
  artifacts: TraceinkArtifactV1[];
  reflections: UserReflectionAssetV1[];
  activeIndexByDate: Record<string, TraceinkIndexArtifactReferenceV1>;
}

export type TraceinkAssetStoreDocument = TraceinkAssetStoreDocumentV1;

export function createEmptyTraceinkAssetStore(): TraceinkAssetStoreDocumentV1 {
  return { schemaVersion: 1, artifacts: [], reflections: [], activeIndexByDate: {} };
}

export const createEmptyTraceinkAssetStoreDocument = createEmptyTraceinkAssetStore;

/**
 * Normalizes one standalone local asset document. Invalid provenance and exact
 * revision references are not admitted. Valid unrelated revisions survive.
 */
export function normalizeTraceinkAssetStore(value: unknown): TraceinkAssetStoreDocumentV1 {
  const raw = asRecord(value);
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.artifacts)) {
    return createEmptyTraceinkAssetStore();
  }

  const artifacts = stableArtifactLineages(
    uniqueArtifacts(raw.artifacts.map(normalizeTraceinkArtifactV1).filter(isPresent))
  );
  const artifactByReference = new Map(artifacts.map((artifact) => [referenceKey(traceinkArtifactReference(artifact)), artifact]));
  const reflections = stableReflectionLineages(uniqueReflections(
    (Array.isArray(raw.reflections) ? raw.reflections : [])
      .map(normalizeUserReflectionAssetV1)
      .filter(isPresent)
      .filter((reflection) => reflectionDossierResolves(reflection, artifactByReference))
  ));
  const reflectionByReference = new Map(reflections.map((reflection) => [reflectionReferenceKey({
    reflectionId: reflection.id,
    revision: reflection.revision,
    contentHash: reflection.contentHash
  }), reflection]));
  const resolvedArtifacts = artifacts.flatMap((artifact): TraceinkArtifactV1[] => {
    if (!artifact.sourceReflection) return [artifact];
    const reflection = reflectionByReference.get(reflectionReferenceKey(artifact.sourceReflection));
    if (
      !reflection ||
      reflection.logicalDate !== artifact.logicalDate ||
      reflection.worklineId !== artifact.worklineId
    ) return [];
    return [blockInvalidProposalSourceQuotes(artifact, reflection)];
  });
  const resolvedArtifactByReference = new Map(
    resolvedArtifacts.map((artifact) => [referenceKey(traceinkArtifactReference(artifact)), artifact])
  );
  const activeIndexByDate = normalizeActiveIndexes(raw.activeIndexByDate, resolvedArtifactByReference);

  return {
    schemaVersion: 1,
    artifacts: resolvedArtifacts,
    reflections,
    activeIndexByDate
  };
}

export const normalizeTraceinkAssetStoreDocument = normalizeTraceinkAssetStore;

export function loadTraceinkAssetStore(serialized: string): TraceinkAssetStoreDocumentV1 {
  try {
    return normalizeTraceinkAssetStore(JSON.parse(serialized) as unknown);
  } catch {
    return createEmptyTraceinkAssetStore();
  }
}

export const loadTraceinkAssetStoreDocument = loadTraceinkAssetStore;

/**
 * Appends the immutable index revision and moves only that date's active
 * pointer. The input document is never mutated, including when validation
 * fails before the append can be materialized.
 */
export function appendTraceinkIndexRevision(
  document: TraceinkAssetStoreDocumentV1,
  draft: TraceinkIndexArtifactDraftV1,
  expectedActiveIndex?: TraceinkIndexArtifactReferenceV1 | null
): TraceinkAssetStoreDocumentV1 {
  if (!isCanonicalStoreEnvelope(document)) throw new Error("Traceink asset store document is invalid.");
  const current = normalizeTraceinkAssetStore(document);
  if (!isDeepStrictEqual(current, document)) {
    throw new Error("Traceink asset store document failed integrity validation.");
  }
  if (!isTraceinkLogicalDate(draft.logicalDate) || draft.schemaVersion !== 1 || draft.stage !== "index") {
    throw new Error("Traceink index draft identity is invalid.");
  }
  if (hasOwn(draft, "id") || hasOwn(draft, "revision") || hasOwn(draft, "outputHash")) {
    throw new Error("Traceink index identity, revision, and output hash are store-owned.");
  }
  if (hasOwn(draft, "worklineId") || hasOwn(draft, "sourceReflection")) {
    throw new Error("Traceink index drafts cannot reference a workline or reflection.");
  }

  const active = activeIndexReferenceForDate(current, draft.logicalDate);
  if (expectedActiveIndex !== undefined && !sameOptionalIndexReference(active, expectedActiveIndex)) {
    throw new Error("Traceink active index changed before this revision could be appended.");
  }
  const artifactId = active?.artifactId ?? traceinkIndexArtifactId(draft.logicalDate);
  const previousRevisions = current.artifacts
    .filter((artifact) => artifact.id === artifactId && artifact.stage === "index")
    .map((artifact) => artifact.revision);
  const revision = (previousRevisions.length > 0 ? Math.max(...previousRevisions) : 0) + 1;
  const materialized = normalizeTraceinkArtifactV1({
    ...draft,
    id: artifactId,
    stage: "index",
    revision,
    outputHash: sha256TraceinkText(draft.rawMarkdown)
  });
  if (!materialized || materialized.stage !== "index" || materialized.worklineId || materialized.sourceReflection) {
    throw new Error("Traceink index draft failed integrity validation.");
  }
  const {
    worklineId: _worklineId,
    sourceReflection: _sourceReflection,
    ...indexFields
  } = materialized;
  const artifact: TraceinkIndexArtifactV1 = {
    ...indexFields,
    stage: "index"
  };
  const reference: TraceinkIndexArtifactReferenceV1 = {
    ...traceinkArtifactReference(artifact),
    stage: "index"
  };
  return {
    schemaVersion: 1,
    artifacts: [...current.artifacts, artifact],
    reflections: current.reflections,
    activeIndexByDate: {
      ...current.activeIndexByDate,
      [artifact.logicalDate]: reference
    }
  };
}

export function appendTraceinkDossierRevision(
  document: TraceinkAssetStoreDocumentV1,
  draft: TraceinkDossierArtifactDraftV1,
  expectedActiveIndex: TraceinkIndexArtifactReferenceV1
): TraceinkAssetStoreDocumentV1 {
  const current = canonicalStore(document);
  const active = activeIndexReferenceForDate(current, draft.logicalDate);
  if (!active || !sameIndexReference(active, expectedActiveIndex)) {
    throw new Error("Traceink active index changed before this dossier could be appended.");
  }
  if (draft.schemaVersion !== 1 || draft.stage !== "dossier" || !draft.worklineId || hasOwn(draft, "sourceReflection")) {
    throw new Error("Traceink dossier draft identity is invalid.");
  }
  if (hasOwn(draft, "id") || hasOwn(draft, "revision") || hasOwn(draft, "outputHash")) {
    throw new Error("Traceink dossier identity, revision, and output hash are store-owned.");
  }
  const artifactId = traceinkDossierArtifactId(active, draft.worklineId);
  const revision = 1 + Math.max(0, ...current.artifacts
    .filter((artifact) => artifact.id === artifactId && artifact.stage === "dossier")
    .map((artifact) => artifact.revision));
  const artifact = normalizeTraceinkArtifactV1({
    ...draft,
    id: artifactId,
    revision,
    outputHash: sha256TraceinkText(draft.rawMarkdown)
  });
  if (!artifact || artifact.stage !== "dossier" || artifact.sourceReflection) {
    throw new Error("Traceink dossier draft failed integrity validation.");
  }
  return { ...current, artifacts: [...current.artifacts, artifact] };
}

export function latestTraceinkDossier(
  document: TraceinkAssetStoreDocumentV1,
  index: TraceinkIndexArtifactReferenceV1,
  worklineId: string
): TraceinkDossierArtifactV1 | undefined {
  const id = traceinkDossierArtifactId(index, worklineId);
  const candidates = document.artifacts
    .filter((artifact) => artifact.id === id && artifact.stage === "dossier" && artifact.worklineId === worklineId)
    .sort((left, right) => right.revision - left.revision);
  const artifact = candidates[0] ? normalizeTraceinkArtifactV1(candidates[0]) : undefined;
  if (artifact?.stage !== "dossier" || !artifact.worklineId || artifact.sourceReflection) return undefined;
  const { sourceReflection: _sourceReflection, ...fields } = artifact;
  return { ...fields, stage: "dossier", worklineId: artifact.worklineId };
}

export function appendTraceinkReflectionRevision(
  document: TraceinkAssetStoreDocumentV1,
  dossierReference: TraceinkArtifactReferenceV1 & { stage: "dossier" },
  text: string,
  savedAt: string
): TraceinkAssetStoreDocumentV1 {
  const current = canonicalStore(document);
  const dossier = findTraceinkArtifact(current, dossierReference);
  if (!dossier || dossier.stage !== "dossier" || !dossier.worklineId || typeof text !== "string" || !text.trim()) {
    throw new Error("Traceink reflection must belong to an exact dossier and contain the user's text.");
  }
  if (!Number.isFinite(Date.parse(savedAt))) throw new Error("Traceink reflection save time is invalid.");
  const id = `traceink-reflection-${sha256TraceinkText(`${dossier.id}\0${dossier.revision}\0${dossier.outputHash}`).slice(0, 24)}`;
  const previous = current.reflections.filter((reflection) => reflection.id === id);
  const revision = 1 + Math.max(0, ...previous.map((reflection) => reflection.revision));
  const createdAt = previous.sort((left, right) => left.revision - right.revision)[0]?.createdAt ?? savedAt;
  const reflection = normalizeUserReflectionAssetV1({
    schemaVersion: 1,
    id,
    logicalDate: dossier.logicalDate,
    worklineId: dossier.worklineId,
    dossier: { ...dossierReference, stage: "dossier" },
    revision,
    text,
    createdAt,
    savedAt,
    contentHash: sha256TraceinkText(text)
  });
  if (!reflection) throw new Error("Traceink reflection failed integrity validation.");
  return { ...current, reflections: [...current.reflections, reflection] };
}

export function latestTraceinkReflection(
  document: TraceinkAssetStoreDocumentV1,
  dossier: TraceinkDossierArtifactV1
): UserReflectionAssetV1 | undefined {
  return document.reflections
    .filter((reflection) => reflection.worklineId === dossier.worklineId &&
      reflection.dossier.artifactId === dossier.id &&
      reflection.dossier.revision === dossier.revision &&
      reflection.dossier.outputHash === dossier.outputHash)
    .sort((left, right) => right.revision - left.revision)[0];
}

export function activeIndexReferenceForDate(
  document: TraceinkAssetStoreDocumentV1,
  logicalDate: string
): TraceinkIndexArtifactReferenceV1 | undefined {
  if (!isTraceinkLogicalDate(logicalDate)) return undefined;
  const reference = normalizeTraceinkArtifactReferenceV1(document.activeIndexByDate[logicalDate]);
  if (!reference || reference.stage !== "index") return undefined;
  const artifact = validatedArtifactForReference(document, reference);
  if (!artifact || artifact.logicalDate !== logicalDate || artifact.stage !== "index") return undefined;
  return { ...reference, stage: "index" };
}

export function findTraceinkArtifact(
  document: TraceinkAssetStoreDocumentV1,
  reference: TraceinkArtifactReferenceV1
): TraceinkArtifactV1 | undefined {
  const normalizedReference = normalizeTraceinkArtifactReferenceV1(reference);
  if (!normalizedReference) return undefined;
  return validatedArtifactForReference(document, normalizedReference);
}

export function traceinkIndexArtifactId(logicalDate: string): string {
  if (!isTraceinkLogicalDate(logicalDate)) throw new Error("Traceink index logical date is invalid.");
  return `traceink-index-${logicalDate}`;
}

export function traceinkDossierArtifactId(index: TraceinkIndexArtifactReferenceV1, worklineId: string): string {
  const normalized = normalizeTraceinkArtifactReferenceV1(index);
  if (!normalized || normalized.stage !== "index" || !worklineId.trim()) {
    throw new Error("Traceink dossier source identity is invalid.");
  }
  return `traceink-dossier-${sha256TraceinkText(`${normalized.artifactId}\0${normalized.revision}\0${normalized.outputHash}\0${worklineId}`).slice(0, 32)}`;
}

function canonicalStore(document: TraceinkAssetStoreDocumentV1): TraceinkAssetStoreDocumentV1 {
  if (!isCanonicalStoreEnvelope(document)) throw new Error("Traceink asset store document is invalid.");
  const current = normalizeTraceinkAssetStore(document);
  if (!isDeepStrictEqual(current, document)) throw new Error("Traceink asset store document failed integrity validation.");
  return current;
}

function sameIndexReference(left: TraceinkIndexArtifactReferenceV1, right: TraceinkIndexArtifactReferenceV1): boolean {
  const normalized = normalizeTraceinkArtifactReferenceV1(right);
  return Boolean(normalized && normalized.stage === "index" && referenceKey(left) === referenceKey(normalized));
}

function normalizeActiveIndexes(
  value: unknown,
  artifactByReference: ReadonlyMap<string, TraceinkArtifactV1>
): Record<string, TraceinkIndexArtifactReferenceV1> {
  const raw = asRecord(value);
  if (!raw) return {};
  const active: Record<string, TraceinkIndexArtifactReferenceV1> = {};
  for (const [logicalDate, valueForDate] of Object.entries(raw)) {
    if (!isTraceinkLogicalDate(logicalDate)) continue;
    const reference = normalizeTraceinkArtifactReferenceV1(valueForDate);
    if (!reference || reference.stage !== "index") continue;
    const artifact = artifactByReference.get(referenceKey(reference));
    if (!artifact || artifact.stage !== "index" || artifact.logicalDate !== logicalDate) continue;
    active[logicalDate] = { ...reference, stage: "index" };
  }
  return active;
}

function uniqueArtifacts(artifacts: TraceinkArtifactV1[]): TraceinkArtifactV1[] {
  const result: TraceinkArtifactV1[] = [];
  const byIdentity = new Map<string, TraceinkArtifactV1>();
  const conflicts = new Set<string>();
  for (const artifact of artifacts) {
    const key = artifactRevisionKey(artifact);
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, artifact);
      result.push(artifact);
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(artifact)) conflicts.add(key);
  }
  return conflicts.size === 0 ? result : result.filter((artifact) => !conflicts.has(artifactRevisionKey(artifact)));
}

function uniqueReflections(reflections: UserReflectionAssetV1[]): UserReflectionAssetV1[] {
  const result: UserReflectionAssetV1[] = [];
  const byIdentity = new Map<string, UserReflectionAssetV1>();
  const conflicts = new Set<string>();
  for (const reflection of reflections) {
    const key = reflectionRevisionKey(reflection);
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, reflection);
      result.push(reflection);
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(reflection)) conflicts.add(key);
  }
  return conflicts.size === 0
    ? result
    : result.filter((reflection) => !conflicts.has(reflectionRevisionKey(reflection)));
}

function stableArtifactLineages(artifacts: TraceinkArtifactV1[]): TraceinkArtifactV1[] {
  const lineageById = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const artifact of artifacts) {
    const lineage = JSON.stringify([
      artifact.stage,
      artifact.logicalDate,
      artifact.worklineId ?? null,
      artifact.sourceReflection ?? null
    ]);
    const previous = lineageById.get(artifact.id);
    if (previous === undefined) lineageById.set(artifact.id, lineage);
    else if (previous !== lineage) conflicts.add(artifact.id);
  }
  return conflicts.size === 0 ? artifacts : artifacts.filter((artifact) => !conflicts.has(artifact.id));
}

function stableReflectionLineages(reflections: UserReflectionAssetV1[]): UserReflectionAssetV1[] {
  const lineageById = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const reflection of reflections) {
    const lineage = JSON.stringify([
      reflection.logicalDate,
      reflection.worklineId,
      reflection.dossier
    ]);
    const previous = lineageById.get(reflection.id);
    if (previous === undefined) lineageById.set(reflection.id, lineage);
    else if (previous !== lineage) conflicts.add(reflection.id);
  }
  return conflicts.size === 0
    ? reflections
    : reflections.filter((reflection) => !conflicts.has(reflection.id));
}

function reflectionDossierResolves(
  reflection: UserReflectionAssetV1,
  artifactByReference: ReadonlyMap<string, TraceinkArtifactV1>
): boolean {
  const dossier = artifactByReference.get(referenceKey(reflection.dossier));
  return Boolean(
    dossier &&
    dossier.stage === "dossier" &&
    dossier.logicalDate === reflection.logicalDate &&
    dossier.worklineId === reflection.worklineId
  );
}

function blockInvalidProposalSourceQuotes(
  artifact: TraceinkArtifactV1,
  reflection: UserReflectionAssetV1
): TraceinkArtifactV1 {
  let blocked = 0;
  const navigation = artifact.navigation.filter((item) => {
    if (!isProposalNavigationItem(item)) return true;
    const resolves = item.sourceQuote.length > 0 && reflection.text.includes(item.sourceQuote);
    if (!resolves) blocked += 1;
    return resolves;
  });
  const diagnostics: string[] = [];
  if (blocked > 0) {
    diagnostics.push(`Traceink storage diagnostic: blocked ${blocked} proposal source quote(s) that do not resolve to the saved reflection.`);
  }
  if (!artifact.rawMarkdown.includes(reflection.text)) {
    diagnostics.push("Traceink storage diagnostic: proposal rawMarkdown does not reproduce the saved reflection verbatim.");
  }
  if (diagnostics.length === 0) return artifact;
  return {
    ...artifact,
    navigation,
    warnings: [...artifact.warnings, ...diagnostics.filter((diagnostic) => !artifact.warnings.includes(diagnostic))]
  };
}

function isProposalNavigationItem(
  item: TraceinkArtifactV1["navigation"][number]
): item is TraceinkProposalNavigationItemV1 {
  return "category" in item && "sourceQuote" in item;
}

function referenceMatchesArtifact(reference: TraceinkArtifactReferenceV1, artifact: TraceinkArtifactV1): boolean {
  return artifact.id === reference.artifactId &&
    artifact.stage === reference.stage &&
    artifact.revision === reference.revision &&
    artifact.outputHash === reference.outputHash;
}

function validatedArtifactForReference(
  document: TraceinkAssetStoreDocumentV1,
  reference: TraceinkArtifactReferenceV1
): TraceinkArtifactV1 | undefined {
  const candidate = document.artifacts.find((artifact) => referenceMatchesArtifact(reference, artifact));
  const normalized = normalizeTraceinkArtifactV1(candidate);
  return normalized && referenceMatchesArtifact(reference, normalized) ? normalized : undefined;
}

function sameOptionalIndexReference(
  current: TraceinkIndexArtifactReferenceV1 | undefined,
  expected: TraceinkIndexArtifactReferenceV1 | null
): boolean {
  if (!current || !expected) return !current && expected === null;
  const normalizedExpected = normalizeTraceinkArtifactReferenceV1(expected);
  return Boolean(
    normalizedExpected &&
    normalizedExpected.stage === "index" &&
    referenceKey(current) === referenceKey(normalizedExpected)
  );
}

function referenceKey(reference: TraceinkArtifactReferenceV1): string {
  return JSON.stringify([reference.artifactId, reference.stage, reference.revision, reference.outputHash]);
}

function reflectionReferenceKey(reference: {
  reflectionId: string;
  revision: number;
  contentHash: string;
}): string {
  return JSON.stringify([reference.reflectionId, reference.revision, reference.contentHash]);
}

function artifactRevisionKey(artifact: TraceinkArtifactV1): string {
  return JSON.stringify([artifact.id, artifact.stage, artifact.revision]);
}

function reflectionRevisionKey(reflection: UserReflectionAssetV1): string {
  return JSON.stringify([reflection.id, reflection.revision]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isCanonicalStoreEnvelope(value: unknown): value is TraceinkAssetStoreDocumentV1 {
  const raw = asRecord(value);
  return Boolean(
    raw &&
    raw.schemaVersion === 1 &&
    Array.isArray(raw.artifacts) &&
    Array.isArray(raw.reflections) &&
    asRecord(raw.activeIndexByDate)
  );
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
