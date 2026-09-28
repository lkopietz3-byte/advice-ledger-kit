// Strict NodeNext type probe: compiled by scripts/verify-package.mjs against
// the installed declarations. Type-level only (no @types/node), so it checks
// that the public types are usable the way a TypeScript consumer would.
import {
  DEFAULT_GRADE_CONFIG,
  computeDivergence,
  describeDivergence,
  describeGrade,
  gradeDecision,
  resolveDivergenceConfig,
  resolveGradeConfig,
  type CalibrationReading,
  type Decision,
  type DecisionGrade,
  type DecisionVerdict,
  type DivergenceConfig,
  type DivergenceRefusalCode,
  type DivergenceReport,
  type DivergenceResult,
  type GradeConfig,
  type GradeRefusalCode,
  type JudgmentPair,
  type Observation,
  type Recommendation,
  type ResolvedDivergenceConfig,
  type ResolvedGradeConfig,
  type SecondaryReading,
  type WindowReading,
} from 'advice-ledger-kit';

const recommendation: Recommendation = { id: 'r', subjectId: 's', checkKey: 'c', proposedAt: '2026-01-01', basis: 'observed' };
const decision: Decision = { recommendationId: 'r', status: 'dismissed', decidedAt: '2026-02-01' };
const observations: Observation[] = [{ subjectId: 's', checkKey: 'c', state: 'bad', observedAt: '2026-01-10' }];
const config: GradeConfig = { proposeThreshold: 2, requireObservedBasis: true };

const grade: DecisionGrade = gradeDecision(decision, recommendation, observations, config);
const verdict: DecisionVerdict = grade.verdict;
const codes: GradeRefusalCode[] = grade.refusalCodes;
const window: WindowReading = grade.result;
const secondary: SecondaryReading = grade.secondary;
const wouldBe: DecisionVerdict = secondary.wouldBeVerdict;
const delta: number | null = grade.badRateDelta;
const resolved: ResolvedGradeConfig = resolveGradeConfig(config);
const defaults: Readonly<ResolvedGradeConfig> = DEFAULT_GRADE_CONFIG;
const sentence: string = describeGrade(grade);

// Exhaustive handling of the verdict union must compile.
function label(v: DecisionVerdict): string {
  switch (v) {
    case 'holding':
      return 'ok';
    case 'not-holding':
      return 'check';
    case 'refused':
      return 'wait';
  }
}

const pairs: JudgmentPair[] = [{ engineJudgment: 'keep', humanJudgment: 'remove', laterOutcome: 'remove', group: 'g', id: '1' }];
const divergenceConfig: DivergenceConfig = { minDivergentRate: 0.1, groupBy: (p) => p.group ?? null };
const result: DivergenceResult = computeDivergence(pairs, divergenceConfig);
const report: DivergenceReport = result.overall;
const calibration: CalibrationReading = report.calibration;
const divergenceCodes: DivergenceRefusalCode[] = [...report.refusalCodes, ...calibration.refusalCodes];
const rate: number | null = report.divergentRate;
const group: string | null = report.group;
const resolvedDivergence: ResolvedDivergenceConfig = resolveDivergenceConfig(divergenceConfig);
const divergenceSentence: string = describeDivergence(report);
const divergenceWithFloors: string = describeDivergence(report, result.thresholds);

// @ts-expect-error refuteThreshold is a number, not a string
const badConfig: GradeConfig = { refuteThreshold: '2' };
// @ts-expect-error there is no blended accuracy field
const blended: number = calibration.accuracy;
// @ts-expect-error the defaults are frozen and typed readonly
DEFAULT_GRADE_CONFIG.refuteThreshold = 1;

export const probe = [
  verdict, codes, window, wouldBe, delta, resolved, defaults, sentence, label(verdict),
  divergenceCodes, rate, group, resolvedDivergence, divergenceSentence, divergenceWithFloors, badConfig, blended,
];
