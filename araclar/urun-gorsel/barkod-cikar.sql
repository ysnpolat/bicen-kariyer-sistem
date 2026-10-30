/* ===========================================================================
 * Görseli olmayan ürünlerin barkodları
 * ===========================================================================
 * Çıktıyı metin olarak kaydedip gorsel-indir.py'ye veriniz.
 *
 * SSMS'te: sonuç penceresine sağ tık → Sonuçları Farklı Kaydet → barkodlar.txt
 * ya da sorgu sonucunu kopyalayıp bir metin dosyasına yapıştırınız.
 *
 * Zaten görseli olanlar dışarıda: aynı ürünü ikinci kez indirmek hem
 * zaman hem de açık bir hizmete gereksiz yük.
 * =========================================================================== */

SELECT DISTINCT b.bar_kodu
FROM [MikroDB_V15_BICEN].dbo.BARKOD_TANIMLARI b WITH (NOLOCK)
    INNER JOIN [MikroDB_V15_BICEN].dbo.STOKLAR s WITH (NOLOCK)
        ON s.sto_kod = b.bar_stokkodu
WHERE s.sto_pasif_fl = 0
  AND LEN(b.bar_kodu) BETWEEN 8 AND 13
  AND b.bar_kodu NOT LIKE '%[^0-9]%'
  AND NOT EXISTS (
        SELECT 1 FROM [biPortal].dbo.B360_URUN_GORSEL g
        WHERE g.stok_kodu = s.sto_kod
  )
ORDER BY b.bar_kodu;
