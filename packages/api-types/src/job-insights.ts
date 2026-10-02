export type JobOutcome = "hired" | "offer_declined" | "no_response" | null;
export interface JobPlanningFields {
  companyBriefId?: string | null;
  closingDate?: string | null;
  closingNote?: string;
  careerPreferences?: string;
  outcome?: JobOutcome;
}
export interface FitDimension {
  key: "skills" | "experience" | "career" | "location" | "language";
  score: number | null;
  status: "supported" | "check" | "unknown";
  jobEvidence: string | null;
  candidateEvidence: string | null;
}
export interface ShortlistEntry {
  leadId: string;
  text: string;
  sourceUrl: string;
  provenance: {
    kind: "pasted" | "browser";
    proposalId: string | null;
    capturedAt: string | null;
  };
  closingDate: string | null;
  closingNote: string;
  version: string;
  reviewedAt: string;
  ranking: null | {
    score: number;
    dimensions: FitDimension[];
    strengths: {
      label: string;
      jobEvidence: string;
      resumeEvidence: string | null;
    }[];
    gaps: {
      label: string;
      jobEvidence: string;
      resumeEvidence: string | null;
    }[];
    resumeId: string;
    resumeRevisionId: string;
    preferences: string;
    inputHash: string;
    model: string;
    providerId: string;
    createdAt: string;
  };
}
export interface JobContactEvent {
  id: string;
  applicationId: string;
  kind: "contact" | "follow_up";
  at: string;
  note: string;
}
export interface FollowUpState {
  applicationId: string;
  version: string;
  snoozedUntil: string | null;
  draft: string;
  events: JobContactEvent[];
}
export interface FollowUpRow extends FollowUpState {
  company: string;
  role: string;
  lastContactAt: string | null;
  daysQuiet: number | null;
  followUps: number;
  due: boolean;
}
export interface CompanyBrief {
  id: string;
  company: string;
  domain: string;
  version: string;
  facts: { text: string; url: string; checkedAt: string }[];
  updatedAt: string;
}
export interface RecurringGap {
  key: string;
  label: string;
  applications: {
    id: string;
    company: string;
    role: string;
    analysisId: string;
    quote: string;
  }[];
}
