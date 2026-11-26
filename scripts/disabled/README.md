# opengraph-image معطّل مؤقتاً — سبب وكيفية التفعيل

## السبب
`@vercel/og` (داخل next/og) يحمّل خطه المضمن عبر `join(import.meta.url, "../noto-sans...ttf")` —
ينكسر على Windows (path.win32 يحقن فواصل `\` داخل file URL) فينهار prerender بـ Invalid URL
ولا يكتمل `npm run build`. لا يتأثر النشر على Vercel (Linux).

## التفعيل على النشر
انقل الملف كأصل `src/app/opengraph-image.tsx` في بيئة Linux/Vercel أو Windows بمسار ASCII فقط.
الخطوط المطلوبة موجودة في `public/fonts/og-cairo-*.woff` والكود يستخدم readFileSync عليها.

## التبعيات الأخرى لهذا الملف
- التعديل المصاحب في `src/app/layout.tsx` (metadataBase + openGraph + twitter) بقي مفعلًا —
  يعمل بلا ملف الصورة (يظهر OG نصي فقط حتى التفعيل).
