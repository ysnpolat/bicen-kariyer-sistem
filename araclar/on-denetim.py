#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
---------------------------------------------------------------------------
C# Ön Denetim
---------------------------------------------------------------------------
Yayınlamadan önce çalıştırılır. Derleyiciye gitmeden yakalanabilecek sık
hataları arar:

  - Dengesiz süslü parantez, parantez ve köşeli parantez
  - Tam metin (@"...") içinde kapatılmamış tırnak
  - Model sınıflarında aynı alanın iki kez tanımlanması
  - Kullanılan ama tanımlanmamış yerel sınıflar

Kullanım:  python araclar/on-denetim.py
---------------------------------------------------------------------------
"""

import os
import pathlib
import re
import sys

KOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "BicenKariyer.API")

# Panel ve aday formu: eksik import taraması buralarda çalışır
PROJE_KOKU = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def tam_metin_tirnak(yol, icerik):
    """
    Tam metin (@"...") içinde kaçırılmamış çift tırnak arar.

    C#'ta @"..." bloğunda çift tırnak iki kez yazılmalıdır (""). Tek yazılırsa
    metin orada biter ve derleyici anlamsız sözdizimi hataları üretir.
    SQL yazarken kolayca yapılan bir hatadır.
    """
    sorunlar = []

    i = 0

    while True:
        bas = icerik.find('@"', i)
        if bas < 0:
            break

        j = bas + 2

        while j < len(icerik):
            if icerik[j] == '"':
                # İki tırnak yan yana ise kaçırılmış sayılır, metin sürüyor
                if j + 1 < len(icerik) and icerik[j + 1] == '"':
                    j += 2
                    continue
                break
            j += 1

        govde = icerik[bas + 2:j]

        # Asıl hata deseni: SQL metninin içinde tek çift tırnak.
        # İç içe metin ifadeleri ($@"..." içinde $"...") geçerlidir, o yüzden
        # yalnızca SQL anahtar kelimesi içeren gövdeler denetlenir.
        sqlMi = any(k in govde.upper() for k in
                    ("SELECT ", "INSERT ", "UPDATE ", "DELETE ", "CREATE "))

        if sqlMi:
            # SQL gövdesinde kaçırılmamış tek tırnak kalıntısı
            kalan = icerik[j + 1:j + 2] if j + 1 < len(icerik) else ""

            if kalan and kalan not in ' ,);\r\n\t':
                satir = icerik[:bas].count("\n") + 1
                parca = govde[-40:].replace("\n", " ")
                sorunlar.append(
                    f"{yol}:{satir} — SQL metni erken kapanmış "
                    f"(çift tırnak \"\" olarak yazılmalı): ...{parca}")

        i = j + 1

    return sorunlar


def tanimsiz_ozellik(yol, icerik):
    """
    Sınıfta tanımlı olmayan özellik kullanımını yakalar.

    `_alan` biçimindeki alanlar ayrı kontrol ediliyor; bu kontrol
    `IslemYapabilir`, `SubeSiniri` gibi büyük harfle başlayan özellikleri
    denetler. Başka denetleyiciden kod taşınırken tanımı unutulursa
    derleyici "does not exist in the current context" hatası verir.
    """
    sorunlar = []

    for m in re.finditer(r'^(public|internal)\s+(?:sealed\s+|abstract\s+|static\s+)?'
                         r'(?:partial\s+)?class\s+(\w+)', icerik, re.M):
        ad = m.group(2)

        try:
            bas = icerik.index("{", m.end())
        except ValueError:
            continue

        derinlik = 0
        son = None

        for j in range(bas, len(icerik)):
            if icerik[j] == "{":
                derinlik += 1
            elif icerik[j] == "}":
                derinlik -= 1
                if derinlik == 0:
                    son = j
                    break

        if son is None:
            continue

        govde = icerik[bas:son]
        tekSatir = re.sub(r'\s+', ' ', govde)

        # Tanımlı özellikler: private bool Ad => ...  veya  private bool Ad {
        tanimli = set(re.findall(
            r'(?:private|protected|public|internal) '
            r'(?:static |readonly |override |virtual )*'
            r'[\w<>,\[\]\?\.]+ ([A-Z]\w*) ?(?:=>|\{ ?get)',
            tekSatir))

        # Metodlar da tanımlı sayılır
        tanimli |= set(re.findall(
            r'(?:private|protected|public|internal) '
            r'(?:static |async |override |virtual )*'
            r'[\w<>,\[\]\?\.]+ ([A-Z]\w*)\(', tekSatir))

        # Bu kontrolde yalnızca bilinen yetki özellikleri aranır;
        # genel tarama yanlış alarm üretiyor.
        aranan = ["IslemYapabilir", "SubeSiniri", "OnayYetkisi",
                  "OzelVeriGorebilir", "UzmanSiniri", "BolgeSuzgeci",
                  "SubeSuzmesi"]

        for ozellik in aranan:
            if ozellik in tanimli:
                continue

            # Nesne alanı ataması (Ad = ...) ve SQL takma adı sayılmaz;
            # yalnızca koşul/ifade içindeki kullanım aranır.
            u = re.search(
                rf'(?<![\w.]){ozellik}(?!\s*=[^=])(?![\w(])', govde)

            if u:
                satir = icerik[:bas + u.start()].count("\n") + 1
                sorunlar.append(
                    f"{yol}:{satir} — sınıf {ad} içinde tanımsız özellik: {ozellik}")

    return sorunlar


def ham_metin_parantez(yol, icerik):
    """
    Ham metin icindeki suslu parantez kacirmalarini denetler.

    C#'ta ham metnin basindaki dolar sayisi, degisken yazmak icin kac
    suslu parantez gerektigini belirler. Tek dolarla acilan metinde
    degisken tek suslu parantezle yazilir ve duz metinde cift suslu
    parantez kullanilamaz; derleyici bunu iki kez acilis sayar:

        error CS9006: The interpolated raw string literal does not start
        with enough '$' characters
    """
    sorunlar = []

    for m in re.finditer(r'(\$+)"""', icerik):
        dolar = len(m.group(1))
        bas = m.end()

        son = icerik.find('"""', bas)
        if son < 0:
            continue

        govde = icerik[bas:son]

        if dolar == 1:
            k = govde.find("{{")

            if k >= 0:
                satir = icerik[:bas + k].count("\n") + 1

                sorunlar.append(
                    yol + ":" + str(satir) + " - tek dolarla acilan ham "
                    "metinde cift suslu parantez var; iki dolarla acip "
                    "degiskeni cift parantezle yaziniz (CS9006)")

    return sorunlar


