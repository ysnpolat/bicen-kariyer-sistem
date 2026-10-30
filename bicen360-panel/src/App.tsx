/**
 * ---------------------------------------------------------------------------
 * Biçen360 - Panel kabuğu
 * ---------------------------------------------------------------------------
 * Düzen İK paneliyle aynı: solda koyu kenar menü, üstte yapışkan başlık,
 * ortada içerik. Menü sunucudan gelen yetki listesine göre kurulur.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Result,
  Spin,
} from "antd";
import trTR from "antd/locale/tr_TR";
import {
  BarChart3,
  Bell,
  Box,
  Boxes,
  ClipboardList,
  LineChart,
  Settings,
  LogOut,
  Menu as MenuIkon,
  Home,
  ScanLine,
  Search,
  Tag,
  UserCircle,
  CalendarClock,
} from "lucide-react";

import { LOGO_ADRESI, api, oturumOku, oturumSil, sayfaAcik, type Oturum } from "./api";
import { RENK, SAYFA_ADLARI, SAYFA_SIRASI } from "./sabitler";
import Giris from "./Giris";
import Karsilama from "./Karsilama";
import HataKalkani from "./HataKalkani";
import Pano from "./sayfalar/Pano";
import Checklistler from "./sayfalar/Checklistler";
import FiyatKontrol from "./sayfalar/FiyatKontrol";
import Raporlar from "./sayfalar/Raporlar";
import RaporMerkezi from "./sayfalar/RaporMerkezi";
import SktTakip from "./sayfalar/SktTakip";
import { adresiDuzelt, rotayiKullan } from "./rota";
import KunyeAnalizi from "./sayfalar/KunyeAnalizi";
import RakipFiyat from "./sayfalar/RakipFiyat";
import Arizalar from "./sayfalar/Arizalar";
import Envanter from "./sayfalar/Envanter";
import Stok from "./sayfalar/Stok";
import Yonetim from "./sayfalar/Yonetim";
import Yakinda from "./sayfalar/Yakinda";

const { Sider, Header, Content } = Layout;

const SIMGELER: Record<string, JSX.Element> = {
  pano: <Home size={18} strokeWidth={2} />,
  kunye: <ScanLine size={18} strokeWidth={2} />,
  rakipfiyat: <Tag size={18} strokeWidth={2} />,
  fiyatkontrol: <Search size={18} strokeWidth={2} />,
  rapormerkezi: <LineChart size={18} strokeWidth={2} />,
  skt: <CalendarClock size={18} strokeWidth={2} />,
  rapor: <BarChart3 size={18} strokeWidth={2} />,
  ariza: <Bell size={18} strokeWidth={2} />,
  envanter: <Box size={18} strokeWidth={2} />,
  stok: <Boxes size={18} strokeWidth={2} />,
  checklist: <ClipboardList size={18} strokeWidth={2} />,
  yonetim: <Settings size={18} strokeWidth={2} />,
};

/** Henüz yazılmamış sayfaların açıklamaları. */
const BEKLEYEN: Record<string, string> = {
  checklist:
    "Kontrol listelerinin oluşturulması Kariyer panelinden buraya taşınacak. Mobil tarafta doldurma ekranı değişmiyor.",
};

