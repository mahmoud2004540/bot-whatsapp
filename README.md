# بوت واتساب بالذكاء الاصطناعي

بوت خدمة عملاء بيرد تلقائيًا على رسايل واتساب من معلومات نشاطك بس، ومعمول بحيث تقدر تضيف عليه منصات تانية بعدين.

## البوت بيعمل إيه

- بيرد بلغة العميل ولهجته، وبياخد آخر 10 رسايل في الاعتبار.
- بيعرّف نفسه إنه مساعد آلي في أول رد لكل عميل.
- بيحوّل العميل لشخص لو كتب «موظف» أو `human` أو `operatore`، أو لو السؤال مش موجود في معلوماتك. وقتها بيسكت 24 ساعة أو لحد ما ترجّعه.
- بيوقف الردود عند 950 رسالة في الشهر، عشان تفضل جوه الـ1,000 رسالة المجانية.
- بيرد على عميل واحد بحد أقصى 20 رسالة في الساعة، عشان محدش يخلّص رصيدك.
- بيتجاهل تكرار الـWebhook، وبيرفض أي طلب توقيعه غلط.
- بيمسح الرسايل الأقدم من 30 يوم تلقائيًا.

## إزاي بيشتغل

```text
العميل ← واتساب ← Cloudflare Worker ← Groq (الرد)
                        ↓
              D1 (المحادثات والعدّادات)
```

| الجزء | الملف |
|---|---|
| معلومات نشاطك والرسايل الثابتة | `src/business.ts` |
| منطق البوت | `src/bot.ts` |
| تعليمات الذكاء الاصطناعي | `src/llm.ts` |
| الربط بواتساب | `src/channels/whatsapp.ts` |
| قاعدة البيانات | `src/store.ts` |
| أوامر الإدارة | `src/admin.ts` |

## اللي هتحتاجه

