/**
 * Sayfa Geçişi
 * ---------------------------------------------------------------------------
 * Panelde yönlendirici yok; sayfalar App içindeki bir durum değişkeniyle
 * değişiyor. Bildirim çekmecesinden "başvuruyu aç" gibi bir istek geldiğinde
 * hem sekmeyi değiştirmek hem hedef sayfaya hangi kaydın açılacağını
 * söylemek gerekiyor.
 *
 * Bu dosya o iki işi yapan küçük bir köprü. Olay yayınlanır, App sekmeyi
 * değiştirir, hedef sayfa açılışta bekleyen yükü okur ve temizler.
 *
 * Yük tek seferliktir: okunduğunda silinir, böylece kullanıcı sayfaya
 * ikinci kez geldiğinde aynı kayıt kendiliğinden açılmaz.
 */

type Yuk = { sekme: string; kayitId?: string | number } | null;

type Dinleyici = (sekme: string) => void;

let bekleyen: Yuk = null;
const dinleyiciler = new Set<Dinleyici>();

/** Bir sekmeye geç; istenirse orada açılacak kaydı da bildir */
export const sayfayaGit = (sekme: string, kayitId?: string | number) => {
  bekleyen = { sekme, kayitId };
  dinleyiciler.forEach((f) => f(sekme));
};

/** App bu dinleyiciyi kurar ve sekmeyi değiştirir */
export const gecisDinle = (f: Dinleyici) => {
  dinleyiciler.add(f);
  return () => dinleyiciler.delete(f);
};

/**
 * Hedef sayfa açılışta çağırır. Kendi sekmesi için bekleyen bir kayıt
 * varsa onu döner ve kaydı tüketir.
 */
export const bekleyenKayit = (sekme: string): string | null => {
  if (!bekleyen || bekleyen.sekme !== sekme) return null;

  const id = bekleyen.kayitId;
  bekleyen = null;

  return id === undefined || id === null ? null : String(id);
};

/** Kaynak ekran anahtarı → panel sekmesi */
export const EKRAN_SEKME: Record<string, string> = {
  basvuru: "basvurular",
  personel: "personeller",
  norm: "norm",
  gecis: "raporlar",
  cikismulakat: "cikismulakat",
  havuz: "havuz",
};
