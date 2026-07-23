import { useCallback, useEffect, useState } from "react";
import { fetchAssets, readActiveSessionToken } from "./api.js";
import type { AssetListItem } from "./model.js";

type AssetsState =
  | { status: "loading"; assets: AssetListItem[] }
  | { status: "ready"; assets: AssetListItem[] }
  | { status: "error"; assets: AssetListItem[] };

export function useAssets() {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<AssetsState>({
    status: "loading",
    assets: [],
  });

  useEffect(() => {
    const token = readActiveSessionToken(window.localStorage);
    if (token === null) {
      setState({ status: "ready", assets: [] });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({ status: "loading", assets: current.assets }));
    void fetchAssets(token, controller.signal)
      .then(({ assets }) => setState({ status: "ready", assets }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => ({ status: "error", assets: current.assets }));
      });

    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);
  return { ...state, retry };
}
