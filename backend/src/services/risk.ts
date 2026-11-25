import { and, eq } from 'drizzle-orm';
import { db, DbOrTx } from '../db/client';
import { riskAcceptanceRules, riskMatrixLevels, riskMatrixVersions } from '../db/schema';
import { unprocessable } from '../lib/errors';

export type MatrixLevel = typeof riskMatrixLevels.$inferSelect;
export type Matrix = typeof riskMatrixVersions.$inferSelect & {
  levels: MatrixLevel[];
  rule: typeof riskAcceptanceRules.$inferSelect | null;
};

export async function loadMatrix(id: string, t: DbOrTx = db): Promise<Matrix | null> {
  const m = await t.query.riskMatrixVersions.findFirst({ where: eq(riskMatrixVersions.id, id), with: { levels: true, rules: true } });
  if (!m) return null;
  const { rules, ...rest } = m;
  return { ...rest, levels: [...m.levels].sort((a, b) => a.sortOrder - b.sortOrder), rule: rules[0] ?? null };
}

export async function getActiveMatrix(t: DbOrTx = db): Promise<Matrix> {
  const m = await t.query.riskMatrixVersions.findFirst({ where: eq(riskMatrixVersions.status, 'ACTIVE') });
  if (!m) throw unprocessable('RISK_MATRIX_NOT_CONFIGURED', 'No active risk matrix is configured');
  return (await loadMatrix(m.id, t))!;
}

/** Pure score calculation (server-side authority). */
export function computeScore(method: string, severity: number, likelihood: number) {
  if (method === 'MULTIPLY') return severity * likelihood;
  if (method === 'ADD') return severity + likelihood;
  throw new Error(`Unknown score method ${method}`);
}

export function levelForScore(levels: Pick<MatrixLevel, 'code' | 'minScore' | 'maxScore'>[], score: number) {
  const l = levels.find((x) => score >= x.minScore && score <= x.maxScore);
  if (!l) throw unprocessable('RISK_LEVEL_UNDEFINED', `No risk level defined for score ${score}`);
  return l.code;
}

export function assess(matrix: Pick<Matrix, 'size' | 'scoreMethod' | 'levels'>, severity: number, likelihood: number) {
  if (!Number.isInteger(severity) || !Number.isInteger(likelihood) || severity < 1 || likelihood < 1 || severity > matrix.size || likelihood > matrix.size) {
    throw unprocessable('RISK_OUT_OF_RANGE', `Severity and likelihood must be integers between 1 and ${matrix.size}`);
  }
  const score = computeScore(matrix.scoreMethod, severity, likelihood);
  return { severity, likelihood, score, levelCode: levelForScore(matrix.levels, score) };
}

/**
 * Validates that matrix levels form a contiguous, non-overlapping cover of every possible score.
 * Returns a list of problems (empty = valid).
 */
export function validateMatrixDefinition(m: Pick<Matrix, 'size' | 'scoreMethod' | 'levels'>): string[] {
  const problems: string[] = [];
  const scores = new Set<number>();
  for (let s = 1; s <= m.size; s++) for (let l = 1; l <= m.size; l++) scores.add(computeScore(m.scoreMethod, s, l));
  for (const sc of scores) {
    const hits = m.levels.filter((x) => sc >= x.minScore && sc <= x.maxScore);
    if (hits.length === 0) problems.push(`Score ${sc} is not covered by any level`);
    if (hits.length > 1) problems.push(`Score ${sc} is covered by multiple levels (${hits.map((h) => h.code).join(', ')})`);
  }
  for (const l of m.levels) if (l.minScore > l.maxScore) problems.push(`Level ${l.code}: min > max`);
  return problems;
}

export const isEscalationLevel = (m: Pick<Matrix, 'levels'>, code: string | null | undefined) =>
  !!code && !!m.levels.find((l) => l.code === code)?.requiresEscalation;

export { and };
