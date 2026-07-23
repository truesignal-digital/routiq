import { useTranslation } from "react-i18next";

export function AssetsStub() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("assets.title")}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("assets.emptyHint")}</p>
    </section>
  );
}
