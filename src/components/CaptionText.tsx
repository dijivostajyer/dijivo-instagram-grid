/**
 * Gönderi açıklamasını yazıldığı gibi gösterir: satır sonları, boş satırlar
 * ve ardışık boşluklar korunur (`whitespace-pre-wrap`). Hashtag'ler renklenir;
 * metin hiçbir aşamada trim/normalize edilmez ve hashtag sonrasına ek boşluk
 * eklenmez (yazılan metin birebir görünür).
 */
export default function CaptionText({ caption }: { caption: string }) {
  const parts = caption.split(/(#[\p{L}\d_]+)/gu);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("#") ? (
          <span key={index} className="text-sky-700 dark:text-sky-400">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