def degisken_cakismasi(yol, icerik):
    """
    Ic ice kapsamlarda ayni adin yeniden tanimlanmasini yakalar (CS0136).

    Kardes kapsamlarda ayni ad kullanilabilir:

        try { var db = ...; }
        try { var db = ...; }        // sorun yok

        for (var i = 0; ...) { }
        for (var i = 0; ...) { }     // sorun yok, her for kendi kapsami

    Ic ice kapsamlarda kullanilamaz:

        var jeton = ...;
        if (...) { var jeton = ...; }   // CS0136

    Bu yuzden kapsam yigini tutulur. for/foreach/using basliklarindaki
    tanimlar o dongunun kendi kapsamina yazilir, metoda degil.
    """
    sorunlar = []

    for m in re.finditer(
            r'(?:public|private|protected|internal)\s+'
            r'(?:static\s+|async\s+|override\s+|virtual\s+)*'
            r'[\w<>,\[\]\?\.]+\s+(\w+)\s*\([^)]*\)\s*\{', icerik):

        metodAdi = m.group(1)

        try:
            bas = icerik.index("{", m.start())
        except ValueError:
            continue

        yigin = [{}]
        derinlik = 0
        i = bas

        while i < len(icerik):
            k = icerik[i]

            if k == "{":
                derinlik += 1
                if derinlik > 1:
                    yigin.append({})
                i += 1
                continue

            if k == "}":
                derinlik -= 1
                if derinlik == 0:
                    break
                if len(yigin) > 1:
                    yigin.pop()
                i += 1
                continue

            # for/foreach/using basligi: icindeki tanimlar dongunun kendi
            # kapsamina aittir, bu yuzden atlanir
            d = re.match(r'\b(for|foreach|using)\s*\(', icerik[i:i + 20])

            if d:
                kapanis = icerik.find(")", i)
                if kapanis > 0:
                    i = kapanis + 1
                    continue

            v = re.match(r'\b(?:using\s+)?var\s+(\w+)\s*=', icerik[i:i + 60])

            if v:
                ad = v.group(1)
                satir = icerik[:i].count("\n") + 1

                for kapsam in yigin:
                    if ad in kapsam:
                        sorunlar.append(
                            yol + ":" + str(satir) + " - '" + metodAdi +
                            "' metodunda '" + ad + "' adi ust kapsamda "
                            "tanimli (satir " + str(kapsam[ad]) +
                            "); C# buna izin vermez (CS0136)")
                        break

                yigin[-1][ad] = satir
                i += v.end()
                continue

            i += 1

    return sorunlar


def dinamik_takma_ad(yol, icerik):
    """
    Tipsiz db.Query çağrılarında büyük harfle başlayan SQL takma adlarını
    yakalar.

    Dapper tip belirtilmediğinde sözlük benzeri nesne döndürür.
    System.Text.Json sözlük ANAHTARLARINA camelCase kuralı uygulamaz;
    yalnızca sınıf özelliklerine uygular. Bu yüzden `SELECT id AS Id`
    panele `{"Id": 5}` olarak gider ve `k.id` tanımsız kalır.

    Doğrusu: tanımlı sınıf kullanmak (db.Query<Sinif>) ya da SQL'de küçük
    harfle takma ad vermek (`AS id`).
    """
    sorunlar = []

    for m in re.finditer(r'(\w+)\s*=\s*db\.Query\(\$?@"', icerik):
        degisken = m.group(1)

        # Metin gövdesini al
        bas = m.end()
        son = icerik.find('"', bas)

        while son > 0 and son + 1 < len(icerik) and icerik[son + 1] == '"':
            son = icerik.find('"', son + 2)

        if son < 0:
            continue

        sorgu = icerik[bas:son]

        # SQL tip adları takma ad değildir: CAST(x AS DATE)
        tipler = {
            "DATE", "DATETIME", "DATETIME2", "TIME", "INT", "BIGINT",
            "SMALLINT", "TINYINT", "BIT", "FLOAT", "REAL", "MONEY",
            "DECIMAL", "NUMERIC", "NVARCHAR", "VARCHAR", "CHAR", "NCHAR",
            "TEXT", "NTEXT", "UNIQUEIDENTIFIER", "VARBINARY", "XML",
        }

        buyukler = [
            x for x in re.findall(r'\bAS\s+([A-Z]\w*)', sorgu)
            if x.upper() not in tipler
        ]

        if not buyukler:
            continue

        # Yalnızca panele dönen sonuçlar önemlidir; sunucu içinde
        # kullanılan sorgularda takma adın biçimi sorun değildir.
        sonrasi = icerik[son:son + 6000]

        panele_donuyor = re.search(
            rf'return Ok\((?:new\s*\{{)?[^;]*\b{re.escape(degisken)}\b',
            sonrasi, re.S)

        if not panele_donuyor:
            continue

        if buyukler:
            satir = icerik[:m.start()].count("\n") + 1
            ornek = ", ".join(sorted(set(buyukler))[:4])

            sorunlar.append(
                f"{yol}:{satir} — tipsiz db.Query'de büyük harfli takma ad "
                f"({ornek}); panel okuyamaz. Tanımlı sınıf kullanın ya da "
                f"takma adı küçük harfle yazın.")

    return sorunlar


