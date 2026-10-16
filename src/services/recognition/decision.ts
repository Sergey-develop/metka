import type { RecognitionCandidate, RecognitionStatus } from './types'

export interface CandidateDecision {
  status: Extract<RecognitionStatus, 'recognized' | 'ambiguous' | 'other_building' | 'not_recognized'>
  confidence: number | null
  margin: number | null
}

/**
 * Client-side mirror of the server rule (submit_building_scan) for UX only:
 * target must beat neighbours with score >= threshold and margin >= marginThreshold.
 */
export function decideCandidates(
  candidates: readonly RecognitionCandidate[],
  targetBuildingId: string,
  thresholds: { scoreThreshold: number; marginThreshold: number },
): CandidateDecision {
  const target = candidates.find((c) => c.buildingId === targetBuildingId)
  const bestOther = candidates
    .filter((c) => c.buildingId !== targetBuildingId)
    .reduce<RecognitionCandidate | null>((best, c) => (best === null || c.score > best.score ? c : best), null)

  const confidence = target?.score ?? null
  const margin = confidence === null ? null : confidence - (bestOther?.score ?? 0)

  if (bestOther && bestOther.score >= thresholds.scoreThreshold && (confidence === null || bestOther.score > confidence)) {
    return { status: 'other_building', confidence, margin }
  }
  if (confidence === null || confidence < thresholds.scoreThreshold) {
    return { status: 'not_recognized', confidence, margin }
  }
  if (margin !== null && margin < thresholds.marginThreshold) {
    return { status: 'ambiguous', confidence, margin }
  }
  return { status: 'recognized', confidence, margin }
}
