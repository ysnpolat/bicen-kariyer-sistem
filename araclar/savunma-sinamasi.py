#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===========================================================================
 BİÇEN KARİYER — SAVUNMA SINAMASI
===========================================================================

Başvuru formundaki bot korumalarını sınar. Her katmanı ayrı ayrı dener ve
hangisinin yakaladığını raporlar.

KULLANIM

    python savunma-sinamasi.py --adres https://kariyer.bicen.com.tr/apiservis

    python savunma-sinamasi.py --adres http://localhost:5177 --katman hepsi

SINANAN KATMANLAR

    1. tekrar-fotograf   Aynı fotoğrafla ikinci başvuru
    2. meta-degisim      Aynı fotoğraf, farklı JPEG yorumu (özet değişir)
    3. sablon            Aynı form şablonu, farklı kimlikler
    4. engelli-alan      Engellenen e-posta sağlayıcısı
    5. eposta-dogrulama  Doğrulama kodu olmadan gönderim
    6. yogunluk          Peş peşe başvuru (korumalı kip)
    7. yapay-zeka        Gerçek yüz olmayan fotoğraf

ÖNEMLİ

  - Yalnızca kendi sisteminizde çalıştırınız.
  - Gönderilen kayıtlar TEST ile başlayan adlarla oluşturulur; sonradan
    silmek kolay olsun diye.
  - Sınama sonunda hangi kayıtların oluştuğunu ve nasıl temizleneceğini
    yazar.
  - İstekler arasında bekleme vardır; sunucuyu yormaz.