def dapper_parametreleri(yol, icerik):
    """
    Dapper çağrılarında noktalı kısayol kullanımını yakalar.

    `new { satir.Bolum }` yazıldığında Dapper parametre adını güvenilir
    biçimde türetemez ve çalışma anında "Must declare the scalar variable"
    hatası verir. Derleme sırasında görünmez; ancak kullanıcı o ekranı
    açtığında ortaya çıkar. Bu yüzden burada yakalanır.

    Doğrusu: `new { bolum = satir.Bolum }`
    """
    sorunlar = []

    cagri = re.compile(
        r'\.(?:Execute|ExecuteScalar|Query|QueryFirst|QuerySingle)'
        r'\w*(?:<[^>]*>)?\s*\(')

    for m in cagri.finditer(icerik):
        derinlik = 0
        bas = m.end() - 1
        govde = None

        for j in range(bas, min(bas + 8000, len(icerik))):
            if icerik[j] == "(":
                derinlik += 1
            elif icerik[j] == ")":
                derinlik -= 1
                if derinlik == 0:
                    govde = icerik[bas:j]
                    break

        if govde is None:
            continue

        for p in re.finditer(r'new\s*\{([^{}]*)\}', govde):
            for oge in p.group(1).split(","):
                oge = oge.strip()

                if oge and "=" not in oge and re.fullmatch(r'\w+\.\w+', oge):
                    satir = icerik[:m.start()].count("\n") + 1
                    sorunlar.append(
                        f"{yol}:{satir} — Dapper parametresi adlandırılmalı: "
                        f"{oge} → {oge.split('.')[1][0].lower()}"
                        f"{oge.split('.')[1][1:]} = {oge}")

    return sorunlar


def tanimsiz_alan(yol, icerik):
    """
    Sınıfta tanımlı olmayan alanların kullanımını yakalar.

    Bir denetleyiciye başka dosyadan kod taşınırken oradaki servis alanları
    (_kayit, _gunluk gibi) da geliyor ama tanım gelmiyor. Derleyici bunu
    "does not exist in the current context" ile reddediyor.
    """
    sorunlar = []

    for m in re.finditer(r'^(public|internal)\s+(?:sealed\s+|abstract\s+|static\s+)?'
                         r'(?:partial\s+)?class\s+(\w+)', icerik, re.M):
        ad = m.group(2)

        try:
            bas = icerik.index("{", m.end())
        except ValueError:
            continue

        derinlik = 0
        son = None

        for j in range(bas, len(icerik)):
            if icerik[j] == "{":
                derinlik += 1
            elif icerik[j] == "}":
                derinlik -= 1
                if derinlik == 0:
                    son = j
                    break

        if son is None:
            continue

        govde = icerik[bas:son]

        # Tanımlı alanlar: private readonly X _ad;  veya  private X _ad;
        # Tip adı jenerik olabilir ve tanım birden fazla satıra yayılabilir:
        #   private readonly ConcurrentDictionary<string, (string, DateTime)> _x
        #       = new();
        # Bu yüzden satır sonları boşluğa çevrilip tek satır gibi taranır.
        tekSatir = re.sub(r'\s+', ' ', govde)

        tanimli = set(re.findall(
            r'(?:private|protected|public|internal) '
            r'(?:readonly |static |volatile )*'
            r'[\w<>,\(\)\[\]\?\. ]+? (_\w+) ?(?:[;=]|=>)',
            tekSatir))

        # Kullanılanlar
        kullanilan = set(re.findall(r'(?<![\w.])(_\w+)\s*[.\(]', govde))

        for alan in sorted(kullanilan - tanimli):
            u = re.search(rf'(?<![\w.]){re.escape(alan)}\s*[.\(]', govde)
            satir = icerik[:bas + u.start()].count("\n") + 1
            sorunlar.append(f"{yol}:{satir} — sınıf {ad} içinde tanımsız alan: {alan}")

    return sorunlar


def metod_derinligi(yol, icerik):
    """
    Sınıf içindeki metodların doğru derinlikte olup olmadığını denetler.

    Bir metodun kapanış parantezi unutulursa sonraki metod onun içine
    girer; C# bunu "modifier is not valid" hatasıyla reddeder ama denge
    kontrolü bunu yakalayamaz çünkü toplam parantez sayısı tutar.
    """
    sorunlar = []

    for m in re.finditer(r'^(public|internal)\s+(?:sealed\s+|abstract\s+|static\s+)?'
                         r'(?:partial\s+)?class\s+(\w+)', icerik, re.M):
        ad = m.group(2)

        try:
            bas = icerik.index("{", m.end())
        except ValueError:
            continue

        derinlik = 0
        son = None

        for j in range(bas, len(icerik)):
            if icerik[j] == "{":
                derinlik += 1
            elif icerik[j] == "}":
                derinlik -= 1
                if derinlik == 0:
                    son = j
                    break

        if son is None:
            continue

        govde = icerik[bas:son]

        # Metod ve özellik tanımları sınıf gövdesinde derinlik 1'de olmalı
        for u in re.finditer(r'^    (public|private|protected|internal)\s+\S', govde, re.M):
            konum = u.start()
            d = govde[:konum].count("{") - govde[:konum].count("}")

            if d != 1:
                satir = icerik[:bas + konum].count("\n") + 1
                parca = govde[konum:konum + 60].split("\n")[0].strip()
                sorunlar.append(f"{yol}:{satir} — sınıf {ad} içinde yanlış derinlik "
                                f"({d}), muhtemelen kapanış parantezi eksik: {parca}")

    return sorunlar


