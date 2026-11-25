export type Role = 'REQUESTER' | 'AREA_OWNER' | 'SAFETY_OFFICER' | 'ADMIN';
export type JsaStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING_AREA_OWNER' | 'PENDING_SAFETY_OFFICER' | 'RETURNED' | 'REJECTED' | 'APPROVED' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED';
export type Stage = 'AREA_OWNER' | 'SAFETY_OFFICER';
export const ALL_STATUSES: JsaStatus[] = ['DRAFT', 'PENDING_AREA_OWNER', 'PENDING_SAFETY_OFFICER', 'RETURNED', 'REJECTED', 'APPROVED', 'CANCELLED', 'EXPIRED', 'COMPLETED'];

export type Me = {
  id: string; email: string; username: string; displayName: string; userType: 'EMPLOYEE' | 'CONTRACTOR'; roles: Role[];
  departmentId: string | null; contractorCompanyId: string | null; preferredLanguage: 'th' | 'en';
  ownedAreaIds: string[]; safetySiteScope: string[] | 'ALL';
};
export type Named = { id: string; code?: string; nameEn: string; nameTh: string; isActive?: boolean };
export type Level = { id: string; code: string; nameEn: string; nameTh: string; minScore: number; maxScore: number; color: string; sortOrder: number; requiresEscalation: boolean };
export type ScaleLabel = { value: number; en: string; th: string };
export type Matrix = {
  id: string; versionNo: number; name: string; size: number; scoreMethod?: string; isValidated: boolean; status?: string; validatedAt?: string | null;
  severityLabels: ScaleLabel[]; likelihoodLabels: ScaleLabel[]; levels: Level[];
  rule: { maxAcceptableResidualScore: number; blockSubmission: boolean; blockFinalApproval: boolean; requireResidualLowerOrEqual: boolean; description?: string | null } | null;
};
export type FollowUp = { key: string; en: string; th: string; type: 'boolean' | 'text'; required: boolean };
export type PermitType = Named & { isHighRisk: boolean; requiresPermitReference: boolean; requiresAttachment: boolean; requiresSafetyVerification: boolean; followUpQuestions: FollowUp[]; guidanceEn: string | null; guidanceTh: string | null; sortOrder: number };
export type Lookups = {
  departments: Named[]; sites: Named[]; areas: (Named & { siteId: string; building: string | null })[]; jobTypes: (Named & { defaultPermitCodes: string[] })[];
  permitTypes: PermitType[]; hazards: (Named & { category: string })[]; controls: (Named & { hierarchy: string })[];
  contractors: { id: string; name: string }[]; reviewers: { id: string; displayName: string }[]; attachmentCategories: string[];
  matrix: Matrix;
  settings: { timezone: string; defaultLanguage: 'th' | 'en'; ppeOptions: string[]; attachmentMaxMb: number; allowedExtensions: string[]; declarationVersion: string; declarationTextEn: string; declarationTextTh: string; overdueReviewHours: number };
  validity: { mode: string; durationHours: number; maxWorkPeriodDays: number; completionTrackingEnabled: boolean; minLeadTimeHours: number };
};
export type Risk = { severity: number; likelihood: number; score: number; levelCode: string } | null;
export type HazardDto = { hazard: string; consequence: string; hazardMasterId: string | null; controlOwner: string | null; existingControls: string; additionalControls: string; initial: Risk; residual: Risk };
export type StepDto = { stepNo: number; activity: string; hazards: HazardDto[] };
export type PermitDto = { id?: string; permitTypeId: string; permitTypeCode?: string; referenceNo: string | null; verificationStatus: string; answers: Record<string, unknown>; attachmentId: string | null; notes: string | null; verified?: boolean };
export type Content = {
  jobTitle: string; jobDescription: string; departmentId: string | null; contactPhone: string | null; contactEmail: string | null; siteId: string | null;
  areaId: string | null; exactLocation: string | null; plannedStart: string | null; plannedEnd: string | null; workerCount: number | null;
  supervisorName: string | null; supervisorPhone: string | null; jobTypeId: string | null; emergencyContactName: string | null;
  emergencyContactPhone: string | null; ppeRequired: string[]; additionalRequirements: string | null; steps: StepDto[]; permits: PermitDto[];
};
export type Attachment = { id: string; originalName: string; category: string; mimeType: string; sizeBytes: number; uploadedAt: string; addedInVersion: number };
export type HistoryItem = { id: string; versionNo: number; stage: Stage | null; decision: string; actorName: string; comment: string | null; createdAt: string; metadata: Record<string, unknown> | null };
export type ChangeSummary = { comparedToVersion: number; changedFields: string[]; steps: { added: number[]; removed: number[]; modified: number[] }; permitsChanged: boolean; attachments: { added: string[]; removed: string[] }; criticalChange: boolean };
export type JsaDetail = {
  jsa: {
    id: string; referenceNo: string; status: JsaStatus; requesterId: string; currentVersionId: string; approvedVersionId: string | null; currentVersionNo: number;
    rowVersion: number; submittedAt: string | null; approvedAt: string | null; validFrom: string | null; validUntil: string | null; cancelledAt: string | null;
    cancelReason: string | null; completedAt: string | null; completionNote: string | null; riskLevelCode: string | null; isHighRiskWork: boolean; createdAt: string; updatedAt: string;
    requester: { id: string; displayName: string; email: string; userType: string; phone: string | null } | null;
    area: (Named & { building: string | null }) | null; site: Named | null; department: Named | null; contractorCompany: { id: string; name: string } | null; jobType: Named | null;
    currentReviewer: { id: string; displayName: string } | null; currentStage: Stage | null; pendingSince: string | null;
  };
  version: { id: string; versionNo: number; locked: boolean; submittedAt: string | null; requesterName: string; requesterType: string; changeSummary: ChangeSummary | null; revisionReason: string | null; contentHash: string | null; isApprovedVersion: boolean };
  content: Content;
  attachments: Attachment[];
  versions: { id: string; versionNo: number; locked: boolean; submittedAt: string | null; changeSummary: ChangeSummary | null; revisionReason: string | null; createdAt: string }[];
  approvalHistory: HistoryItem[];
  statusHistory: { id: string; fromStatus: JsaStatus | null; toStatus: JsaStatus; versionNo: number; reason: string | null; createdAt: string }[];
  declaration: { declarationVersion: string; language: string; textSnapshot: string; acceptedAt: string } | null;
  matrix: Matrix | null;
  permissions: {
    canEdit: boolean; canSubmit: boolean; canDeleteDraft: boolean; canCancel: boolean; canRevise: boolean; canDiscardRevision: boolean; canComplete: boolean;
    canCopy: boolean; canDownloadPdf: boolean; review: { taskId: string; stage: Stage; versionId: string } | null;
  };
};
export type JsaRow = {
  id: string; referenceNo: string; version: number; jobTitle: string; status: JsaStatus; plannedStart: string | null; plannedEnd: string | null;
  riskLevelCode: string | null; maxResidualRiskScore: number | null; isHighRiskWork: boolean; updatedAt: string; submittedAt: string | null; validUntil: string | null;
  requesterName: string; areaNameEn: string | null; areaNameTh: string | null; siteNameEn: string | null; siteNameTh: string | null;
  departmentNameEn: string | null; departmentNameTh: string | null; contractorName: string | null; jobTypeNameEn: string | null; jobTypeNameTh: string | null;
  currentStage: Stage | null; pendingSince: string | null; currentReviewerName: string | null;
};
export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
