import { and, eq, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { db, DbOrTx } from '../db/client';
import {
  areaOwnerAssignments, factoryAreas, jsas, roles, safetyOfficerAssignments, userRoles, users,
} from '../db/schema';

export type RoleCode = 'REQUESTER' | 'AREA_OWNER' | 'SAFETY_OFFICER' | 'ADMIN';

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  userType: 'EMPLOYEE' | 'CONTRACTOR';
  departmentId: string | null;
  contractorCompanyId: string | null;
  preferredLanguage: string;
  roles: RoleCode[];
  /** Areas the user is an active (primary or backup) Area Owner for. */
  ownedAreaIds: string[];
  /** Safety Officer scope: list of site ids, or 'ALL'. Empty = no scope. */
  safetySiteScope: string[] | 'ALL';
};

export const hasRole = (u: AuthUser, ...r: RoleCode[]) => r.some((x) => u.roles.includes(x));

export async function loadAuthUser(userId: string, t: DbOrTx = db): Promise<AuthUser | null> {
  const u = await t.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u || !u.isActive) return null;
  const roleRows = await t.select({ code: roles.code }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  const roleCodes = roleRows.map((r) => r.code as RoleCode);
  let ownedAreaIds: string[] = [];
  if (roleCodes.includes('AREA_OWNER')) {
    const rows = await t.select({ areaId: areaOwnerAssignments.areaId }).from(areaOwnerAssignments)
      .where(and(eq(areaOwnerAssignments.userId, userId), eq(areaOwnerAssignments.isActive, true)));
    ownedAreaIds = rows.map((r) => r.areaId);
  }
  let safetySiteScope: string[] | 'ALL' = [];
  if (roleCodes.includes('SAFETY_OFFICER')) {
    const rows = await t.select({ siteId: safetyOfficerAssignments.siteId }).from(safetyOfficerAssignments)
      .where(and(eq(safetyOfficerAssignments.userId, userId), eq(safetyOfficerAssignments.isActive, true)));
    safetySiteScope = rows.some((r) => r.siteId === null) ? 'ALL' : rows.map((r) => r.siteId!) ;
  }
  return {
    id: u.id, email: u.email, username: u.username, displayName: u.displayName, userType: u.userType,
    departmentId: u.departmentId, contractorCompanyId: u.contractorCompanyId, preferredLanguage: u.preferredLanguage,
    roles: roleCodes, ownedAreaIds, safetySiteScope,
  };
}

/**
 * Record-level visibility of JSA headers.
 * - Requester: own records (including drafts)
 * - Area Owner: non-draft records in assigned areas
 * - Safety Officer: non-draft records in sites within scope
 * - Admin: all records (read-only; admin does not imply approval rights)
 */
export function jsaVisibility(u: AuthUser): SQL {
  const conds: SQL[] = [eq(jsas.requesterId, u.id)];
  const submittedOnce = sql`${jsas.submittedAt} IS NOT NULL`;
  if (u.roles.includes('ADMIN')) conds.push(sql`TRUE`);
  if (u.roles.includes('AREA_OWNER') && u.ownedAreaIds.length) {
    conds.push(and(submittedOnce, inArray(jsas.areaId, u.ownedAreaIds))!);
  }
  if (u.roles.includes('SAFETY_OFFICER')) {
    if (u.safetySiteScope === 'ALL') conds.push(submittedOnce);
    else if (u.safetySiteScope.length) {
      conds.push(and(submittedOnce, inArray(jsas.areaId,
        db.select({ id: factoryAreas.id }).from(factoryAreas).where(inArray(factoryAreas.siteId, u.safetySiteScope))))!);
    }
  }
  return and(isNull(jsas.deletedAt), or(...conds))!;
}

/** Can the user act as reviewer for the given stage on a JSA located in the given area/site? */
export function canReviewStage(u: AuthUser, stage: 'AREA_OWNER' | 'SAFETY_OFFICER', areaId: string | null, siteId: string | null) {
  if (stage === 'AREA_OWNER') return u.roles.includes('AREA_OWNER') && !!areaId && u.ownedAreaIds.includes(areaId);
  if (!u.roles.includes('SAFETY_OFFICER')) return false;
  if (u.safetySiteScope === 'ALL') return true;
  return !!siteId && u.safetySiteScope.includes(siteId);
}