def metinleri_ayikla(kaynak: str) -> str:
    """Metin ve yorumları boşaltarak yalnızca kodu döndürür."""
    sonuc = []
    i, n = 0, len(kaynak)

    while i < n:
        # Tam metin: @"..." ve $@"..."
        if kaynak[i] == "@" and i + 1 < n and kaynak[i + 1] == '"':
            i += 2
            while i < n:
                if kaynak[i] == '"':
                    if i + 1 < n and kaynak[i + 1] == '"':
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            sonuc.append('""')
            continue

        if kaynak[i] == "$" and kaynak.startswith('$@"', i):
            i += 3
            while i < n:
                if kaynak[i] == '"':
                    if i + 1 < n and kaynak[i + 1] == '"':
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            sonuc.append('""')
            continue

        if kaynak[i] == '"':
            i += 1
            while i < n:
                if kaynak[i] == "\\":
                    i += 2
                    continue
                if kaynak[i] == '"':
                    i += 1
                    break
                i += 1
            sonuc.append('""')
            continue

        if kaynak[i] == "'":
            i += 1
            while i < n:
                if kaynak[i] == "\\":
                    i += 2
                    continue
                if kaynak[i] == "'":
                    i += 1
                    break
                i += 1
            sonuc.append("''")
            continue

        if kaynak.startswith("//", i):
            while i < n and kaynak[i] != "\n":
                i += 1
            continue

        if kaynak.startswith("/*", i):
            son = kaynak.find("*/", i)
            i = son + 2 if son > 0 else n
            continue

        sonuc.append(kaynak[i])
        i += 1

    return "".join(sonuc)


def servis_uyeleri(yol, icerik):
    """
    Var olmayan servis metodu çağrılarını yakalar.

    _ayar.FormYaz(...) gibi bir çağrı, AyarServisi'nde böyle bir metot
    yoksa derlemede patlıyor ve bunu ancak sunucuda görüyoruz. Servis
    sınıflarının public üyeleri okunup çağrılarla karşılaştırılır.
    """
    sorunlar = []

    kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    servis_klasor = os.path.join(kok, "BicenKariyer.API", "Servisler")

    if not os.path.isdir(servis_klasor):
        return sorunlar

    # Servis sınıfı -> public üye adları
    uyeler = {}

    for dosya in os.listdir(servis_klasor):
        if not dosya.endswith(".cs"):
            continue

        try:
            metin = open(os.path.join(servis_klasor, dosya), encoding="utf-8").read()
        except OSError:
            continue

        for m in re.finditer(r"public\s+class\s+(\w+)", metin):
            ad = m.group(1)
            govde = metin[m.end():]

            sonraki = re.search(r"\npublic\s+(?:class|record|interface)\s", govde)
            if sonraki:
                govde = govde[: sonraki.start()]

            bulunan = set()

            # Genel metotlar: public void Yaz<T>(...)
            # Demet dönüşleri: public (string token, DateTime bitis) Uret(...)
            for u in re.finditer(
                r"public\s+(?:static\s+|async\s+|virtual\s+|override\s+)*"
                r"(?:\([^)]*\)|[\w<>,\[\]\?\. ]+?)\s+(\w+)\s*"
                r"(?:<[^>(]*>)?\s*[\(=;{]",
                govde,
            ):
                bulunan.add(u.group(1))

            uyeler[ad] = bulunan

    # Dosyadaki alan -> servis sınıfı eşlemesi
    alanlar = {}

    for m in re.finditer(r"private\s+readonly\s+(\w+)\s+(_\w+)\s*;", icerik):
        alanlar[m.group(2)] = m.group(1)

    for alan, sinif in alanlar.items():
        if sinif not in uyeler or not uyeler[sinif]:
            continue

        for c in re.finditer(re.escape(alan) + r"\.(\w+)\s*[\(<]", icerik):
            metot = c.group(1)

            if metot in uyeler[sinif]:
                continue

            satir = icerik[: c.start()].count("\n") + 1

            sorunlar.append(
                f"{yol}:{satir} — {sinif} sınıfında '{metot}' üyesi yok "
                f"({alan}.{metot})"
            )

    return sorunlar


# Ant Design'den gelen bileşenler. JSX'te kullanılıp import edilmezse
# derleme geçer ama tarayıcıda "X is not defined" hatası verir.
ANTD_BILESENLER = {
    "Alert", "App", "Avatar", "Badge", "Button", "Card", "Checkbox", "Col",
    "Collapse", "ConfigProvider", "DatePicker", "Descriptions", "Divider",
    "Drawer", "Dropdown", "Empty", "Form", "Image", "Input", "InputNumber",
    "Layout", "List", "Menu", "Modal", "Pagination", "Popconfirm", "Popover",
    "Progress", "Radio", "Result", "Row", "Segmented", "Select", "Skeleton",
    "Space", "Spin", "Statistic", "Steps", "Switch", "Table", "Tabs", "Tag",
    "Timeline", "Tooltip", "Tree", "Typography", "Upload",
}


