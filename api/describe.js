// دالة الخادم: تستقبل الصورة وترسلها لـ Claude وترجع الرد.
// مفتاح ANTHROPIC_API_KEY يُقرأ من إعدادات Vercel فقط، ولا يظهر للمستخدم أبدًا.

const hits = new Map(); // حد الطلبات لكل جهاز (تقريبي)
const LIMIT = 40;       // أقصى عدد طلبات في الدقيقة لكل جهاز

const RULES = `أنت "عيني"، مساعد لشخص لا يبصر. تكلم بلهجة سعودية بيضاء، بجمل قصيرة وبسيطة، بدون رموز أو قوائم.
إذا كانت الصورة غير واضحة أو الشيء مقطوع أو مظلم: لا تصفه، وجّهه بجملة واحدة قصيرة (مثل: "قرّب شوي"، "ارفع العلبة"، "لف العلبة للجنب الثاني"، "شغّل الضوء") وخلّ status = "guide".
إذا كانت الصورة واضحة: قل وش هو الشيء، ثم اقرأ النص المهم فقط (الاسم، الجرعة، السعر، التاريخ) وخلّ status = "ready".
في الأدوية: لا تعطِ جرعة من عندك، وذكّره يسأل الصيدلي.
أجب بـ JSON فقط بهذا الشكل: {"status":"guide","text":"..."}`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const ip = (req.headers["x-forwarded-for"] || "x").split(",")[0];
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "كثرت الطلبات، انتظر دقيقة." });
  recent.push(now); hits.set(ip, recent);

  const { image, question, lastAnswer } = req.body || {};
  if (!image || image.length > 1500000) return res.status(400).json({ error: "الصورة غير صالحة." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "المفتاح غير مضبوط." });

  const userText = question
    ? `آخر ما قلته له: ${String(lastAnswer || "").slice(0, 500)}\nسؤاله الحين: ${String(question).slice(0, 300)}\nجاوبه من الصورة بإيجاز، وخلّ status = "ready".`
    : "هذه الصورة الحالية. ابدأ.";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 400,
        system: RULES,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: userText },
          ],
        }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "تعذّر الاتصال بالذكاء الاصطناعي." });
    const data = await r.json();
    const raw = (data.content || []).map(c => c.text || "").join("").replace(/```json|```/g, "").trim();
    let out;
    try { out = JSON.parse(raw); } catch { out = { status: "guide", text: raw }; }
    return res.status(200).json({ status: out.status === "ready" ? "ready" : "guide", text: out.text || "" });
  } catch (e) {
    return res.status(500).json({ error: "صار خطأ في الخادم." });
  }
}
