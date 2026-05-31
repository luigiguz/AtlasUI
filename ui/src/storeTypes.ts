/** Tipos Gestión de Tiendas (atlas-stores). */

export type StoreSummary = {
  id: string;
  folderName: string;
  application: string;
  distro: string;
  stacks: string[];
  chartVersions: Record<string, string>;
  imageChannel: string;
  namespace: string;
};

export type StoreServiceToggle = {
  key: string;
  enabled: boolean;
  tag: string;
  hostPort?: number | null;
};

export type StoreWorkerToggle = {
  key: string;
  enabled: boolean;
  tag: string;
};

export type StoreWorkerGroup = {
  id: string;
  label: string;
  workers: StoreWorkerToggle[];
};

export type StoreDetail = StoreSummary & {
  clusterLabels: Record<string, string>;
  db: {
    timezone?: string;
    database?: string;
    persistenceEnabled?: boolean;
    storageClass?: string;
    size?: string;
    pgadminEnabled?: boolean;
  };
  station: {
    stack: string;
    config: Record<string, unknown>;
    services: StoreServiceToggle[];
    /** Agrupado: generales + iERP */
    workerGroups?: { groups: StoreWorkerGroup[] };
    /** Lista plana (compatibilidad al guardar) */
    workers?: StoreWorkerToggle[];
  };
  stacksData?: Record<string, { chartVersion?: string; bundleVersion?: string }>;
};

export type StoresListResponse = {
  ok: boolean;
  configured?: boolean;
  message?: string;
  repoUrl?: string;
  branch?: string;
  count: number;
  stores: StoreSummary[];
  gitWarning?: string;
  gitBlocked?: boolean;
  gitSummary?: string;
  pendingFolders?: string[];
  pendingApprovalCount?: number;
};

export type StoreChangeRequest = {
  id: number;
  kind: "update" | "create";
  folderName: string;
  storeId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  summary: string;
  commitMessage: string;
  createdByUserId: number;
  createdByUsername: string;
  createdAt: string | null;
  reviewedByUsername?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  payload?: Record<string, unknown>;
};

export type StoreChangeRequestsResponse = {
  ok: boolean;
  canApprove?: boolean;
  requests: StoreChangeRequest[];
};

export type StoreDetailResponse = {
  ok: boolean;
  store: StoreDetail;
};

export type StoreTemplateInfo = {
  distro: string;
  label: string;
  stackDir: string;
  templatePath: string;
  available: boolean;
  source?: "template" | "reference" | "builtin";
  primaryTemplatePath?: string;
  fallbackTemplatePath?: string;
  referenceStore?: string;
};

export type StoreTemplatesResponse = {
  ok: boolean;
  configured?: boolean;
  message?: string;
  templates: StoreTemplateInfo[];
};

export type StorePreviewWarning = {
  level: "error" | "warn";
  code: string;
  message: string;
};

export type StoreCreatePreview = {
  storeId: string;
  folderName: string;
  distro: string;
  imageChannel: string;
  namespace: string;
  clusterLabels: Record<string, string>;
  gitPaths: string[];
  files: {
    path: string;
    stack: string;
    sourceTemplate: string;
    chart: string;
    chartVersion: string;
    bundleVersion: string;
  }[];
  chartVersions: Record<string, string>;
  db: StoreDetail["db"];
  station: StoreDetail["station"];
  placeholders: string[];
  warnings: StorePreviewWarning[];
  canPublish: boolean;
  folderExists: boolean;
};

export type StoreCreatePreviewResponse = {
  ok: boolean;
  preview: StoreCreatePreview;
  branch: string;
  repoUrl?: string;
  suggestedCommitMessage?: string;
  equipment: {
    name?: string;
    displayName?: string;
    state?: string;
  };
};

export type StoreGitChange = {
  path: string;
  status: "unmerged" | "modified" | "added" | "deleted" | "untracked" | "changed";
  label: string;
};

export type StoreGitStatusResponse = {
  ok: boolean;
  configured?: boolean;
  branch?: string;
  dirty?: boolean;
  blocked?: boolean;
  canPublish?: boolean;
  mergeInProgress?: boolean;
  rebaseInProgress?: boolean;
  cherryPickInProgress?: boolean;
  stashCount?: number;
  changes?: StoreGitChange[];
  summary?: string;
  canDiscard?: boolean;
  message?: string;
};

export type StoreGitDiscardMode = "abort" | "local" | "remote";
