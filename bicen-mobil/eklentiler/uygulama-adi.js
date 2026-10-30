/**
 * Uygulamanın telefondaki adı (26.10.2026).
 *
 * expo.name "Bicen360" (ASCII): iOS derlemesinde Xcode hedef adı bu addan
 * üretiliyor; "Biçen360"daki ç düşünce EAS hedefi bulamıyordu ("Could not
 * find target 'Bien360'"). Ana ekranda görünen ad ise "Biçen360" kalsın:
 * iOS'ta CFBundleDisplayName (app.json infoPlist), Android'de app_name.
 */
const { withStringsXml, AndroidConfig } = require("expo/config-plugins");

module.exports = function uygulamaAdi(config, ad = "Biçen360") {
  return withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem(
      [AndroidConfig.Resources.buildResourceItem({ name: "app_name", value: ad })],
      c.modResults
    );
    return c;
  });
};
