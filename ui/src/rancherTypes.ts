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
  namespace: string;
  phase: string;
  node: string;
  ready: string;
  restarts: number;
  podIP: string;
  createdAt?: string | null;
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

export type ClustersResponse = {
  ok: boolean;
  configured?: boolean;
  message?: string;
  source: string;
  rancherUrl: string;
  count: number;
  clusters: RancherCustomCluster[];
};
