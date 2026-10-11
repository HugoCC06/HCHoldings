import { Empty } from './ui';

export function AssetWorkTab(_: { assetId: number }) {
  return <Empty title="Projects and tasks arrive in phase 3" />;
}
export function AssetGoalsTab(_: { assetId: number }) {
  return <Empty title="Goals arrive in a later phase" />;
}
export function AssetKnowledgeTab(_: { assetId: number }) {
  return <Empty title="Notes arrive in phase 5" />;
}
