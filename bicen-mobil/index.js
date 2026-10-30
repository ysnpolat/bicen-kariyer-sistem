import { registerRootComponent } from "expo";

/**
 * Kök bileşen olarak açılış katmanı kaydediliyor, App doğrudan değil.
 *
 * App.js onlarca ekranı statik olarak içe aktarıyor ve bunlardan biri
 * yüklenirken hata verirse, hiçbir React bileşeni çizilmeden önce her şey
 * duruyor: ekran açılış görselinde donuyor ve hata görünmüyor. Açılış
 * katmanı önce kendini çizip uygulamayı sonra yüklüyor; hata çıkarsa
 * ekranda yazıyor.
 */
import Basla from "./Basla";

registerRootComponent(Basla);
