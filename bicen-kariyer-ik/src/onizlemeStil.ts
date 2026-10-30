/**
 * İndirilen başvuru formunun içine gömülen stiller.
 * styles.css içindeki önizleme bölümünün, CSS değişkenleri sabit değerlere
 * çevrilmiş kopyasıdır.
 */

export const ONIZLEME_STIL = `/* ==========================================================================
   DOLDURULMUS FORM ONIZLEMESI (basili BIK-001 yerlesimi)
   ========================================================================== */

.on-belge {
  font-size: 12.5px;
  color: #000;
  line-height: 1.45;
}

.on-ust {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1.5px solid #000;
  border-bottom: none;
  padding: 10px 12px;
  flex-wrap: wrap;
}

.on-logo {
  height: 38px;
  object-fit: contain;
}

.on-ust-orta {
  flex: 1 1 180px;
  text-align: center;
}

.on-ust-baslik {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.on-ust-alt {
  font-size: 11.5px;
  color: #333;
  margin-top: 2px;
}

.on-ust-sag {
  font-size: 10.5px;
  font-weight: 700;
  text-align: right;
}

.on-bant {
  background: #1d2126;
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.6px;
  padding: 6px 10px;
  border: 1.5px solid #000;
  border-bottom: none;
}

.on-bant-aciklama {
  font-weight: 400;
  font-size: 10.5px;
  color: #cfd4cb;
  margin-left: 8px;
}

.on-tablo {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.on-tablo th,
.on-tablo td {
  border: 1px solid #000;
  padding: 6px 8px;
  vertical-align: top;
  word-break: break-word;
}

.on-tablo th {
  background: #f1f2ef;
  font-weight: 600;
  text-align: left;
  width: 26%;
  font-size: 11.5px;
}

.on-tablo td {
  font-weight: 600;
}

.on-tablo-liste {
  table-layout: auto;
  min-width: 560px;
}

.on-tablo-liste th {
  width: auto;
  text-align: center;
  background: #f1f2ef;
}

.on-bos-satir {
  text-align: center;
  font-weight: 400 !important;
  color: #666;
  padding: 12px !important;
}

.on-kaydir {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.on-kutu-alani {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px;
  border: 1px solid #000;
  padding: 8px;
}

.on-kutu {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  padding: 3px 2px;
}

.on-kutu-isaret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1.2px solid #000;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  flex: 0 0 auto;
}

.on-kutu-dolu {
  font-weight: 700;
}

.on-taahhut {
  border: 1px solid #000;
  border-top: none;
  padding: 10px 12px;
  font-size: 11.5px;
  line-height: 1.6;
  text-align: justify;
  margin-top: 10px;
}

.on-imza {
  display: flex;
  border: 1px solid #000;
  border-top: none;
  flex-wrap: wrap;
}

.on-imza-kutu {
  flex: 1 1 150px;
  padding: 8px 10px;
  border-right: 1px solid #000;
}

.on-imza-kutu:last-child {
  border-right: none;
}

.on-imza-etiket {
  display: block;
  font-size: 10.5px;
  color: #444;
}

.on-imza-deger {
  display: block;
  font-weight: 700;
  font-size: 12.5px;
  margin-top: 2px;
}

.on-kunye {
  margin-top: 8px;
  text-align: center;
  font-size: 10.5px;
  color: #555;
}

/* ==========================================================================
   YAZDIRMA
   ========================================================================== */


.on-tablo-sertifika {
  table-layout: auto;
}

.on-tablo-sertifika th {
  width: 34px;
  text-align: center;
}

.on-srt-ad {
  font-weight: 700;
}

.on-srt-alt {
  font-weight: 400;
  font-size: 11px;
  color: #444;
  margin-top: 1px;
}

.on-srt-link {
  display: inline-block;
  margin-top: 3px;
  font-size: 11px;
  font-weight: 400;
  color: #5f8c10;
  word-break: break-all;
}

.on-srt-gorsel-hucre {
  width: 108px;
  text-align: center;
}

.on-srt-gorsel {
  width: 92px;
  height: 92px;
  object-fit: cover;
  border: 1px solid #000;
}

.on-srt-gorsel-yok {
  font-size: 10.5px;
  font-weight: 400;
  color: #777;
}


.on-tablo-riza {
  margin-top: 10px;
}

.on-vesikalik {
  width: 74px;
  height: 94px;
  object-fit: cover;
  border: 1px solid #000;
  flex: 0 0 auto;
}
`;