def eksik_import(yol, icerik):
    """
    JSX'te kullanılıp import edilmemiş Ant Design bileşenlerini yakalar.

    esbuild yalnızca sözdizimine bakar; import eksikse derleme geçer ve
    hata ancak tarayıcıda ortaya çıkar. Bu kontrol o boşluğu kapatır.
    """
    if not yol.endswith(".tsx"):
        return []

    icerde = set()

    # Süslü parantezli importlar
    for m in re.finditer(r"import\s*\{([^}]*)\}\s*from", icerik):
        for ad in m.group(1).split(","):
            ad = ad.strip()
            if not ad:
                continue
            icerde.add(ad.split(" as ")[-1].strip() if " as " in ad else ad)

    # Varsayılan importlar: import App from "./App"
    for m in re.finditer(r"import\s+(\w+)\s*(?:,|from)", icerik):
        icerde.add(m.group(1))

    # Yerel tanımlar: const Marka = ..., function Tablo(...)
    for m in re.finditer(r"(?:const|function|class)\s+([A-Z]\w*)", icerik):
        icerde.add(m.group(1))

    # Yıkım: const { Text, Title } = Typography
    for m in re.finditer(r"(?:const|let|var)\s*\{([^}]*)\}\s*=", icerik):
        for ad in m.group(1).split(","):
            ad = ad.strip().split(":")[-1].strip().split("=")[0].strip()
            if ad:
                icerde.add(ad)

    # Tip tanımları: interface X, type X =
    for m in re.finditer(r"(?:interface|type)\s+(\w+)", icerik):
        icerde.add(m.group(1))

    sorunlar = []

    """
    JSX bileşenleri aranırken tip parametreleri (useRef<HTMLElement>,
    useState<Kayit>) dışarıda bırakılır: onlar da "<Ad" biçiminde
    görünüyor ama bileşen değil. Ayırt etmek için öncesinde harf ya da
    kapanış parantezi olmaması aranır.
    """
    for ad in sorted(set(re.findall(r"(?<![\w>)])<([A-Z]\w*)[\s/>]", icerik))):
        if ad in icerde:
            continue

        # Ant Design bileşeni
        if ad in ANTD_BILESENLER:
            sorunlar.append(
                f"{yol} — '{ad}' JSX'te kullanılıyor ama import edilmemiş"
            )
            continue

        # Nokta içeren bileşenler (Form.Item, Checkbox.Group) atlanır
        if "." in ad:
            continue

        # Lucide simgeleri: dosya lucide'den bir şey alıyorsa ve bu ad
        # da simge biçimindeyse (PascalCase, tek kelime değil) kontrol
        # edilir. Yerel bileşenler zaten "icerde" listesinde.
        if 'from "lucide-react"' in icerik and re.fullmatch(r"[A-Z][a-zA-Z0-9]*", ad):
            sorunlar.append(
                f"{yol} — '{ad}' JSX'te kullanılıyor ama import edilmemiş"
            )

    return sorunlar


def menu_anahtarlari():
    """
    Yönetim'deki menü sırası listesi ile App.tsx'teki gerçek menü
    anahtarlarını karşılaştırır.

    Uyuşmayan bir anahtar sessizce göz ardı ediliyor: kullanıcı sırayı
    kaydediyor ama o sayfa menünün sonunda kalıyor ve sebebi görünmüyor.
    """
    sorunlar = []

    kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(kok, "bicen-kariyer-ik", "src")

    app_yol = os.path.join(src, "App.tsx")
    yon_yol = os.path.join(src, "Yonetim.tsx")

    if not (os.path.isfile(app_yol) and os.path.isfile(yon_yol)):
        return sorunlar

    app = open(app_yol, encoding="utf-8").read()
    yon = open(yon_yol, encoding="utf-8").read()

    if "const TUMU:" not in yon or "const menuler = [" not in app:
        return sorunlar

    # App.tsx'teki tüm menü anahtarları
    i = app.index("const menuler = [")
    j = app.index("const menulerSirali") if "const menulerSirali" in app else len(app)
    gercek = set(re.findall(r'key:\s*"(\w+)"', app[i:j]))

    # Yönetim'deki sıralama listesi
    # Listenin sonu: "];" satırı. İlk "]" tip tanımına (}[]) ait, ona
    # bakılırsa liste hiç okunmuyor.
    k = yon.index("const TUMU:")
    son = yon.index("];", k)
    ayar = set(re.findall(r'\{\s*key:\s*"(\w+)"', yon[k:son]))

    for anahtar in sorted(ayar - gercek):
        sorunlar.append(
            f"{yon_yol} — menü sırası listesinde '{anahtar}' var ama "
            f"App.tsx'te böyle bir menü anahtarı yok"
        )

    return sorunlar


# Her yerde tanımlı olan adlar; bunlar için uyarı verilmez.
KURESEL_ADLAR = {
    "window", "document", "console", "Math", "JSON", "Number", "String",
    "Boolean", "Array", "Object", "Date", "Promise", "Set", "Map", "RegExp",
    "Error", "URLSearchParams", "FormData", "Blob", "File", "FileReader",
    "localStorage", "sessionStorage", "fetch", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", "navigator", "location", "history",
    "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat",
    "isNaN", "undefined", "null", "true", "false", "this", "React",
}


def tanimsiz_degisken(yol, icerik):
    """
    Bileşen içinde tanımlanmamış değişken kullanımını yakalar.

    Örnek: veri?.ozet yazılmış ama o dosyada 'veri' diye bir durum yok.
    TypeScript bunu yakalar ama esbuild tip denetimi yapmıyor; hata
    ancak tarayıcıda "veri is not defined" olarak çıkıyor.

    Yalnızca "?." ile erişilen adlara bakılır: bunlar neredeyse her zaman
    durum ya da veri nesnesidir ve yanlış alarm olasılığı düşüktür.
    """
    if not yol.endswith(".tsx"):
        return []

    tanimli = set(KURESEL_ADLAR)

    # const/let/var tanımları, yıkım (destructuring) dahil
    for m in re.finditer(r"(?:const|let|var)\s+(\w+)", icerik):
        tanimli.add(m.group(1))

    for m in re.finditer(r"(?:const|let|var)\s*\{([^}]*)\}", icerik):
        for ad in m.group(1).split(","):
            ad = ad.strip().split(":")[-1].strip().split("=")[0].strip()
            if ad:
                tanimli.add(ad)

    for m in re.finditer(r"(?:const|let|var)\s*\[([^\]]*)\]", icerik):
        for ad in m.group(1).split(","):
            ad = ad.strip().split("=")[0].strip()
            if ad:
                tanimli.add(ad)

    # import, function, class, parametreler
    for m in re.finditer(r"import\s*\{([^}]*)\}", icerik):
        for ad in m.group(1).split(","):
            ad = ad.strip()
            if ad:
                tanimli.add(ad.split(" as ")[-1].strip())

    for m in re.finditer(r"import\s+(\w+)", icerik):
        tanimli.add(m.group(1))

    for m in re.finditer(r"(?:function|class)\s+(\w+)", icerik):
        tanimli.add(m.group(1))

    for m in re.finditer(r"\(([^)]*)\)\s*(?:=>|\{)", icerik):
        for ad in re.findall(r"\b(\w+)\b", m.group(1)):
            tanimli.add(ad)

    sorunlar = []
    gorulen = set()

    for m in re.finditer(r"(?<![\w.$])(\w+)\?\.", icerik):
        ad = m.group(1)

        if ad in tanimli or ad in gorulen or ad[0].isupper() or ad[0].isdigit():
            continue

        gorulen.add(ad)
        satir = icerik[: m.start()].count("\n") + 1

        sorunlar.append(f"{yol}:{satir} — '{ad}' tanımlı değil ({ad}?. kullanımı)")

    return sorunlar


