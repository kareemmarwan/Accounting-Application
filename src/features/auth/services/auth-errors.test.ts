import { describe, expect, it } from "vitest";
import { mapAuthError, NOT_CONFIGURED_MESSAGE } from "./auth-errors";

describe("mapAuthError", () => {
  it("يترجم بيانات الدخول غير الصحيحة", () => {
    expect(mapAuthError(new Error("Invalid login credentials"))).toBe(
      "البريد الإلكتروني أو كلمة المرور غير صحيحة"
    );
  });

  it("يترجم بريداً غير مؤكد", () => {
    expect(mapAuthError(new Error("Email not confirmed"))).toBe(
      "لم يتم تأكيد البريد الإلكتروني بعد — تحقق من صندوق الوارد"
    );
  });

  it("يترجم بريداً مسجلاً مسبقاً", () => {
    expect(mapAuthError(new Error("User already registered"))).toBe(
      "هذا البريد مسجل مسبقاً — جرّب تسجيل الدخول"
    );
  });

  it("يترجم تجاوز حد المحاولات", () => {
    expect(
      mapAuthError(new Error("Too many requests from this IP address"))
    ).toBe("محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة");
  });

  it("يترجم فشل الشبكة", () => {
    expect(mapAuthError(new Error("TypeError: fetch failed"))).toBe(
      "تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت"
    );
  });

  it("يترجم رسالة عدم الإعداد كما هي", () => {
    expect(mapAuthError(new Error(NOT_CONFIGURED_MESSAGE))).toBe(
      NOT_CONFIGURED_MESSAGE
    );
  });

  it("يرجع رسالة عامة لخطأ غير معروف", () => {
    expect(mapAuthError(new Error("some obscure error"))).toBe(
      "حدث خطأ غير متوقع — أعد المحاولة"
    );
  });

  it("يتعامل مع كائنات بها message نصي", () => {
    expect(mapAuthError({ message: "Invalid login credentials" })).toBe(
      "البريد الإلكتروني أو كلمة المرور غير صحيحة"
    );
  });

  it("يرجع رسالة عامة عند عدم وجود رسالة", () => {
    expect(mapAuthError(null)).toBe("حدث خطأ غير متوقع — أعد المحاولة");
  });
});
