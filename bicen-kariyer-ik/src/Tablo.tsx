/**
 * ---------------------------------------------------------------------------
 * Duyarlı Tablo
 * ---------------------------------------------------------------------------
 * Geniş ekranlarda normal tablo, dar ekranlarda kart listesi gösterir.
 *
 * Telefonda çok sütunlu tablolar yatay kaydırma gerektirir ve okunmaz hâle
 * gelir. Bu bileşen aynı sütun tanımlarını kullanarak her satırı bir karta
 * çevirir: sütun başlığı etiket, hücre içeriği değer olur.
 *
 * Kullanımı Ant Design tablosuyla aynıdır; mevcut sütun tanımları değişmez.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Pagination, Spin, Table } from "antd";
import type { TableProps } from "antd";
import { ChevronDown, ChevronUp } from "lucide-react";

/** Kart görünümüne geçiş eşiği */
const DAR_ESIK = 768;

export function darEkranMi(): boolean {
  return typeof window !== "undefined" && window.innerWidth < DAR_ESIK;
}

/** Ekran genişliğini izler */
export function useDarEkran(): boolean {
  const [dar, setDar] = useState(darEkranMi);

  useEffect(() => {
    const olcum = () => setDar(darEkranMi());

    window.addEventListener("resize", olcum);
    return () => window.removeEventListener("resize", olcum);
  }, []);

  return dar;
}

/** Sütun tanımından hücre içeriğini üretir */
const hucreIcerigi = (sutun: any, kayit: any, sira: number) => {
  const ham = sutun.dataIndex ? kayit?.[sutun.dataIndex] : undefined;

  if (typeof sutun.render === "function") {
    return sutun.render(ham, kayit, sira);
  }

  if (ham === null || ham === undefined || ham === "") return null;

  return String(ham);
};

/** Başlık metin değilse (ikon, bileşen) etiket olarak kullanılmaz */
const basligiOku = (baslik: unknown): string => {
  if (typeof baslik === "string") return baslik;
  if (typeof baslik === "number") return String(baslik);
  return "";
};

export default function Tablo<T extends object = any>(props: TableProps<T>) {
  const dar = useDarEkran();

  const {
    columns = [],
    dataSource = [],
    rowKey,
    loading,
    pagination,
    expandable,
    onRow,
    locale,
    ...kalan
  } = props;

  /* Dar ekranda sayfalama elle yürütülür */
  const [sayfa, setSayfa] = useState(1);

  const sayfaBoyutu =
    typeof pagination === "object" && pagination?.pageSize
      ? pagination.pageSize
      : 10;

  const kayitlar = useMemo(() => (dataSource ?? []) as T[], [dataSource]);

  const gorunen = useMemo(() => {
    if (pagination === false) return kayitlar;
    return kayitlar.slice((sayfa - 1) * sayfaBoyutu, sayfa * sayfaBoyutu);
  }, [kayitlar, sayfa, sayfaBoyutu, pagination]);

  /* Açılabilir satırların durumu */
  const [acik, setAcik] = useState<Record<string, boolean>>({});

  if (!dar) {
    return (
      <Table<T>
        columns={columns}
        dataSource={dataSource}
        rowKey={rowKey}
        loading={loading}
        pagination={pagination}
        expandable={expandable}
        onRow={onRow}
        locale={locale}
        {...kalan}
      />
    );
  }

  /* ------------------------------------------------------- kart görünümü */

  const anahtarBul = (kayit: any, sira: number): string => {
    if (typeof rowKey === "function") return String((rowKey as any)(kayit, sira));
    if (typeof rowKey === "string") return String(kayit?.[rowKey] ?? sira);
    return String(sira);
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <Spin />
      </div>
    );
  }

  if (gorunen.length === 0) {
    return <Empty description={(locale as any)?.emptyText ?? "Kayıt bulunamadı"} />;
  }

  return (
    <div className="tb-kartlar">
      {gorunen.map((kayit, sira) => {
        const anahtar = anahtarBul(kayit, sira);
        const satirOzellik = onRow?.(kayit, sira) ?? {};
        const acilabilir =
          typeof expandable?.expandedRowRender === "function" &&
          (expandable.rowExpandable?.(kayit) ?? true);

        /* İlk sütun kartın başlığı olur */
        const gorunurSutunlar = (columns as any[]).filter((s) => !s.hidden);
        const [ilk, ...digerleri] = gorunurSutunlar;

        return (
          <div className="tb-kart" key={anahtar}>
            <div
              className={`tb-kart-ust${satirOzellik.onClick ? " tb-tiklanabilir" : ""}`}
              onClick={satirOzellik.onClick as any}
            >
              <div className="tb-kart-baslik">
                {ilk ? hucreIcerigi(ilk, kayit, sira) : null}
              </div>

              {acilabilir && (
                <Button
                  type="text"
                  size="small"
                  icon={
                    acik[anahtar] ? (
                      <ChevronUp size={16} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={16} strokeWidth={2} />
                    )
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setAcik({ ...acik, [anahtar]: !acik[anahtar] });
                  }}
                />
              )}
            </div>

            <div className="tb-kart-alanlar">
              {digerleri.map((sutun: any, i: number) => {
                const icerik = hucreIcerigi(sutun, kayit, sira);
                if (icerik === null || icerik === undefined || icerik === "") return null;

                const etiket = basligiOku(sutun.title);

                return (
                  <div className="tb-alan" key={sutun.key ?? sutun.dataIndex ?? i}>
                    {etiket && <span className="tb-etiket">{etiket}</span>}
                    <div className="tb-deger">{icerik}</div>
                  </div>
                );
              })}
            </div>

            {acilabilir && acik[anahtar] && (
              <div className="tb-kart-detay">
                {expandable!.expandedRowRender!(kayit, sira, 0, true)}
              </div>
            )}
          </div>
        );
      })}

      {pagination !== false && kayitlar.length > sayfaBoyutu && (
        <div className="tb-sayfalama">
          <Pagination
            simple
            current={sayfa}
            pageSize={sayfaBoyutu}
            total={kayitlar.length}
            onChange={setSayfa}
          />
        </div>
      )}
    </div>
  );
}
