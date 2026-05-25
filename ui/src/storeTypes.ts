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
};

export type StoreDetailResponse = {
  ok: boolean;
  store: StoreDetail;
};
