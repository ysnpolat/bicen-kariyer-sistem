import { useCallback, useEffect, useRef, useState } from "react";
import { altSayfaAcik } from "./sayfaYetkileri";
import {
  App as AntdApp,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Layout,
  Space,
} from "antd";
import trTR from "antd/locale/tr_TR";
import dayjs from "dayjs";
import "dayjs/locale/tr";
import {
  BarChart3,
  Trophy,
  BrainCircuit,
  Briefcase,
  LayoutDashboard,
  ClipboardCheck,
  ShieldAlert,
  CalendarDays,
  ClipboardList,
  ScanLine,
  FlaskConical,
  Gauge,
  Contact,
  Target,
  TrendingDown,
  TrendingUp,
  LogOut,
  UserCog,
  Menu as MenuIkon,
  CalendarCheck,
  Megaphone,
  Newspaper,
  ShieldCheck,
  UsersRound,
  QrCode,
  Settings2,
  UserCircle2,
  Users,
  Receipt,
  FileText,
  GraduationCap,
  CreditCard,
  Wallet,
  Kanban,
  MessagesSquare,
  Scale,
  Inbox,
} from "lucide-react";

import Basvurular from "./Basvurular";
import BolgeOzeti from "./BolgeOzeti";
import BolgeSecici from "./BolgeSecici";
import UzmanSecici from "./UzmanSecici";
import { uzmanSifirla } from "./uzmanFiltresi";
import GorusmeTakibi from "./GorusmeTakibi";
import HareketsizlikDenetimi from "./HareketsizlikDenetimi";
import BildirimMerkezi from "./BildirimMerkezi";
import Checklistler from "./Checklistler";
import Pusulalar from "./Pusulalar";
import IzinDuzeni from "./IzinDuzeni";
import Egitimler from "./Egitimler";
import EtikHat from "./EtikHat";
import IsEmirleri from "./IsEmirleri";
import KunyeAnalizi from "./KunyeAnalizi";
import KazanKazan from "./KazanKazan";
import { gecisDinle } from "./gecis";
import { personelKartiDinle, personelKartiYetkisi } from "./personelKarti";
import KenarMenu, {
  DAR_ANAHTARI,
  TEMA_ANAHTARI,
  depoOku,
  depoYaz,
  menuYolu,
  menuyuGrupla,
  useKenarCekmece,
  type MenuGrubu,
  type MenuTema,
} from "./KenarMenu";
import Giris from "./Giris";
import Havuz from "./Havuz";
import GorusmeTakvimi from "./GorusmeTakvimi";
import CikisMulakati from "./CikisMulakati";
import PersonelPerformansi from "./PersonelPerformansi";
import PerformansBuyume from "./PerformansBuyume";
import PrimHakedis from "./PrimHakedis";
import BicenKart from "./BicenKart";
import KadroPlani from "./KadroPlani";
import Profil from "./Profil";
import Performans from "./Performans";
import Personeller from "./Personeller";
import Sirkulasyon from "./Sirkulasyon";
import Mesajlasma from "./Mesajlasma";
import HukukMasasi from "./HukukMasasi";
import MesajBildirim from "./MesajBildirim";
import Rapor from "./Rapor";
import YapayZekaIncelemesi from "./YapayZekaIncelemesi";
import ErisimDenetimi from "./ErisimDenetimi";
import YonetimRaporu from "./YonetimRaporu";
import YillikIzin from "./YillikIzin";
import IzinUcretleri from "./IzinUcretleri";
import VardiyaKarekod from "./VardiyaKarekod";
import IzinTalepleri from "./IzinTalepleri";
import MobilDuyurular from "./Duyurular";
import HaberYonetimi from "./HaberYonetimi";
import EkibimAyar from "./EkibimAyar";
import Aydinlatma from "./Aydinlatma";
import TestVerisi from "./TestVerisi";
import QrKodlar from "./QrKodlar";
import Yonetim from "./Yonetim";
import IsPlanlamasi from "./IsPlanlamasi";
import {
  ROL_ADLARI,
  rolAdlariniYaz,
  rolleriGetir,
  adminMi,
  api,
  bolgeSecici,
  formAyari,
  saltOkunur,
  taklitModu,
  ozetEkrani,
  performansGorme,
  tamYonetim,
  islemYetkisi,
  incelemeYetkisi,
  yonetimRaporu,
  oturumOku,
  oturumSil,
  oturumYaz,
  yalnizcaFotograf,
  type Oturum,
  haberYonetimi,
} from "./api";
import { RENK } from "./sabitler";
import Yenilikler from "./Yenilikler";
import Talep from "./Talep";
import Talepler from "./Talepler";
import { okunmamisSayisi, gorunenYenilikler } from "./yenilikListesi";
import { panelGorunumYenile } from "./panelGorunum";

dayjs.locale("tr");

const { Header, Content } = Layout;

/**
 * Açılışta gösterilecek sayfa.
 *
 * Rol Yetkileri'nde menü listesi boşsa kısıtlama yok demektir ve
 * varsayılan sayfa Başvurular'dır. Liste doluysa Başvurular (ya da aynı
 * sayfanın bölge rollerindeki karşılığı Özet) işaretli değilken o sayfayı
 * açmak, kullanıcıyı menüsünde bulunmayan bir ekranda bırakıyordu.
 *
 * Yalnızca yöneticiye açılan sayfalar atlanıyor: ayarla verilemedikleri
 * için listede bulunsalar da o role açılmıyorlar.
 */
/* Yıllık İzin Ücretleri (izinucreti) ücret verisi gösteriyor: yalnızca
   Yönetici; Rol Yetkileri'nde işaretlense de başka role açılmaz. */
const YALNIZ_YONETICI = ["zeka", "erisim", "test", "izinucreti"];

/* 16.10.2026: açık sayfa adres çubuğunda (#personeller) tutulur; sayfa
   yenilenince aynı ekranda açılır, tarayıcının geri/ileri tuşları çalışır. */
function adrestekiSekme(): string | null {
  try {
    const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).trim();
    return /^[a-z0-9_-]{2,40}$/i.test(h) ? h : null;
  } catch {
    return null;
  }
}

function acilisSekmesi(oturum: Oturum | null): string {
  const izinli = oturum?.yetki?.menuler ?? [];

  if (izinli.length === 0) return "basvurular";

  if (izinli.includes("basvurular") || izinli.includes("ozet"))
    return "basvurular";

  return izinli.find((k) => !YALNIZ_YONETICI.includes(k)) ?? "basvurular";
}