def cift_export(yol, icerik):
    """
    Aynı adla iki kez dışa aktarılan sabitleri yakalar.

    Var olan bir yardımcıyı fark etmeden yeniden tanımlamak derlemeyi
    kırıyor ve hata ancak sunucuda yayınlarken görülüyor.
    """
    if not (yol.endswith(".ts") or yol.endswith(".tsx")):
        return []

    adlar = {}
    sorunlar = []

    for m in re.finditer(r"export\s+(?:const|function|class)\s+(\w+)", icerik):
        ad = m.group(1)
        satir = icerik[: m.start()].count("\n") + 1

        if ad in adlar:
            sorunlar.append(
                f"{yol}:{satir} — '{ad}' iki kez dışa aktarılmış "
                f"(ilki {adlar[ad]}. satırda)"
            )
        else:
            adlar[ad] = satir

    return sorunlar


def api_yollari():
    """
    Panelin çağırdığı API yollarının sunucuda var olup olmadığını
    kontrol eder.

    Yanlış bir yol derlemede fark edilmiyor; hata ancak kullanıcı o
    düğmeye bastığında "404" olarak çıkıyor.
    """
    sorunlar = []

    kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    api_klasor = os.path.join(kok, "BicenKariyer.API", "Controllers")

    if not os.path.isdir(api_klasor):
        return sorunlar

    # Sunucudaki yollar: controller adı + HttpX yolu
    mevcut = set()

    for dosya in os.listdir(api_klasor):
        if not dosya.endswith(".cs"):
            continue

        metin = open(os.path.join(api_klasor, dosya), encoding="utf-8").read()

        for sm in re.finditer(r"public\s+class\s+(\w+)Controller", metin):
            sinif = sm.group(1)
            govde = metin[sm.end():]

            sonraki = re.search(r"public\s+class\s+\w+Controller", govde)
            if sonraki:
                govde = govde[: sonraki.start()]

            mevcut.add(f"api/{sinif}".lower())

            for hm in re.finditer(
                r'\[Http(?:Get|Post|Put|Delete|Patch)\("([^"]*)"\)\]', govde
            ):
                yol = hm.group(1).strip("/")
                # Parametreleri sadeleştir: {id:int} → *
                yol = re.sub(r"\{[^}]*\}", "*", yol)
                mevcut.add(f"api/{sinif}/{yol}".lower())

    # Panelin çağırdıkları
    for kok_dizin, _, dosyalar in os.walk(PROJE_KOKU):
        if "node_modules" in kok_dizin or "dist" in kok_dizin:
            continue

        for d in dosyalar:
            if not (d.endswith(".tsx") or d.endswith(".ts")):
                continue

            yol_dosya = os.path.join(kok_dizin, d)

            try:
                icerik = open(yol_dosya, encoding="utf-8").read()
            except OSError:
                continue

            for m in re.finditer(r'"(/api/[A-Za-z][\w/\-]*)', icerik):
                cagri = m.group(1).strip("/")

                # Değişken parçaları sadeleştir
                parcalar = [
                    "*" if p.startswith("$") or p.startswith("{") else p
                    for p in cagri.split("/")
                ]

                aday = "/".join(parcalar).lower()

                if aday in mevcut:
                    continue

                # Son parça parametre olabilir
                if len(parcalar) > 2:
                    kisa = "/".join(parcalar[:-1] + ["*"]).lower()
                    if kisa in mevcut:
                        continue

                    kisa2 = "/".join(parcalar[:-1]).lower()
                    if kisa2 in mevcut:
                        continue

                satir = icerik[: m.start()].count("\n") + 1

                sorunlar.append(
                    f"{yol_dosya}:{satir} — '{m.group(1)}' sunucuda bulunamadı"
                )

    return sorunlar


def modul_yollari():
    """
    Göreli import yollarının gerçekten var olan dosyaları gösterip
    göstermediğini kontrol eder.

    "./tema" yerine "../tema" yazılması gerektiğinde derleme sessiz
    kalıyor; hata ancak uygulama telefonda açılırken çıkıyor.
    """
    sorunlar = []

    mobil = os.path.join(PROJE_KOKU, "bicen-mobil")

    if not os.path.isdir(mobil):
        return sorunlar

    for dizin, _, dosyalar in os.walk(mobil):
        if "node_modules" in dizin:
            continue

        for d in dosyalar:
            if not (d.endswith(".js") or d.endswith(".jsx")):
                continue

            yol = os.path.join(dizin, d)

            try:
                icerik = open(yol, encoding="utf-8").read()
            except OSError:
                continue

            for m in re.finditer(r'from\s+"(\.[^"]+)"', icerik):
                hedef = os.path.normpath(os.path.join(dizin, m.group(1)))

                varMi = (
                    os.path.isfile(hedef)
                    or os.path.isfile(hedef + ".js")
                    or os.path.isfile(hedef + ".jsx")
                    or os.path.isfile(os.path.join(hedef, "index.js"))
                )

                if varMi:
                    continue

                satir = icerik[: m.start()].count("\n") + 1

                sorunlar.append(
                    f"{yol}:{satir} — '{m.group(1)}' dosyası bulunamadı"
                )

    return sorunlar


