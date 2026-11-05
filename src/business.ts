/**
 * Edit this file for your business. It is everything the bot knows.
 * `npm run deploy` refuses to run while any TODO is left here.
 */
export const BUSINESS_NAME = "TODO: اسم نشاطك";

export const BUSINESS_INFO = `
TODO: اكتب هنا كل المعلومات اللي البوت مسموح يرد بيها، مثلًا:
- الخدمات أو المنتجات والأسعار
- مواعيد العمل
- العنوان وطريقة التوصيل
- سياسة الاسترجاع
- الأسئلة اللي بتتكرر وإجاباتها
`;

type FixedMessages = {
  disclosure: string;
  handoff: string;
  unsupported: string;
  unavailable: string;
};

/** Fixed replies, sent without the AI. "intl" is used for anything not written in Arabic. */
export const MESSAGES: { ar: FixedMessages; intl: FixedMessages } = {
  ar: {
    disclosure: "أهلًا! أنا مساعد آلي، ولو حبيت تكلم موظف اكتب «موظف» في أي وقت.",
    handoff: "تمام، طلبك وصل لموظف وهيرد عليك في أقرب وقت.",
    unsupported: "لسه بقدر أقرأ الرسايل المكتوبة بس. ممكن تكتبلي طلبك؟",
    unavailable: "معذرة، مش قادر أرد دلوقتي. جرّب تاني كمان شوية أو اكتب «موظف».",
  },
  intl: {
    disclosure:
      "Ciao! Sono un assistente automatico. Scrivi «operatore» per parlare con una persona.\nHi! I'm an automated assistant. Type \"human\" to reach a person.",
    handoff:
      "Ho inoltrato la tua richiesta a un operatore, ti risponderà appena possibile.\nI've passed your request to a person, who will reply as soon as possible.",
    unsupported:
      "Per ora leggo solo messaggi di testo. Puoi scrivermi la tua richiesta?\nFor now I can only read text messages. Could you type your request?",
    unavailable:
      "Mi dispiace, ora non riesco a rispondere. Riprova più tardi o scrivi «operatore».\nSorry, I can't reply right now. Please try again later or type \"human\".",
  },
};

/** A message containing one of these as a whole word goes straight to a person. */
export const HANDOFF_WORDS = [
  "موظف",
  "انسان",
  "إنسان",
  "خدمة العملاء",
  "human",
  "agent",
  "operatore",
];
