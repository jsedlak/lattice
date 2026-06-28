// cytoscape-fcose ships without bundled type declarations.
declare module "cytoscape-fcose" {
  import type { Ext } from "cytoscape";
  const ext: Ext;
  export default ext;
}
