/**
 * Alt menüde kendi sekmesi olan ekranlar
 * ---------------------------------------------------------------------------
 * Hangi modülün alt menüde duracağı panelden ayarlanıyor; kalanlar Diğer
 * ekranından açılıyor. Başlık çubuğundaki geri oku yalnızca bu ikinci
 * gruba gerekiyor — kendi sekmesi olan ekranda geri oku, personelin zaten
 * göründüğü yerden çıkmasını öneren anlamsız bir düğme oluyordu.
 *
 * Liste App.js'de kuruluyor ve buradan okunuyor: ekranların hangi
 * gruptan olduğunu tek tek prop ile taşımak, alt menü her değiştiğinde
 * elle güncellenmesi gereken ikinci bir liste bırakırdı.
 */

import { createContext, useContext } from "react";

export const SekmeBaglami = createContext([]);

/** Alt menüde sekmesi olan rota adları */
export const sekmeleriKullan = () => useContext(SekmeBaglami);
