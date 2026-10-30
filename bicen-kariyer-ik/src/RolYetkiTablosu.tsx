/**
 * Rol yetkileri — sayfa × rol tablosu (21.10.2026).
 *
 * Hangi sayfayı hangi rolün gördüğü tek ekranda. Satır sayfa, sütun rol.
 * Menü listesi boş olan rol "varsayılan menüleri" görür; o rolde kutu
 * işaretlemek için önce "Kısıtla" ile listeyi açmak gerekir (tüm sayfalar
 * işaretli başlar, istemediklerinizi kaldırırsınız).
 */
import { Fragment } from "react";
import { Button, Checkbox, Tag, Tooltip } from "antd";
import { SAYFA_GRUPLARI, TUM_SAYFA_ANAHTARLARI } from "./sayfaYetkileri";

interface Rol {
  kod: string;
  ad: string;
}

export default function RolYetkiTablosu({
  roller,
  yetkiler,
  degistir,
}: {
  roller: Rol[];
  yetkiler: Record<string, any>;
  degistir: (rol: string, menuler: string[]) => void;
}) {
  const verilebilir = TUM_SAYFA_ANAHTARLARI.filter(
    (k) => !SAYFA_GRUPLARI.some((g) => g.sayfalar.some((s) => s.key === k && s.yalnizYonetici))
  );

  const menuler = (rol: string): string[] => yetkiler[rol]?.menuler ?? [];

  const ac = (rol: string, keys: string[], acik: boolean) => {
    const y = new Set(menuler(rol));
    keys.forEach((k) => (acik ? y.add(k) : y.delete(k)));
    degistir(rol, TUM_SAYFA_ANAHTARLARI.filter((k) => y.has(k)));
  };

  const hucre = (rol: string, key: string, kilitli?: boolean, altlar?: string[]) => {
    const liste = menuler(rol);
    const varsayilan = liste.length === 0;

    if (kilitli) return <Tag style={{ margin: 0 }}>yönetici</Tag>;
    if (varsayilan)
      return (
        <Tooltip title="Bu rol varsayılan menülerini görüyor. Üstteki “Kısıtla” ile listeyi açınız.">
          <span style={{ color: "#98a2b3" }}>·</span>
        </Tooltip>
      );

    const isaretli = liste.includes(key);
    const altSecili = altlar ? altlar.filter((a) => liste.includes(a)).length : 0;

    return (
      <Checkbox
        checked={isaretli || (altlar ? altSecili === altlar.length && altlar.length > 0 : false)}
        indeterminate={!!altlar && !isaretli && altSecili > 0 && altSecili < altlar.length}
        onChange={(e) => ac(rol, altlar ? [key, ...altlar] : [key], e.target.checked)}
      />
    );
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ry-tablo">
        <thead>
          <tr>
            <th style={{ textAlign: "left", minWidth: 220 }}>Sayfa</th>
            {roller.map((r) => {
              const varsayilan = menuler(r.kod).length === 0;
              return (
                <th key={r.kod}>
                  <div>{r.ad}</div>
                  {varsayilan ? (
                    <Button size="small" type="link" style={{ padding: 0, height: 18 }} onClick={() => degistir(r.kod, verilebilir)}>
                      Kısıtla
                    </Button>
                  ) : (
                    <Tooltip title="Rol yeniden varsayılan menülerine döner">
                      <Button size="small" type="link" danger style={{ padding: 0, height: 18 }} onClick={() => degistir(r.kod, [])}>
                        Varsayılana dön
                      </Button>
                    </Tooltip>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {SAYFA_GRUPLARI.map((g) => (
            <Fragment key={g.ad}>
              <tr className="ry-tablo-grup">
                <td colSpan={roller.length + 1}>{g.ad}</td>
              </tr>
              {g.sayfalar.map((s) => (
                <Fragment key={s.key}>
                  <tr>
                    <td>
                      {s.ad}
                      {s.aciklama && <div className="ry-tablo-aciklama">{s.aciklama}</div>}
                    </td>
                    {roller.map((r) => (
                      <td key={r.kod}>{hucre(r.kod, s.key, s.yalnizYonetici, s.alt?.map((a) => a.key))}</td>
                    ))}
                  </tr>
                  {(s.alt ?? []).map((a) => (
                    <tr key={a.key}>
                      <td style={{ paddingLeft: 26 }}>↳ {a.ad}</td>
                      {roller.map((r) => (
                        <td key={r.kod}>{hucre(r.kod, a.key)}</td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