export default function App() {
  const [oturum, setOturum] = useState<Oturum | null>(oturumOku());

  /* Adres satırında #giris varsa doğrudan forma açılıyor: personele
     verilen kısayol bağlantısı tanıtım sayfasını atlayabilmeli. */
  const [girisGorunsun, setGirisGorunsun] = useState(
    typeof window !== "undefined" && window.location.hash === "#giris"
  );
  /* Sayfa adresten okunuyor: durumda tutulduğunda adres hep aynı kalıyor,
     sayfa yer imine eklenemiyor ve geri tuşu portaldan çıkarıyordu. */
  const [sekme, setSekme] = rotayiKullan();
  const [kapali, setKapali] = useState(false);
  const [menuAcik, setMenuAcik] = useState(false);

  const ekran = Grid.useBreakpoint();
  const darEkran = !ekran.lg;

  /* Panel açıkken yetkisi değiştirilen kullanıcının menüsü, çıkış yapmadan
     güncellensin. */
  useEffect(() => {
    if (!oturum) return;

    api
      .getir<{ sayfalar: string[]; portalRol?: string | null }>("Giris/Ben")
      .then((c) => setOturum((o) => (o ? { ...o, sayfalar: c.sayfalar, portalRol: c.portalRol ?? null } : o)))
      .catch(() => {
        /* Erişim kaldırılmışsa istek katmanı zaten oturumu düşürüyor */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oturum?.kullaniciAdi]);

  const menuler = useMemo(() => {
    const acik = (oturum?.sayfalar ?? []).filter((k) => SAYFA_ADLARI[k]);

    return SAYFA_SIRASI.filter((k) => acik.includes(k)).map((k) => ({
      key: k,
      icon: SIMGELER[k],
      label: SAYFA_ADLARI[k],
    }));
  }, [oturum?.sayfalar]);

  useEffect(() => {
    if (menuler.length === 0) return;

    /* Adresteki sayfaya yetki yoksa ilk açık sayfaya düşülüyor ve adres
       de ona göre düzeltiliyor. */
    const acik = menuler.some((m) => m.key === sekme);

    if (!acik) {
      setSekme(menuler[0].key);
      return;
    }

    adresiDuzelt(sekme);
  }, [menuler, sekme, setSekme]);

  /* Giriş ekranı da tema içinde kalmalı: dışarıda kaldığında AntD kendi
     varsayılan mavisini kullanıyor ve düğme kurumsal yeşil çıkmıyordu. */
  const cikis = () => {
    oturumSil();
    setOturum(null);
    setSekme("");
  };

  const menuSec = (kod: string) => {
    setSekme(kod);
    setMenuAcik(false);
  };

  const govde = () => {
    if (menuler.length === 0)
      return (
        <Result
          status="403"
          title="Görüntüleyebileceğiniz sayfa yok"
          subTitle="Erişiminiz tanımlandıktan sonra menü burada görünecek."
        />
      );

    /* Sunucu her uçta yetkiyi ayrıca denetliyor; buradaki kontrol yalnızca
       boş ekran yerine açıklama göstermek için. */
    if (!sayfaAcik(oturum, sekme))
      return <Result status="403" title="Bu sayfaya erişim yetkiniz yok" />;

    if (sekme === "pano") return <Pano git={setSekme} />;
    if (sekme === "kunye") return <KunyeAnalizi />;
    if (sekme === "rakipfiyat") return <RakipFiyat />;
    if (sekme === "ariza") return <Arizalar />;
    if (sekme === "envanter") return <Envanter />;
    if (sekme === "stok") return <Stok />;
    if (sekme === "checklist") return <Checklistler />;
    if (sekme === "fiyatkontrol") return <FiyatKontrol />;
    if (sekme === "rapor") return <Raporlar />;
    if (sekme === "rapormerkezi") return <RaporMerkezi />;
    if (sekme === "skt") return <SktTakip />;
    if (sekme === "yonetim") return <Yonetim />;

    return (
      <Yakinda
        baslik={SAYFA_ADLARI[sekme] ?? "Sayfa"}
        icerik={BEKLEYEN[sekme] ?? "Bu sayfa hazırlanıyor."}
      />
    );
  };

  const marka = (
    <div className="b3-sider-marka">
      <img
        src={LOGO_ADRESI}
        alt="Biçen"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      {!kapali && <span>Biçen360</span>}
    </div>
  );

  const kenarMenu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[sekme]}
      items={menuler}
      onClick={(e) => menuSec(e.key)}
      className="b3-sider-menu"
    />
  );

  return (
    <ConfigProvider
      locale={trTR}
      theme={{
        token: {
          colorPrimary: RENK.yesil,
          colorLink: RENK.yesilKoyu,
          borderRadius: 6,
        },
      }}
    >
      {!oturum ? (
        /* Oturum yokken önce karşılama sayfası: portalın adresi kurum
           dışına da veriliyor ve doğrudan giriş formuyla karşılamak,
           sistemin ne olduğunu anlatmadan parola soruyordu. Giriş
           formuna oradan geçiliyor. */
        girisGorunsun ? (
          <Giris
            girisYapildi={setOturum}
            karsilamaya={() => setGirisGorunsun(false)}
          />
        ) : (
          <Karsilama girise={() => setGirisGorunsun(true)} />
        )
      ) : (
      <Layout className="b3-duzen">
        {!darEkran && (
          <Sider
            collapsible
            collapsed={kapali}
            onCollapse={setKapali}
            breakpoint="lg"
            collapsedWidth={64}
            width={220}
            className="b3-sider"
          >
            {marka}
            {kenarMenu}
          </Sider>
        )}

        <Drawer
          open={darEkran && menuAcik}
          onClose={() => setMenuAcik(false)}
          placement="left"
          width={250}
          closable={false}
          styles={{ body: { padding: 0, background: "#1f2933" } }}
        >
          {marka}
          {kenarMenu}
        </Drawer>

        <Layout>
          <Header className="b3-baslik">
            {darEkran && (
              <Button
                type="text"
                className="b3-menu-dugme"
                icon={<MenuIkon size={18} strokeWidth={2} />}
                onClick={() => setMenuAcik(true)}
              />
            )}

            <span className="b3-sayfa-basligi">
              {SAYFA_ADLARI[sekme] ?? "Biçen360"}
            </span>

            <Dropdown
              menu={{
                items: [
                  { key: "ad", label: oturum.adSoyad, disabled: true },
                  { key: "rol", label: `Rol: ${oturum.portalRol || oturum.rol}`, disabled: true },
                  { type: "divider" },
                  {
                    key: "cikis",
                    label: "Çıkış yap",
                    icon: <LogOut size={15} strokeWidth={2} />,
                    onClick: cikis,
                  },
                ],
              }}
            >
              <span className="b3-kullanici">
                {/* Şube kullanıcısı: hangi şubenin verisini gördüğü her
                    ekranda belli olsun. Başka şube seçilemiyor. */}
                {oturum.sube && (
                  <span
                    style={{
                      background: "#fff2e8",
                      color: "#e8481c",
                      fontWeight: 700,
                      fontSize: 12,
                      padding: "2px 10px",
                      borderRadius: 12,
                      marginRight: 6,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {oturum.sube}
                  </span>
                )}
                <UserCircle size={20} strokeWidth={2} color={RENK.metinPasif} />
                {!darEkran && <span>{oturum.adSoyad}</span>}
              </span>
            </Dropdown>
          </Header>

          <Content className="b3-icerik">
            {/* Kalkan sayfanın etrafında: bir sayfadaki hata menüyü ve
                başlığı da götürüp portalı bomboş bırakıyordu. Sekme
                değişince kendiliğinden sıfırlanıyor. */}
            <HataKalkani anahtar={sekme}>
              {menuler.length > 0 ? govde() : <Spin />}
            </HataKalkani>
          </Content>
        </Layout>
      </Layout>
      )}
    </ConfigProvider>
  );
}
