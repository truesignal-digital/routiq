import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { assetDisplayName } from "./display.js";
import { useAssets } from "./useAssets.js";

/**
 * The whole fleet, labelled as the entries filter labels it. Stopping at the
 * first keyset page would hide assets an operator needs to charge a cost to;
 * pilot fleets are tens of rows, so draining the cursor costs a request or two.
 */
export function useAssetOptions(): Array<{ value: string; label: string }> {
  const { t } = useTranslation();
  const assetsQuery = useAssets();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = assetsQuery;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return useMemo(
    () =>
      (assetsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((asset) => {
        const name = assetDisplayName(asset);
        return {
          value: asset.id,
          label:
            name === asset.assetCode
              ? asset.assetCode
              : t("finance.entries.filters.assetOption", {
                  code: asset.assetCode,
                  name,
                }),
        };
      }),
    [assetsQuery.data, t],
  );
}