def model_alanlari(yol, icerik):
    """
    Bir model nesnesinde var olmayan alan kullanımını yakalar.

    p.SubeKodu gibi bir erişim, o sınıfta böyle bir özellik yoksa
    derlemede patlıyor ve ancak sunucuda görülüyor. Yalnızca yerel
    değişkeni bilinen türde olan erişimlere bakılır; yanlış alarm
    vermemek için tür çıkarımı yapılmaz.
    """
    if not yol.endswith(".cs"):
        return []

    kok = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    model_yol = os.path.join(kok, "BicenKariyer.API", "Modeller.cs")

    if not os.path.isfile(model_yol):
        return []

    try:
        modeller = open(model_yol, encoding="utf-8").read()
    except OSError:
        return []

    # Sınıf -> özellik adları
    siniflar = {}

    for m in re.finditer(r"public\s+class\s+(\w+)", modeller):
        ad = m.group(1)
        govde = modeller[m.end():]

        sonraki = re.search(r"\npublic\s+(?:class|record|enum|interface)\s", govde)
        if sonraki:
            govde = govde[: sonraki.start()]

        siniflar[ad] = {
            x.group(1)
            for x in re.finditer(r"public\s+[\w?<>\[\], ]+?\s+(\w+)\s*\{\s*get", govde)
        }

    sorunlar = []

    # "TurAdi degisken = " ya da "var degisken = ... as TurAdi"
    for m in re.finditer(r"\b(\w+)\s+(\w+)\s*=\s*(?:new\s+\1|[^;]*?as\s+\1)\b", icerik):
        tur, degisken = m.group(1), m.group(2)

        if tur not in siniflar or not siniflar[tur]:
            continue

        for e in re.finditer(re.escape(degisken) + r"\??\.(\w+)", icerik):
            alan = e.group(1)

            if alan in siniflar[tur]:
                continue

            # Metot çağrısı olabilir
            sonrasi = icerik[e.end(): e.end() + 2]
            if sonrasi.startswith("("):
                continue

            satir = icerik[: e.start()].count("\n") + 1

            sorunlar.append(
                f"{yol}:{satir} — {tur} sınıfında '{alan}' özelliği yok "
                f"({degisken}.{alan})"
            )

    return sorunlar


def tekrar_metot(yol, icerik):
    """
    Aynı sınıfta iki kez tanımlanmış metotları yakalar.

    Bir bloğu koda eklerken hedef metin dosyada birden çok yerde
    geçiyorsa aynı metot birkaç kez yazılabiliyor; hata ancak
    derlemede görülüyor.
    """
    if not yol.endswith(".cs"):
        return []

    sorunlar = []

    for m in re.finditer(r"public\s+class\s+(\w+)", icerik):
        sinif = m.group(1)
        govde = icerik[m.end():]

        sonraki = re.search(r"\npublic\s+class\s+\w+", govde)
        if sonraki:
            govde = govde[: sonraki.start()]

        gorulen = {}

        for u in re.finditer(
            r"(?:public|private|protected)\s+"
            # readonly ve sealed de değiştirici: listede olmayınca
            # "public static readonly (...)" bildirimi 'readonly' adlı bir
            # metot sanılıyor ve iki böyle alan olunca yinelenme
            # bildiriliyordu.
            r"(?:static\s+|async\s+|virtual\s+|override\s+"
            r"|readonly\s+|sealed\s+|const\s+|extern\s+|unsafe\s+)*"
            r"(?:\([^)]*\)|[\w<>,\[\]\?\. ]+?)\s+(\w+)\s*\(",
            govde,
        ):
            ad = u.group(1)

            # Yapıcı metot ve söz dizimi anahtarları atlanır
            if ad in (sinif, "if", "while", "for", "foreach", "switch",
                      "catch", "using", "lock", "return",
                      "readonly", "static", "const", "new"):
                continue

            if ad in gorulen:
                satir = icerik[: m.end() + u.start()].count("\n") + 1

                sorunlar.append(
                    f"{yol}:{satir} — {sinif} sınıfında '{ad}' metodu "
                    f"birden fazla kez tanımlanmış"
                )
            else:
                gorulen[ad] = True

    return sorunlar


def dosyalari_bul():
    for kok, _, dosyalar in os.walk(KOK):
        if "bin" in kok or "obj" in kok:
            continue
        for d in dosyalar:
            if d.endswith(".cs"):
                yield os.path.join(kok, d)


def panel_dosyalari():
    """Panel ve aday formundaki .tsx dosyaları."""
    for kok, _, dosyalar in os.walk(PROJE_KOKU):
        if "node_modules" in kok or "dist" in kok:
            continue
        for d in dosyalar:
            if d.endswith(".tsx") or d.endswith(".ts"):
                yield os.path.join(kok, d)


def tip_nitelemesi():
    """İçe aktarılmayan ad alanından tip kullanımı.

    C# derlemesi yapılamadığı için bu sınıf hata sunucuya kadar
    taşınıyordu: IDbConnection gibi tipler bazı dosyalarda tam adıyla
    yazılmış, yeni eklenen satırda kısa yazılınca derleme düşüyor.
    """
    tipler = {
        "IDbConnection": ("System.Data", "using System.Data;"),
        "DataTable": ("System.Data", "using System.Data;"),
    }

    for kok in ("BicenKariyer.API", "Bicen360.API"):
        for yol in pathlib.Path(kok).rglob("*.cs"):
            try:
                icerik = yol.read_text(encoding="utf-8")
            except OSError:
                continue

            for tip, (adalan, kalip) in tipler.items():
                if kalip in icerik:
                    continue

                for m in re.finditer(
                    r"(?<!" + re.escape(adalan) + r"\.)(?<![\w.])" + tip + r"\b",
                    icerik,
                ):
                    satir = icerik[: m.start()].count("\n") + 1

                    yield (f"{yol}:{satir} — '{tip}' tam adıyla yazılmalı "
                           f"({adalan}.{tip}); dosyada '{kalip}' yok")