===========================================================================
"""

import argparse
import base64
import hashlib
import io
import json
import random
import secrets
import struct
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Görsel üretimi
# ---------------------------------------------------------------------------


def jpeg_uret(genislik=480, yukseklik=640, renk=(120, 120, 120), yorum=None):
    """
    Küçük ama geçerli bir JPEG üretir.

    Dış kütüphane kullanılmaz; sunucunun kabul edeceği asgari yapı elle
    kurulur. `yorum` verildiğinde dosyaya JPEG yorum bölümü eklenir —
    botun özet değiştirmek için kullandığı yöntem budur.
    """
    parcalar = [b"\xff\xd8"]                       # SOI

    if yorum:
        veri = yorum.encode("ascii", "ignore")
        parcalar.append(b"\xff\xfe" + struct.pack(">H", len(veri) + 2) + veri)

    # Nicemleme tablosu: tüm katsayılar aynı
    parcalar.append(b"\xff\xdb" + struct.pack(">H", 67) + b"\x00" + bytes([16] * 64))

    # Kare bilgisi (SOF0), tek bileşen (gri)
    parcalar.append(
        b"\xff\xc0" + struct.pack(">H", 11) + b"\x08"
        + struct.pack(">HH", yukseklik, genislik)
        + b"\x01\x01\x11\x00")

    # Huffman tabloları: asgari geçerli tablolar
    dc_sayilar = bytes([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    dc_degerler = bytes(range(12))
    parcalar.append(
        b"\xff\xc4" + struct.pack(">H", 3 + len(dc_sayilar) + len(dc_degerler))
        + b"\x00" + dc_sayilar + dc_degerler)

    ac_sayilar = bytes([0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d])
    ac_degerler = bytes([1, 2, 3, 0, 4, 17, 5, 18, 33, 49, 65] + [0] * 151)
    parcalar.append(
        b"\xff\xc4" + struct.pack(">H", 3 + len(ac_sayilar) + len(ac_degerler))
        + b"\x10" + ac_sayilar + ac_degerler)

    # Tarama başlangıcı
    parcalar.append(b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00")

    # Görüntü verisi: renk değerine göre sabit bir dizi
    gri = renk[0] & 0xFF
    govde = bytes([gri, 0x00] * 900)
    parcalar.append(govde.replace(b"\xff", b"\xff\x00"))

    parcalar.append(b"\xff\xd9")                   # EOI

    return b"".join(parcalar)


def base64_gorsel(bayt):
    return "data:image/jpeg;base64," + base64.b64encode(bayt).decode()


# ---------------------------------------------------------------------------
# Sahte kimlik üretimi
# ---------------------------------------------------------------------------


def tc_uret():
    """
    Algoritmaya uygun bir T.C. kimlik numarası üretir.

    Gerçek bir kişiye ait olmaması için ilk hane 9 seçilir; bu aralık
    kullanımda değildir.
    """
    while True:
        h = [9] + [random.randint(0, 9) for _ in range(8)]

        tek = sum(h[0:9:2])
        cift = sum(h[1:8:2])

        onuncu = (tek * 7 - cift) % 10
        h.append(onuncu)
        h.append((sum(h[:10])) % 10)

        return "".join(map(str, h))


ADLAR = ["Test Deneme", "Sınama Kullanıcı", "Deneme Aday", "Test Başvuru"]


def form_uret(eposta=None, sabit_adres=False, fotograf=None, jeton=None):
    """Başvuru gövdesi üretir."""
    ad = random.choice(ADLAR) + " " + str(random.randint(100, 999))

    govde = {
        "adayAdSoyad": ad,
        "tcKimlikNo": tc_uret(),
        "telefon": "5" + "".join(str(random.randint(0, 9)) for _ in range(9)),
        "email": eposta or f"test.{secrets.token_hex(4)}@example.com",
        "dogumTarihi": "1995-06-15",
        "dogumYeri": "İstanbul",
        "cinsiyet": "Erkek",
        "medeniDurum": "Bekar",
        "askerlikDurumu": "Yapıldı",
        "egitimSeviyesi": "Lise",
        "il": "İstanbul",
        "ilce": "Avcılar" if not sabit_adres else "Arnavutköy",
        "mahalle": "Merkez Mahallesi" if not sabit_adres else "Anadolu Mahallesi",
        "caddeSokak": "Atatürk Caddesi",
        "binaNo": "12",
        "daireNo": "3",
        "kanGrubu": "A Rh+",
        "subeKodu": "SEFAKOY",
        "subeAdi": "Sefaköy Şubesi",
        "birimTuru": "Şube",
        "bolumler": ["Kasiyer"],
        "iseBaslamaTarihi": "2026-09-01",
        "kvkkOnay": True,
        "acikRizaOnay": True,
    }

    if fotograf:
        govde["fotograf"] = {"ad": "test.jpg", "base64": fotograf}

    if jeton:
        govde["dogrulamaJetonu"] = jeton

    return govde


# ---------------------------------------------------------------------------
# İstek gönderimi
# ---------------------------------------------------------------------------


def istek(adres, yol, govde=None, yontem=None):
    """Sunucuya istek gönderir; (durum, veri) döner."""
    tam = adres.rstrip("/") + yol

    veri = json.dumps(govde).encode() if govde is not None else None
    yontem = yontem or ("POST" if veri else "GET")

    r = urllib.request.Request(tam, data=veri, method=yontem)
    r.add_header("Content-Type", "application/json")
    r.add_header("User-Agent",
                 "BicenSavunmaSinamasi/1.0 (kendi sistemimizi siniyoruz)")

    try:
        with urllib.request.urlopen(r, timeout=45) as c:
            return c.status, json.loads(c.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        govde_metni = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(govde_metni or "{}")
        except json.JSONDecodeError:
            return e.code, {"ham": govde_metni[:200]}
    except Exception as e:
        return 0, {"hata": str(e)}


def basvur(adres, govde):
    return istek(adres, "/api/Basvuru", govde)


# ---------------------------------------------------------------------------
# Raporlama
# ---------------------------------------------------------------------------


class Rapor:
    def __init__(self):
        self.satirlar = []

    def ekle(self, katman, yakalandi, aciklama):
        self.satirlar.append((katman, yakalandi, aciklama))

        isaret = "YAKALADI " if yakalandi else "GEÇTİ    "
        print(f"    {isaret} {aciklama}")

    def ozet(self):
        print()
        print("=" * 71)
        print("  SONUÇ")
        print("=" * 71)

        yakalanan = sum(1 for _, y, _ in self.satirlar if y)
        toplam = len(self.satirlar)

        for katman, yakalandi, aciklama in self.satirlar:
            durum = "korumalı" if yakalandi else "AÇIK"
            print(f"  {katman:<22} {durum}")

        print()
        print(f"  {yakalanan}/{toplam} katman çalışıyor")

        acik = [k for k, y, _ in self.satirlar if not y]

        if acik:
            print()
            print("  Çalışmayan katmanlar:")
            for k in acik:
                print(f"    - {k}")
            print()
            print("  Sebebi ayarlarda ya da yayınlanmamış sürümde olabilir.")

        print("=" * 71)


# ---------------------------------------------------------------------------
# Sınamalar
# ---------------------------------------------------------------------------


def sina_tekrar_fotograf(adres, rapor, bekleme):
    """Aynı fotoğrafla iki başvuru; ikincisi reddedilmeli."""
    print("\n[1] Tekrar fotoğraf denetimi")

    foto = base64_gorsel(jpeg_uret(renk=(90, 90, 90)))

    d1, _ = basvur(adres, form_uret(fotograf=foto))
    time.sleep(bekleme)

    d2, v2 = basvur(adres, form_uret(fotograf=foto))

    yakalandi = d2 != 200 or "alınamadı" in str(v2).lower()

    rapor.ekle("Tekrar fotoğraf", yakalandi,
               f"İlk başvuru: {d1}, aynı fotoğrafla ikinci: {d2}")


def sina_meta_degisim(adres, rapor, bekleme):
    """Aynı görüntü, farklı JPEG yorumu; özet aynı kalmalı."""
    print("\n[2] Meta veri değişimi (botun son yöntemi)")

    ham = jpeg_uret(renk=(140, 140, 140))

    a = jpeg_uret(renk=(140, 140, 140), yorum=secrets.token_hex(16))
    b = jpeg_uret(renk=(140, 140, 140), yorum=secrets.token_hex(16))

    print(f"    Dosya özetleri farklı mı: "
          f"{hashlib.sha256(a).hexdigest()[:8]} / "
          f"{hashlib.sha256(b).hexdigest()[:8]}")

    d1, _ = basvur(adres, form_uret(fotograf=base64_gorsel(a)))
    time.sleep(bekleme)

    d2, v2 = basvur(adres, form_uret(fotograf=base64_gorsel(b)))

    yakalandi = d2 != 200 or "alınamadı" in str(v2).lower()

    rapor.ekle("Meta veri değişimi", yakalandi,
               f"İlk: {d1}, yorumu değiştirilmiş aynı görsel: {d2}")


def sina_sablon(adres, rapor, bekleme):
    """Aynı form şablonu farklı kimliklerle; üçüncüde yakalanmalı."""
    print("\n[3] Form şablonu tekrarı")

    durumlar = []

    for i in range(4):
        foto = base64_gorsel(jpeg_uret(renk=(70 + i * 30, 70, 70)))
        d, _ = basvur(adres, form_uret(sabit_adres=True, fotograf=foto))
        durumlar.append(d)
        time.sleep(bekleme)

    yakalandi = any(d != 200 for d in durumlar[2:])

    rapor.ekle("Şablon tekrarı", yakalandi,
               f"Dört başvurunun durumları: {durumlar}")


def sina_engelli_alan(adres, rapor, bekleme):
    """Engellenen sağlayıcıdan kod istemi reddedilmeli."""
    print("\n[4] Engellenen e-posta alan adı")

    d, v = istek(adres, "/api/Basvuru/KodGonder",
                 {"eposta": f"test.{secrets.token_hex(3)}@protonmail.com"})

    yakalandi = d != 200

    rapor.ekle("Engelli alan", yakalandi,
               f"protonmail.com ile kod isteği: {d} · {v.get('hata', '')}")


def sina_eposta_dogrulama(adres, rapor, bekleme):
    """Doğrulama jetonu olmadan başvuru reddedilmeli."""
    print("\n[5] E-posta doğrulaması")

    foto = base64_gorsel(jpeg_uret(renk=(180, 180, 180)))
    d, v = basvur(adres, form_uret(fotograf=foto))

    yakalandi = d != 200 and "doğrulama" in str(v).lower()

    rapor.ekle("E-posta doğrulama", yakalandi,
               f"Jetonsuz başvuru: {d} · {v.get('hata', '')}")


def sina_yogunluk(adres, rapor, bekleme):
    """Peş peşe başvuru; korumalı kip devreye girmeli."""
    print("\n[6] Yoğunluk denetimi (korumalı kip)")

    d, v = istek(adres, "/api/Basvuru/KorumaDurumu")

    if d == 401:
        rapor.ekle("Yoğunluk denetimi", None,
                   "Durum ucu yetki istiyor; panelden bakınız")
        return

    if d != 200:
        rapor.ekle("Yoğunluk denetimi", False,
                   f"Durum ucu yanıt vermedi: {d}")
        return

    print(f"    Ayar: {v.get('pencereDakika')} dakikada "
          f"{v.get('esik')} başvuru eşiği")
    print(f"    Son pencerede: {v.get('sonPencereBasvuru')} başvuru")

    yakalandi = v.get("acik") is True

    rapor.ekle("Yoğunluk denetimi", yakalandi,
               f"Korumalı kip {'AÇIK' if v.get('korumaliKip') else 'kapalı'}, "
               f"denetim {'etkin' if v.get('acik') else 'devre dışı'}")


def sina_yapay_zeka(adres, rapor, bekleme):
    """Gerçek yüz olmayan görsel; yapay zekâ reddetmeli."""
    print("\n[7] Yapay zekâ görsel incelemesi")

    # Düz renk bir görsel: insan yüzü içermez
    foto = base64_gorsel(jpeg_uret(renk=(200, 200, 200)))

    d, v = basvur(adres, form_uret(fotograf=foto))

    # Yapay zekâ reddettiğinde adaya başarı mesajı döner ama kayıt
    # incelemeye alınır; bu yüzden durum koduna bakmak yetmez.
    print("    Not: Yapay zekâ reddi adaya 200 döner ve kayıt İnceleme")
    print("         sekmesine düşer. Panelden doğrulayınız.")

    rapor.ekle("Yapay zekâ", None,
               f"Düz renk görselle başvuru: {d} · İnceleme sekmesini kontrol ediniz")


# ---------------------------------------------------------------------------
# Ana akış
# ---------------------------------------------------------------------------


SINAMALAR = {
    "tekrar-fotograf": sina_tekrar_fotograf,
    "meta-degisim": sina_meta_degisim,
    "sablon": sina_sablon,
    "engelli-alan": sina_engelli_alan,
    "eposta-dogrulama": sina_eposta_dogrulama,
    "yogunluk": sina_yogunluk,
    "yapay-zeka": sina_yapay_zeka,
}


def main():
    ayristirici = argparse.ArgumentParser(
        description="Başvuru formu savunma sınaması")

    ayristirici.add_argument("--adres", required=True,
                             help="API kök adresi, örn. https://.../apiservis")

    ayristirici.add_argument("--katman", default="hepsi",
                             help="Sınanacak katman ya da 'hepsi'")

    ayristirici.add_argument("--bekleme", type=float, default=2.0,
                             help="İstekler arası bekleme (saniye)")

    a = ayristirici.parse_args()

    print("=" * 71)
    print("  BİÇEN KARİYER — SAVUNMA SINAMASI")
    print("=" * 71)
    print(f"  Hedef  : {a.adres}")
    print(f"  Katman : {a.katman}")
    print("=" * 71)

    # Sunucu ayakta mı
    d, _ = istek(a.adres, "/api/Ayar/FormGenel")

    if d != 200:
        print(f"\n  Sunucuya ulaşılamadı ({d}). Adresi kontrol ediniz.")
        return 1

    print("\n  Sunucu yanıt veriyor.")

    rapor = Rapor()

    if a.katman == "hepsi":
        secilen = SINAMALAR.items()
    elif a.katman in SINAMALAR:
        secilen = [(a.katman, SINAMALAR[a.katman])]
    else:
        print(f"\n  Bilinmeyen katman: {a.katman}")
        print(f"  Seçenekler: {', '.join(SINAMALAR)}")
        return 1

    for ad, islev in secilen:
        try:
            islev(a.adres, rapor, a.bekleme)
        except Exception as hata:
            rapor.ekle(ad, False, f"Sınama hata verdi: {hata}")

        time.sleep(a.bekleme)

    rapor.ozet()

    print()
    print("  TEMİZLİK")
    print("  Sınama kayıtları TEST ile başlayan adlarla oluşturuldu:")
    print()
    print("    SELECT id, ad_soyad, olusturma FROM KRY_BASVURULAR")
    print("    WHERE ad_soyad LIKE 'Test%' OR ad_soyad LIKE 'Sınama%'")
    print("    ORDER BY id DESC;")
    print()
    print("  İnceleme sekmesindeki kayıtlar için:")
    print()
    print("    SELECT id, ad_soyad, ai_gerekce FROM KRY_AI_ENGELLENEN")
    print("    WHERE ad_soyad LIKE 'Test%' ORDER BY id DESC;")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
