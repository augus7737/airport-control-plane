import { createNodeTableCellsModule } from "./node-table-cells.js";
import { createNodeRecommendationsModule } from "./node-table-recommendations.js";

export function createNodeTableRenderer(dependencies = {}) {
  const {
    getAccessMode,
    getProbeSshStage,
    normalizeProbeCode,
  } = dependencies;
  const {
    nodeTable,
    renderNodeAssetCell,
    renderNodeIdentityCell,
    renderNodePlacementCell,
    renderNodeStatusCell,
    renderNodeTableActions,
  } = createNodeTableCellsModule(dependencies);
  const {
    buildNodeRecommendations,
    pushRecommendation,
  } = createNodeRecommendationsModule({
    getAccessMode,
    getProbeSshStage,
    normalizeProbeCode,
  });

  return {
    renderNodeStatusCell,
    renderNodeIdentityCell,
    renderNodePlacementCell,
    renderNodeAssetCell,
    renderNodeTableActions,
    pushRecommendation,
    buildNodeRecommendations,
    nodeTable,
  };
}