def denetle() -> int:
    hata = 0

    for sorun in modul_yollari():
        print(f"[HATA] {sorun}")
        hata += 1

    for sorun in api_yollari():
        print(f"[HATA] {sorun}")
        hata += 1

    for sorun in menu_anahtarlari():
        print(f"[HATA] {sorun}")
        hata += 1

    for sorun in tip_nitelemesi():
        print(f"[HATA] {sorun}")
        hata += 1

    # Panel dosyaları: eksik import taraması
    for yol in panel_dosyalari():
        try:
            icerik = open(yol, encoding="utf-8").read()
        except OSError:
            continue

        for sorun in cift_export(yol, icerik):
            print(f"[HATA] {sorun}")
            hata += 1

        for sorun in tanimsiz_degisken(yol, icerik):
            print(f"[HATA] {sorun}")
            hata += 1

        for sorun in eksik_import(yol, icerik):
            print(f"[HATA] {sorun}")
            hata += 1


    # 1) Parantez dengesi
    for yol in dosyalari_bul():
        kaynak = open(yol, encoding="utf-8").read()
        kod = metinleri_ayikla(kaynak)

        for ac, kap, ad in (("{", "}", "süslü"), ("(", ")", "parantez"), ("[", "]", "köşeli")):
            if kod.count(ac) != kod.count(kap):
                print(f"[HATA] Dengesiz {ad}: {yol} ({kod.count(ac)}/{kod.count(kap)})")
                hata += 1

        # 1b) Metod derinliği: kapanış unutulduğunda denge tutar ama
        #     metodlar iç içe girer; derleyici bunu reddeder.
        if yol.endswith(".cs"):
            for sorun in metod_derinligi(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in tanimsiz_alan(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in dapper_parametreleri(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in dinamik_takma_ad(yol, kaynak):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in tekrar_metot(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in model_alanlari(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in servis_uyeleri(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in degisken_cakismasi(yol, kaynak):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in ham_metin_parantez(yol, kaynak):
                print(f"[HATA] {sorun}")
                hata += 1


            for sorun in tanimsiz_ozellik(yol, kod):
                print(f"[HATA] {sorun}")
                hata += 1

            for sorun in tam_metin_tirnak(yol, kaynak):
                print(f"[HATA] {sorun}")
                hata += 1

    # 2) Tam metin içinde erken kapanmış tırnak
    #
    #    SQL metninin içine yazılan yorumda çift tırnak kullanılırsa metin
    #    orada biter ve derleyici anlamsız hatalar üretir. Böyle bir durumda
    #    metin gövdesinde açılmış ama kapanmamış bir SQL yorumu kalır.
    for yol in dosyalari_bul():
        kaynak = open(yol, encoding="utf-8").read()

        for m in re.finditer(r'\$?@"', kaynak):
            bas = m.end()
            i = bas

            while i < len(kaynak):
                if kaynak[i] == '"':
                    if i + 1 < len(kaynak) and kaynak[i + 1] == '"':
                        i += 2
                        continue
                    break
                i += 1

            govde = kaynak[bas:i]
            satir = kaynak[: m.start()].count("\n") + 1

            if govde.count("/*") != govde.count("*/"):
                print(
                    f"[HATA] Metin erken kapanmış olabilir "
                    f"(yorum içinde çift tırnak?): {yol}:{satir}"
                )
                hata += 1

    # 3) Yinelenen model alanları
    modeller = os.path.join(KOK, "Modeller.cs")

    if os.path.exists(modeller):
        kaynak = open(modeller, encoding="utf-8").read()

        for blok in re.split(r"\npublic class ", kaynak)[1:]:
            ad = blok.split("\n")[0].split(":")[0].strip()
            alanlar = re.findall(r"public [\w\?<>, \[\]]+ (\w+) \{ get; set; \}", blok)
            yinelenen = {a for a in alanlar if alanlar.count(a) > 1}

            if yinelenen:
                print(f"[HATA] Yinelenen alan: {ad} -> {', '.join(yinelenen)}")
                hata += 1

    # 4) Tanımsız yerel sınıflar
    tanimlar = set()
    for yol in dosyalari_bul():
        kaynak = open(yol, encoding="utf-8").read()
        tanimlar |= set(re.findall(r"\b(?:class|record|enum|struct)\s+(\w+)", kaynak))

    yerlesik = {
        "List", "Dictionary", "HashSet", "Exception", "DateTime", "Guid",
        "SqlConnection", "StringBuilder", "Random", "Task", "JsonSerializerOptions",
        "BodyBuilder", "MailMessage", "InvalidOperationException", "JwtBearerEvents",
        "TokenValidationParameters", "SymmetricSecurityKey", "SigningCredentials",
        "JwtSecurityToken", "Claim", "ClaimsIdentity", "FileStreamResult",
    }

    for yol in dosyalari_bul():
        kaynak = open(yol, encoding="utf-8").read()

        for tip in re.findall(r"new List<(\w+)>|new (\w+)\s*\{", kaynak):
            ad = tip[0] or tip[1]
            if ad and ad[0].isupper() and ad not in tanimlar and ad not in yerlesik:
                print(f"[HATA] Tanımsız olabilir: {yol} -> {ad}")
                hata += 1

    if hata == 0:
        print("Denetim tamam: sorun bulunamadı.")

    return hata