- Node.js 20 أو أحدث
- حساب [Cloudflare](https://dash.cloudflare.com/sign-up)
- حساب [Groq](https://console.groq.com)
- حساب [Meta for Developers](https://developers.facebook.com)

## التشغيل خطوة بخطوة

### 1. ثبّت المشروع

```bash
npm install
cp .dev.vars.example .dev.vars
```

### 2. اكتب معلومات نشاطك

افتح `src/business.ts` وغيّر كل `TODO`. البوت مش هيرد إلا من المعلومات دي، و`npm run deploy` هيرفض يشتغل طول ما فيه `TODO`.

### 3. جهّز قاعدة البيانات

```bash
npx wrangler login
npx wrangler d1 create whatsapp-bot
```

انسخ الـ`database_id` اللي هيظهرلك وحطه في `wrangler.toml`، وبعدين:

```bash
npm run db:remote
```

### 4. جهّز Meta

1. من [My Apps](https://developers.facebook.com/apps) اعمل تطبيق Business وضيف له WhatsApp.
2. من **WhatsApp > API Setup** خد الـ`Phone number ID` والتوكن.
3. ضيف رقمك في قائمة المستلمين بتاعة رقم الاختبار.
4. من **App settings > Basic** خد الـ`App Secret`.

> التوكن اللي في API Setup مؤقت وبينتهي بسرعة، فهو للتجربة بس. للاستخدام الفعلي اعمل توكن System User من Business Settings بصلاحيتي `whatsapp_business_messaging` و`whatsapp_business_management`.

### 5. خد مفتاح Groq

اعمل API key من [console.groq.com/keys](https://console.groq.com/keys).

### 6. ضيف الأسرار

نفّذ كل سطر وادخل القيمة لما يطلبها منك:

```bash
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

`WHATSAPP_VERIFY_TOKEN` و`ADMIN_TOKEN` إنت اللي بتختارهم. تقدر تعمل قيمة قوية لكل واحد بالأمر ده:

```bash
openssl rand -hex 32
```

### 7. ارفع البوت

```bash
npm run deploy
```

هيطلعلك رابط زي `https://whatsapp-bot.<حسابك>.workers.dev`.

### 8. اربط الـWebhook

من **WhatsApp > Configuration** في Meta:

1. **Callback URL:** `https://whatsapp-bot.<حسابك>.workers.dev/webhook/whatsapp`
2. **Verify token:** نفس قيمة `WHATSAPP_VERIFY_TOKEN`
3. اضغط **Verify and save**، وبعدها اشترك في حقل `messages`.

### 9. جرّب

ابعت رسالة من رقمك لرقم الاختبار. لو مفيش رد، شوف السجلات:

```bash
npx wrangler tail
```

## الانتقال لرقم حقيقي

رقم الاختبار بيبعت لأرقام مسجلة بس. عشان تستقبل عملاء بجد:

1. جهّز رقم مخصوص للبوت، لأن الرقم الشغال على تطبيق واتساب عادةً لازم يتشال منه الأول.
2. كمّل توثيق البيزنس في Meta لو طلبه منك.
3. ضيف الرقم في Meta، وحدّث `WHATSAPP_PHONE_NUMBER_ID`.
4. حوّل التطبيق لوضع **Live**.

## الرد بنفسك على العميل

رقم الـAPI مش بيشتغل عادةً على الموبايل، فبترد من خلال أوامر الإدارة:

```bash
BOT=https://whatsapp-bot.<حسابك>.workers.dev
AUTH="Authorization: Bearer <ADMIN_TOKEN>"
NUMBER=393331112222

# مين مستني موظف
curl -H "$AUTH" $BOT/admin/whatsapp/handoffs

# قراءة المحادثة
curl -H "$AUTH" $BOT/admin/whatsapp/conversations/$NUMBER

# الرد على العميل
curl -X POST -H "$AUTH" -d '{"text":"أهلًا، معاك محمود"}' \
  $BOT/admin/whatsapp/conversations/$NUMBER/reply

# رجوع البوت للرد
curl -X POST -H "$AUTH" $BOT/admin/whatsapp/conversations/$NUMBER/resume

# عدد الرسايل المستخدمة الشهر ده
curl -H "$AUTH" $BOT/admin/whatsapp/stats

# مسح بيانات عميل طلب حذفها
curl -X DELETE -H "$AUTH" $BOT/admin/whatsapp/conversations/$NUMBER
```

**تنبيه الموظف:** لو ضفت السر `OWNER_WHATSAPP`، البوت هيبعتلك رسالة لما عميل يطلب موظف. بس دي بتوصل بس لو كنت باعت للبوت من الرقم ده في آخر 24 ساعة، فراجع `handoffs` كمان.

## الإعدادات

في `wrangler.toml`:

| الإعداد | الافتراضي | الوظيفة |
|---|---|---|
| `MONTHLY_REPLY_LIMIT` | `950` | الحد الأقصى لرسايل البوت في الشهر |
| `MAX_USER_MSGS_PER_HOUR` | `20` | رسايل العميل الواحد في الساعة |
| `HANDOFF_HOURS` | `24` | مدة سكوت البوت بعد التحويل لموظف |
| `RETENTION_DAYS` | `30` | مدة الاحتفاظ بالرسايل |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | النموذج الأساسي |
| `GROQ_FALLBACK_MODEL` | `llama-3.1-8b-instant` | النموذج البديل لو الأساسي وصل لحده |
| `GRAPH_API_VERSION` | `v26.0` | إصدار API بتاع Meta |

## التكلفة

المشروع مصمم يفضل مجاني في حدود الاستخدام القليل، بس الأسعار والحدود بتتغير، فراجعها قبل ما تطلق البوت:

- **Meta:** أول 1,000 رد خدمة في الشهر لكل رقم مجاني، وبعدها بتتحاسب على كل رسالة. الرسايل اللي بتبدأها إنت بقوالب ليها سعر منفصل، والبوت ده مش بيبعتها.
- **Groq:** الخطة المجانية ليها حد يومي. لو الحد خلص في النموذجين، العميل بياخد رسالة اعتذار.
- **Cloudflare:** الخطة المجانية لـWorkers وD1 المفروض تكفي الاستخدام القليل.

راجع الأسعار من [Meta](https://developers.facebook.com/docs/whatsapp/pricing) و[Groq](https://console.groq.com/docs/rate-limits) و[Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/).

## الأمان والخصوصية

- متحطش أي سر في الكود. `.dev.vars` متسجل في `.gitignore`.
- الذكاء الاصطناعي بيكتب نص بس، ومعندوش أي صلاحية على قاعدة البيانات أو غيرها، فلو حد حاول يخدعه أقصى ضرر هو رد غلط.
- متكتبش في `business.ts` أي حاجة مش عاوز العملاء يشوفوها، لأن محاولات خداع النموذج ممكن تكشف محتواه.
- الرسايل فيها بيانات شخصية والـGDPR بيسري عليها. لو البوت لنشاط حقيقي، لازم سياسة خصوصية توضح إن الرسايل بتتخزن وبتتبعت لـGroq، وتراجع الالتزامات دي مع متخصص.
- ده بوت لخدمة عملاء نشاطك. المساعدات العامة ليها سياسة ورسوم مختلفة عند Meta.

## إضافة منصة جديدة

1. اعمل ملف زي `src/channels/instagram.ts` ينفّذ واجهة `Channel` الموجودة في `src/types.ts`.
2. سجّله في `src/channels/index.ts`.

المنصة هتشتغل على `/webhook/instagram`، وهتستخدم نفس منطق البوت وقاعدة البيانات وأوامر الإدارة. راجع قواعد كل منصة الأول، زي نافذة الرد والمناطق المدعومة، لأن فحص عمر الرسالة في `src/bot.ts` مظبوط حاليًا على 24 ساعة.

## التطوير والاختبار

```bash
npm run typecheck   # فحص الأنواع
npm test            # الاختبارات السريعة
npm run test:e2e    # تشغيل البوت كامل مع واتساب وGroq وهميين
```

`test:e2e` مش محتاج حسابات أو مفاتيح، ومش بيبعت أي حاجة بره جهازك.

للتشغيل المحلي:

```bash
npm run db:local
npm run dev
```

## حل المشاكل

| المشكلة | السبب المحتمل |
|---|---|
| Meta بيرفض الـWebhook | `WHATSAPP_VERIFY_TOKEN` مختلف، أو الرابط ناقصه `/webhook/whatsapp` |
| الرسايل مش بتوصل للبوت | مش مشترك في حقل `messages`، وفي الأرقام الحقيقية ممكن كمان تكون محتاج تربط الـWABA بالتطبيق عن طريق `subscribed_apps` |
| `Invalid signature` في السجلات | `WHATSAPP_APP_SECRET` غلط |
| `HTTP 401` عند الإرسال | التوكن انتهى، استخدم توكن System User |
| `code 131030` | رقمك مش في قائمة المستلمين بتاعة رقم الاختبار |
| `code 131047` | عدّت 24 ساعة من آخر رسالة للعميل |
| البوت ساكت مع عميل | شوف `handoffs` و`stats`، ممكن يكون محوّل لموظف أو الحد الشهري خلص |
| `no such table` | لسه ما نفذتش `npm run db:remote` |
