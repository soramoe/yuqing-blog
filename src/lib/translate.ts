const CJK = /[\u4e00-\u9fff]/;

// Google 翻译免密钥接口；只翻含汉字的文本，失败时原样返回，不阻断生图流程
export async function translateToEnglish(text: string) {
  if (!CJK.test(text)) return text;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" +
          encodeURIComponent(text),
        { signal: controller.signal },
      );
      if (!response.ok) return text;
      const payload = (await response.json()) as unknown;
      const rows = Array.isArray(payload) ? (payload[0] as unknown[]) : [];
      const translated = rows
        .map((row) =>
          Array.isArray(row) && typeof row[0] === "string" ? row[0] : "",
        )
        .join("");
      return translated || text;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return text;
  }
}
