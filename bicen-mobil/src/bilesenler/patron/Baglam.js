/**
 * Patron görünümü bağlamı
 * ---------------------------------------------------------------------------
 * Bildirim (tost), personel ve aday alt sayfaları ve menü kökte bir kez
 * kuruluyor; ekranlar buradan çağırıyor. Her ekranın kendi alt sayfasını
 * taşıması, aynı personel kartının beş ayrı kopyası demekti ve kart
 * sekme çubuğunun altında kalıyordu.
 */

import { createContext, useContext } from "react";
import { Linking } from "react-native";

export const PatronBaglami = createContext({
  tost: () => {},
  personelAc: () => {},
  adayAc: () => {},
  menuAc: () => {},
});

export const usePatron360 = () => useContext(PatronBaglami);

/**
 * Sunucunun "hedef" alanını ekrana çevirir (dikkat listesi, sunucu
 * tanımlı sayfadan gelen `{ tur: "git" }` mesajı). Bilinmeyen ekran
 * sessizce yok sayılıyor: eski uygulamaya yeni bir hedef gelebilir.
 *
 * `t` parametresi aynı hedefe ikinci kez gidildiğinde de filtrenin
 * yeniden uygulanması için: sekme ekranları bellekte kaldığından aynı
 * parametreyle gezinmek etkiyi tetiklemiyordu.
 */
export const hedefeGit = (navigation, hedef) => {
  const p = hedef?.p ?? undefined;
  const t = Date.now();

  switch (hedef?.ekran) {
    case "sube":
      return p ? navigation.navigate("SubeDetay", { ad: p }) : navigation.navigate("Subeler");
    case "subeler":
      return navigation.navigate("Subeler");
    case "basvurular":
      return navigation.navigate("Basvurular", { durum: p, t });
    case "onaylar":
      return navigation.navigate("Onaylar", { tur: p, t });
    case "gecis":
      return navigation.navigate("Gecis", { segment: p, t });
    case "norm":
      return navigation.navigate("Norm");
    case "kart":
      return navigation.navigate("Kart");
    case "etik":
      return navigation.navigate("IkDetay", { bolum: "etik" });
    case "ik":
      return navigation.navigate("Ik");

    /* Sunucu tanımlı sayfa (WebSayfa): yeni sayfa için uygulama
       güncellemesi gerekmesin diye içerik sunucudan geliyor. */
    case "sayfa":
      return p ? navigation.navigate("WebSayfa", { kod: String(p), baslik: hedef?.baslik ?? null, t }) : undefined;
    default:
      return undefined;
  }
};

/**
 * Arama / SMS.
 *
 * Numara yoksa ya da cihaz açamıyorsa (tablet, simülatör) sessiz kalmak
 * yerine sebep söyleniyor.
 */
export const iletisim = async (tur, telefon, tost) => {
  const no = String(telefon ?? "").replace(/[^\d+]/g, "");

  if (!no) {
    tost?.("Telefon numarası kayıtlı değil", "hata");
    return;
  }

  try {
    await Linking.openURL(`${tur === "sms" ? "sms" : "tel"}:${no}`);
  } catch {
    tost?.(tur === "sms" ? "Mesaj uygulaması açılamadı" : "Arama başlatılamadı", "hata");
  }
};
