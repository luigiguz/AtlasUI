/** Tipos compartidos del módulo Atlas Rancher. */

export type RancherCustomCluster = {
  id: string;
  name: string;
  namespace: string;
  displayName: string;
  state: string;
  kubernetesVersion: string;
  ready: boolean | null;
  kind: string;
  createdAt?: string | null;
  labels?: Record<string, string>;
  application: string;
  distro: string;
  store: string;
  atlas: string;
  steveCollection?: string;
  managementClusterId?: string;
  podCount?: number | null;
};

export type RancherPod = {
  name: string;
  /** Namespace real en Kubernetes (metadata.namespace). */
  k8sNamespace?: string;
  namespace: string;
  phase: string;
  node: string;
  ready: string;
  restarts: number;
  podIP: string;
  createdAt?: string | null;
  containers?: string[];
};

export type RancherDeployment = {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  image: string;
  imageTag: string;
  images?: string[];
  createdAt?: string | null;
};

export type DeploymentsResponse = {
  ok: boolean;
  managementClusterId: string;
  application: string;
  podNamespace: string;
  count: number;
  deployments: RancherDeployment[];
};

export type DeploymentRolloutResponse = {
  ok: boolean;
  deployment: RancherDeployment;
  targetReplicas: number;
  steps: string[];
};

export type PodsResponse = {
  ok: boolean;
  source: string;
  managementClusterId: string;
  application: string;
  podNamespace: string;
  count: number;
  pods: RancherPod[];
};

export type RancherPersistentVolumeClaim = {
  name: string;
  namespace: string;
  storageClassName: string;
  volumeName: string;
  phase: string;
  capacity: string;
  accessModes: string[];
  hostPath: string | null;
  createdAt?: string | null;
};

export type PvcsResponse = {
  ok: boolean;
  source: string;
  managementClusterId: string;
  podNamespace: string;
  count: number;
  pvcs: RancherPersistentVolumeClaim[];
  ssh: {
    clusterName?: string;
    store: string;
    site: string | null;
    available: boolean;
    message: string | null;
  };
};

export type StorageSessionResponse = {
  ok: boolean;
  site: string;
  session_id?: string;
  home?: string;
  start_path?: string | null;
  listing?: {
    path: string;
    parent: string | null;
    entries: { name: string; path: string; is_dir: boolean; size?: number | null; mtime?: number | null }[];
  };
};

export type SftpStatResponse = {
  path: string;
  is_dir: boolean;
  size?: number | null;
  mtime?: number | null;
  permissions: number;
  mode_octal: string;
  uid?: number | null;
  gid?: number | null;
};

export type ClustersResponse = {
  ok: boolean;
  configured?: boolean;
  message?: string;
  source: string;
  rancherUrl: string;
  count: number;
  clusters: RancherCustomCluster[];
};
