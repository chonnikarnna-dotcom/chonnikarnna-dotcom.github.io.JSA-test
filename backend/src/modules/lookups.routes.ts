import { Router } from 'express';
import { asc, eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import * as s from '../db/schema';
import { asyncH, requireAuth } from '../middleware/core';
import { getActiveMatrix } from '../services/risk';
import { getSettings, getValiditySettings } from '../services/settings';
import { ATTACHMENT_CATEGORIES } from '../services/attachments';

export const lookupsRouter = Router();

/** Unauthenticated: only what the login page needs. */
lookupsRouter.get('/public', asyncH(async (_req, res) => {
  const st = await getSettings();
  res.json({ defaultLanguage: st.defaultLanguage });
}));

/** Reference data used by forms and filters (authenticated). */
lookupsRouter.get('/', requireAuth, asyncH(async (req, res) => {
  const active = <T extends { isActive: any }>(t: T) => eq(t.isActive, true);
  const [departments, sites, areas, jobTypes, permitTypes, hazards, controls, contractors] = await Promise.all([
    db.select().from(s.departments).where(active(s.departments)).orderBy(asc(s.departments.code)),
    db.select().from(s.factorySites).where(active(s.factorySites)).orderBy(asc(s.factorySites.code)),
    db.select().from(s.factoryAreas).where(active(s.factoryAreas)).orderBy(asc(s.factoryAreas.code)),
    db.select().from(s.jobTypes).where(active(s.jobTypes)).orderBy(asc(s.jobTypes.code)),
    db.select().from(s.permitTypes).where(active(s.permitTypes)).orderBy(asc(s.permitTypes.sortOrder)),
    db.select().from(s.hazardMaster).where(active(s.hazardMaster)).orderBy(asc(s.hazardMaster.category), asc(s.hazardMaster.code)),
    db.select().from(s.controlMeasureMaster).where(active(s.controlMeasureMaster)).orderBy(asc(s.controlMeasureMaster.hierarchy)),
    // Contractors see only their own company; internal users see the list for filtering.
    req.user!.userType === 'CONTRACTOR'
      ? db.select({ id: s.contractorCompanies.id, name: s.contractorCompanies.name }).from(s.contractorCompanies).where(eq(s.contractorCompanies.id, req.user!.contractorCompanyId!))
      : db.select({ id: s.contractorCompanies.id, name: s.contractorCompanies.name }).from(s.contractorCompanies).where(active(s.contractorCompanies)).orderBy(asc(s.contractorCompanies.name)),
  ]);
  // Reviewer list for register filters (internal users only)
  const reviewers = req.user!.userType === 'CONTRACTOR' ? [] : await db.selectDistinct({ id: s.users.id, displayName: s.users.displayName }).from(s.users)
    .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(and(inArray(s.roles.code, ['AREA_OWNER', 'SAFETY_OFFICER']), eq(s.users.isActive, true))).orderBy(asc(s.users.displayName));
  const matrix = await getActiveMatrix();
  const st = await getSettings();
  const validity = await getValiditySettings();
  res.json({
    departments, sites, areas, jobTypes, permitTypes, hazards, controls, contractors, reviewers,
    attachmentCategories: ATTACHMENT_CATEGORIES,
    matrix: { id: matrix.id, versionNo: matrix.versionNo, name: matrix.name, size: matrix.size, scoreMethod: matrix.scoreMethod, isValidated: matrix.isValidated, severityLabels: matrix.severityLabels, likelihoodLabels: matrix.likelihoodLabels, levels: matrix.levels, rule: matrix.rule },
    settings: {
      timezone: st.timezone, defaultLanguage: st.defaultLanguage, ppeOptions: st.ppeOptions, attachmentMaxMb: st.attachmentMaxMb,
      allowedExtensions: st.allowedExtensions, declarationVersion: st.declarationVersion, declarationTextEn: st.declarationTextEn,
      declarationTextTh: st.declarationTextTh, overdueReviewHours: st.overdueReviewHours,
    },
    validity: { mode: validity.mode, durationHours: validity.durationHours, maxWorkPeriodDays: validity.maxWorkPeriodDays, completionTrackingEnabled: validity.completionTrackingEnabled, minLeadTimeHours: validity.minLeadTimeHours },
  });
}));