export default function App() {
  const [oturum, setOturum] = useState<Oturum | null>(oturumOku());

  /* Test verisi üretimi sunucu ayarıyla kapatılabilir */
  const [testAcik, setTestAcik] = useState(false);

  /* Sol menü sırası; Yönetim ekranından ayarlanır */
  const [menuSirasi, setMenuSirasi] = useState<string[]>([]);
  const [menuGruplari, setMenuGruplari] = useState<Record<string, string>>({});

  /* Rol yetkisi canlı (21.10.2026): yetki değişince yeniden giriş
     gerekmesin. Açılışta, sekmeye dönüldüğünde ve 5 dakikada bir okunur. */
  useEffect(() => {
    if (!oturum?.token) return;
    let iptal = false;

    const yenile = () =>
      api
        .al<any>("/api/Ayar/Yetkim")
        .then((d) => {
          if (iptal) return;
          const guncel = oturumOku();
          if (!guncel || guncel.token !== oturum.token) return;
          const yeni = d?.yetki ?? undefined;
          if (JSON.stringify(yeni ?? null) === JSON.stringify(guncel.yetki ?? null)) return;
          const o = { ...guncel, yetki: yeni };
          oturumYaz(o);
          setOturum(o);
        })
        .catch(() => undefined);

    yenile();
    const zaman = window.setInterval(yenile, 5 * 60 * 1000);
    const gorunur = () => document.visibilityState === "visible" && yenile();
    document.addEventListener("visibilitychange", gorunur);

    return () => {
      iptal = true;
      window.clearInterval(zaman);
      document.removeEventListener("visibilitychange", gorunur);
    };
  }, [oturum?.token]);

  useEffect(() => {
    if (!oturum) return;

    api
      .al<any>("/api/Ayar/FormGenel")
      .then((d) => {
        setMenuSirasi(d?.menuSirasi ?? []);
        setMenuGruplari(d?.menuGruplari ?? {});
      })
      .catch(() => undefined);
  }, [oturum]);

  /* Kenar menünün başlığı ve logosu (Yönetim → Panel Görünümü). Son
     değer tarayıcıda tutuluyor; istek sürerken ya da hata verirse menü
     onu (yoksa varsayılanı) gösterir. Kaydedilince ayar ekranı yeniler. */
  useEffect(() => {
    if (!oturum) return;

    panelGorunumYenile();
  }, [oturum]);

  /* Panelden açılan rollerin adları: rol kodu ekranlarda ham görünmesin.
     Giriş yapıldıktan sonra bir kez okunuyor, rol listesi sık değişmiyor. */
  useEffect(() => {
    if (!oturum) return;

    rolleriGetir()
      .then((d) => rolAdlariniYaz(d?.roller ?? []))
      .catch(() => undefined);
  }, [oturum]);

  /* İş Planlaması yalnızca iki sicile açık; kapı sunucuda (sicil),
     Rol Yetkileri'nden açılamaz. Menü öğesi sunucu "açık" derse çizilir. */
  const [isPlaniAcik, setIsPlaniAcik] = useState(false);

  /* Hukuk masası (24.10.2026): menü öğesi sunucu "yetkili" derse çizilir */
  const [hukukAcik, setHukukAcik] = useState(false);

  useEffect(() => {
    if (!oturum || oturum.rol === "HukukDanisman") {
      setHukukAcik(false);
      return;
    }
    api
      .al<{ yetkili: boolean }>("/api/Hukuk/Ben")
      .then((d) => setHukukAcik(!!d?.yetkili))
      .catch(() => setHukukAcik(false));
  }, [oturum]);

  useEffect(() => {
    if (!oturum || oturum.rol === "HukukDanisman") {
      setIsPlaniAcik(false);
      return;
    }

    api
      .al<{ acik: boolean }>("/api/IsPlani/Erisim")
      .then((d) => setIsPlaniAcik(!!d?.acik))
      .catch(() => setIsPlaniAcik(false));
  }, [oturum]);

  useEffect(() => {
    if (!oturum) return;

    api
      .al<{ acik: boolean }>("/api/Test/Durum")
      .then((d) => setTestAcik(!!d?.acik))
      .catch(() => setTestAcik(false));
  }, [oturum]);

  /* Açılış sayfası rol yetkisine göre.

     Sabit "basvurular" ile başlıyordu ve rol bu sayfayı görmese bile ilk
     açılışta ya da yenilemede o sayfa yükleniyordu: menüde yok ama ekranda
     duruyordu. Menüden seçim yapılınca düzeliyor, yenileyince geri
     dönüyordu.

     Hesap render sırasında yapılıyor, etki içinde değil: etkiyle
     düzeltmek önce yanlış sayfayı bir kez çizdiriyor ve o sayfanın
     istekleri boşuna gidiyor. */
  const [sekme, setSekme] = useState(() =>
    oturum ? adrestekiSekme() ?? acilisSekmesi(oturum) : acilisSekmesi(oturum)
  );

  /* Adresten gelen sayfa, menü kurulunca bir kez yetkiye göre denetlenir */
  const adrestenDenetle = useRef(!!adrestekiSekme());

  /* Aynı sekmede giriş yapıldığında başlangıç değeri yeniden
     hesaplanmıyor; oturum değiştiğinde bir kez düzeltiliyor. */
  const acilisDuzeltildi = useRef(false);

  useEffect(() => {
    if (!oturum) {
      acilisDuzeltildi.current = false;
      return;
    }

    if (acilisDuzeltildi.current) return;

    acilisDuzeltildi.current = true;

    /* Yenilemede oturum zaten açık: adresteki sayfa korunur */
    const adres = adrestekiSekme();
    if (adres) {
      adrestenDenetle.current = true;
      setSekme(adres);
    } else setSekme(acilisSekmesi(oturum));
  }, [oturum]);

  /* Seçili sayfa adrese yazılır; ilk yazım geçmişe kayıt eklemez */
  const ilkAdres = useRef(true);
  useEffect(() => {
    if (!oturum) return;
    try {
      if (window.location.hash === `#${sekme}`) {
        ilkAdres.current = false;
        return;
      }
      const yeni = `${window.location.pathname}${window.location.search}#${sekme}`;
      if (ilkAdres.current) window.history.replaceState(null, "", yeni);
      else window.history.pushState(null, "", yeni);
      ilkAdres.current = false;
    } catch {
      /* adres yazılamazsa sayfa yine çalışır */
    }
  }, [sekme, oturum]);

  /* Geri / ileri tuşları */
  useEffect(() => {
    const dinle = () => {
      const adres = adrestekiSekme();
      if (adres) {
        adrestenDenetle.current = true;
        setSekme(adres);
      }
    };
    window.addEventListener("popstate", dinle);
    return () => window.removeEventListener("popstate", dinle);
  }, []);

  /* Bildirim çekmecesinden gelen sayfa geçişleri: iş emrindeki "Gör"
     düğmesi ilgili sayfaya atlatır, kaydı sayfa kendisi açar. */
  useEffect(() => gecisDinle((hedef) => setSekme(hedef)), []);

  /* Her sayfadan personel kartı (09.10.2026): adına tıklanan personelin
     kartı sayfadan ayrılmadan açılır */
  const [kartKod, setKartKod] = useState<string | null>(null);
  useEffect(() => personelKartiDinle(setKartKod), []);

  /* Başvurular sayfasından çıkınca uzman süzgeci sıfırlanır: seçici
     görünmediği hâlde süzgecin açık kalması şaşırtıcı olurdu. */
  useEffect(() => {
    if (sekme !== "basvurular" && sekme !== "izintalep") uzmanSifirla();
  }, [sekme]);
  /* Kenar menü: dar (yalnızca simgeler) ya da geniş, açık ya da koyu.
     Tercih tarayıcıda saklanır; okuma/yazma KenarMenu'deki try/catch'li
     yardımcılarla yapılır. */
  const [kapali, setKapaliDurum] = useState(() => depoOku(DAR_ANAHTARI) === "1");
  const setKapali = useCallback((v: boolean) => {
    setKapaliDurum(v);
    depoYaz(DAR_ANAHTARI, v ? "1" : "0");
  }, []);

  const [menuTemasi, setMenuTemasiDurum] = useState<MenuTema>(() =>
    depoOku(TEMA_ANAHTARI) === "acik" ? "acik" : "koyu"
  );
  const setMenuTemasi = useCallback((t: MenuTema) => {
    setMenuTemasiDurum(t);
    depoYaz(TEMA_ANAHTARI, t);
  }, []);

  const [profilAcik, setProfilAcik] = useState(false);

  /* Yenilikler ve Talep/Öneri (30.10.2026).
     okunan: sunucudaki "son okunan yenilik no"; null = henüz alınmadı. */
  const [okunan, setOkunan] = useState<number | null | undefined>(undefined);
  const [yenilikKip, setYenilikKip] = useState<"yeni" | "hepsi" | null>(null);
  const [talepAcik, setTalepAcik] = useState(false);

  useEffect(() => {
    if (!oturum?.token) return;
    let iptal = false;
    api
      .al<{ no: number | null }>("/api/Yenilikler/Okunan")
      .then((c) => {
        if (iptal) return;
        setOkunan(c?.no ?? null);
        /* Okunmamış ve yetkiye giren yenilik varsa pencere kendiliğinden açılır */
        if (okunmamisSayisi(oturum, c?.no ?? null) > 0) setYenilikKip("yeni");
      })
      .catch(() => {
        if (!iptal) setOkunan(null);
      });
    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oturum?.token]);

  const yenilikKapat = (enBuyuk: number | null) => {
    setYenilikKip(null);
    if (enBuyuk === null || !oturum || oturum.taklitEden) return;
    if ((okunan ?? 0) >= enBuyuk) return;
    setOkunan(enBuyuk);
    api.guncelle("/api/Yenilikler/Okunan", { no: enBuyuk }).catch(() => undefined);
  };

  /* Telefonda menü çekmece olarak açılır.

     Bu iki satır aşağıda, oturum denetimlerinin ARDINDA duruyordu.
     React hook'ların her çizimde aynı sırayla ve aynı sayıda
     çağrılmasını şart koşar; oturum açılıp kapandığında erken return
     devreye girip bu hook'lar atlanıyor, hook sayısı değişiyor ve
     React tüm ağacı söküyordu. Giriş ve çıkışta görülen boş ekranın
     sebebi buydu (React hatası #310). */
  /* 992 pikselin altında kenar menü çekmeceye dönüşür (eski Sider'ın
     "lg" kırılımı). Telefon görünümündeki tablo/kart eşiği (768) ayrı. */
  const darEkran = useKenarCekmece();
  const [menuAcik, setMenuAcik] = useState(false);

  /* Çekmecede Ctrl+K: önce çekmece açılır, sonra arama kutusuna gidilir */
  const [aramaIstegi, setAramaIstegi] = useState(0);

  useEffect(() => {
    if (!darEkran) return;

    const tus = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenuAcik(true);
        setAramaIstegi((n) => n + 1);
      }
    };

    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [darEkran]);

  /* Geniş ekrana dönülünce açık kalmış çekmece kapanır */
  useEffect(() => {
    if (!darEkran) setMenuAcik(false);
  }, [darEkran]);

  /* Menü rozetleri: bekleyen işlerin sayısı. Dakikada bir, pencere odağa
     geldiğinde ve sayfa değiştiğinde (bir talep onaylanınca sayı düşsün)
     tazelenir. Uç yoksa ya da hata verirse rozet çıkmaz, menü etkilenmez. */
  const [menuSayilari, setMenuSayilari] = useState<Record<string, number | null>>({});

  /* Mesajlar rozeti MesajBildirim'in 8 saniyelik özetinden gelir */
  const [mesajSayisi, setMesajSayisi] = useState(0);
  useEffect(() => {
    const f = (e: Event) => setMesajSayisi(Number((e as CustomEvent).detail) || 0);
    window.addEventListener("mesaj-okunmamis", f);
    return () => window.removeEventListener("mesaj-okunmamis", f);
  }, []);

  const sayilariGetir = useCallback(() => {
    const o = oturumOku();
    if (!o || yalnizcaFotograf(o)) return;

    api
      .al<Record<string, number | null>>("/api/Panel/MenuSayilari")
      .then((d) => setMenuSayilari(d ?? {}))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!oturum) {
      setMenuSayilari({});
      return;
    }

    sayilariGetir();

    const zaman = window.setInterval(sayilariGetir, 60_000);
    window.addEventListener("focus", sayilariGetir);

    return () => {
      window.clearInterval(zaman);
      window.removeEventListener("focus", sayilariGetir);
    };
  }, [oturum, sayilariGetir]);

  /* Taklit şeridinin yüksekliği: üst bar onun altına yapışsın */
  const taklitRef = useRef<HTMLDivElement>(null);
  const [taklitYuksekligi, setTaklitYuksekligi] = useState(0);
  const taklitVar = !!oturum?.taklitEden;

  useEffect(() => {
    const el = taklitRef.current;

    if (!taklitVar || !el) {
      setTaklitYuksekligi(0);
      return;
    }

    const olc = () => setTaklitYuksekligi(el.offsetHeight);
    olc();

    if (typeof ResizeObserver === "undefined") return;

    const gozlem = new ResizeObserver(olc);
    gozlem.observe(el);
    return () => gozlem.disconnect();
  }, [taklitVar, darEkran]);

  const ilkSekme = useRef(true);

  useEffect(() => {
    if (ilkSekme.current) {
      ilkSekme.current = false;
      return;
    }

    const t = window.setTimeout(sayilariGetir, 1500);
    return () => window.clearTimeout(t);
  }, [sekme, sayilariGetir]);

  const cikis = () => {
    oturumSil();
    setOturum(null);

    /* Ekran durumu sıfırlanır; sonraki girişte eski sekmede açılmasın */
    setSekme("basvurular");
    setProfilAcik(false);
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* yok sayılır */
    }
  };

  const tema = {
    locale: trTR,
    /* Açılır listeler ve takvim panelleri sayfa gövdesine eklenir;
       telefon tarayıcılarında kırpılma sorununu önler. */
    getPopupContainer: () => document.body,
    theme: {
      token: {
        colorPrimary: RENK.yesil,
        colorLink: RENK.yesilKoyu,
        borderRadius: 8,
        fontFamily:
          "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif",
      },
    },
  };

  if (!oturum) {
    return (
      <ConfigProvider {...tema}>
        <AntdApp>
          <Giris girisYapildi={setOturum} />
        </AntdApp>
      </ConfigProvider>
    );
  }

  /* Dış hukuk danışmanı yalnız hukuk masasını görür (sunucu da diğer uçları kapatır) */
  if (oturum.rol === "HukukDanisman") {
    return (
      <ConfigProvider {...tema}>
        <AntdApp>
          <HukukMasasi key={oturum.kullaniciAdi} bagimsiz cikis={cikis} />
        </AntdApp>
      </ConfigProvider>
    );
  }

  /* Oturum değiştiğinde alt bileşenler baştan kurulsun.
     Aksi hâlde giriş sonrası eski durumla kalıp boş ekran gösterebilirler. */
  const oturumAnahtari = oturum.kullaniciAdi + (oturum.taklitEden ?? "");

  /* Fotoğraf görevlisi yalnızca personel listesine erişir */
  if (yalnizcaFotograf(oturum)) {
    return (
      <ConfigProvider {...tema}>
        <AntdApp key={oturumAnahtari}>
          <Layout className="ik-duzen">
            {/* Ana düzenle aynı başlık sınıfları kullanılır; bu role özel
                yazılmış eski sınıflar (ik-ustbar / ik-marka) stil
                dosyasında tanımlı olmadığı için başlık biçimsiz kalıyor,
                logo arka plana karışıyor ve çıkış görünmüyordu. */}
            <Header className="ik-baslik">
              <span className="ik-sayfa-basligi">Personel Fotoğrafları</span>

              <Dropdown
                menu={{
                  items: [
                    {
                      key: "rol",
                      label: ROL_ADLARI[oturum.rol] ?? oturum.rol,
                      disabled: true,
                    },
                    { type: "divider" },
                    {
                      key: "cikis",
                      label: "Çıkış yap",
                      icon: <LogOut size={14} strokeWidth={2} />,
                      onClick: cikis,
                    },
                  ],
                }}
              >
                <Button type="text" className="ik-kullanici">
                  <UserCircle2 size={17} strokeWidth={2} />
                  <span>{oturum.adSoyad || oturum.kullaniciAdi}</span>
                </Button>
              </Dropdown>
            </Header>

            <Content className="ik-icerik">
              <Personeller />
            </Content>
          </Layout>
        </AntdApp>
      </ConfigProvider>
    );
  }

  /* Kenar menü grupları — sayfa anahtarına göre.

     YENİ BİR SAYFA EKLERKEN anahtarını buraya da yazın (katalog ve
     menuler listelerine ek olarak). Yazılmazsa sayfa kaybolmaz, menünün
     sonundaki "Diğer" grubuna düşer. Grup içi sıra buradaki sıradır;
     Yönetim'den menü sırası ayarlanmışsa grup içinde o sıra geçerli olur.
     Rolde görünür öğesi kalmayan grup hiç çizilmez. */
  const MENU_GRUPLARI: MenuGrubu[] = [
    { ad: "Genel", anahtarlar: ["mesajlasma", "hukuk", "isplani", "yonetimraporu", "zeka", "erisim"] },
    { ad: "İşe Alım", anahtarlar: ["basvurular", "havuz", "takvim", "cikismulakat"] },
    {
      ad: "Personel",
      anahtarlar: [
        "personeller", "kadro", "sirkulasyon", "personelperformansGrup",
        "performans", "egitim", "pusula",
      ],
    },
    {
      ad: "İzin ve Vardiya",
      anahtarlar: ["izintalep", "yillikizin", "izinduzeni", "vardiyakarekod", "qr"],
    },
    { ad: "Operasyon", anahtarlar: ["isemri", "checklist", "kunye", "kazankazan", "mobilduyuru", "haberler", "etik"] },
    /* İzin ücretleri bir yükümlülük raporu (para), izin işlemi değil;
       İzin grubundaki sayfaları İK günlük kullanıyor, bu ise yalnızca
       yöneticinin baktığı bir rapor. */
    { ad: "Kart ve Raporlar", anahtarlar: ["bicenkart", "rapor", "izinucreti"] },
    { ad: "Sistem", anahtarlar: ["yonetim", "talepler", "test"] },
  ];

  /* Tüm menü kataloğu — koşulsuz. Rol ayarı doluyken menü buradan
     kurulur; koşullu liste (aşağıdaki menuler) yalnızca ayar boşken
     geçerli varsayılandır. Yeni bir sayfa eklerken iki listeye de yazın. */
  const katalog: any[] = [
    { key: "basvurular", label: ozetEkrani(oturum) ? "Özet" : "Başvurular",
      icon: <ClipboardList size={16} strokeWidth={2} /> },
    { key: "zeka", label: "İnceleme", icon: <BrainCircuit size={16} strokeWidth={2} /> },
    { key: "erisim", label: "Erişim Denetimi", icon: <ShieldAlert size={16} strokeWidth={2} /> },
    { key: "yonetimraporu", label: "Yönetim Raporu", icon: <LayoutDashboard size={16} strokeWidth={2} /> },
    { key: "havuz", label: "Aday Havuzu", icon: <Users size={16} strokeWidth={2} /> },
    { key: "takvim", label: "Görüşme Takvimi", icon: <CalendarDays size={16} strokeWidth={2} /> },
    { key: "cikismulakat", label: "Çıkış Mülakatı", icon: <LogOut size={16} strokeWidth={2} /> },
    { key: "checklist", label: "Kontrol Listeleri", icon: <ClipboardCheck size={16} strokeWidth={2} /> },
    { key: "pusula", label: "Ücret Pusulaları", icon: <FileText size={16} strokeWidth={2} /> },
    { key: "izinduzeni", label: "İzin Düzeni", icon: <CalendarDays size={16} strokeWidth={2} /> },
    { key: "egitim", label: "Eğitim Dokümanları", icon: <GraduationCap size={16} strokeWidth={2} /> },
    { key: "etik", label: "Etik Hat", icon: <ShieldAlert size={16} strokeWidth={2} /> },
    { key: "isemri", label: "İş Emirleri", icon: <Briefcase size={16} strokeWidth={2} /> },
    { key: "kunye", label: "Künye Analizi", icon: <ScanLine size={16} strokeWidth={2} /> },
    { key: "kazankazan", label: "Kazan-Kazan", icon: <Trophy size={16} strokeWidth={2} /> },
    { key: "personeller", label: "Personeller", icon: <Contact size={16} strokeWidth={2} /> },
    { key: "izintalep", label: "Personel Talepleri", icon: <CalendarCheck size={16} strokeWidth={2} /> },
    { key: "mobilduyuru", label: "Duyurular", icon: <Megaphone size={16} strokeWidth={2} /> },
    /* Biçen'den Haberler: sunucu Admin, GMY, İK yöneticisi ve İK'ya açık */
    ...(haberYonetimi(oturum)
      ? [
          { key: "haberler", label: "Biçen'den Haberler", icon: <Newspaper size={16} strokeWidth={2} /> },
          /* Ekibim görünürlüğü ve aydınlatma metni Yönetim sayfasında (09.10.2026) */
        ]
      : []),
    { key: "yillikizin", label: "İzin Yönetimi", icon: <CalendarDays size={16} strokeWidth={2} /> },
    { key: "sirkulasyon", label: "Sirkülasyon", icon: <TrendingDown size={16} strokeWidth={2} /> },
    { key: "kadro", label: "Norm Kadro", icon: <Target size={16} strokeWidth={2} /> },
    { key: "bicenkart", label: "Biçen Kart", icon: <CreditCard size={16} strokeWidth={2} /> },
    { key: "rapor", label: "Raporlar", icon: <BarChart3 size={16} strokeWidth={2} /> },
    ...(adminMi(oturum)
      ? [{ key: "izinucreti", label: "Yıllık İzin Ücretleri", icon: <Wallet size={16} strokeWidth={2} /> }]
      : []),
    { key: "vardiyakarekod", label: "Vardiya Karekodları", icon: <QrCode size={16} strokeWidth={2} /> },
    { key: "qr", label: "QR Kodlar", icon: <QrCode size={16} strokeWidth={2} /> },
    { key: "yonetim", label: "Yönetim", icon: <Settings2 size={16} strokeWidth={2} /> },
    { key: "talepler", label: "Talep ve Öneriler", icon: <Inbox size={16} strokeWidth={2} /> },
    { key: "performans", label: "İK Performans", icon: <Gauge size={16} strokeWidth={2} /> },
    { key: "personelperformansGrup", label: "Personel Performansı",
      icon: <TrendingUp size={16} strokeWidth={2} />,
      children: [
        { key: "personelperformans", label: "Değerlendirme" },
        { key: "performansbuyume", label: "Büyüme Oranları" },
        { key: "primhakedis", label: "Prim Hak Edişi" },
      ] },
    ...(adminMi(oturum) && testAcik
      ? [{ key: "test", label: "Test Verisi", icon: <FlaskConical size={16} strokeWidth={2} /> }]
      : []),
  ];

  let menuler = [
    {
      key: "basvurular",
      /* Bölge müdürü başvuru listesi yerine özet ekranı görür */
      label: ozetEkrani(oturum) ? "Özet" : "Başvurular",
      icon: <ClipboardList size={16} strokeWidth={2} />,
    },

    /* İnceleme ekranı yalnızca sistem yöneticisine açıktır */
    ...(incelemeYetkisi(oturum)
      ? [
          {
            key: "zeka",
            label: "İnceleme",
            icon: <BrainCircuit size={16} strokeWidth={2} />,
          },
          {
            key: "erisim",
            label: "Erişim Denetimi",
            icon: <ShieldAlert size={16} strokeWidth={2} />,
          },
        ]
      : []),

    /* Yönetim raporu, İnceleme ekranından daha geniş bir kitleye açık */
    ...(yonetimRaporu(oturum)
      ? [
          {
            key: "yonetimraporu",
            label: "Yönetim Raporu",
            icon: <LayoutDashboard size={16} strokeWidth={2} />,
          },
        ]
      : []),

    /* Aday havuzu yalnızca işlem yapan rollerde görünür */
    ...(islemYetkisi(oturum) || performansGorme(oturum)
      ? [
          {
            key: "havuz",
            label: "Aday Havuzu",
            icon: <Users size={16} strokeWidth={2} />,
          },
        ]
      : []),

    /* Görüşme takvimi: İK uzmanı kendi oluşturduğu görüşmeleri görür */
    ...(islemYetkisi(oturum)
      ? [
          {
            key: "takvim",
            label: "Görüşme Takvimi",
            icon: <CalendarDays size={16} strokeWidth={2} />,
          },
          {
            key: "cikismulakat",
            label: "Çıkış Mülakatı",
            icon: <LogOut size={16} strokeWidth={2} />,
          },
          {
            key: "checklist",
            label: "Kontrol Listeleri",
            icon: <ClipboardCheck size={16} strokeWidth={2} />,
          },
          {
            key: "pusula",
            label: "Ücret Pusulaları",
            icon: <FileText size={16} strokeWidth={2} />,
          },
          {
            /* Haftalık izin günleri ve nöbet takvimi. Menü sırasından
               Yıllık İzin'in altına alınabiliyor. */
            key: "izinduzeni",
            label: "İzin Düzeni",
            icon: <CalendarDays size={16} strokeWidth={2} />,
          },
          {
            key: "egitim",
            label: "Eğitim Dokümanları",
            icon: <GraduationCap size={16} strokeWidth={2} />,
          },
          {
            /* Kimin göreceği Rol Yetkileri'nden belirleniyor: etik
               bildirimlerin önemli bir kısmı yönetim zinciri hakkında
               oluyor ve bu karar yazılıma gömülemez. */
            key: "etik",
            label: "Etik Hat",
            icon: <ShieldAlert size={16} strokeWidth={2} />,
          },
          {
            key: "isemri",
            label: "İş Emirleri",
            icon: <Briefcase size={16} strokeWidth={2} />,
          },
          {
            key: "kunye",
            label: "Künye Analizi",
            icon: <ScanLine size={16} strokeWidth={2} />,
          },
          {
            key: "kazankazan",
            label: "Kazan-Kazan",
            icon: <Trophy size={16} strokeWidth={2} />,
          },
        ]
      : []),

    ...(ozetEkrani(oturum) || saltOkunur(oturum)
      ? []
      : [
          {
            key: "personeller",
            label: "Personeller",
            icon: <Contact size={16} strokeWidth={2} />,
          },
          {
            key: "izintalep",
            label: "Personel Talepleri",
            icon: <CalendarCheck size={16} strokeWidth={2} />,
          },
          {
            key: "mobilduyuru",
            label: "Duyurular",
            icon: <Megaphone size={16} strokeWidth={2} />,
          },
          ...(haberYonetimi(oturum)
            ? [
                { key: "haberler", label: "Biçen'den Haberler", icon: <Newspaper size={16} strokeWidth={2} /> },
              ]
            : []),
          {
            key: "yillikizin",
            label: "İzin Yönetimi",
            icon: <CalendarDays size={16} strokeWidth={2} />,
          },
          {
            key: "sirkulasyon",
            label: "Sirkülasyon",
            icon: <TrendingDown size={16} strokeWidth={2} />,
          },
        ]),

    /* Norm kadro: düzenleyebilenler ve görüntüleyebilenler */
    {
      key: "kadro",
      label: "Norm Kadro",
      icon: <Target size={16} strokeWidth={2} />,
    },

    /* Biçen Kart: puan kartlarının eşleştirilmesi ve sorgulanması.
       Kart verisi yazarkasa tarafında duruyor, burası yalnızca
       yönetim ekranı. */
    {
      key: "bicenkart",
      label: "Biçen Kart",
      icon: <CreditCard size={16} strokeWidth={2} />,
    },

    /* Raporlar herkese açık; bölge müdüründe yalnızca Günlük Geçiş
       sekmesi görünür ve kendi bölgesiyle sınırlıdır. */
    {
      key: "rapor",
      label: "Raporlar",
      icon: <BarChart3 size={16} strokeWidth={2} />,
    },

    /* Yıllık izin ücretleri: kişi başı net maaş içeriyor, yalnızca
       Yönetici. Sunucu da yalnızca Admin'e veri veriyor (403). */
    ...(adminMi(oturum)
      ? [
          {
            key: "izinucreti",
            label: "Yıllık İzin Ücretleri",
            icon: <Wallet size={16} strokeWidth={2} />,
          },
        ]
      : []),

    ...(islemYetkisi(oturum)
      ? [
          {
            key: "vardiyakarekod",
            label: "Vardiya Karekodları",
            icon: <QrCode size={16} strokeWidth={2} />,
          },
          {
            key: "qr",
            label: "QR Kodlar",
            icon: <QrCode size={16} strokeWidth={2} />,
          },
        ]
      : []),

    /* Tahakkuk artık ayrı bir menü değil: Ücret Pusulaları sayfasının
       sekmesi. İkisi de aynı işin parçası — biri bordroyu Mikro'dan
       üretiyor, diğeri personele iletip onayını topluyor — ve ayrı
       menülerde durduklarında hangisinden ne yapılacağı karışıyordu. */

    /* Yönetim: tam yetkililer her şeyi, İK yalnızca form ayarlarını görür */
    ...(tamYonetim(oturum) || formAyari(oturum)
      ? [
          {
            key: "yonetim",
            label: "Yönetim",
            icon: <Settings2 size={16} strokeWidth={2} />,
          },
        ]
      : []),

    /* Talep ve Öneriler (30.10.2026): varsayılan olarak yönetimde; Rol
       Yetkileri'nden başka rollere de açılabilir */
    ...(tamYonetim(oturum)
      ? [
          {
            key: "talepler",
            label: "Talep ve Öneriler",
            icon: <Inbox size={16} strokeWidth={2} />,
          },
        ]
      : []),

    /* İK performans yalnızca üst yönetimde */
    ...(performansGorme(oturum)
      ? [
          {
            key: "performans",
            label: "İK Performans",
            icon: <Gauge size={16} strokeWidth={2} />,
          },
          /* Personel performansı bir alt grup: iki sayfa da menüde ayrı
             satır kaplıyordu. Ana başlığa tıklandığında alt sayfalar
             açılır, kapalıyken tek satır yer tutar. */
          {
            key: "personelperformansGrup",
            label: "Personel Performansı",
            icon: <TrendingUp size={16} strokeWidth={2} />,
            children: [
              {
                key: "personelperformans",
                label: "Değerlendirme",
              },
              {
                key: "performansbuyume",
                label: "Büyüme Oranları",
              },
              {
                key: "primhakedis",
                label: "Prim Hak Edişi",
              },
            ],
          },
        ]
      : []),

    ...(adminMi(oturum) && testAcik
      ? [
          {
            key: "test",
            label: "Test Verisi",
            icon: <FlaskConical size={16} strokeWidth={2} />,
          },
        ]
      : []),
  ];

  /** Taklit oturumundan kendi hesabına döner */
  const kendiHesabimaDon = () => {
    const onceki = oturum?.oncekiOturum;

    if (onceki) {
      oturumYaz(onceki);
      window.location.reload();
      return;
    }

    /* Önceki oturum kaybolmuşsa yeniden giriş istenir */
    oturumSil();
    window.location.reload();
  };

  const icerik = () => {
    switch (sekme) {
      case "basvurular":
        /* Bölge müdürü listeleme yerine özet ekranını görür */
        return ozetEkrani(oturum) ? <BolgeOzeti /> : <Basvurular />;

      case "havuz":
        return <Havuz />;
      case "takvim":
        return <GorusmeTakvimi />;
      case "cikismulakat":
        return <CikisMulakati />;
      case "checklist":
        return <Checklistler />;
      case "pusula":
        return <Pusulalar />;
      case "izinduzeni":
        return <IzinDuzeni />;
      case "egitim":
        return <Egitimler />;
      case "etik":
        return <EtikHat />;
      case "isemri":
        return <IsEmirleri />;
      case "kunye":
        return <KunyeAnalizi />;
      /* 20.10.2026: Mağaza Havuzu Kazan-Kazan'ın içinde */
      case "kazankazan":
        return <KazanKazan />;
      case "magazahavuz":
        return <KazanKazan sekme="havuz" />;
      case "izintalep":
        return <IzinTalepleri />;
      case "mobilduyuru":
        return <MobilDuyurular />;
      case "haberler":
        return haberYonetimi(oturum) ? <HaberYonetimi /> : null;
      case "ekibimayar":
        return haberYonetimi(oturum) ? <EkibimAyar /> : null;
      case "aydinlatma":
        return haberYonetimi(oturum) ? <Aydinlatma /> : null;
      case "yillikizin":
        return <YillikIzin />;
      case "personeller":
        return <Personeller />;
      case "sirkulasyon":
        return <Sirkulasyon />;
      case "kadro":
        return <KadroPlani />;
      case "bicenkart":
        return <BicenKart />;
      case "zeka":
        return incelemeYetkisi(oturum) ? <YapayZekaIncelemesi /> : null;
      case "erisim":
        return incelemeYetkisi(oturum) ? <ErisimDenetimi /> : null;
      case "yonetimraporu":
        return yonetimRaporu(oturum) ? <YonetimRaporu /> : null;
      case "rapor":
        return <Rapor />;
      case "izinucreti":
        return adminMi(oturum) ? <IzinUcretleri /> : null;
      case "vardiyakarekod":
        return <VardiyaKarekod />;
      case "qr":
        return <QrKodlar />;
      /* Eski menü anahtarı: kayıtlı sekme sırası ya da yetki listesinde
         "tahakkuk" kalmış olabilir, aynı sayfaya düşsün. */
      case "tahakkuk":
        return <Pusulalar />;
      case "yonetim":
        return <Yonetim />;
      case "mesajlasma":
        return <Mesajlasma />;
      case "hukuk":
        return hukukAcik ? <HukukMasasi /> : null;
      case "isplani":
        return isPlaniAcik ? <IsPlanlamasi /> : null;
      case "personelperformans":
        return <PersonelPerformansi />;
      case "performansbuyume":
        return <PerformansBuyume />;
      case "primhakedis":
        return <PrimHakedis />;
      case "performans":
        return <Performans />;
      case "talepler":
        return <Talepler />;
      case "test":
        return testAcik ? <TestVerisi /> : <Basvurular />;
      default:
        /* Grup başlıkları sayfa değildir; tıklandığında yalnızca açılırlar.
           Bilinmeyen bir anahtar geldiğinde sessizce Başvurular'a düşmek
           hatayı gizliyordu — başlıkta "Personel Performansı" yazarken
           içerik Başvurular oluyordu. */
        if (sekme.endsWith("Grup")) return null;

        return <Basvurular />;
    }
  };

  /* Menü sırası Yönetim'den ayarlanabilir.

     Ayardaki anahtarlar önce, verilen sırayla dizilir; ayarda olmayanlar
     kendi doğal sıralarında sona eklenir. Böylece yeni bir sayfa
     eklendiğinde ayar bozulmaz, sayfa yalnızca listenin sonuna düşer. */
  const menulerSirali = (() => {
    const sira = menuSirasi ?? [];
    const gruplar = menuGruplari ?? {};

    /* Rol yetkisi. Liste boşsa kısıtlama yok demektir; rolün koddaki
       varsayılan menüleri görünür. Liste doluysa AYARLAR ESASTIR: menü
       tüm katalogdan, yalnızca işaretlenenlerle kurulur.

       Önceden ayar yalnızca daraltabiliyordu — koddaki rol kapıları
       önce çalışıyor, ayarda işaretlenen ama kapının vermediği menü
       (bölge koordinatörüne Aday Havuzu gibi) hiç görünmüyordu. İK
       "yetki verdim, gelmedi" diyordu ve haklıydı.

       Yalnızca yönetici sayfaları (İnceleme, Erişim Denetimi, Test
       Verisi) ayarla açılamaz; onların kapısı yerinde kalır. */
    const izinli = oturum?.yetki?.menuler ?? [];

    if (izinli.length > 0) {
      const yalnizYonetici = new Set(YALNIZ_YONETICI);
      const kapidanGecen = new Set(
        menuler.flatMap((m: any) => [m?.key, ...((m?.children ?? []).map((c: any) => c.key))])
      );

      menuler = katalog.flatMap((m: any) => {
        if (!m?.children) return [m];

        /* Grup başlığı: yalnızca açık alt sayfalarıyla kalır (21.10.2026) */
        const cocuklar = m.children.filter((c: any) => altSayfaAcik(izinli, m.key, c.key));
        return cocuklar.length > 0 ? [{ ...m, children: cocuklar }] : [];
      }).filter((m: any) => {
        if (!m?.key) return false;
        if (yalnizYonetici.has(m.key) && !kapidanGecen.has(m.key)) return false;

        if (m.children) return true;

        /* Eski anahtar: Ücret Pusulaları önce "tahakkuk" adıyla kaydediliyordu */
        if (m.key === "pusula") return izinli.includes("pusula") || izinli.includes("tahakkuk");

        /* "Özet" ile "Başvurular" aynı sayfa: bölge rolleri özet görür */
        if (m.key === "basvurular")
          return izinli.includes("basvurular") || izinli.includes("ozet");

        /* Biçen'den Haberler yeni: rol ayarı kaydedilmiş rollerde listede
           yok. Duyurular'ı gören rol onu da görsün; ayrıca işaretlenebilir. */
        if (m.key === "haberler")
          return izinli.includes("haberler") || izinli.includes("mobilduyuru");

        /* 09.10.2026: yeni sayfalar Personeller'i gören rolde de açık */
        /* Mağaza Havuzu yetkisi olan rol Kazan-Kazan'ı da görür */
        if (m.key === "kazankazan")
          return izinli.includes("kazankazan") || izinli.includes("magazahavuz");

        if (m.key === "ekibimayar" || m.key === "aydinlatma")
          return izinli.includes(m.key) || izinli.includes("personeller");

        return izinli.includes(m.key);
      });
    }

    /* Mesajlar (22.10.2026): bütün panel kullanıcılarına açık, rol ayarından bağımsız */
    if (!yalnizcaFotograf(oturum) && !menuler.some((m: any) => m?.key === "mesajlasma"))
      menuler = [
        { key: "mesajlasma", label: "Mesajlar", icon: <MessagesSquare size={16} strokeWidth={2} /> },
        ...menuler,
      ];

    /* Hukuk masası: yetkisi olana, rol ayarından bağımsız */
    if (hukukAcik && !menuler.some((m: any) => m?.key === "hukuk"))
      menuler = [
        { key: "hukuk", label: "Hukuk masası", icon: <Scale size={16} strokeWidth={2} /> },
        ...menuler,
      ];

    /* Sicille açılan sayfa: rol ayarından bağımsız, en başta */
    if (isPlaniAcik && !menuler.some((m: any) => m?.key === "isplani"))
      menuler = [
        { key: "isplani", label: "İş Planlaması", icon: <Kanban size={16} strokeWidth={2} /> },
        ...menuler,
      ];

    const yer = (k: string) => {
      const i = sira.indexOf(k);
      return i < 0 ? 9999 : i;
    };

    /* Önce sıralanır */
    const sirali =
      sira.length === 0
        ? [...menuler]
        : [...menuler].sort((a: any, b: any) => yer(a?.key) - yer(b?.key));

    if (Object.keys(gruplar).length === 0) return sirali;

    /* Gruplama iki geçişte yapılır.

       Tek geçişte, üst başlık listede alt öğesinden SONRA geliyorsa
       grup önce oluşturuluyor, sonra asıl kayıt yeniden ekleniyor ve
       menüde iki kez görünüyordu. */

    /* 1. Hangi anahtarlar üst başlık olacak */
    const ustAnahtarlar = new Set(
      Object.entries(gruplar)
        .filter(([alt, ust]) =>
          sirali.some((x: any) => x?.key === alt) &&
          sirali.some((x: any) => x?.key === ust)
        )
        .map(([, ust]) => ust)
    );

    /* 2. Sırayı koruyarak menü kurulur */
    const sonuc: any[] = [];

    for (const m of sirali) {
      const anahtar = (m as any)?.key;
      if (!anahtar) continue;

      /* Bir üst başlığın altındaysa burada atlanır; grubun içine girer */
      if (gruplar[anahtar] && ustAnahtarlar.has(gruplar[anahtar])) continue;

      if (!ustAnahtarlar.has(anahtar)) {
        sonuc.push(m);
        continue;
      }

      /* Üst başlık: kendi alt menüsü varsa korunur, yoksa kendisi ilk
         alt öğe olur — aksi hâlde o sayfaya ulaşılamaz. */
      const mevcutAltlar = (m as any).children;

      const altlar = mevcutAltlar
        ? [...mevcutAltlar]
        : [{ key: anahtar, label: (m as any).label }];

      for (const alt of sirali) {
        const altAnahtar = (alt as any)?.key;

        if (altAnahtar && gruplar[altAnahtar] === anahtar)
          altlar.push({ key: altAnahtar, label: (alt as any).label });
      }

      sonuc.push({
        key: `${anahtar}Grup`,
        label: (m as any).label,
        icon: (m as any).icon,
        children: altlar,
      });
    }

    return sonuc;
  })();

  /* Personeller sayfasını gören rol, her sayfada adlara tıklayıp kartı açar */
  personelKartiYetkisi(
    (menuler as any[]).some(
      (m) => m?.key === "personeller" || (m?.children as any[])?.some((c) => c?.key === "personeller")
    )
  );

  /* Başlık alt gruplarda da bulunmalı: yalnızca üst seviyeye bakıldığında
     alt sayfalarda üst bar boş kalıyordu. */
  const baslik = (() => {
    for (const m of menuler as any[]) {
      if (m?.key === sekme) return m.label;

      const alt = (m?.children as any[])?.find((c) => c?.key === sekme);
      if (alt) return alt.label;
    }

    return "";
  })();

  /* Kenar menü: aynı süzülmüş ve sıralanmış liste, gruplara ayrılmış */
  const menuGruplanmis = menuyuGrupla(
    menulerSirali as any[],
    MENU_GRUPLARI,
    (menuSirasi ?? []).length > 0
  );

  /* Adresten (yenileme, geri tuşu, eski bağlantı) gelen sayfa bu
     kullanıcının menüsünde yoksa rolün açılış sayfasına dönülür.
     Sicille açılan İş Planlaması yetkisi sonradan yüklendiği için
     beklenir. Render sırasında kendi durumunu güncellemek React'te
     geçerli: yanlış sayfa hiç çizilmez. */
  if (adrestenDenetle.current && menulerSirali.length > 0) {
    const anahtarlar = new Set<string>(
      (menulerSirali as any[]).flatMap((m: any) => [
        m?.key,
        ...((m?.children ?? []).map((c: any) => c?.key)),
      ])
    );
    if (anahtarlar.has(sekme)) adrestenDenetle.current = false;
    else if ((sekme !== "isplani" || isPlaniAcik) && (sekme !== "hukuk" || hukukAcik)) {
      adrestenDenetle.current = false;
      setSekme(acilisSekmesi(oturum));
    }
  }

  /* Üst bardaki "Grup / Sayfa" yolu; menüde bulunmayan bir sayfada
     (eski anahtar, bildirimden gelen geçiş) yalnızca başlık yazar. */
  const yol = menuYolu(menuGruplanmis, sekme);

  const rolAdi = ROL_ADLARI[oturum.rol] ?? oturum.rol;
  const gorunenAd = oturum.adSoyad || oturum.kullaniciAdi;

  /* Kullanıcı menüsü: geniş ekranda kenar menüdeki kullanıcı kartında,
     dar ekranda (çekmece kapalıyken de erişilsin diye) üst barda. */
  const kullaniciMenusu = [
    {
      key: "rol",
      label: rolAdi,
      disabled: true,
    },
    { type: "divider" as const },
    {
      key: "profil",
      label: "Profilim",
      icon: <UserCog size={14} strokeWidth={2} />,
      onClick: () => {
        setMenuAcik(false);
        setProfilAcik(true);
      },
    },
    {
      key: "cikis",
      label: "Çıkış yap",
      icon: <LogOut size={14} strokeWidth={2} />,
      onClick: cikis,
    },
  ];

  const kenarMenu = (cekmece: boolean) => (
    <KenarMenu
      gruplar={menuGruplanmis}
      secili={sekme}
      sec={(k) => {
        setSekme(k);
        if (cekmece) setMenuAcik(false);
      }}
      sayilar={{ ...menuSayilari, mesajlasma: mesajSayisi || null }}
      kullaniciAdi={oturum.kullaniciAdi}
      adSoyad={gorunenAd}
      rolAdi={rolAdi}
      kullaniciMenusu={kullaniciMenusu}
      cikis={cikis}
      yenilikAc={() => setYenilikKip("hepsi")}
      yenilikSayisi={okunan === undefined ? 0 : okunmamisSayisi(oturum, okunan)}
      talepAc={() => {
        setTalepAcik(true);
        if (cekmece) setMenuAcik(false);
      }}
      dar={kapali}
      darDegistir={setKapali}
      tema={menuTemasi}
      temaDegistir={setMenuTemasi}
      cekmece={cekmece}
      kapat={() => setMenuAcik(false)}
      aramaIstegi={cekmece ? aramaIstegi : 0}
    />
  );

  return (
    <ConfigProvider {...tema}>
      <AntdApp key={oturumAnahtari}>
        <Layout className="ik-duzen" hasSider={!darEkran}>
          {/* ------------------------------------------------------- sidebar */}
          {/* Geniş ekranda sabit kenar menü, 992 pikselin altında çekmece */}
          {!darEkran && kenarMenu(false)}

          <Drawer
            open={darEkran && menuAcik}
            onClose={() => setMenuAcik(false)}
            placement="left"
            width={280}
            closable={false}
            className="ik-menu-cekmece ik-km-cekmece"
            styles={{
              body: {
                padding: 0,
                background: menuTemasi === "acik" ? "#ffffff" : "#111a0c",
              },
            }}
          >
            {kenarMenu(true)}
          </Drawer>

          {/* Bir süre işlem yapılmazsa oturum kapatılır */}
          <HareketsizlikDenetimi cikis={cikis} />

          {/* Görüşme zamanı geçen adaylar için uyarı */}
          <GorusmeTakibi />

          <Layout>
            {/* Başka bir kullanıcı adına görüntüleme uyarısı. İçerik sütununun
                başında: dış düzen kenar menüyle yan yana dizildiği için
                orada menü ile içerik arasında ayrı bir sütun oluyordu.
                Üst bar şeridin altına yapışır (top = şerit yüksekliği). */}
            {taklitModu(oturum) && (
              <div className="ik-taklit-serit" ref={taklitRef}>
                <Space size={8}>
                  <UserCog size={16} strokeWidth={2} />
                  <span>
                    <b>{oturum.adSoyad}</b> hesabıyla görüntülüyorsunuz
                    <span className="ik-taklit-alt">
                      {" "}
                      · {ROL_ADLARI[oturum.rol] ?? oturum.rol} yetkileriyle
                    </span>
                  </span>
                </Space>

                <Button size="small" onClick={kendiHesabimaDon}>
                  Kendi hesabıma dön
                </Button>
              </div>
            )}

            {/* ----------------------------------------------------- header */}
            <Header
              className="ik-baslik"
              style={taklitYuksekligi ? { top: taklitYuksekligi } : undefined}
            >
              {/* Geniş ekranda daraltma kenar menünün kendi düğmesinde */}
              {darEkran && (
                <Button
                  type="text"
                  className="ik-menu-dugme"
                  icon={<MenuIkon size={18} strokeWidth={2} />}
                  onClick={() => setMenuAcik(true)}
                  aria-label="Menüyü aç"
                />
              )}

              <span className="ik-sayfa-basligi km-kirinti">
                {yol ? (
                  <>
                    <span className="km-kirinti-grup">{yol.grup}</span>
                    <span className="km-kirinti-ayrac">/</span>
                    {yol.ust && (
                      <>
                        <span className="km-kirinti-grup">{yol.ust}</span>
                        <span className="km-kirinti-ayrac">/</span>
                      </>
                    )}
                    <span className="km-kirinti-sayfa">{yol.ad}</span>
                  </>
                ) : (
                  <span className="km-kirinti-sayfa">{baslik}</span>
                )}
              </span>

              {/* Yetkisi olanlar için bölge seçimi */}
              {bolgeSecici(oturum) && <BolgeSecici />}

              {/* İK uzmanı süzgeci: Başvurular ve Personel Talepleri */}
              {(sekme === "basvurular" || sekme === "izintalep") && <UzmanSecici />}

              {/* Bekleyen işler ve bildirimler tek çanda (07.10.2026) */}
              <BildirimMerkezi />


              {/* Geniş ekranda kullanıcı menüsü kenar menünün altındaki
                  kartta; dar ekranda çekmece kapalıyken de erişilsin diye
                  burada kalır. */}
              {darEkran && (
                <Dropdown menu={{ items: kullaniciMenusu }}>
                  <Button type="text" className="ik-kullanici">
                    <UserCircle2 size={17} strokeWidth={2} />
                    <span>{gorunenAd}</span>
                  </Button>
                </Dropdown>
              )}
            </Header>

            <Content>{icerik()}</Content>
          </Layout>

          <Profil
            acik={profilAcik}
            kapat={() => setProfilAcik(false)}
            guncellendi={(adSoyad) => {
              const yeni = { ...oturum, adSoyad };
              oturumYaz(yeni);
              setOturum(yeni);
            }}
          />
        </Layout>

        {/* Her sayfadan açılan personel kartı */}
        {kartKod && <Personeller kartModu={{ kod: kartKod, kapat: () => setKartKod(null) }} />}

        {/* Yeni mesajda ses ve sağ alttaki bildirim kartı; tüm ekranlarda */}
        {!yalnizcaFotograf(oturum) && <MesajBildirim sayfa={sekme} />}

        {/* Yenilikler: girişte okunmamış varsa "yeni" kipinde kendiliğinden,
            menüdeki düğmeden "hepsi" kipinde (30.10.2026) */}
        {yenilikKip !== null && gorunenYenilikler(oturum).length > 0 && (
          <Yenilikler
            acik
            kip={yenilikKip}
            oturum={oturum}
            okunan={okunan ?? null}
            kapat={yenilikKapat}
          />
        )}

        {/* Her ekrandan sorun bildirimi / öneri */}
        <Talep
          acik={talepAcik}
          kapat={() => setTalepAcik(false)}
          oturum={oturum}
          ekran={yol ? `${yol.grup} / ${yol.ust ? `${yol.ust} / ` : ""}${yol.ad}` : String(baslik || sekme)}
          sekme={sekme}
        />
      </AntdApp>
    </ConfigProvider>
  );
}
