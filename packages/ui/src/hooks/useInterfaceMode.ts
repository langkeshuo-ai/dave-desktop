import { useDaveStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useDaveStoreWithDefault((state) => state.interfaceMode === "office", false);
}
