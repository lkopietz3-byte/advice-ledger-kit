// advice-ledger-kit — grade the grader.
//
// A system makes recommendations, a human accepts or rejects them, and reality
// later shows who was right. This library closes that loop honestly: it
// compares a before window to an after window, it only counts outcomes where
// the advice could actually have applied toward the headline reading, it holds
// each window to its own floor, and below any floor it returns machine-readable
// refusal codes instead of a verdict.
//
// Companion to the same family's outward-facing graders. Those refuse to
// assert what they cannot support about the world; this one refuses to assert
// that its own advice is landing.

export type {
  // Ledger inputs
  Recommendation,
  RecommendationBasis,
  Decision,
  DecisionStatus,
  Observation,
  ObservationState,
  // Grading
  DecisionVerdict,
  GradeRefusalCode,
  GradeConfig,
  ResolvedGradeConfig,
  WindowReading,
  SecondaryReading,
  DecisionGrade,
  // Divergence
  JudgmentPair,
  DivergenceRefusalCode,
  DivergenceConfig,
  ResolvedDivergenceConfig,
  CalibrationReading,
  DivergenceReport,
  DivergenceResult,
} from './types.js'

export { gradeDecision, describeGrade, resolveGradeConfig, DEFAULT_GRADE_CONFIG } from './grade.js'
export {
  computeDivergence,
  describeDivergence,
  resolveDivergenceConfig,
  DEFAULT_DIVERGENCE_CONFIG,
} from './divergence.js'
