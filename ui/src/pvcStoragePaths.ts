/** Referencia mínima al cluster Rancher para APIs de volúmenes (sin rutas sensibles). */
export type PvcVolumeClusterRef = {
  namespace: string;
  name: string;
  steveCollection?: string;
  store?: string;
};

function clusterQuery(cluster: PvcVolumeClusterRef): string {
  const steve = encodeURIComponent(cluster.steveCollection || "provisioning.cattle.io.customclusters");
  const store = cluster.store ? `&store=${encodeURIComponent(cluster.store)}` : "";
  return `steve_collection=${steve}${store}`;
}

export function clusterPvcsApiPath(cluster: PvcVolumeClusterRef): string {
  const ns = encodeURIComponent(cluster.namespace);
  const nm = encodeURIComponent(cluster.name);
  return `/api/atlas-rancher/custom-clusters/${ns}/${nm}/pvcs?${clusterQuery(cluster)}`;
}

export function clusterStorageSessionPath(cluster: PvcVolumeClusterRef): string {
  const ns = encodeURIComponent(cluster.namespace);
  const nm = encodeURIComponent(cluster.name);
  return `/api/atlas-rancher/custom-clusters/${ns}/${nm}/storage/session?${clusterQuery(cluster)}`;
}
