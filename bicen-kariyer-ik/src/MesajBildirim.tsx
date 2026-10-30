/**
 * Mesaj bildirimi (22.10.2026)
 * ---------------------------------------------------------------------------
 * Panelin her sayfasında çalışır: 8 saniyede bir /api/Mesajlasma/Ozet sorar.
 * Başkasından yeni mesaj geldiyse kısa bir ses çalar ve sağ altta bir kart
 * açar; karta tıklayınca Mesajlar sayfasında o sohbet açılır. Ekranda açık
 * olan sohbetin mesajları için ses/kart çıkmaz. Sessize alınan sohbetler
 * sunucuda zaten süzülüyor.
 *
 * Okunmamış toplamı "mesaj-okunmamis" olayıyla menü rozetine iletilir.
 */
import { useEffect, useRef } from "react";
import { App as AntdApp } from "antd";
import { api } from "./api";
import { sayfayaGit } from "./gecis";
import { acikSohbet, mesajlasmaAc } from "./Mesajlasma";

interface Yeni { id: number; sohbetId: number; baslik: string; gonderenAd: string; grup: boolean; metin: string }

const RENK = ["#7cb518", "#1a4d80", "#e8481c", "#722ed1", "#0f766e", "#c98a0b", "#5f8c10", "#be185d"];
const renk = (a = "") => RENK[[...a].reduce((t, c) => t + c.charCodeAt(0), 0) % RENK.length];
const bas = (a = "") =>
  a.split(" ").filter((x) => /\p{L}/u.test(x[0] ?? "")).map((x) => x[0]).slice(0, 2).join("").toLocaleUpperCase("tr");

export let mesajOkunmamis = 0;

export default function MesajBildirim({ sayfa }: { sayfa: string }) {
  const { notification } = AntdApp.useApp();
  const son = useRef(0);
  const ses = useRef<HTMLAudioElement | null>(null);
  const sayfaRef = useRef(sayfa);
  sayfaRef.current = sayfa;

  useEffect(() => {
    ses.current = new Audio(`${import.meta.env.BASE_URL}sesler/mesaj.mp3`);
    ses.current.volume = 0.7;
    let iptal = false;

    const sor = async () => {
      try {
        const d = await api.al<{ okunmamis: number; sonId: number; yeniler: Yeni[] }>(
          `/api/Mesajlasma/Ozet?son=${son.current}`
        );
        if (iptal) return;
        mesajOkunmamis = d.okunmamis ?? 0;
        window.dispatchEvent(new CustomEvent("mesaj-okunmamis", { detail: mesajOkunmamis }));

        /* İlk sorguda yalnızca başlangıç noktası alınır; eski mesajlar için bildirim çıkmaz */
        const ilk = son.current === 0;
        son.current = Math.max(son.current, d.sonId ?? 0);
        if (ilk) return;

        const gosterilecek = (d.yeniler ?? []).filter(
          (y) => !(sayfaRef.current === "mesajlasma" && acikSohbet.id === y.sohbetId && document.visibilityState === "visible")
        );
        if (!gosterilecek.length) return;

        ses.current?.play().catch(() => undefined);

        /* Aynı sohbetten gelenler tek kartta toplanır */
        const sohbetler = new Map<number, Yeni[]>();
        gosterilecek.forEach((y) => sohbetler.set(y.sohbetId, [...(sohbetler.get(y.sohbetId) ?? []), y]));

        sohbetler.forEach((l, sohbetId) => {
          const y = l[l.length - 1];
          const ac = () => {
            notification.destroy(`msj-${sohbetId}`);
            sayfayaGit("mesajlasma");
            setTimeout(() => mesajlasmaAc(sohbetId), 50);
          };
          notification.open({
            key: `msj-${sohbetId}`,
            placement: "bottomRight",
            duration: 7,
            message: null,
            description: (
              <div className="msj-bildirim" onClick={ac}>
                <div
                  className={"msj-av" + (y.grup ? " kare" : "")}
                  style={{ background: renk(y.baslik), width: 40, height: 40, flexBasis: 40, fontSize: 14 }}
                >
                  {bas(y.baslik) || "?"}
                </div>
                <div className="msj-bildirim-metin">
                  <small>{l.length > 1 ? `${l.length} yeni mesaj` : "Yeni mesaj"}</small>
                  <b>{y.baslik}</b>
                  <div>{y.grup ? `${y.gonderenAd?.split(" ")[0]}: ${y.metin}` : y.metin}</div>
                </div>
              </div>
            ),
          });
        });

        /* Sekme arka plandaysa başlıkta da belirtilir */
        if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
          const y = gosterilecek[gosterilecek.length - 1];
          try {
            const n = new Notification(y.baslik, { body: y.metin, tag: `msj-${y.sohbetId}` });
            n.onclick = () => {
              window.focus();
              sayfayaGit("mesajlasma");
              setTimeout(() => mesajlasmaAc(y.sohbetId), 50);
            };
          } catch {
            /* desteklenmiyor */
          }
        }
      } catch {
        /* sessiz: tablo kurulmadıysa ya da bağlantı yoksa panel bozulmasın */
      }
    };

    sor();
    const z = window.setInterval(sor, 8000);
    const odak = () => document.visibilityState === "visible" && sor();
    document.addEventListener("visibilitychange", odak);

    /* Masaüstü bildirimi için bir kez izin istenir (ilk tıklamada) */
    const izin = () => {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
      window.removeEventListener("click", izin);
    };
    window.addEventListener("click", izin);

    return () => {
      iptal = true;
      window.clearInterval(z);
      document.removeEventListener("visibilitychange", odak);
      window.removeEventListener("click", izin);
    };
  }, [notification]);

  return null;
}
